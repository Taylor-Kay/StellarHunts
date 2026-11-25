# Guide: Writing Soroban Smart Contracts for StellarHunts

This guide walks you through writing Soroban smart contracts following the patterns established in the StellarHunts codebase (`onchain/contracts/stellar_hunts/`).

---

## 1. Prerequisites

- Rust toolchain (stable, edition 2021)
- `soroban-cli` installed (`cargo install --locked soroban-cli`)
- Stellar Testnet or Futurenet account funded with XLM
- Familiarity with Rust ownership and trait system

---

## 2. SDK Setup and Project Structure

### Workspace `Cargo.toml`

The StellarHunts project uses a Cargo workspace. Each contract is its own crate:

```toml
[workspace]
members = [
    "contracts/stellar_hunts",
    "contracts/stellar_hunts_nft",
    "contracts/stellar_hunts_types",
]

[workspace.dependencies]
soroban-sdk = { version = "22", default-features = false }
```

### Contract `Cargo.toml`

```toml
[package]
name = "stellar-hunts"
version.workspace = true
edition.workspace = true

[lib]
# cdylib produces the deployable WASM artifact.
# rlib allows other workspace crates to import this crate's Rust items.
crate-type = ["cdylib", "rlib"]
doctest = false

[dependencies]
soroban-sdk = { workspace = true }

[dev-dependencies]
# testutils enables mock_all_auths, register_contract, Address::generate.
soroban-sdk = { workspace = true, features = ["testutils"] }
```

### Directory Layout

```
onchain/
  contracts/
    stellar_hunts/
      Cargo.toml
      src/
        lib.rs      ← contract entry point
        test.rs     ← unit tests
        point.rs    ← NFT/badge logic
        audit.rs    ← audit helpers
        log.rs      ← structured logging
```

---

## 3. Contract Structure

### 3.1 The `no_std` Pattern

Soroban contracts compile to WASM and must opt out of `std`. Tests are allowed to use `std`:

```rust
// Allow std during cargo test for std::panic::catch_unwind.
// The WASM build remains no_std.
#![cfg_attr(not(test), no_std)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    panic_with_error, Address, Bytes, BytesN, Env, Symbol,
};
```

### 3.2 Declaring a Contract

```rust
#[contract]
pub struct StellarHunts;

#[contractimpl]
impl StellarHunts {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }
}
```

---

## 4. Storage Patterns

Soroban provides three storage tiers:

| Tier         | Lifetime                  | Use case                              |
|--------------|---------------------------|---------------------------------------|
| `instance`   | Lives as long as contract | Config, admin address, global counters|
| `persistent` | Renewed per-use           | Per-player progress, questions        |
| `temporary`  | Short-lived               | Rate limit windows, ephemeral data    |

### 4.1 Storage Keys with `#[contracttype]`

Define an enum as your key space. Composite keys hold associated data:

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    PendingAdmin,
    QuestionCount,
    Question(u64),                       // keyed by question ID
    QuestionsByLevel(Levels, u32),       // (level, index) → question_id
    PlayerProgressV2(Address),           // keyed by player address
    PlayerLevelProgressV2(Address, Levels), // (player, level) → progress
    Role(Address, Role),                 // (account, role) → bool
    SchemaVersion,
    Paused,
}
```

### 4.2 Reading and Writing

```rust
// Instance storage — config data
let count: u64 = env
    .storage()
    .instance()
    .get(&DataKey::QuestionCount)
    .unwrap_or(0u64);

env.storage()
    .instance()
    .set(&DataKey::QuestionCount, &question_id);

// Persistent storage — player records
let progress: Option<PlayerProgressV2> = env
    .storage()
    .persistent()
    .get(&DataKey::PlayerProgressV2(player.clone()));

env.storage()
    .persistent()
    .set(&DataKey::PlayerProgressV2(player.clone()), &progress);

// Check existence without deserialising
let exists = env.storage().persistent().has(&DataKey::Question(id));

// Delete
env.storage().persistent().remove(&DataKey::Question(id));
```

### 4.3 Custom Types

Annotate every struct or enum used in storage or function signatures with `#[contracttype]`:

```rust
#[contracttype]
#[derive(Clone, Debug)]
pub struct Question {
    pub question_id: u64,
    pub question: Bytes,
    pub hashed_answer: BytesN<32>,
    pub level: Levels,
    pub hint: Bytes,
    pub version: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct LevelProgressV2 {
    pub player: Address,
    pub level: Levels,
    pub last_question_index: u32,
    pub is_completed: bool,
    pub attempts: u32,
    pub nft_minted: bool,
    pub last_attempt_ledger: u32,
    pub version: u32,
}

// Enums used as storage values must also carry the attribute
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Role {
    Minter,
    Upgrader,
}
```

> **Note:** `u8` is not a valid Soroban `Val` in soroban-sdk 22. The smallest unsigned integer you can use is `u32`.

### 4.4 Schema Versioning

Add a `version` field to every persistent struct so you can migrate storage non-destructively:

```rust
const CURRENT_SCHEMA_VERSION: u32 = 2;

fn write_player_progress(e: &Env, pp: &PlayerProgressV2) {
    let mut stamped = pp.clone();
    stamped.version = CURRENT_SCHEMA_VERSION;
    e.storage().persistent().set(
        &DataKey::PlayerProgressV2(stamped.address.clone()),
        &stamped,
    );
    // Lazy migration: drop any pre-versioning record
    e.storage()
        .persistent()
        .remove(&DataKey::PlayerProgress(stamped.address.clone()));
}
```

Reads fall back to the legacy key when the versioned key is absent, then surface the old record as `version == LEGACY_RECORD_VERSION`. See `onchain/docs/storage-versioning.md` for the full migration contract.

---

## 5. Functions

### 5.1 Auth Guards

Use `require_auth()` on the caller's `Address` to enforce authorization:

```rust
pub fn add_question(env: Env, level: Levels, question: Bytes, answer: Bytes, hint: Bytes) {
    require_admin(&env);   // internal helper — see below
    // ...
}

fn require_admin(e: &Env) {
    let admin: Address = e
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(e, Error::NotInitialized));
    admin.require_auth();
}
```

### 5.2 Input Validation

Bound all user-supplied payloads to keep storage costs predictable:

```rust
const MAX_QUESTION_LEN: u32 = 4_096;
const MAX_ANSWER_LEN: u32 = 1_024;
const MAX_HINT_LEN: u32 = 2_048;

if question.len() > MAX_QUESTION_LEN || hint.len() > MAX_HINT_LEN {
    panic_with_error!(&env, Error::InputTooLarge);
}
if question.is_empty() || answer.is_empty() {
    panic_with_error!(&env, Error::EmptyField);
}
```

### 5.3 Checked Arithmetic

Never use `+` on counters that could overflow. Use `checked_add`:

```rust
let question_id = count
    .checked_add(1)
    .unwrap_or_else(|| panic_with_error!(&env, Error::ArithmeticOverflow));
```

### 5.4 Cryptography

Hash answers server-side before storing so raw answers never appear on-chain:

```rust
let hashed: BytesN<32> = env.crypto().sha256(&answer).into();
```

---

## 6. Error Handling

Define all contract errors in a single `#[contracterror]` enum. Assign stable discriminant values — never reorder existing variants:

```rust
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized          = 1,
    EmptyField             = 2,
    QuestionNotFound       = 3,
    LevelNotCompleted      = 4,
    AlreadyMinted          = 5,
    NotInitialized         = 6,
    WrongLevel             = 7,
    QuestionPerLevelLimit  = 8,
    MissingNftContract     = 9,
    AttemptTooSoon         = 10,
    // New variants go at the END to keep existing discriminants stable
    InvalidInput           = 24,
    InputTooLarge          = 25,
}
```

Trigger errors with `panic_with_error!`:

```rust
panic_with_error!(&env, Error::NotAuthorized);
```

---

## 7. Event Emission

Emit events for every state change so off-chain indexers can reconstruct state without reading contract storage:

```rust
// Tuple of topic symbols, then the data payload
env.events().publish(
    (Symbol::new(&env, "question_added"),),
    (question_id, level),
);

env.events().publish(
    (Symbol::new(&env, "admin_transfer_accepted"),),
    (previous_admin, pending_admin),
);

env.events().publish(
    (Symbol::new(&env, "role_granted"),),
    (account, role),
);
```

**Conventions used in StellarHunts:**

| Event name                   | Payload                              |
|------------------------------|--------------------------------------|
| `game_initialized`           | `(admin, schema_version)`            |
| `question_added`             | `(question_id, level)`               |
| `question_updated`           | `(question_id, level)`               |
| `question_retired`           | `(question_id,)`                     |
| `role_granted`               | `(account, role)`                    |
| `role_revoked`               | `(account, role)`                    |
| `contract_upgraded`          | `(upgrader, new_wasm_hash)`          |
| `admin_transfer_proposed`    | `(current_admin, new_admin)`         |
| `admin_transfer_accepted`    | `(previous_admin, new_admin)`        |
| `nft_contract_updated`       | `(old_address, new_address)`         |
| `level_badge_minted`         | `(recipient, level, minter, admin)`  |

See `onchain/docs/event-schema.md` for the full schema.

---

## 8. Contract Testing with `soroban-cli`

### 8.1 Unit Tests (in-process)

The recommended approach is host-side tests using `soroban-sdk`'s `testutils` feature. Tests live in `src/test.rs`:

```rust
#![cfg(test)]

use crate::{Levels, StellarHunts, StellarHuntsClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{Address, Bytes, Env};

fn b(env: &Env, s: &str) -> Bytes {
    Bytes::from_slice(env, s.as_bytes())
}

fn init_with_admin(env: &Env) -> (Address, Address, StellarHuntsClient) {
    let admin = Address::generate(env);
    let contract_address = env.register_contract(None, StellarHunts);
    let client = StellarHuntsClient::new(env, &contract_address);
    env.mock_all_auths();
    client.init(&admin);
    (admin, contract_address, client)
}

#[test]
fn test_add_and_get_question() {
    let env = Env::default();
    let (_admin, _contract_address, client) = init_with_admin(&env);

    let level = crate::Levels::Easy;
    let question = b(&env, "What is the capital of France?");
    let answer  = b(&env, "Paris");
    let hint    = b(&env, "It starts with P");

    client.set_question_per_level(&5u32);
    client.add_question(&level, &question, &answer, &hint);

    let got = client.get_question(&1u64);
    assert_eq!(got.question_id, 1);
}
```

**Key helpers:**

| Helper | Purpose |
|--------|---------|
| `env.mock_all_auths()` | Approve every `require_auth` automatically |
| `env.mock_auths(&[...])` | Approve only specific, named invocations |
| `env.ledger().set_sequence_number(n)` | Advance ledger sequence for time-based checks |
| `env.register_contract(None, T)` | Deploy a contract into the test environment |
| `std::panic::catch_unwind(...)` | Assert that a call panics (negative tests) |

### 8.2 Running Tests with Cargo

```bash
# From the workspace root
cargo test -p stellar-hunts

# Or inside the contract directory
cd onchain/contracts/stellar_hunts
cargo test
```

### 8.3 Invoking a Deployed Contract with `soroban-cli`

```bash
# Call a read-only function
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_schema_version

# Call a state-changing function
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source-account <ADMIN_SECRET_KEY> \
  -- add_question \
  --level '{"Easy": null}' \
  --question '"What is 2+2?"' \
  --answer '"4"' \
  --hint '"basic math"'
```

---

## 9. Deployment Guide

### 9.1 Build the WASM Artifact

```bash
cd onchain
cargo build --release --target wasm32-unknown-unknown -p stellar-hunts

# The artifact is at:
# target/wasm32-unknown-unknown/release/stellar_hunts.wasm
```

Or use `soroban-cli`'s build command (wraps the above):

```bash
soroban contract build
```

### 9.2 Deploy to Testnet

```bash
# Configure CLI once
soroban network add --global testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

soroban keys generate --global admin --network testnet

# Fund the account
soroban keys fund admin --network testnet

# Deploy
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_hunts.wasm \
  --source admin \
  --network testnet
# Outputs: CONTRACT_ID

# Initialize
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- init \
  --admin $(soroban keys address admin)
```

The existing deployment script is at `stellar-extensions/scripts/deploy-soroban-contract.sh`.

### 9.3 Upgrade a Deployed Contract

The `upgrade` function updates the WASM bytecode in-place. The contract's storage and address remain unchanged:

```bash
# Build the new WASM
cargo build --release --target wasm32-unknown-unknown -p stellar-hunts

# Upload the new WASM and get its hash
soroban contract install \
  --wasm target/wasm32-unknown-unknown/release/stellar_hunts.wasm \
  --source upgrader \
  --network testnet
# Outputs: WASM_HASH

# Trigger the in-contract upgrade
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source upgrader \
  --network testnet \
  -- upgrade \
  --new_wasm_hash <WASM_HASH>
```

See `onchain/docs/contract-upgrade-and-rollback.md` for the full upgrade and rollback runbook.

---

## 10. Quick Reference

### Storage tiers

```rust
env.storage().instance()   // contract-lifetime config
env.storage().persistent() // renewable player/question records
env.storage().temporary()  // short-lived windows
```

### Must-have attributes

| Attribute | Use on |
|-----------|--------|
| `#[contract]` | The contract struct |
| `#[contractimpl]` | The `impl` block |
| `#[contracttype]` | Every type used in storage or function signatures |
| `#[contracterror]` | The error enum |

### Auth

```rust
// Caller must sign the transaction
some_address.require_auth();

// Tests: approve all auths automatically
env.mock_all_auths();
```

### Events

```rust
env.events().publish(
    (Symbol::new(&env, "event_name"),), // topics (tuple)
    (payload_field_1, payload_field_2), // data (tuple)
);
```
