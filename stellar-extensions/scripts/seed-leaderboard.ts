#!/usr/bin/env ts-node
/**
 * seed-leaderboard.ts
 * -------------------
 * Seeds the database with mock leaderboard data for development and testing.
 *
 * Usage:
 *   npx ts-node stellar-extensions/scripts/seed-leaderboard.ts [options]
 *
 * Options:
 *   --count <n>       Number of mock users to generate  (default: 50)
 *   --clean           Drop existing test data before seeding (default: true)
 *   --no-clean        Skip the cleanup step
 *
 * Examples:
 *   npx ts-node stellar-extensions/scripts/seed-leaderboard.ts
 *   npx ts-node stellar-extensions/scripts/seed-leaderboard.ts --count 200
 *   npx ts-node stellar-extensions/scripts/seed-leaderboard.ts --count 100 --no-clean
 *
 * The script is idempotent: re-running it cleans up the previous test data
 * (unless --no-clean is passed) and re-seeds fresh records.
 *
 * Technical context:
 *   Follows patterns from backend/scripts/seed.ts and
 *   backend/scripts/load-test-leaderboard.ts.
 */

import 'reflect-metadata';
import { DataSource, EntityManager } from 'typeorm';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  count: number;
  clean: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    // --no-<flag> → { <flag>: false }
    if (key.startsWith('no-')) {
      args[key.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }

  return {
    count: Number(args['count'] ?? process.env.SEED_COUNT ?? 50),
    clean: args['clean'] !== false,
  };
}

// ---------------------------------------------------------------------------
// Minimal inline entity definitions
// (mirrors backend entity shapes without importing the backend module graph)
// ---------------------------------------------------------------------------

/**
 * Leaderboard entry covering one time-period bucket for one user.
 *
 * Table: leaderboard_entries
 */
interface LeaderboardEntry {
  userId: string;
  username: string;
  walletAddress: string;
  solveCount: number;
  totalTimeSeconds: number;
  averageTimeSeconds: number;
  period: 'daily' | 'weekly' | 'all_time';
  periodStart: Date;
  rank: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random (no external deps — same technique as
// SeededRandom in backend/src/puzzle/puzzle-randomization.ts but simplified
// for seeding use where crypto-grade randomness is unnecessary).
// ---------------------------------------------------------------------------

class SimpleRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** LCG next integer in [0, max). */
  nextInt(max: number): number {
    // Numerical Recipes LCG constants
    this.state = (1664525 * this.state + 1013904223) & 0xffffffff;
    return Math.abs(this.state) % max;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }

  /** Pick a random element. */
  pick<T>(items: T[]): T {
    return items[this.nextInt(items.length)];
  }
}

// ---------------------------------------------------------------------------
// Data generation helpers
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  'Cosmic', 'Stellar', 'Nebular', 'Lunar', 'Solar', 'Galactic',
  'Orbital', 'Astral', 'Quantum', 'Binary', 'Photon', 'Neutron',
  'Pulsar', 'Quasar', 'Void', 'Nova', 'Dwarf', 'Giant',
];

const NOUNS = [
  'Hunter', 'Explorer', 'Pioneer', 'Ranger', 'Seeker', 'Rover',
  'Voyager', 'Scout', 'Nomad', 'Drifter', 'Pilot', 'Captain',
  'Commander', 'Admiral', 'Warden', 'Sage', 'Oracle', 'Knight',
];

/** Generate a mock Stellar wallet address (G... format). */
function mockWalletAddress(rng: SimpleRng): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let addr = 'G';
  for (let i = 0; i < 55; i++) {
    addr += chars[rng.nextInt(chars.length)];
  }
  return addr;
}

interface MockUser {
  userId: string;
  username: string;
  walletAddress: string;
}

/** Generates `count` mock users with unique usernames. */
function generateUsers(count: number, rng: SimpleRng): MockUser[] {
  const users: MockUser[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    let username: string;
    let attempts = 0;
    do {
      const adj  = rng.pick(ADJECTIVES);
      const noun = rng.pick(NOUNS);
      const num  = rng.int(1, 9999);
      username = `${adj}${noun}${num}`;
      attempts++;
    } while (usedNames.has(username) && attempts < 100);

    usedNames.add(username);

    users.push({
      userId: `test-user-${i + 1}`,
      username,
      walletAddress: mockWalletAddress(rng),
    });
  }

  return users;
}

/**
 * Returns the ISO-8601 start of the current day (UTC).
 * Used as `periodStart` for `daily` entries.
 */
function startOfDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the ISO-8601 start of the current week (Monday UTC).
 * Used as `periodStart` for `weekly` entries.
 */
function startOfWeek(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * Generates leaderboard entries for all three periods for the given user set.
 *
 * Solve counts follow a Zipf-like distribution so the top players have
 * dramatically more solves than the median — matching real leaderboard shapes.
 */
function generateEntries(
  users: MockUser[],
  rng: SimpleRng,
): LeaderboardEntry[] {
  const now = new Date();
  const periods: Array<LeaderboardEntry['period']> = ['daily', 'weekly', 'all_time'];
  const periodStarts: Record<LeaderboardEntry['period'], Date> = {
    daily: startOfDay(),
    weekly: startOfWeek(),
    all_time: new Date('2024-01-01T00:00:00.000Z'),
  };

  // Solve count ranges per period (min, max)
  const solveBounds: Record<LeaderboardEntry['period'], [number, number]> = {
    daily: [0, 20],
    weekly: [0, 100],
    all_time: [0, 2000],
  };

  const entries: LeaderboardEntry[] = [];

  for (const period of periods) {
    const [minSolves, maxSolves] = solveBounds[period];

    // Build unsorted entries
    const periodEntries: Omit<LeaderboardEntry, 'rank'>[] = users.map((u, idx) => {
      // Zipf-like distribution: earlier users (lower idx) tend to solve more
      const fraction = Math.pow(1 - idx / users.length, 2);
      const solveCount = Math.round(
        minSolves + fraction * (maxSolves - minSolves) + rng.int(-2, 2),
      );
      const clampedSolves = Math.max(0, solveCount);

      // Average time per solve: 30 s to 10 min, faster for top players
      const avgTime = rng.int(30, 600 - Math.round(fraction * 400));
      const totalTime = clampedSolves * avgTime;

      return {
        userId: u.userId,
        username: u.username,
        walletAddress: u.walletAddress,
        solveCount: clampedSolves,
        totalTimeSeconds: totalTime,
        averageTimeSeconds: clampedSolves > 0 ? avgTime : 0,
        period,
        periodStart: periodStarts[period],
        createdAt: now,
        updatedAt: now,
      };
    });

    // Sort by solveCount DESC, totalTimeSeconds ASC (tiebreaker)
    periodEntries.sort((a, b) => {
      if (b.solveCount !== a.solveCount) return b.solveCount - a.solveCount;
      return a.totalTimeSeconds - b.totalTimeSeconds;
    });

    // Assign ranks
    periodEntries.forEach((entry, idx) => {
      entries.push({ ...entry, rank: idx + 1 });
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

const TEST_USER_ID_PREFIX = 'test-user-';
const TABLE = 'leaderboard_entries';

/** Removes all rows whose userId starts with the test prefix. */
async function cleanTestData(manager: EntityManager): Promise<number> {
  const result = await manager.query(
    `DELETE FROM ${TABLE} WHERE "userId" LIKE $1`,
    [`${TEST_USER_ID_PREFIX}%`],
  );
  // TypeORM raw result shape varies by driver; handle both.
  return typeof result === 'number' ? result : (result?.affected ?? result?.rowCount ?? 0);
}

/** Bulk-inserts leaderboard entries using raw SQL for performance. */
async function insertEntries(
  manager: EntityManager,
  entries: LeaderboardEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  // Build parameterised bulk insert in chunks of 500 to stay under
  // PostgreSQL's parameter limit (65535 / 10 columns ≈ 6553 rows per batch).
  const CHUNK = 500;
  const cols = [
    '"userId"', '"username"', '"walletAddress"',
    '"solveCount"', '"totalTimeSeconds"', '"averageTimeSeconds"',
    '"period"', '"periodStart"', '"rank"',
    '"createdAt"', '"updatedAt"',
  ];

  for (let offset = 0; offset < entries.length; offset += CHUNK) {
    const chunk = entries.slice(offset, offset + CHUNK);
    const values: unknown[] = [];
    const placeholders = chunk.map((e, i) => {
      const base = i * cols.length;
      values.push(
        e.userId, e.username, e.walletAddress,
        e.solveCount, e.totalTimeSeconds, e.averageTimeSeconds,
        e.period, e.periodStart, e.rank,
        e.createdAt, e.updatedAt,
      );
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    });

    await manager.query(
      `INSERT INTO ${TABLE} (${cols.join(', ')}) VALUES ${placeholders.join(', ')}
       ON CONFLICT ("userId", "period") DO UPDATE SET
         "solveCount"         = EXCLUDED."solveCount",
         "totalTimeSeconds"   = EXCLUDED."totalTimeSeconds",
         "averageTimeSeconds" = EXCLUDED."averageTimeSeconds",
         "rank"               = EXCLUDED."rank",
         "updatedAt"          = EXCLUDED."updatedAt"`,
      values,
    );
  }
}

// ---------------------------------------------------------------------------
// DataSource bootstrap
// (Attempts to reuse backend/src/database/data-source when available,
//  falls back to environment variables.)
// ---------------------------------------------------------------------------

async function buildDataSource(): Promise<DataSource> {
  try {
    // Prefer the application's configured DataSource when running inside
    // the backend workspace (e.g. via ts-node from the repo root).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppDataSource } = require('../../backend/src/database/data-source');
    return AppDataSource.initialize();
  } catch {
    // Standalone fallback: build a minimal DataSource from env vars.
    const ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? 'stellarhunts',
      password: process.env.DB_PASSWORD ?? 'stellarhunts',
      database: process.env.DB_NAME ?? 'stellarhunts',
      synchronize: false,
      logging: false,
    });
    return ds.initialize();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.count <= 0) {
    throw new Error('--count must be a positive integer');
  }

  process.stdout.write(
    `\nLeaderboard seeder\n` +
    `  users:  ${args.count}\n` +
    `  clean:  ${args.clean}\n` +
    `  periods: daily, weekly, all_time\n\n`,
  );

  const dataSource = await buildDataSource();

  try {
    await dataSource.transaction(async (manager) => {
      // ---- 1. Clean up existing test data ---------------------------------
      let deleted = 0;
      if (args.clean) {
        process.stdout.write('Cleaning existing test data… ');
        deleted = await cleanTestData(manager);
        process.stdout.write(`removed ${deleted} row(s).\n`);
      }

      // ---- 2. Generate mock data ------------------------------------------
      process.stdout.write('Generating mock users… ');
      const rng = new SimpleRng(Date.now() & 0xffffffff);
      const users = generateUsers(args.count, rng);
      process.stdout.write(`${users.length} users ready.\n`);

      process.stdout.write('Generating leaderboard entries… ');
      const entries = generateEntries(users, rng);
      process.stdout.write(`${entries.length} entries ready (3 periods × ${users.length} users).\n`);

      // ---- 3. Insert entries -----------------------------------------------
      process.stdout.write('Inserting entries… ');
      await insertEntries(manager, entries);
      process.stdout.write('done.\n');

      // ---- 4. Summary -------------------------------------------------------
      const byPeriod = entries.reduce<Record<string, number>>((acc, e) => {
        acc[e.period] = (acc[e.period] ?? 0) + 1;
        return acc;
      }, {});

      process.stdout.write(
        [
          '',
          'Seed complete.',
          `  users seeded:          ${users.length}`,
          `  entries (daily):       ${byPeriod['daily'] ?? 0}`,
          `  entries (weekly):      ${byPeriod['weekly'] ?? 0}`,
          `  entries (all_time):    ${byPeriod['all_time'] ?? 0}`,
          `  total entries:         ${entries.length}`,
          '',
        ].join('\n'),
      );
    });
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  process.stderr.write(
    `Leaderboard seeder failed: ${(error as Error)?.message ?? String(error)}\n`,
  );
  process.exitCode = 1;
});
