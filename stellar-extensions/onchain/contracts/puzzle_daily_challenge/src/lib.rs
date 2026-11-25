// Allow `std` access during `cargo test` while keeping the deployed contract
// `no_std` for the WASM build.
#![cfg_attr(not(test), no_std)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, token::TokenClient,
    Address, Bytes, BytesN, Env, Symbol,
};

// ---------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    RewardToken,
    /// Highest day a challenge has been opened for. Used to keep days
    /// strictly increasing so an old day can never be reopened.
    LastOpenedDay,
    /// Challenge hash of the most recently opened day, chained into the
    /// next day's hash so a day's challenge commits to its history.
    LastChallengeHash,
    /// A day's challenge, including the solution hash.
    Challenge(u64),
    /// Presence of this key is the per-player, per-day replay guard.
    Completion(Address, u64),
    /// A player's streak bookkeeping.
    StreakState(Address),
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

/// Stored challenge record. `solution_hash` stays internal: the public
/// `ChallengeView` never exposes it.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DailyChallenge {
    pub day: u64,
    pub challenge_hash: BytesN<32>,
    pub solution_hash: BytesN<32>,
    pub reward_amount: i128,
    pub completion_count: u32,
    pub active: bool,
}

/// Public view of a challenge without the solution hash.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ChallengeView {
    pub day: u64,
    pub challenge_hash: BytesN<32>,
    pub reward_amount: i128,
    pub completion_count: u32,
    pub active: bool,
}

/// Immutable record of a verified daily completion.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CompletionRecord {
    pub player: Address,
    pub day: u64,
    pub streak: u32,
    pub reward_paid: i128,
    /// Ledger timestamp at which the submission was verified.
    pub completed_at: u64,
}

/// Per-player streak state, updated on each verified completion.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreakState {
    pub player: Address,
    pub last_completed_day: u64,
    pub streak: u32,
    pub total_completions: u32,
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    InvalidRewardAmount = 4,
    EmptyField = 5,
    InputTooLarge = 6,
    ChallengeNotFound = 7,
    ChallengeNotActive = 8,
    /// The day was already opened, or is not later than the last opened day.
    /// Both cases are rejected so a past challenge cannot be replayed.
    ChallengeAlreadyOpened = 9,
    /// Submission attempted outside the challenge's own day.
    NotChallengeDay = 10,
    SolutionMismatch = 11,
    AlreadyCompleted = 12,
    ArithmeticOverflow = 13,
    RewardTransferFailed = 14,
}

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

const SECONDS_PER_DAY: u64 = 86_400;
const MAX_SEED_LEN: u32 = 256;
const MAX_SOLUTION_LEN: u32 = 1_024;

/// Base reward multiplier for the first day of a streak (100%).
const BASE_MULTIPLIER_BPS: u32 = 10_000;
/// Each additional consecutive day adds 25 percentage points.
const STREAK_STEP_BPS: u32 = 2_500;
/// Cap the streak at 3x so rewards cannot grow without bound.
const MAX_MULTIPLIER_BPS: u32 = 30_000;

// Ledger TTL bumps: keep daily challenge state available for roughly a month,
// refreshing on every write.
const INSTANCE_BUMP_THRESHOLD: u32 = 17_280;
const INSTANCE_BUMP_AMOUNT: u32 = 518_400;
const PERSISTENT_BUMP_THRESHOLD: u32 = 17_280;
const PERSISTENT_BUMP_AMOUNT: u32 = 518_400;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn require_admin(env: &Env) {
    load_admin(env).require_auth();
}

fn load_reward_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::RewardToken)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn load_challenge(env: &Env, day: u64) -> DailyChallenge {
    env.storage()
        .persistent()
        .get(&DataKey::Challenge(day))
        .unwrap_or_else(|| panic_with_error!(env, Error::ChallengeNotFound))
}

fn load_streak_state(env: &Env, player: &Address) -> StreakState {
    env.storage()
        .persistent()
        .get(&DataKey::StreakState(player.clone()))
        .unwrap_or(StreakState {
            player: player.clone(),
            last_completed_day: 0,
            streak: 0,
            total_completions: 0,
        })
}

/// Days since the Unix epoch, so a "daily" challenge is derived from ledger
/// time rather than a caller-supplied value.
fn current_day(env: &Env) -> u64 {
    env.ledger().timestamp() / SECONDS_PER_DAY
}

/// Streak multipliers: day 1 = 1.00x, day 2 = 1.25x, ... capped at 3.00x.
pub fn streak_multiplier_bps(streak: u32) -> u32 {
    let capped_steps = (MAX_MULTIPLIER_BPS - BASE_MULTIPLIER_BPS) / STREAK_STEP_BPS;
    let steps = streak.saturating_sub(1).min(capped_steps);
    (BASE_MULTIPLIER_BPS + steps * STREAK_STEP_BPS).min(MAX_MULTIPLIER_BPS)
}

fn reward_for(env: &Env, challenge: &DailyChallenge, streak: u32) -> i128 {
    challenge
        .reward_amount
        .checked_mul(streak_multiplier_bps(streak) as i128)
        .unwrap_or_else(|| panic_with_error!(env, Error::ArithmeticOverflow))
        / 10_000
}

/// Builds `sha256(domain || previous_challenge_hash || day || seed || solution_hash)`.
///
/// Chaining the previous challenge hash makes each day's challenge depend on
/// the full history, so a day's hash cannot be precomputed or swapped in
/// isolation. Including the solution hash commits the challenge to its answer.
fn derive_challenge_hash(
    env: &Env,
    previous: Option<&BytesN<32>>,
    day: u64,
    seed: &Bytes,
    solution_hash: &BytesN<32>,
) -> BytesN<32> {
    let mut preimage = Bytes::new(env);
    preimage.extend_from_array(b"stellar-hunts-daily-v1");
    if let Some(prev) = previous {
        preimage.extend_from_array(&prev.to_array());
    }
    preimage.extend_from_array(&day.to_be_bytes());
    preimage.append(seed);
    preimage.extend_from_array(&solution_hash.to_array());
    env.crypto().sha256(&preimage).into()
}

// ---------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------

#[contract]
pub struct PuzzleDailyChallenge;

#[contractimpl]
impl PuzzleDailyChallenge {
    /// Configures the contract exactly once.
    ///
    /// * `admin` — account allowed to open/close challenges and manage the
    ///   reward token.
    /// * `reward_token` — SEP-41 token paid out for completions.
    pub fn init(env: Env, admin: Address, reward_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RewardToken, &reward_token);
        env.storage().instance().set(&DataKey::LastOpenedDay, &0u64);
        bump_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "daily_initialized"),),
            (admin, reward_token),
        );
    }

    /// Updates the token used for completion rewards. Admin only.
    pub fn set_reward_token(env: Env, token: Address) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::RewardToken, &token);
        bump_instance(&env);

        env.events()
            .publish((Symbol::new(&env, "reward_token_updated"),), (token,));
    }

    /// Moves `amount` of the reward token from the admin into the contract's
    /// reward pool. Returns the pool balance after the transfer.
    pub fn fund_reward_pool(env: Env, amount: i128) -> i128 {
        require_admin(&env);
        if amount < 0 {
            panic_with_error!(&env, Error::InvalidRewardAmount);
        }

        let admin = load_admin(&env);
        let token = load_reward_token(&env);
        let client = TokenClient::new(&env, &token);
        let contract = env.current_contract_address();

        match client.try_transfer(&admin, &contract, &amount) {
            Ok(Ok(())) => {}
            _ => panic_with_error!(&env, Error::RewardTransferFailed),
        }
        bump_instance(&env);

        env.events()
            .publish((Symbol::new(&env, "reward_pool_funded"),), (admin, amount));
        client.balance(&contract)
    }

    /// Opens the challenge for the current UTC day. Admin only.
    ///
    /// The day comes from ledger time and must be strictly later than the last
    /// opened day, which prevents reopening (and therefore replaying) an old
    /// challenge. The challenge hash is derived on-chain from the previous
    /// day's hash, the day, the admin seed, and the solution hash.
    ///
    /// Returns the generated challenge hash.
    pub fn open_daily_challenge(
        env: Env,
        seed: Bytes,
        solution_hash: BytesN<32>,
        reward_amount: i128,
    ) -> BytesN<32> {
        require_admin(&env);

        if reward_amount < 0 {
            panic_with_error!(&env, Error::InvalidRewardAmount);
        }
        if seed.is_empty() {
            panic_with_error!(&env, Error::EmptyField);
        }
        if seed.len() > MAX_SEED_LEN {
            panic_with_error!(&env, Error::InputTooLarge);
        }

        let day = current_day(&env);
        let last_opened: u64 = env
            .storage()
            .instance()
            .get(&DataKey::LastOpenedDay)
            .unwrap_or(0u64);
        if day <= last_opened {
            panic_with_error!(&env, Error::ChallengeAlreadyOpened);
        }

        let previous: Option<BytesN<32>> =
            env.storage().instance().get(&DataKey::LastChallengeHash);
        let challenge_hash =
            derive_challenge_hash(&env, previous.as_ref(), day, &seed, &solution_hash);

        let challenge = DailyChallenge {
            day,
            challenge_hash: challenge_hash.clone(),
            solution_hash,
            reward_amount,
            completion_count: 0,
            active: true,
        };

        let key = DataKey::Challenge(day);
        env.storage().persistent().set(&key, &challenge);
        bump_persistent(&env, &key);

        env.storage().instance().set(&DataKey::LastOpenedDay, &day);
        env.storage()
            .instance()
            .set(&DataKey::LastChallengeHash, &challenge_hash);
        bump_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "challenge_opened"),),
            (day, challenge_hash.clone(), reward_amount),
        );

        challenge_hash
    }

    /// Closes an opened challenge so no further submissions are accepted.
    /// Admin only.
    pub fn close_daily_challenge(env: Env, day: u64) {
        require_admin(&env);

        let mut challenge = load_challenge(&env, day);
        challenge.active = false;
        let key = DataKey::Challenge(day);
        env.storage().persistent().set(&key, &challenge);
        bump_persistent(&env, &key);

        env.events()
            .publish((Symbol::new(&env, "challenge_closed"),), (day,));
    }

    /// Verifies `solution` against the day's solution hash, records the
    /// completion, and pays the streak-adjusted reward.
    ///
    /// Replay protection is layered:
    /// * a challenge can only be opened once, for a strictly increasing day;
    /// * submissions are only accepted on the challenge's own day;
    /// * `Completion(player, day)` makes a second completion impossible.
    ///
    /// The completion record is written before the token transfer. Soroban
    /// reverts the whole invocation if the transfer fails, and a reentrant
    /// token cannot complete twice because the guard is already set.
    pub fn submit_daily_solution(
        env: Env,
        player: Address,
        day: u64,
        solution: Bytes,
    ) -> CompletionRecord {
        player.require_auth();

        if solution.is_empty() {
            panic_with_error!(&env, Error::EmptyField);
        }
        if solution.len() > MAX_SOLUTION_LEN {
            panic_with_error!(&env, Error::InputTooLarge);
        }

        let mut challenge = load_challenge(&env, day);
        if !challenge.active {
            panic_with_error!(&env, Error::ChallengeNotActive);
        }
        if day != current_day(&env) {
            panic_with_error!(&env, Error::NotChallengeDay);
        }

        let completion_key = DataKey::Completion(player.clone(), day);
        if env.storage().persistent().has(&completion_key) {
            panic_with_error!(&env, Error::AlreadyCompleted);
        }

        let submitted: BytesN<32> = env.crypto().sha256(&solution).into();
        if submitted != challenge.solution_hash {
            panic_with_error!(&env, Error::SolutionMismatch);
        }

        let mut state = load_streak_state(&env, &player);
        let streak = if state.last_completed_day.checked_add(1) == Some(day) {
            state
                .streak
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, Error::ArithmeticOverflow))
        } else {
            1
        };

        let reward = reward_for(&env, &challenge, streak);
        let completed_at = env.ledger().timestamp();

        let record = CompletionRecord {
            player: player.clone(),
            day,
            streak,
            reward_paid: reward,
            completed_at,
        };
        env.storage().persistent().set(&completion_key, &record);
        bump_persistent(&env, &completion_key);

        challenge.completion_count = challenge
            .completion_count
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ArithmeticOverflow));
        let challenge_key = DataKey::Challenge(day);
        env.storage().persistent().set(&challenge_key, &challenge);
        bump_persistent(&env, &challenge_key);

        state.last_completed_day = day;
        state.streak = streak;
        state.total_completions = state
            .total_completions
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ArithmeticOverflow));
        let state_key = DataKey::StreakState(player.clone());
        env.storage().persistent().set(&state_key, &state);
        bump_persistent(&env, &state_key);

        if reward > 0 {
            let token = load_reward_token(&env);
            let client = TokenClient::new(&env, &token);
            match client.try_transfer(&env.current_contract_address(), &player, &reward) {
                Ok(Ok(())) => {}
                _ => panic_with_error!(&env, Error::RewardTransferFailed),
            }
        }

        bump_instance(&env);
        env.events().publish(
            (Symbol::new(&env, "daily_completed"),),
            (player, day, streak, reward),
        );

        record
    }

    // -----------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------

    /// Public challenge information (never includes the solution hash).
    pub fn get_challenge(env: Env, day: u64) -> ChallengeView {
        let challenge = load_challenge(&env, day);
        ChallengeView {
            day: challenge.day,
            challenge_hash: challenge.challenge_hash,
            reward_amount: challenge.reward_amount,
            completion_count: challenge.completion_count,
            active: challenge.active,
        }
    }

    pub fn has_completed(env: Env, player: Address, day: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Completion(player, day))
    }

    pub fn get_completion(env: Env, player: Address, day: u64) -> CompletionRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Completion(player, day))
            .unwrap_or_else(|| panic_with_error!(&env, Error::ChallengeNotFound))
    }

    pub fn get_streak(env: Env, player: Address) -> u32 {
        load_streak_state(&env, &player).streak
    }

    pub fn get_streak_state(env: Env, player: Address) -> StreakState {
        load_streak_state(&env, &player)
    }

    /// Reward the player would receive if they completed `day` now, including
    /// the streak multiplier the completion would earn.
    pub fn preview_reward(env: Env, player: Address, day: u64) -> i128 {
        let challenge = load_challenge(&env, day);
        let state = load_streak_state(&env, &player);
        let streak = if state.last_completed_day.checked_add(1) == Some(day) {
            state.streak.saturating_add(1)
        } else {
            1
        };
        reward_for(&env, &challenge, streak)
    }

    /// Multiplier for a given streak, in basis points (10,000 = 1x).
    pub fn get_streak_multiplier_bps(_env: Env, streak: u32) -> u32 {
        streak_multiplier_bps(streak)
    }

    pub fn get_current_day(env: Env) -> u64 {
        current_day(&env)
    }

    pub fn get_last_opened_day(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::LastOpenedDay)
            .unwrap_or(0u64)
    }

    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    pub fn get_reward_token(env: Env) -> Address {
        load_reward_token(&env)
    }
}

#[cfg(test)]
mod test;
