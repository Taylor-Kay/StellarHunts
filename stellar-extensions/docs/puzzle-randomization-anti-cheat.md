# Guide: Puzzle Randomization and Anti-Cheat

This guide covers the puzzle randomization algorithm and anti-cheat measures implemented in StellarHunts. Technical references: `docs/puzzle-randomization.md` and `backend/src/puzzle/puzzle-randomization.ts`.

---

## 1. Why Randomize Puzzles?

A puzzle with a fixed answer for every player gets shared in community channels within hours. Per-player randomization gives each player a unique puzzle instance while keeping server-side validation fully deterministic — no per-user answer needs to be stored.

---

## 2. Puzzle Randomization Algorithm

### 2.1 Seed Derivation

The seed for each player-puzzle pair is derived with **HMAC-SHA256** keyed by a server-side secret:

```
seed = HMAC-SHA256(SERVER_SECRET, "{userId}:{puzzleId}")
```

```typescript
import { createHmac } from 'crypto';

export function deriveSeed(
  userId: string,
  puzzleId: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${userId}:${puzzleId}`)
    .digest('hex');
}
```

**Properties:**
- The server secret ensures players cannot precompute each other's seeds, even knowing the derivation formula.
- The same `(userId, puzzleId, secret)` triple always produces the same seed, making validation reproducible.

### 2.2 Seeded Random Source

`SeededRandom` builds a deterministic random stream on top of HMAC-SHA256 using a monotonically incrementing counter:

```typescript
export class SeededRandom {
  private counter = 0;

  constructor(private readonly seed: string) {}

  /** Next integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Invalid range [${min}, ${max}]`);
    }
    const digest = createHmac('sha256', this.seed)
      .update(String(this.counter++))
      .digest();
    // 48 bits of entropy is sufficient for any puzzle parameter range.
    const value = digest.readUIntBE(0, 6);
    return min + (value % (max - min + 1));
  }

  /** Picks one element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
    return items[this.int(0, items.length - 1)];
  }
}
```

### 2.3 Puzzle Generator Contract

A puzzle author writes a `PuzzleGenerator` — a pure function that takes an `rng` and returns a prompt and an answer:

```typescript
export type PuzzleGenerator = (rng: SeededRandom) => {
  prompt: string;
  answer: string | number;
};
```

**Example generator — arithmetic:**

```typescript
import { PuzzleGenerator } from 'backend/src/puzzle/puzzle-randomization';

export const additionPuzzle: PuzzleGenerator = (rng) => {
  const a = rng.int(10, 99);
  const b = rng.int(10, 99);
  return { prompt: `What is ${a} + ${b}?`, answer: a + b };
};
```

**Example generator — multiple choice with shuffled answers:**

```typescript
export const capitalCityPuzzle: PuzzleGenerator = (rng) => {
  const cities = [
    { country: 'France', capital: 'Paris' },
    { country: 'Japan',  capital: 'Tokyo' },
    { country: 'Brazil', capital: 'Brasília' },
    { country: 'Egypt',  capital: 'Cairo' },
  ];
  const chosen = rng.pick(cities);
  const distractors = cities
    .filter((c) => c.capital !== chosen.capital)
    .map((c) => c.capital);
  // Shuffle the wrong answers deterministically
  const shuffled = [
    rng.pick(distractors),
    rng.pick(distractors.filter((d) => d !== rng.pick(distractors))),
  ];
  const options = rng.pick([
    [chosen.capital, ...shuffled],
    [shuffled[0], chosen.capital, shuffled[1]],
    [...shuffled, chosen.capital],
  ]);
  return {
    prompt: `What is the capital of ${chosen.country}? Options: ${options.join(', ')}`,
    answer: chosen.capital,
  };
};
```

### 2.4 Answer Shuffling for Multiple Choice

Always shuffle options by drawing from the `rng`, not from `Math.random()`. The player must receive the same option ordering on every page load so they cannot refresh until the correct option lands first:

```typescript
// ✅ Deterministic — the same player always sees the same order
const position = rng.int(0, options.length - 1);

// ❌ Non-deterministic — breaks reproducibility
const position = Math.floor(Math.random() * options.length);
```

### 2.5 Building and Validating an Instance

```typescript
export function normaliseAnswer(value: string | number): string {
  return String(value).trim().toLowerCase();
}

export function createPuzzleInstance(
  generate: PuzzleGenerator,
  userId: string,
  puzzleId: string,
  secret: string,
): PuzzleInstance {
  const rng = new SeededRandom(deriveSeed(userId, puzzleId, secret));
  const { prompt, answer } = generate(rng);
  return { prompt, answer: normaliseAnswer(answer) };
}

export function isCorrectAnswer(
  instance: PuzzleInstance,
  submitted: string | number,
): boolean {
  return normaliseAnswer(submitted) === instance.answer;
}
```

Validation **recomputes** the instance from the same seed rather than storing the expected answer. This eliminates a whole class of database-leakage attacks.

---

## 3. Time-Based Anti-Cheat: Impossible Solve Detection

Puzzles that are solved implausibly quickly are flagged as suspicious. The server records the time the puzzle was first served and compares it against the submission time:

```
elapsed = submission_timestamp - puzzle_served_timestamp
if elapsed < MIN_SOLVE_TIME_SECONDS → flag / reject
```

**Typical thresholds:**

| Puzzle type        | Minimum solve time |
|--------------------|--------------------|
| Simple arithmetic  | 2 seconds          |
| Knowledge question | 5 seconds          |
| Multi-step puzzle  | 15 seconds         |

The minimum time is set conservatively to allow for fast but legitimate solvers while blocking automated scripts that submit instantly.

---

## 4. IP-Based Duplicate Account Detection

To prevent a single person from farming rewards with many throwaway accounts, the backend logs the IP address at account creation and at puzzle completion:

1. **Registration:** record `(ip_address, created_at)` in the user record.
2. **Puzzle completion:** record `(ip_address, completed_at)` per completion.
3. **Cluster detection:** query for IP addresses linked to more than `N` accounts (default: 3) within a 24-hour window. Cluster members are flagged for review.
4. **Proxy/VPN awareness:** X-Forwarded-For headers are stripped to the first non-private IP. Known VPN/datacenter CIDR ranges are weighted more heavily in the scoring.

IP-based detection is a heuristic, not a ban trigger. Flagged accounts go into a review queue; a human or higher-confidence signal confirms the ban.

---

## 5. Client-Side vs. Server-Side Validation

| Concern | Client | Server |
|---------|--------|--------|
| Instant feedback (UX) | ✅ Preferred | — |
| Authoritative grading | ❌ Never trust | ✅ Required |
| Answer exposure | ❌ Never send the answer to the client | — |
| Seed / RNG state | ❌ Never expose | ✅ Server holds the secret |

**Rule:** the client only receives the puzzle **prompt** and the list of options (for multiple choice). The expected answer and the seed are never transmitted to the browser. All correctness decisions are made on the server.

```typescript
// ✅ What the API returns to the client
{ prompt: "What is 42 + 17?", options: null }  // open answer

// ❌ Never return this
{ prompt: "...", expectedAnswer: "59", seed: "abc123..." }
```

---

## 6. Rate Limiting for Submissions

### 6.1 Per-User Attempt Limits

The `puzzle-submission-throttle` module (see `stellar-extensions/backend/src/puzzle-submission-throttle/`) enforces:

- **Sliding window:** max N submissions per puzzle per time window (e.g. 5 attempts per 10 minutes).
- **Progressive backoff:** each incorrect attempt adds a delay before the next attempt is accepted.
- **Global daily cap:** an account cannot submit more than M answers in 24 hours, preventing brute-force sweeps across all puzzles.

```typescript
// Guard applied at the controller level
@UseGuards(PuzzleSubmissionThrottleGuard)
@Post('/submit')
async submitAnswer(@Body() dto: SubmitAnswerDto) { ... }
```

### 6.2 On-Chain Rate Limiting

The Soroban contract enforces `AttemptTooSoon` by comparing the current ledger sequence number against the last attempt ledger stored in `LevelProgressV2.last_attempt_ledger`. A minimum number of ledgers must pass between attempts:

```rust
// From lib.rs — submit_answer
let ledger_gap = env
    .ledger()
    .sequence()
    .saturating_sub(lp.last_attempt_ledger);
if ledger_gap < MIN_ATTEMPT_GAP_LEDGERS {
    panic_with_error!(&env, Error::AttemptTooSoon);
}
```

This prevents on-chain spam even if the backend rate limiter is bypassed.

### 6.3 IP-Level Rate Limiting

At the reverse-proxy level (nginx / Cloudflare), the `/api/v1/*/submit` path is rate-limited per IP:

```nginx
limit_req_zone $binary_remote_addr zone=submit:10m rate=10r/m;
limit_req zone=submit burst=5 nodelay;
```

---

## 7. Author Checklist

When writing a new randomized puzzle:

- [ ] Only draw randomness from `rng.int` or `rng.pick`. Never call `Math.random()` or `Date.now()`.
- [ ] Call `rng` methods in a fixed order — adding a new call in the middle changes every existing instance.
- [ ] Keep the answer space large enough that exhaustive guessing is impractical (aim for > 10,000 possibilities).
- [ ] If you change a generator, **publish a new puzzle version** instead of editing the live generator.
- [ ] Do not embed the answer in the client-side prompt string.
- [ ] Test that `isCorrectAnswer(createPuzzleInstance(gen, userId, puzzleId, secret), correctAnswer)` returns `true` and that common wrong answers return `false`.
