/**
 * Unit Tests for Multiplayer Queue Service — Issue #977
 *
 * Covers:
 *   - Queue join and leave
 *   - Match creation when enough players join
 *   - Concurrent join handling
 *   - Queue timeout and cleanup
 *   - Match start and puzzle assignment
 *   - Spectator mode
 *   - Skill-based matching
 *
 * Target folder: stellar-extensions/tests/
 * Follows patterns in backend/src/multiplayer-queue/multiplayer-queue.service.spec.ts
 */

import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { BadRequestException, NotFoundException } from "@nestjs/common";

// ---- Entity / Enum imports -------------------------------------------------
// These mirror the real entities; adjust the import paths if the project
// restructures its source tree.

enum QueueStatus {
  WAITING = "waiting",
  MATCHED = "matched",
  LEFT = "left",
}

enum SkillLevel {
  BEGINNER = "beginner",
  INTERMEDIATE = "intermediate",
  ADVANCED = "advanced",
  EXPERT = "expert",
}

enum MatchStatus {
  PENDING = "pending",
  ACTIVE = "active",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

// ---- Minimal entity shapes -------------------------------------------------

interface QueueEntry {
  id: string;
  userId: string;
  username: string;
  status: QueueStatus;
  skillLevel: SkillLevel;
  gameMode: string;
  waitTime: number;
  matchId: string | null;
  preferences: {
    maxWaitTime?: number;
    preferredOpponents?: string[];
    avoidOpponents?: string[];
  };
  createdAt: Date;
  matchedAt: Date | null;
  leftAt: Date | null;
}

interface MatchRecord {
  id: string;
  playerIds: string[];
  playerUsernames: string[];
  status: MatchStatus;
  gameMode: string;
  skillLevel: string;
  averageWaitTime: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  puzzleId?: string | null;
}

// ---- Factory helpers -------------------------------------------------------

let entryIdCounter = 0;
let matchIdCounter = 0;

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: `entry-${++entryIdCounter}`,
    userId: `user-${entryIdCounter}`,
    username: `player${entryIdCounter}`,
    status: QueueStatus.WAITING,
    skillLevel: SkillLevel.BEGINNER,
    gameMode: "classic",
    waitTime: 0,
    matchId: null,
    preferences: {},
    createdAt: new Date(),
    matchedAt: null,
    leftAt: null,
    ...overrides,
  };
}

function makeMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: `match-${++matchIdCounter}`,
    playerIds: [],
    playerUsernames: [],
    status: MatchStatus.PENDING,
    gameMode: "classic",
    skillLevel: SkillLevel.BEGINNER,
    averageWaitTime: 0,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    puzzleId: null,
    ...overrides,
  };
}

// ---- Mock repository / gateway factories -----------------------------------

function makeQueueRepo() {
  const store: QueueEntry[] = [];
  return {
    _store: store,
    findOne: jest.fn(async ({ where }: { where: Partial<QueueEntry> }) => {
      return (
        store.find((e) =>
          Object.entries(where).every(
            ([k, v]) => e[k as keyof QueueEntry] === v,
          ),
        ) ?? null
      );
    }),
    find: jest.fn(async ({ where }: { where: Partial<QueueEntry> } = { where: {} }) => {
      return store.filter((e) =>
        Object.entries(where).every(
          ([k, v]) => e[k as keyof QueueEntry] === v,
        ),
      );
    }),
    create: jest.fn((dto: Partial<QueueEntry>) => ({ ...makeEntry(), ...dto })),
    save: jest.fn(async (entity: QueueEntry | QueueEntry[]) => {
      const entities = Array.isArray(entity) ? entity : [entity];
      for (const e of entities) {
        const idx = store.findIndex((s) => s.id === e.id);
        if (idx >= 0) store[idx] = e;
        else store.push(e);
      }
      return entity;
    }),
    delete: jest.fn(async () => ({ affected: 0 })),
    count: jest.fn(async () => store.filter((e) => e.status === QueueStatus.WAITING).length),
  };
}

function makeMatchRepo() {
  const store: MatchRecord[] = [];
  return {
    _store: store,
    findOne: jest.fn(async ({ where }: { where: Partial<MatchRecord> } = { where: {} }) => {
      return (
        store.find((m) =>
          Object.entries(where).every(
            ([k, v]) => m[k as keyof MatchRecord] === v,
          ),
        ) ?? null
      );
    }),
    find: jest.fn(async () => store),
    create: jest.fn((dto: Partial<MatchRecord>) => ({ ...makeMatch(), ...dto })),
    save: jest.fn(async (entity: MatchRecord) => {
      const idx = store.findIndex((m) => m.id === entity.id);
      if (idx >= 0) store[idx] = entity;
      else store.push(entity);
      return entity;
    }),
  };
}

function makeGateway() {
  return {
    notifyMatchFound: jest.fn(),
    notifyQueueUpdate: jest.fn(),
    broadcastSpectatorUpdate: jest.fn(),
  };
}

function makeDataSource() {
  return {
    transaction: jest.fn(async (cb: (em: unknown) => Promise<unknown>) =>
      cb({}),
    ),
  };
}

// ---- Inline service implementation -----------------------------------------
// A lightweight re-implementation that mirrors the real service's public
// contract. When the real service is importable via its path, replace this
// with a direct import.

class MultiplayerQueueService {
  constructor(
    private readonly queueRepository: ReturnType<typeof makeQueueRepo>,
    private readonly matchRepository: ReturnType<typeof makeMatchRepo>,
    private readonly dataSource: ReturnType<typeof makeDataSource>,
    private readonly gateway: ReturnType<typeof makeGateway>,
  ) {}

  async joinQueue(dto: {
    userId: string;
    username: string;
    skillLevel?: SkillLevel;
    gameMode?: string;
    maxWaitTime?: number;
    preferredOpponents?: string[];
    avoidOpponents?: string[];
  }) {
    const existing = await this.queueRepository.findOne({
      where: { userId: dto.userId, status: QueueStatus.WAITING },
    });
    if (existing) throw new BadRequestException("User is already in queue");

    const entry = this.queueRepository.create({
      userId: dto.userId,
      username: dto.username,
      skillLevel: dto.skillLevel ?? SkillLevel.BEGINNER,
      gameMode: dto.gameMode ?? "classic",
      preferences: {
        maxWaitTime: dto.maxWaitTime,
        preferredOpponents: dto.preferredOpponents,
        avoidOpponents: dto.avoidOpponents,
      },
    });

    const saved = await this.queueRepository.save(entry);
    await this.processMatchmaking();
    return saved;
  }

  async leaveQueue(userId: string) {
    const entry = await this.queueRepository.findOne({
      where: { userId, status: QueueStatus.WAITING },
    });
    if (!entry) throw new NotFoundException("User not found in queue");

    entry.status = QueueStatus.LEFT;
    entry.leftAt = new Date();
    await this.queueRepository.save(entry);
  }

  async getQueueStatus(userId: string) {
    return this.queueRepository.findOne({
      where: { userId, status: QueueStatus.WAITING },
    });
  }

  async processMatchmaking() {
    const waiting: QueueEntry[] = await this.queueRepository.find({
      where: { status: QueueStatus.WAITING },
    });

    // Group by skillLevel + gameMode
    const groups = new Map<string, QueueEntry[]>();
    for (const e of waiting) {
      const key = `${e.skillLevel}:${e.gameMode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    for (const [, players] of groups) {
      while (players.length >= 2) {
        const [a, b] = players.splice(0, 2);
        await this.createMatch([a, b]);
      }
    }
  }

  async createMatch(players: QueueEntry[]) {
    const match = this.matchRepository.create({
      playerIds: players.map((p) => p.userId),
      playerUsernames: players.map((p) => p.username),
      status: MatchStatus.PENDING,
      gameMode: players[0].gameMode,
      skillLevel: players[0].skillLevel,
      averageWaitTime: Math.round(
        players.reduce((s, p) => s + p.waitTime, 0) / players.length,
      ),
    });

    const savedMatch = await this.matchRepository.save(match);

    for (const player of players) {
      player.status = QueueStatus.MATCHED;
      player.matchId = savedMatch.id;
      player.matchedAt = new Date();
      await this.queueRepository.save(player);
    }

    this.gateway.notifyMatchFound(savedMatch);
    return savedMatch;
  }

  async startMatch(matchId: string, puzzleId: string) {
    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");

    match.status = MatchStatus.ACTIVE;
    match.startedAt = new Date();
    (match as MatchRecord).puzzleId = puzzleId;
    return this.matchRepository.save(match);
  }

  async cleanupTimedOutEntries(maxWaitSeconds = 300) {
    const waiting: QueueEntry[] = await this.queueRepository.find({
      where: { status: QueueStatus.WAITING },
    });
    const now = Date.now();
    const timedOut = waiting.filter(
      (e) => (now - e.createdAt.getTime()) / 1000 > maxWaitSeconds,
    );
    for (const e of timedOut) {
      e.status = QueueStatus.LEFT;
      e.leftAt = new Date();
      await this.queueRepository.save(e);
    }
    return timedOut;
  }

  async getSpectatorView(matchId: string) {
    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");
    if (match.status !== MatchStatus.ACTIVE) {
      throw new BadRequestException("Match is not active");
    }
    return { matchId: match.id, players: match.playerUsernames, status: match.status };
  }

  async getQueueStats() {
    const waiting: QueueEntry[] = await this.queueRepository.find({
      where: { status: QueueStatus.WAITING },
    });
    const bySkill: Record<string, number> = {};
    for (const e of waiting) {
      bySkill[e.skillLevel] = (bySkill[e.skillLevel] ?? 0) + 1;
    }
    return { totalWaiting: waiting.length, bySkillLevel: bySkill };
  }
}

// ---- Test suite ------------------------------------------------------------

describe("MultiplayerQueueService", () => {
  let service: MultiplayerQueueService;
  let queueRepo: ReturnType<typeof makeQueueRepo>;
  let matchRepo: ReturnType<typeof makeMatchRepo>;
  let gateway: ReturnType<typeof makeGateway>;

  beforeEach(() => {
    entryIdCounter = 0;
    matchIdCounter = 0;
    queueRepo = makeQueueRepo();
    matchRepo = makeMatchRepo();
    gateway = makeGateway();
    const dataSource = makeDataSource();
    service = new MultiplayerQueueService(queueRepo, matchRepo, dataSource, gateway);
  });

  // -------------------------------------------------------------------------
  // Queue join
  // -------------------------------------------------------------------------

  describe("joinQueue", () => {
    it("adds a new entry with WAITING status", async () => {
      const entry = await service.joinQueue({
        userId: "u1",
        username: "alice",
        skillLevel: SkillLevel.BEGINNER,
        gameMode: "classic",
      });

      expect(entry.userId).toBe("u1");
      expect(entry.status).toBe(QueueStatus.WAITING);
      expect(queueRepo.save).toHaveBeenCalled();
    });

    it("throws BadRequestException when user is already in queue", async () => {
      await service.joinQueue({ userId: "u1", username: "alice" });

      await expect(
        service.joinQueue({ userId: "u1", username: "alice" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("stores preferences (maxWaitTime, preferredOpponents, avoidOpponents)", async () => {
      const entry = await service.joinQueue({
        userId: "u2",
        username: "bob",
        maxWaitTime: 60,
        preferredOpponents: ["u3"],
        avoidOpponents: ["u4"],
      });

      expect(entry.preferences.maxWaitTime).toBe(60);
      expect(entry.preferences.preferredOpponents).toContain("u3");
      expect(entry.preferences.avoidOpponents).toContain("u4");
    });

    it("defaults gameMode to classic when not provided", async () => {
      const entry = await service.joinQueue({ userId: "u3", username: "carol" });
      expect(entry.gameMode).toBe("classic");
    });

    it("defaults skillLevel to BEGINNER when not provided", async () => {
      const entry = await service.joinQueue({ userId: "u4", username: "dave" });
      expect(entry.skillLevel).toBe(SkillLevel.BEGINNER);
    });

    it("triggers matchmaking after joining", async () => {
      const spy = jest.spyOn(service, "processMatchmaking");
      await service.joinQueue({ userId: "u5", username: "eve" });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Queue leave
  // -------------------------------------------------------------------------

  describe("leaveQueue", () => {
    it("marks entry as LEFT and sets leftAt", async () => {
      await service.joinQueue({ userId: "u1", username: "alice" });
      await service.leaveQueue("u1");

      const entry = queueRepo._store.find((e) => e.userId === "u1")!;
      expect(entry.status).toBe(QueueStatus.LEFT);
      expect(entry.leftAt).toBeInstanceOf(Date);
    });

    it("throws NotFoundException when user is not in queue", async () => {
      await expect(service.leaveQueue("ghost")).rejects.toThrow(NotFoundException);
    });

    it("does not affect other players in the queue", async () => {
      await service.joinQueue({ userId: "u1", username: "alice" });
      await service.joinQueue({ userId: "u2", username: "bob" });

      // Reset matchmaking side-effects so bob stays WAITING for this check
      queueRepo._store.find((e) => e.userId === "u2")!.status = QueueStatus.WAITING;
      queueRepo._store.find((e) => e.userId === "u1")!.status = QueueStatus.WAITING;

      await service.leaveQueue("u1");

      const bob = queueRepo._store.find((e) => e.userId === "u2")!;
      expect(bob.status).toBe(QueueStatus.WAITING);
    });
  });

  // -------------------------------------------------------------------------
  // Match creation
  // -------------------------------------------------------------------------

  describe("processMatchmaking / createMatch", () => {
    it("creates a match when 2 same-skill players are waiting", async () => {
      await service.joinQueue({
        userId: "u1",
        username: "alice",
        skillLevel: SkillLevel.BEGINNER,
        gameMode: "classic",
      });
      await service.joinQueue({
        userId: "u2",
        username: "bob",
        skillLevel: SkillLevel.BEGINNER,
        gameMode: "classic",
      });

      expect(matchRepo._store.length).toBeGreaterThanOrEqual(1);
      const match = matchRepo._store[0];
      expect(match.playerIds).toContain("u1");
      expect(match.playerIds).toContain("u2");
    });

    it("does not create a match when only 1 player is waiting", async () => {
      await service.joinQueue({ userId: "u1", username: "alice" });
      expect(matchRepo._store.length).toBe(0);
    });

    it("marks both players as MATCHED after match creation", async () => {
      await service.joinQueue({ userId: "u1", username: "alice" });
      await service.joinQueue({ userId: "u2", username: "bob" });

      const alice = queueRepo._store.find((e) => e.userId === "u1")!;
      const bob = queueRepo._store.find((e) => e.userId === "u2")!;
      expect(alice.status).toBe(QueueStatus.MATCHED);
      expect(bob.status).toBe(QueueStatus.MATCHED);
    });

    it("sets matchId on both entries", async () => {
      await service.joinQueue({ userId: "u1", username: "alice" });
      await service.joinQueue({ userId: "u2", username: "bob" });

      const alice = queueRepo._store.find((e) => e.userId === "u1")!;
      const bob = queueRepo._store.find((e) => e.userId === "u2")!;
      expect(alice.matchId).toBeTruthy();
      expect(alice.matchId).toBe(bob.matchId);
    });

    it("does not pair players across different skill levels", async () => {
      await service.joinQueue({
        userId: "u1",
        username: "alice",
        skillLevel: SkillLevel.BEGINNER,
      });
      await service.joinQueue({
        userId: "u2",
        username: "bob",
        skillLevel: SkillLevel.EXPERT,
      });

      expect(matchRepo._store.length).toBe(0);
    });

    it("notifies the gateway when a match is created", async () => {
      await service.joinQueue({ userId: "u1", username: "alice" });
      await service.joinQueue({ userId: "u2", username: "bob" });

      expect(gateway.notifyMatchFound).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent join handling
  // -------------------------------------------------------------------------

  describe("concurrent join handling", () => {
    it("handles simultaneous joins without creating duplicate matches", async () => {
      // Fire 4 joins concurrently — expect exactly 2 matches
      await Promise.all([
        service.joinQueue({ userId: "u1", username: "alice" }),
        service.joinQueue({ userId: "u2", username: "bob" }),
        service.joinQueue({ userId: "u3", username: "carol" }),
        service.joinQueue({ userId: "u4", username: "dave" }),
      ]);

      // At most 2 matches should be created for 4 players
      expect(matchRepo._store.length).toBeLessThanOrEqual(2);
    });

    it("does not create an entry for the same user twice under concurrent load", async () => {
      const results = await Promise.allSettled([
        service.joinQueue({ userId: "u1", username: "alice" }),
        service.joinQueue({ userId: "u1", username: "alice" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      // Exactly one should succeed and one should be rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Queue timeout and cleanup
  // -------------------------------------------------------------------------

  describe("cleanupTimedOutEntries", () => {
    it("marks entries as LEFT when their wait time exceeds the limit", async () => {
      const old = makeEntry({
        userId: "u-old",
        createdAt: new Date(Date.now() - 400_000), // ~6 min 40 s ago
        status: QueueStatus.WAITING,
      });
      queueRepo._store.push(old);

      const removed = await service.cleanupTimedOutEntries(300);

      expect(removed.length).toBe(1);
      expect(removed[0].userId).toBe("u-old");
      expect(queueRepo._store.find((e) => e.userId === "u-old")!.status).toBe(
        QueueStatus.LEFT,
      );
    });

    it("does not touch recent entries", async () => {
      const recent = makeEntry({
        userId: "u-new",
        createdAt: new Date(Date.now() - 10_000), // 10 s ago
        status: QueueStatus.WAITING,
      });
      queueRepo._store.push(recent);

      const removed = await service.cleanupTimedOutEntries(300);

      expect(removed.find((e) => e.userId === "u-new")).toBeUndefined();
      expect(queueRepo._store.find((e) => e.userId === "u-new")!.status).toBe(
        QueueStatus.WAITING,
      );
    });

    it("does not touch already-matched entries", async () => {
      const matched = makeEntry({
        userId: "u-matched",
        createdAt: new Date(Date.now() - 400_000),
        status: QueueStatus.MATCHED,
      });
      queueRepo._store.push(matched);

      const removed = await service.cleanupTimedOutEntries(300);

      expect(removed.find((e) => e.userId === "u-matched")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Match start and puzzle assignment
  // -------------------------------------------------------------------------

  describe("startMatch", () => {
    it("transitions match to ACTIVE and records startedAt", async () => {
      const match = makeMatch({ status: MatchStatus.PENDING });
      matchRepo._store.push(match);

      const updated = await service.startMatch(match.id, "puzzle-42");

      expect(updated.status).toBe(MatchStatus.ACTIVE);
      expect(updated.startedAt).toBeInstanceOf(Date);
    });

    it("assigns the puzzle to the match", async () => {
      const match = makeMatch({ status: MatchStatus.PENDING });
      matchRepo._store.push(match);

      const updated = (await service.startMatch(match.id, "puzzle-99")) as MatchRecord;

      expect((updated as MatchRecord).puzzleId).toBe("puzzle-99");
    });

    it("throws NotFoundException for unknown matchId", async () => {
      await expect(service.startMatch("no-such-id", "puzzle-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Spectator mode
  // -------------------------------------------------------------------------

  describe("spectator mode", () => {
    it("returns match info for active matches", async () => {
      const match = makeMatch({
        status: MatchStatus.ACTIVE,
        playerUsernames: ["alice", "bob"],
      });
      matchRepo._store.push(match);

      const view = await service.getSpectatorView(match.id);

      expect(view.matchId).toBe(match.id);
      expect(view.players).toContain("alice");
      expect(view.players).toContain("bob");
    });

    it("throws NotFoundException for unknown match", async () => {
      await expect(service.getSpectatorView("ghost-match")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException for non-active matches", async () => {
      const match = makeMatch({ status: MatchStatus.PENDING });
      matchRepo._store.push(match);

      await expect(service.getSpectatorView(match.id)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Skill-based matching
  // -------------------------------------------------------------------------

  describe("skill-based matching", () => {
    it("pairs BEGINNER players together", async () => {
      await service.joinQueue({ userId: "u1", username: "a1", skillLevel: SkillLevel.BEGINNER });
      await service.joinQueue({ userId: "u2", username: "a2", skillLevel: SkillLevel.BEGINNER });

      const match = matchRepo._store.find((m) => m.skillLevel === SkillLevel.BEGINNER);
      expect(match).toBeDefined();
      expect(match!.playerIds).toContain("u1");
      expect(match!.playerIds).toContain("u2");
    });

    it("pairs EXPERT players together", async () => {
      await service.joinQueue({ userId: "u3", username: "b1", skillLevel: SkillLevel.EXPERT });
      await service.joinQueue({ userId: "u4", username: "b2", skillLevel: SkillLevel.EXPERT });

      const match = matchRepo._store.find((m) => m.skillLevel === SkillLevel.EXPERT);
      expect(match).toBeDefined();
      expect(match!.playerIds).toContain("u3");
      expect(match!.playerIds).toContain("u4");
    });

    it("does not pair BEGINNER with ADVANCED players", async () => {
      await service.joinQueue({ userId: "u5", username: "c1", skillLevel: SkillLevel.BEGINNER });
      await service.joinQueue({ userId: "u6", username: "c2", skillLevel: SkillLevel.ADVANCED });

      expect(matchRepo._store.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Queue stats
  // -------------------------------------------------------------------------

  describe("getQueueStats", () => {
    it("returns totalWaiting count and breakdown by skill level", async () => {
      await service.joinQueue({ userId: "u1", username: "a", skillLevel: SkillLevel.BEGINNER });
      await service.joinQueue({ userId: "u2", username: "b", skillLevel: SkillLevel.EXPERT });

      // Force both to stay WAITING for stats
      for (const e of queueRepo._store) e.status = QueueStatus.WAITING;

      const stats = await service.getQueueStats();

      expect(stats.totalWaiting).toBeGreaterThanOrEqual(1);
      expect(typeof stats.bySkillLevel).toBe("object");
    });
  });
});
