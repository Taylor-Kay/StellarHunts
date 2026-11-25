#![cfg(test)]

use crate::{AccessRequirement, AccessRule, PuzzleAccessControl, PuzzleAccessControlClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn init(env: &Env) -> (Address, Address, PuzzleAccessControlClient) {
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let contract_id = env.register_contract(None, PuzzleAccessControl);
    let client = PuzzleAccessControlClient::new(env, &contract_id);
    client.init(&admin, &treasury);
    (admin, treasury, client)
}

fn free_rule() -> AccessRule {
    AccessRule {
        requirement: AccessRequirement::Free,
        token_contract: None,
        price: 0,
        subscription_duration_ledgers: 0,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_init_once() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    // Calling init a second time should panic.
    let result = std::panic::catch_unwind(|| {
        let admin2 = Address::generate(&env);
        let treasury2 = Address::generate(&env);
        client.init(&admin2, &treasury2);
    });
    assert!(result.is_err(), "double-init should panic");
}

#[test]
fn test_free_puzzle_always_allows_access() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    let player = Address::generate(&env);
    // No rule set → defaults to Free.
    assert!(client.has_access(&player, &1u64));
    assert!(client.verify_access(&player, &1u64));
}

#[test]
fn test_set_and_get_access_rule() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    let rule = free_rule();
    client.set_access_rule(&1u64, &rule);

    let stored = client.get_access_rule(&1u64);
    assert_eq!(stored.requirement, AccessRequirement::Free);
}

#[test]
fn test_admin_grant_and_revoke_access() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    // Set a TokenPayment rule so access isn't trivially free.
    let token_contract = Address::generate(&env);
    let rule = AccessRule {
        requirement: AccessRequirement::TokenPayment,
        token_contract: Some(token_contract),
        price: 1_000_000,
        subscription_duration_ledgers: 0,
    };
    client.set_access_rule(&42u64, &rule);

    let player = Address::generate(&env);

    // Not granted yet.
    assert!(!client.has_access(&player, &42u64));

    // Admin grants access permanently (expires_at_ledger = 0).
    client.admin_grant_access(&player, &42u64, &0u32);
    assert!(client.has_access(&player, &42u64));

    // Admin revokes.
    client.admin_revoke_access(&player, &42u64);
    assert!(!client.has_access(&player, &42u64));
}

#[test]
fn test_nft_access_rule_deny_without_grant() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    let nft_contract = Address::generate(&env);
    let rule = AccessRule {
        requirement: AccessRequirement::NftOwnership,
        token_contract: Some(nft_contract),
        price: 0,
        subscription_duration_ledgers: 0,
    };
    client.set_access_rule(&7u64, &rule);

    let player = Address::generate(&env);
    assert!(!client.has_access(&player, &7u64));
}

#[test]
fn test_subscription_rule_deny_without_grant() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    let token_contract = Address::generate(&env);
    let rule = AccessRule {
        requirement: AccessRequirement::Subscription,
        token_contract: Some(token_contract),
        price: 500_000,
        subscription_duration_ledgers: 17_280, // ≈ 24 h at 5 s/ledger
    };
    client.set_access_rule(&8u64, &rule);

    let player = Address::generate(&env);
    assert!(!client.has_access(&player, &8u64));
}

#[test]
fn test_remove_rule_reverts_to_free() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    let token_contract = Address::generate(&env);
    let rule = AccessRule {
        requirement: AccessRequirement::TokenPayment,
        token_contract: Some(token_contract),
        price: 1_000_000,
        subscription_duration_ledgers: 0,
    };
    client.set_access_rule(&5u64, &rule);

    // Remove the rule.
    client.remove_access_rule(&5u64);

    // Now defaults back to Free.
    let stored = client.get_access_rule(&5u64);
    assert_eq!(stored.requirement, AccessRequirement::Free);

    let player = Address::generate(&env);
    assert!(client.has_access(&player, &5u64));
}

#[test]
fn test_get_access_grant_returns_none_without_grant() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    let player = Address::generate(&env);
    let grant = client.get_access_grant(&player, &99u64);
    assert!(grant.is_none());
}

#[test]
fn test_get_access_grant_returns_some_after_admin_grant() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _treasury, client) = init(&env);

    // Need a non-free rule.
    let token_contract = Address::generate(&env);
    client.set_access_rule(
        &10u64,
        &AccessRule {
            requirement: AccessRequirement::TokenPayment,
            token_contract: Some(token_contract),
            price: 1_000,
            subscription_duration_ledgers: 0,
        },
    );

    let player = Address::generate(&env);
    client.admin_grant_access(&player, &10u64, &0u32);

    let grant = client.get_access_grant(&player, &10u64);
    assert!(grant.is_some());
    assert!(grant.unwrap().granted);
}
