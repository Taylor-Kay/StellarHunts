# Guide: Testing Strategies for StellarHunts

This guide explains how to test all three layers of the StellarHunts stack: the **Next.js frontend** (Vitest + React Testing Library), the **NestJS backend** (Jest + Supertest), and the **Soroban on-chain contracts** (Rust `cargo test` with soroban-sdk testutils). It also covers mocking patterns and the CI pipeline.

---

## 1. Frontend Testing — Vitest and React Testing Library

Reference: `frontend/tests/`

### 1.1 Setup

The frontend uses **Vitest** as the test runner and **React Testing Library** for component tests. Configuration lives in `vitest.config.ts` (or `vite.config.ts`):

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
});
```

```ts
// tests/setup.ts
import '@testing-library/jest-dom';
```

Install dependencies:

```bash
npm install --save-dev vitest @vitest/ui jsdom \
  @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event
```

### 1.2 Running Tests

```bash
# Run all frontend tests
npx vitest run

# Watch mode during development
npx vitest

# With coverage
npx vitest run --coverage
```

### 1.3 Example: Component Test

```tsx
// frontend/tests/PuzzleComponent.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PuzzleComponent from '../src/components/PuzzleComponent';

describe('PuzzleComponent', () => {
  it('renders the puzzle prompt', () => {
    render(<PuzzleComponent prompt="What is 2 + 2?" onSubmit={vi.fn()} />);
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
  });

  it('calls onSubmit with the entered answer', async () => {
    const onSubmit = vi.fn();
    render(<PuzzleComponent prompt="What is 2 + 2?" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith('4');
  });
});
```

### 1.4 Example: Custom Hook Test

```ts
// frontend/tests/useGameStore-optimistic.test.js
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useGameStore } from '../src/store/useGameStore';

describe('useGameStore optimistic update', () => {
  it('advances the level optimistically before the server responds', async () => {
    const { result } = renderHook(() => useGameStore());
    expect(result.current.level).toBe('Easy');

    act(() => result.current.advanceLevelOptimistic());
    expect(result.current.level).toBe('Medium');
  });
});
```

### 1.5 Mocking the Stellar SDK

The Stellar SDK and wallet connectors are always mocked in frontend tests to avoid real network calls:

```ts
// tests/__mocks__/@stellar/stellar-sdk.ts
export const Networks = { TESTNET: 'Test SDF Network ; September 2015' };
export const Keypair = {
  fromPublicKey: vi.fn(() => ({ publicKey: () => 'GMOCK...' })),
};
export const Server = vi.fn().mockImplementation(() => ({
  loadAccount: vi.fn().mockResolvedValue({ accountId: 'GMOCK...' }),
}));
```

Place auto-mocks under `tests/__mocks__/` following the module path so Vitest resolves them automatically.

---

## 2. Backend Testing — Jest and Supertest

Reference: `backend/test/`

### 2.1 Setup

The backend uses **Jest** (via NestJS CLI defaults) with **Supertest** for end-to-end HTTP assertions.

```bash
# Run all backend tests (unit + e2e)
npm run test

# Unit tests only (watches source files)
npm run test:watch

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

### 2.2 Unit Test: Service

```ts
// backend/src/puzzle/puzzle.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PuzzleService } from './puzzle.service';
import { Puzzle } from './puzzle.entity';

describe('PuzzleService', () => {
  let service: PuzzleService;

  const mockRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PuzzleService,
        { provide: getRepositoryToken(Puzzle), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<PuzzleService>(PuzzleService);
  });

  it('returns null when puzzle is not found', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    const result = await service.findById(999);
    expect(result).toBeNull();
  });
});
```

### 2.3 E2E Test: HTTP Endpoint with Supertest

```ts
// backend/test/gameplay-flow.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Gameplay flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /api/v1/puzzles returns 200', () => {
    return request(app.getHttpServer())
      .get('/api/v1/puzzles')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
      });
  });

  it('POST /api/v1/puzzles/:id/submit returns 400 for wrong answer', () => {
    return request(app.getHttpServer())
      .post('/api/v1/puzzles/1/submit')
      .send({ answer: 'definitely_wrong' })
      .expect(400);
  });
});
```

### 2.4 Mocking TypeORM

Avoid connecting to a real database in unit tests. Use `getRepositoryToken` to substitute mock repositories:

```ts
{ provide: getRepositoryToken(MyEntity), useValue: { find: jest.fn(), save: jest.fn() } }
```

For integration tests that need a database, use a test-scoped PostgreSQL instance (e.g. via Docker Compose) and the `jest-e2e.json` config in `backend/test/`.

### 2.5 Mocking the Stellar SDK (Backend)

```ts
jest.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: jest.fn().mockResolvedValue({ id: 'GMOCK...' }),
    })),
  },
}));
```

---

## 3. On-Chain Contract Testing — Soroban

Reference: `onchain/contracts/stellar_hunts/src/test.rs`

### 3.1 How Soroban Tests Work

Soroban contract tests run entirely in-process using the **Soroban host environment** provided by `soroban-sdk`'s `testutils` feature. No network connection or deployed contract is needed. Tests are standard Rust `#[test]` functions.

Enable testutils in `Cargo.toml`:

```toml
[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
```

### 3.2 Core Helpers

```rust
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{Address, Bytes, Env};

// Convert a string literal to Soroban Bytes
fn b(env: &Env, s: &str) -> Bytes {
    Bytes::from_slice(env, s.as_bytes())
}

// Register the contract and initialize it; returns (admin, contract_id, client)
fn init_with_admin(env: &Env) -> (Address, Address, StellarHuntsClient) {
    let admin = Address::generate(env);
    let contract_id = env.register_contract(None, StellarHunts);
    let client = StellarHuntsClient::new(env, &contract_id);
    env.mock_all_auths();
    client.init(&admin);
    (admin, contract_id, client)
}
```

### 3.3 Example: Positive Test

```rust
#[test]
fn test_add_and_get_question() {
    let env = Env::default();
    let (_admin, _contract_id, client) = init_with_admin(&env);

    let level = crate::Levels::Easy;
    client.set_question_per_level(&5u32);
    client.add_question(
        &level,
        &b(&env, "What is the capital of France?"),
        &b(&env, "Paris"),
        &b(&env, "It starts with P"),
    );

    let question = client.get_question(&1u64);
    assert_eq!(question.question_id, 1);
}
```

### 3.4 Example: Negative Test (Expect Panic)

```rust
// Use #[should_panic] for simple error assertions
#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_require_admin_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarHunts);
    let client = StellarHuntsClient::new(&env, &contract_id);
    // Calling any admin function before init must panic with NotInitialized (#6)
    client.set_question_per_level(&5u32);
}

// Use catch_unwind when you need to assert on behaviour AFTER the panic
#[test]
fn test_add_question_unauthorized() {
    let env = Env::default();
    let (_admin, _contract_id, client) = init_admin_auth_only(&env);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.add_question(
            &crate::Levels::Easy,
            &b(&env, "Should I be here?"),
            &b(&env, "No"),
            &b(&env, "Only admin can add"),
        );
    }));
    assert!(result.is_err(), "non-admin should not be able to add_question");
}
```

### 3.5 Ledger Manipulation

The on-chain rate limiter compares the current ledger sequence against `last_attempt_ledger`. Advance the ledger in tests:

```rust
// Set a non-zero sequence so the initial `last_attempt_ledger == 0` does not
// collide with the current ledger and trigger AttemptTooSoon.
env.ledger().set_sequence_number(100_000);

// Advance for the next submission
env.ledger().set_sequence_number(env.ledger().sequence() + 1);
```

### 3.6 Cross-Contract Tests

Register multiple contracts in the same `Env` to test cross-contract interactions:

```rust
#[test]
fn test_full_happy_path_with_nft() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100_000);

    let nft_id = env.register_contract(None, stellar_hunts_nft::StellarHuntsNft);
    let nft_client = stellar_hunts_nft::StellarHuntsNftClient::new(&env, &nft_id);

    let game_id = env.register_contract(None, StellarHunts);
    let game_client = StellarHuntsClient::new(&env, &game_id);

    let admin = Address::generate(&env);
    nft_client.init(
        &admin,
        &game_id,
        &soroban_sdk::String::from_str(&env, "https://example.com/badge/"),
        &soroban_sdk::String::from_str(&env, "StellarHunts Badge"),
        &soroban_sdk::String::from_str(&env, "SHB"),
    );
    game_client.init(&admin);
    game_client.set_nft_contract_address(&nft_id);

    game_client.set_question_per_level(&1u32);
    game_client.add_question(
        &crate::Levels::Easy,
        &b(&env, "What is 2+2?"),
        &b(&env, "4"),
        &b(&env, "basic math"),
    );

    let player = Address::generate(&env);
    assert!(game_client.submit_answer(&player, &1u64, &b(&env, "4")));
    game_client.claim_level_completion_nft(&player, &crate::Levels::Easy);
    assert!(nft_client.has_level_badge(&player, &crate::Levels::Easy));
}
```

### 3.7 Running Contract Tests

```bash
# From the workspace root
cargo test -p stellar-hunts

# From the contract directory
cd onchain/contracts/stellar_hunts
cargo test

# With output printed (for debugging)
cargo test -- --nocapture
```

---

## 4. Mock Patterns Summary

### 4.1 Mocking Stellar SDK — Frontend (Vitest)

```ts
// vi.mock replaces the module for the duration of the test file
vi.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  Keypair: { fromPublicKey: vi.fn(() => ({ publicKey: () => 'GMOCK...' })) },
}));
```

### 4.2 Mocking Stellar SDK — Backend (Jest)

```ts
jest.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  Horizon: {
    Server: jest.fn(() => ({
      loadAccount: jest.fn().mockResolvedValue({ accountId: 'GMOCK...' }),
    })),
  },
}));
```

### 4.3 Mocking TypeORM Repositories — Backend (Jest)

```ts
const mockRepository = {
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
  delete: jest.fn().mockResolvedValue({ affected: 1 }),
};

{ provide: getRepositoryToken(MyEntity), useValue: mockRepository }
```

### 4.4 Soroban: Selective Auth Mocks

```rust
// Approve every require_auth in the transaction (most tests)
env.mock_all_auths();

// Approve only the admin's init call (negative-auth tests)
env.mock_auths(&[MockAuth {
    address: &admin,
    invoke: &MockAuthInvoke {
        contract: &contract_id,
        fn_name: "init",
        args: (&admin,).into_val(&env),
        sub_invokes: &[],
    },
}]);
```

---

## 5. CI Test Pipeline

The GitHub Actions workflow (`/.github/workflows/`) runs tests in three parallel jobs:

```
┌──────────────────────────────────────────────────┐
│                    CI Pipeline                   │
├──────────────┬───────────────┬───────────────────┤
│  frontend    │   backend     │   onchain         │
│  Vitest      │   Jest unit   │   cargo test      │
│  unit +      │   Jest e2e    │   -p stellar-hunts │
│  coverage    │   coverage    │                   │
└──────────────┴───────────────┴───────────────────┘
```

### 5.1 Coverage Requirements

| Layer    | Line coverage target |
|----------|----------------------|
| Frontend | ≥ 70%                |
| Backend  | ≥ 80%                |
| Onchain  | Measured by `cargo llvm-cov` (no hard gate yet) |

### 5.2 Running the Full CI Suite Locally

```bash
# From the repo root (uses the Makefile)
npm run ci

# Individual layers
npm run test          # all jest + vitest
npm run lint          # eslint + rustfmt check
npm run build         # tsc + next build + cargo build
```

### 5.3 Generating a Coverage Report

```bash
# Frontend
npx vitest run --coverage

# Backend
cd backend && npm run test:cov

# Onchain (requires cargo-llvm-cov)
cargo install cargo-llvm-cov
cargo llvm-cov --package stellar-hunts --html
# Report: target/llvm-cov/html/index.html
```
