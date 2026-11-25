#![cfg(test)]

use crate::{Error, PuzzleDailyChallenge, PuzzleDailyChallengeClient, StreakState};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Error as SdkError};

// ---------------------------------------------------------------------
// Minimal SEP-41-compatible token used for rewards in tests.
// ---------------------------------------------------------------------

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let current: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        env.storage().persistent().set(&to, &(current + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().persistent().get(&id).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let from_balance: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        let to_balance: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        assert!(from_balance >= amount, "insufficient balance");
        env.storage()
            .persistent()
            .set(&from, &(from_balance - amount));
        env.storage().persistent().set(&to, &(to_balance + amount));
    }
}

/// Assert that a `try_*` client call failed with `expected`.
fn assert_contract_error<T>(
    result: Result<
        Result<T, <T as soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>::Error>,
        Result<SdkError, soroban_sdk::InvokeError>,
    >,
    expected: Error,
) where
    T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val> + core::fmt::Debug,
    <T as soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>::Error: core::fmt::Debug,
{
    match result {
        Err(Ok(err)) => assert_eq!(
            err,
            SdkError::from_contract_error(expected as u32),
            "unexpected contract error",
        ),
        other => panic!("expected {expected:?}, got {other:?}"),
    }
}

// ---------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------

const SECONDS_PER_DAY: u64 = 86_400;
const DAY: u64 = 20_000;

struct Fixture {
    env: Env,
    contract_id: Address,
    token_id: Address,
    admin: Address,
    alice: Address,
    bob: Address,
}

fn set_day(env: &Env, day: u64) {
    env.ledger().set_timestamp(day * SECONDS_PER_DAY + 3_600);
}

fn sha(env: &Env, bytes: &Bytes) -> BytesN<32> {
    env.crypto().sha256(bytes).into()
}

fn solution_hash(env: &Env, solution: &[u8]) -> BytesN<32> {
    sha(env, &Bytes::from_slice(env, solution))
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    set_day(&env, DAY);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let token_id = env.register(MockToken, ());
    let contract_id = env.register(PuzzleDailyChallenge, ());
    PuzzleDailyChallengeClient::new(&env, &contract_id).init(&admin, &token_id);

    Fixture {
        env,
        contract_id,
        token_id,
        admin,
        alice,
        bob,
    }
}

impl Fixture {
    fn client(&self) -> PuzzleDailyChallengeClient<'_> {
        PuzzleDailyChallengeClient::new(&self.env, &self.contract_id)
    }

    fn token(&self) -> MockTokenClient<'_> {
        MockTokenClient::new(&self.env, &self.token_id)
    }

    fn fund(&self, amount: i128) {
        self.token().mint(&self.admin, &amount);
        self.client().fund_reward_pool(&amount);
    }

    fn open(&self, seed: &[u8], solution: &[u8], reward: i128) -> BytesN<32> {
        self.client().open_daily_challenge(
            &Bytes::from_slice(&self.env, seed),
            &solution_hash(&self.env, solution),
            &reward,
        )
    }

    fn submit(&self, player: &Address, day: u64, solution: &[u8]) -> crate::CompletionRecord {
        self.client()
            .submit_daily_solution(player, &day, &Bytes::from_slice(&self.env, solution))
    }

    fn expected_hash(
        &self,
        previous: Option<&BytesN<32>>,
        day: u64,
        seed: &[u8],
        solution: &[u8],
    ) -> BytesN<32> {
        let mut preimage = Bytes::new(&self.env);
        preimage.extend_from_array(b"stellar-hunts-daily-v1");
        if let Some(prev) = previous {
            preimage.extend_from_array(&prev.to_array());
        }
        preimage.extend_from_array(&day.to_be_bytes());
        preimage.append(&Bytes::from_slice(&self.env, seed));
        preimage.extend_from_array(&solution_hash(&self.env, solution).to_array());
        sha(&self.env, &preimage)
    }
}

// ---------------------------------------------------------------------
// Initialization and configuration
// ---------------------------------------------------------------------

#[test]
fn init_stores_admin_and_reward_token() {
    let f = setup();

    assert_eq!(f.client().get_admin(), f.admin);
    assert_eq!(f.client().get_reward_token(), f.token_id);
    assert_eq!(f.client().get_last_opened_day(), 0);
}

#[test]
fn init_can_only_run_once() {
    let f = setup();
    let other = Address::generate(&f.env);

    assert_contract_error(
        f.client().try_init(&other, &f.token_id),
        Error::AlreadyInitialized,
    );
}

#[test]
fn admin_can_update_reward_token() {
    let f = setup();
    let new_token = Address::generate(&f.env);

    f.client().set_reward_token(&new_token);

    assert_eq!(f.client().get_reward_token(), new_token);
}

#[test]
fn admin_calls_require_authorization() {
    let f = setup();
    let new_token = Address::generate(&f.env);

    // Drop the blanket auth mock; with no signed auth entries the admin
    // require_auth check must fail.
    f.env.mock_auths(&[]);

    let result = f.client().try_set_reward_token(&new_token);
    assert!(result.is_err(), "unauthorized update must fail");
}

#[test]
fn fund_reward_pool_moves_tokens_into_the_contract() {
    let f = setup();
    f.token().mint(&f.admin, &10_000);

    let pool = f.client().fund_reward_pool(&1_000);

    assert_eq!(pool, 1_000);
    assert_eq!(f.token().balance(&f.contract_id), 1_000);
    assert_eq!(f.token().balance(&f.admin), 9_000);
}

#[test]
fn fund_reward_pool_rejects_negative_amounts() {
    let f = setup();

    assert_contract_error(
        f.client().try_fund_reward_pool(&-1),
        Error::InvalidRewardAmount,
    );
}

// ---------------------------------------------------------------------
// Challenge generation
// ---------------------------------------------------------------------

#[test]
fn open_derives_the_challenge_hash_on_chain() {
    let f = setup();
    let expected = f.expected_hash(None, DAY, b"seed-1", b"solve-1");

    let actual = f.open(b"seed-1", b"solve-1", 1_000);

    assert_eq!(actual, expected);
    let view = f.client().get_challenge(&DAY);
    assert_eq!(view.challenge_hash, expected);
    assert_eq!(view.reward_amount, 1_000);
    assert_eq!(view.completion_count, 0);
    assert!(view.active);
    assert_eq!(f.client().get_last_opened_day(), DAY);
}

#[test]
fn each_day_chains_the_previous_challenge_hash() {
    let f = setup();
    let first = f.open(b"seed-1", b"solve-1", 1_000);

    set_day(&f.env, DAY + 1);
    let second = f.open(b"seed-2", b"solve-2", 1_000);

    let expected = f.expected_hash(Some(&first), DAY + 1, b"seed-2", b"solve-2");
    assert_eq!(second, expected);
    assert_ne!(first, second);
}

#[test]
fn same_seed_and_solution_produce_different_daily_hashes() {
    let f = setup();
    let first = f.open(b"seed", b"answer", 100);

    set_day(&f.env, DAY + 1);
    let second = f.open(b"seed", b"answer", 100);

    assert_ne!(first, second, "the day and chain must affect the hash");
}

#[test]
fn rejects_opening_the_same_day_twice() {
    let f = setup();
    f.open(b"seed", b"answer", 100);

    assert_contract_error(
        f.client().try_open_daily_challenge(
            &Bytes::from_slice(&f.env, b"seed"),
            &solution_hash(&f.env, b"other"),
            &100,
        ),
        Error::ChallengeAlreadyOpened,
    );
}

#[test]
fn rejects_reopening_a_past_day() {
    let f = setup();
    f.open(b"seed-1", b"solve-1", 100);

    set_day(&f.env, DAY + 1);
    f.open(b"seed-2", b"solve-2", 100);

    // Pretend the clock moved back: the day is not strictly newer.
    set_day(&f.env, DAY);

    assert_contract_error(
        f.client().try_open_daily_challenge(
            &Bytes::from_slice(&f.env, b"seed-3"),
            &solution_hash(&f.env, b"solve-3"),
            &100,
        ),
        Error::ChallengeAlreadyOpened,
    );
}

#[test]
fn open_validates_seed_and_reward() {
    let f = setup();

    assert_contract_error(
        f.client().try_open_daily_challenge(
            &Bytes::new(&f.env),
            &solution_hash(&f.env, b"solve"),
            &100,
        ),
        Error::EmptyField,
    );

    let oversized = Bytes::from_slice(&f.env, &[7u8; 257]);
    assert_contract_error(
        f.client()
            .try_open_daily_challenge(&oversized, &solution_hash(&f.env, b"solve"), &100),
        Error::InputTooLarge,
    );

    assert_contract_error(
        f.client().try_open_daily_challenge(
            &Bytes::from_slice(&f.env, b"seed"),
            &solution_hash(&f.env, b"solve"),
            &-1,
        ),
        Error::InvalidRewardAmount,
    );
}

// ---------------------------------------------------------------------
// Submission and replay protection
// ---------------------------------------------------------------------

#[test]
fn correct_solution_records_completion_and_pays_reward() {
    let f = setup();
    f.fund(10_000);
    f.open(b"seed", b"solve", 1_000);

    let record = f.submit(&f.alice, DAY, b"solve");

    assert_eq!(record.player, f.alice);
    assert_eq!(record.day, DAY);
    assert_eq!(record.streak, 1);
    assert_eq!(record.reward_paid, 1_000);
    assert_eq!(record.completed_at, DAY * SECONDS_PER_DAY + 3_600);

    assert!(f.client().has_completed(&f.alice, &DAY));
    assert_eq!(f.client().get_streak(&f.alice), 1);
    assert_eq!(f.client().get_challenge(&DAY).completion_count, 1);
    assert_eq!(f.token().balance(&f.alice), 1_000);
    assert_eq!(f.token().balance(&f.contract_id), 9_000);

    let state: StreakState = f.client().get_streak_state(&f.alice);
    assert_eq!(state.last_completed_day, DAY);
    assert_eq!(state.total_completions, 1);
}

#[test]
fn wrong_solution_is_rejected_and_not_recorded() {
    let f = setup();
    f.fund(10_000);
    f.open(b"seed", b"solve", 1_000);

    assert_contract_error(
        f.client()
            .try_submit_daily_solution(&f.alice, &DAY, &Bytes::from_slice(&f.env, b"wrong")),
        Error::SolutionMismatch,
    );

    assert!(!f.client().has_completed(&f.alice, &DAY));
    assert_eq!(f.client().get_challenge(&DAY).completion_count, 0);
    assert_eq!(f.token().balance(&f.alice), 0);
}

#[test]
fn empty_and_oversized_solutions_are_rejected() {
    let f = setup();
    f.fund(10_000);
    f.open(b"seed", b"solve", 1_000);

    assert_contract_error(
        f.client()
            .try_submit_daily_solution(&f.alice, &DAY, &Bytes::new(&f.env)),
        Error::EmptyField,
    );

    assert_contract_error(
        f.client().try_submit_daily_solution(
            &f.alice,
            &DAY,
            &Bytes::from_slice(&f.env, &[1u8; 1_025]),
        ),
        Error::InputTooLarge,
    );
}

#[test]
fn replaying_the_same_day_is_rejected() {
    let f = setup();
    f.fund(10_000);
    f.open(b"seed", b"solve", 1_000);
    f.submit(&f.alice, DAY, b"solve");

    assert_contract_error(
        f.client()
            .try_submit_daily_solution(&f.alice, &DAY, &Bytes::from_slice(&f.env, b"solve")),
        Error::AlreadyCompleted,
    );
    assert_eq!(f.client().get_challenge(&DAY).completion_count, 1);
    assert_eq!(f.token().balance(&f.alice), 1_000);
}

#[test]
fn submissions_outside_the_challenge_day_are_rejected() {
    let f = setup();
    f.fund(10_000);
    f.open(b"seed", b"solve", 1_000);

    set_day(&f.env, DAY + 1);
    f.open(b"seed-2", b"solve-2", 1_000);

    assert_contract_error(
        f.client()
            .try_submit_daily_solution(&f.bob, &DAY, &Bytes::from_slice(&f.env, b"solve")),
        Error::NotChallengeDay,
    );
}

#[test]
fn unknown_challenges_are_rejected() {
    let f = setup();

    assert_contract_error(
        f.client()
            .try_submit_daily_solution(&f.alice, &DAY, &Bytes::from_slice(&f.env, b"solve")),
        Error::ChallengeNotFound,
    );
    assert_contract_error(f.client().try_get_challenge(&DAY), Error::ChallengeNotFound);
    assert_contract_error(
        f.client().try_get_completion(&f.alice, &DAY),
        Error::ChallengeNotFound,
    );
}

#[test]
fn closed_challenges_reject_submissions() {
    let f = setup();
    f.fund(10_000);
    f.open(b"seed", b"solve", 1_000);
    f.client().close_daily_challenge(&DAY);

    assert!(!f.client().get_challenge(&DAY).active);
    assert_contract_error(
        f.client()
            .try_submit_daily_solution(&f.alice, &DAY, &Bytes::from_slice(&f.env, b"solve")),
        Error::ChallengeNotActive,
    );
}

#[test]
fn failed_reward_transfer_reverts_the_completion() {
    let f = setup();
    // No funding: the contract cannot pay the reward.
    f.open(b"seed", b"solve", 1_000);

    assert_contract_error(
        f.client()
            .try_submit_daily_solution(&f.alice, &DAY, &Bytes::from_slice(&f.env, b"solve")),
        Error::RewardTransferFailed,
    );

    assert!(!f.client().has_completed(&f.alice, &DAY));
    assert_eq!(f.client().get_streak(&f.alice), 0);
}

// ---------------------------------------------------------------------
// Streak bonuses
// ---------------------------------------------------------------------

#[test]
fn consecutive_days_increase_the_reward() {
    let f = setup();
    f.fund(100_000);

    f.open(b"seed-1", b"solve-1", 1_000);
    let first = f.submit(&f.alice, DAY, b"solve-1");
    set_day(&f.env, DAY + 1);
    f.open(b"seed-2", b"solve-2", 1_000);
    let second = f.submit(&f.alice, DAY + 1, b"solve-2");
    set_day(&f.env, DAY + 2);
    f.open(b"seed-3", b"solve-3", 1_000);
    let third = f.submit(&f.alice, DAY + 2, b"solve-3");

    assert_eq!(first.reward_paid, 1_000); // 1.00x
    assert_eq!(second.reward_paid, 1_250); // 1.25x
    assert_eq!(third.reward_paid, 1_500); // 1.50x
    assert_eq!(third.streak, 3);
    assert_eq!(f.client().get_streak(&f.alice), 3);
    assert_eq!(f.token().balance(&f.alice), 3_750);
}

#[test]
fn missing_a_day_resets_the_streak() {
    let f = setup();
    f.fund(10_000);

    f.open(b"seed-1", b"solve-1", 1_000);
    f.submit(&f.alice, DAY, b"solve-1");

    // Skip DAY + 1 entirely.
    set_day(&f.env, DAY + 2);
    f.open(b"seed-3", b"solve-3", 1_000);
    let record = f.submit(&f.alice, DAY + 2, b"solve-3");

    assert_eq!(record.streak, 1);
    assert_eq!(record.reward_paid, 1_000);
    assert_eq!(f.client().get_streak_state(&f.alice).total_completions, 2);
}

#[test]
fn preview_reward_reflects_the_projected_streak() {
    let f = setup();
    f.fund(100_000);

    f.open(b"seed-1", b"solve-1", 1_000);
    f.submit(&f.alice, DAY, b"solve-1");
    set_day(&f.env, DAY + 1);
    f.open(b"seed-2", b"solve-2", 1_000);

    // A completion now would be the second consecutive day (1.25x).
    assert_eq!(f.client().preview_reward(&f.alice, &(DAY + 1)), 1_250);
    // A different player has no streak yet (1.00x).
    assert_eq!(f.client().preview_reward(&f.bob, &(DAY + 1)), 1_000);
}

#[test]
fn streak_multiplier_is_capped() {
    let f = setup();

    assert_eq!(f.client().get_streak_multiplier_bps(&1), 10_000);
    assert_eq!(f.client().get_streak_multiplier_bps(&2), 12_500);
    assert_eq!(f.client().get_streak_multiplier_bps(&9), 30_000);
    assert_eq!(f.client().get_streak_multiplier_bps(&50), 30_000);
}

#[test]
fn players_have_independent_streaks() {
    let f = setup();
    f.fund(100_000);
    f.open(b"seed-1", b"solve-1", 1_000);
    f.submit(&f.alice, DAY, b"solve-1");

    set_day(&f.env, DAY + 1);
    f.open(b"seed-2", b"solve-2", 1_000);
    let alice = f.submit(&f.alice, DAY + 1, b"solve-2");
    let bob = f.submit(&f.bob, DAY + 1, b"solve-2");

    assert_eq!(alice.streak, 2);
    assert_eq!(bob.streak, 1);
    assert_eq!(f.client().get_challenge(&(DAY + 1)).completion_count, 2);
}
