// Issue #966 – Puzzle Access Control Contract
//
// Manages access control for premium puzzles. A puzzle can require:
//   - Free (no requirement)
//   - Token payment (pays into the contract treasury)
//   - NFT ownership (gated by holding a specific NFT contract address)
//   - Subscription (time-limited access window, e.g. 30 days)
//
// Admin functions set rules per puzzle. Verify functions gate puzzle
// interaction. Time-limited access is tracked per (player, puzzle) pair.
//
// Follows patterns in onchain/contracts/stellar_hunts/src/lib.rs.

#![cfg_attr(not(test), no_std)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, token, Address, Env,
    Symbol,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// The kind of access requirement for a puzzle.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AccessRequirement {
    /// Anyone can access the puzzle for free.
    Free,
    /// Player must pay `price` stroops of `token` to gain access.
    TokenPayment,
    /// Player must hold at least one token from `nft_contract`.
    NftOwnership,
    /// Player must have an active subscription.
    Subscription,
}

/// Per-puzzle access rule stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AccessRule {
    pub requirement: AccessRequirement,
    /// SAC token contract used for payment / balance check (if applicable).
    pub token_contract: Option<Address>,
    /// Price in stroops (for TokenPayment) or 0.
    pub price: i128,
    /// For Subscription: duration of access in ledgers (≈5 s each).
    pub subscription_duration_ledgers: u32,
}

/// Per-player access grant for a specific puzzle.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AccessGrant {
    pub player: Address,
    pub puzzle_id: u64,
    /// Ledger number after which access expires. 0 = permanent.
    pub expires_at_ledger: u32,
    pub granted: bool,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Treasury,
    AccessRule(u64),
    AccessGrant(Address, u64),
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    RuleNotFound = 4,
    AccessDenied = 5,
    AccessExpired = 6,
    InvalidPrice = 7,
    AlreadyGranted = 8,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct PuzzleAccessControl;

#[contractimpl]
impl PuzzleAccessControl {
    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Initialise the contract with an admin and a treasury address.
    /// Treasury receives token payments for paid puzzles.
    pub fn init(env: Env, admin: Address, treasury: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);

        env.events()
            .publish((Symbol::new(&env, "access_control_init"),), (admin, treasury));
    }

    // -----------------------------------------------------------------------
    // Admin – rule management
    // -----------------------------------------------------------------------

    /// Set the access rule for a puzzle (admin only).
    pub fn set_access_rule(env: Env, puzzle_id: u64, rule: AccessRule) {
        require_admin(&env);

        if rule.requirement == AccessRequirement::TokenPayment && rule.price <= 0 {
            panic_with_error!(&env, Error::InvalidPrice);
        }

        env.storage()
            .persistent()
            .set(&DataKey::AccessRule(puzzle_id), &rule);

        env.events().publish(
            (Symbol::new(&env, "rule_set"),),
            (puzzle_id, rule.requirement),
        );
    }

    /// Remove the access rule for a puzzle (admin only). Defaults to Free.
    pub fn remove_access_rule(env: Env, puzzle_id: u64) {
        require_admin(&env);
        env.storage()
            .persistent()
            .remove(&DataKey::AccessRule(puzzle_id));

        env.events()
            .publish((Symbol::new(&env, "rule_removed"),), (puzzle_id,));
    }

    /// Transfer admin role to a new address.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((Symbol::new(&env, "admin_transferred"),), (new_admin,));
    }

    // -----------------------------------------------------------------------
    // Player – access
    // -----------------------------------------------------------------------

    /// Verify whether a player currently has access to a puzzle.
    /// Returns `true` if access is granted and not expired; panics otherwise.
    pub fn verify_access(env: Env, player: Address, puzzle_id: u64) -> bool {
        player.require_auth();

        let rule = Self::get_rule(&env, puzzle_id);

        if rule.requirement == AccessRequirement::Free {
            return true;
        }

        let grant_key = DataKey::AccessGrant(player.clone(), puzzle_id);
        let grant: Option<AccessGrant> = env.storage().persistent().get(&grant_key);

        match grant {
            Some(g) if g.granted => {
                if g.expires_at_ledger > 0
                    && env.ledger().sequence() > g.expires_at_ledger
                {
                    panic_with_error!(&env, Error::AccessExpired);
                }
                true
            }
            _ => panic_with_error!(&env, Error::AccessDenied),
        }
    }

    /// Pay for access to a token-payment puzzle. Transfers `price` stroops
    /// from the player's wallet to the treasury.
    pub fn pay_for_access(env: Env, player: Address, puzzle_id: u64) {
        player.require_auth();

        let rule = Self::get_rule(&env, puzzle_id);

        if rule.requirement != AccessRequirement::TokenPayment {
            panic_with_error!(&env, Error::AccessDenied);
        }

        let token_contract = rule
            .token_contract
            .clone()
            .unwrap_or_else(|| panic_with_error!(&env, Error::RuleNotFound));

        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(Error::NotInitialized)
            .unwrap();

        // Transfer payment from player to treasury using the Stellar Asset
        // Contract (SAC) token interface.
        let token_client = token::Client::new(&env, &token_contract);
        token_client.transfer(&player, &treasury, &rule.price);

        Self::grant_access_internal(&env, player.clone(), puzzle_id, 0);

        env.events()
            .publish((Symbol::new(&env, "paid_access_granted"),), (player, puzzle_id, rule.price));
    }

    /// Verify NFT ownership and grant access for an NFT-gated puzzle.
    /// The player must hold a balance > 0 in the specified NFT/token contract.
    pub fn grant_nft_access(env: Env, player: Address, puzzle_id: u64) {
        player.require_auth();

        let rule = Self::get_rule(&env, puzzle_id);

        if rule.requirement != AccessRequirement::NftOwnership {
            panic_with_error!(&env, Error::AccessDenied);
        }

        let nft_contract = rule
            .token_contract
            .clone()
            .unwrap_or_else(|| panic_with_error!(&env, Error::RuleNotFound));

        // Check the player's balance using the SAC interface (works for
        // SEP-41 tokens and Soroban-wrapped Stellar Classic assets alike).
        let token_client = token::Client::new(&env, &nft_contract);
        let balance = token_client.balance(&player);

        if balance <= 0 {
            panic_with_error!(&env, Error::AccessDenied);
        }

        Self::grant_access_internal(&env, player.clone(), puzzle_id, 0);

        env.events().publish(
            (Symbol::new(&env, "nft_access_granted"),),
            (player, puzzle_id),
        );
    }

    /// Activate a subscription for the player, granting time-limited access.
    /// The subscription fee is taken from the player via the rule's token contract.
    pub fn subscribe(env: Env, player: Address, puzzle_id: u64) {
        player.require_auth();

        let rule = Self::get_rule(&env, puzzle_id);

        if rule.requirement != AccessRequirement::Subscription {
            panic_with_error!(&env, Error::AccessDenied);
        }

        let token_contract = rule
            .token_contract
            .clone()
            .unwrap_or_else(|| panic_with_error!(&env, Error::RuleNotFound));

        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(Error::NotInitialized)
            .unwrap();

        // Transfer subscription fee.
        if rule.price > 0 {
            let token_client = token::Client::new(&env, &token_contract);
            token_client.transfer(&player, &treasury, &rule.price);
        }

        let expires_at_ledger =
            env.ledger().sequence() + rule.subscription_duration_ledgers;

        Self::grant_access_internal(&env, player.clone(), puzzle_id, expires_at_ledger);

        env.events().publish(
            (Symbol::new(&env, "subscription_granted"),),
            (player, puzzle_id, expires_at_ledger),
        );
    }

    // -----------------------------------------------------------------------
    // Admin – manual grant / revoke
    // -----------------------------------------------------------------------

    /// Admin can directly grant access (e.g. for allowlisting, beta testers).
    pub fn admin_grant_access(env: Env, player: Address, puzzle_id: u64, expires_at_ledger: u32) {
        require_admin(&env);
        Self::grant_access_internal(&env, player.clone(), puzzle_id, expires_at_ledger);
        env.events().publish(
            (Symbol::new(&env, "admin_access_granted"),),
            (player, puzzle_id, expires_at_ledger),
        );
    }

    /// Admin can revoke access.
    pub fn admin_revoke_access(env: Env, player: Address, puzzle_id: u64) {
        require_admin(&env);
        env.storage()
            .persistent()
            .remove(&DataKey::AccessGrant(player.clone(), puzzle_id));
        env.events().publish(
            (Symbol::new(&env, "admin_access_revoked"),),
            (player, puzzle_id),
        );
    }

    // -----------------------------------------------------------------------
    // View functions
    // -----------------------------------------------------------------------

    /// Return the access rule for a puzzle (defaults to Free if unset).
    pub fn get_access_rule(env: Env, puzzle_id: u64) -> AccessRule {
        Self::get_rule(&env, puzzle_id)
    }

    /// Return whether the player has an active grant (does not check expiry).
    pub fn has_access(env: Env, player: Address, puzzle_id: u64) -> bool {
        let rule = Self::get_rule(&env, puzzle_id);
        if rule.requirement == AccessRequirement::Free {
            return true;
        }

        let grant: Option<AccessGrant> = env
            .storage()
            .persistent()
            .get(&DataKey::AccessGrant(player, puzzle_id));

        match grant {
            Some(g) => {
                if g.expires_at_ledger > 0 {
                    g.granted && env.ledger().sequence() <= g.expires_at_ledger
                } else {
                    g.granted
                }
            }
            None => false,
        }
    }

    /// Return the access grant for a (player, puzzle) pair if it exists.
    pub fn get_access_grant(env: Env, player: Address, puzzle_id: u64) -> Option<AccessGrant> {
        env.storage()
            .persistent()
            .get(&DataKey::AccessGrant(player, puzzle_id))
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn get_rule(env: &Env, puzzle_id: u64) -> AccessRule {
        env.storage()
            .persistent()
            .get(&DataKey::AccessRule(puzzle_id))
            .unwrap_or(AccessRule {
                requirement: AccessRequirement::Free,
                token_contract: None,
                price: 0,
                subscription_duration_ledgers: 0,
            })
    }

    fn grant_access_internal(
        env: &Env,
        player: Address,
        puzzle_id: u64,
        expires_at_ledger: u32,
    ) {
        let grant = AccessGrant {
            player: player.clone(),
            puzzle_id,
            expires_at_ledger,
            granted: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::AccessGrant(player, puzzle_id), &grant);
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn require_admin(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set");
    admin.require_auth();
}

#[cfg(test)]
mod test;
