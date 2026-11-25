# Puzzle Daily Challenge Contract

Soroban contract that generates one puzzle challenge per UTC day, verifies
solutions on-chain, tracks per-player completion and streaks, and pays rewards
from a pre-funded token pool with a streak multiplier.

Part of the isolated `stellar-extensions/onchain` workspace; it does not modify
the core `onchain/` contracts.

## Day semantics

A "day" is `ledger timestamp / 86_400` (UTC days since the Unix epoch). The
contract derives it on-chain, so callers cannot choose or fake the day.

## Entrypoints

### Setup

| Function | Auth | Description |
| --- | --- | --- |
| `init(admin, reward_token)` | admin | One-time configuration. |
| `set_reward_token(token)` | admin | Replace the SEP-41 reward token. |
| `fund_reward_pool(amount) -> i128` | admin | Moves tokens from the admin into the contract and returns the new pool balance. |

### Challenge management

| Function | Auth | Description |
| --- | --- | --- |
| `open_daily_challenge(seed, solution_hash, reward_amount) -> BytesN<32>` | admin | Opens today's challenge and returns its generated hash. |
| `close_daily_challenge(day)` | admin | Stops accepting submissions for a day. |

`open_daily_challenge` computes:

```
challenge_hash = sha256(
    "stellar-hunts-daily-v1"
    || previous_challenge_hash   (absent on the first day)
    || day (big-endian u64)
    || seed
    || solution_hash
)
```

Chaining the previous hash makes each day's challenge commit to the full history,
so a day's hash cannot be precomputed or swapped in isolation. The day must be
strictly later than the last opened day.

### Completion

| Function | Auth | Description |
| --- | --- | --- |
| `submit_daily_solution(player, day, solution) -> CompletionRecord` | player | Verifies `sha256(solution)` and pays the reward. |

Replay protection is layered:

1. A day can only be opened once (`ChallengeAlreadyOpened`), so a past challenge
   cannot be recreated.
2. Submissions are only accepted on the challenge's own day (`NotChallengeDay`).
3. `Completion(player, day)` is the per-player replay guard
   (`AlreadyCompleted`).

The completion record is written before the token transfer; a failed transfer
reverts the whole invocation and a reentrant token cannot complete twice.

### Views

| Function | Description |
| --- | --- |
| `get_challenge(day) -> ChallengeView` | Public challenge data; never exposes the solution hash. |
| `has_completed(player, day) -> bool` | Whether a player completed the day. |
| `get_completion(player, day) -> CompletionRecord` | Stored completion record. |
| `get_streak(player) -> u32` | Current consecutive-day streak. |
| `get_streak_state(player) -> StreakState` | Streak plus total completions. |
| `preview_reward(player, day) -> i128` | Reward a completion would pay, including the projected streak bonus. |
| `get_streak_multiplier_bps(streak) -> u32` | Multiplier for a streak, in basis points. |
| `get_current_day() -> u64` | Current on-chain day. |
| `get_last_opened_day() -> u64` | Highest day opened so far. |
| `get_admin()`, `get_reward_token()` | Configuration. |

## Streak bonus

| Consecutive days | Multiplier |
| --- | --- |
| 1 | 1.00x |
| 2 | 1.25x |
| 3 | 1.50x |
| 4 | 1.75x |
| 5 | 2.00x |
| 6 | 2.25x |
| 7 | 2.50x |
| 8 | 2.75x |
| 9+ | 3.00x (cap) |

Each extra consecutive day adds 2,500 bps (25 points). Missing a day resets the
streak to 1. The reward is `reward_amount * multiplier_bps / 10_000`, rounded
down, with checked arithmetic.

## Events

| Topic | Payload |
| --- | --- |
| `daily_initialized` | `(admin, reward_token)` |
| `reward_token_updated` | `(token)` |
| `reward_pool_funded` | `(admin, amount)` |
| `challenge_opened` | `(day, challenge_hash, reward_amount)` |
| `challenge_closed` | `(day)` |
| `daily_completed` | `(player, day, streak, reward)` |

## Storage and TTL

Instance storage holds the admin, reward token, last opened day, and last
challenge hash. Persistent storage holds challenges, completion records, and
streak state. Every write bumps TTL (threshold 17,280 ledgers, extend to
518,400 ledgers, roughly 30 days).

## Tests

```bash
cd stellar-extensions/onchain
cargo test -p stellar-hunts-puzzle-daily-challenge
```

25 tests cover initialization and authorization, on-chain hash derivation and
daily chaining, duplicate/past-day rejection, input validation, correct and
incorrect submissions, replay and wrong-day rejection, closed challenges, reward
payouts and pool funding, transfer-failure rollback, streak progression and
reset, the multiplier cap, previews, and independent per-player streaks.
