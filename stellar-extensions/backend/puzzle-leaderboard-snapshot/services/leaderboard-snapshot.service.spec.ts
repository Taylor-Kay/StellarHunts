/**
 * Issue #934 – Unit tests for LeaderboardSnapshotService
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { LeaderboardSnapshotService } from './leaderboard-snapshot.service';
import {
  LeaderboardSnapshot,
  RankEntry,
  RankTrend,
} from '../entities/leaderboard-snapshot.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(userId: string, rank: number, score: number): RankEntry {
  return { userId, displayName: `User ${userId}`, rank, score, achievements: 0, activityPoints: 0 };
}

function makeSnapshot(
  id: string,
  rankings: RankEntry[],
  takenAt: Date = new Date(),
  puzzleId: string | null = null,
): LeaderboardSnapshot {
  const s = new LeaderboardSnapshot();
  s.id = id;
  s.rankings = rankings;
  s.takenAt = takenAt;
  s.puzzleId = puzzleId;
  s.totalPlayers = rankings.length;
  return s;
}

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------

const mockSnapshotRepo = {
  create: jest.fn((data) => ({ ...data })),
  save: jest.fn(async (entity) => ({ id: 'snap-uuid', takenAt: new Date(), ...entity })),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  delete: jest.fn().mockResolvedValue({ affected: 3 }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LeaderboardSnapshotService', () => {
  let service: LeaderboardSnapshotService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardSnapshotService,
        {
          provide: getRepositoryToken(LeaderboardSnapshot),
          useValue: mockSnapshotRepo,
        },
      ],
    }).compile();

    service = module.get<LeaderboardSnapshotService>(LeaderboardSnapshotService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // takeSnapshot
  // -------------------------------------------------------------------------

  describe('takeSnapshot', () => {
    it('creates and persists a global snapshot', async () => {
      const result = await service.takeSnapshot(null);
      expect(mockSnapshotRepo.create).toHaveBeenCalled();
      expect(mockSnapshotRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });

    it('creates and persists a puzzle-scoped snapshot', async () => {
      const puzzleId = 'puzzle-abc';
      await service.takeSnapshot(puzzleId);
      const createArg = mockSnapshotRepo.create.mock.calls[0][0];
      expect(createArg.puzzleId).toBe(puzzleId);
    });
  });

  // -------------------------------------------------------------------------
  // getSnapshotHistory
  // -------------------------------------------------------------------------

  describe('getSnapshotHistory', () => {
    it('returns empty list when no snapshots exist', async () => {
      mockSnapshotRepo.find.mockResolvedValueOnce([]);
      const result = await service.getSnapshotHistory({ limit: 10 });
      expect(result.snapshots).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('passes date range filters to the repository', async () => {
      const snap = makeSnapshot('s1', [makeEntry('u1', 1, 100)]);
      mockSnapshotRepo.find.mockResolvedValueOnce([snap]);

      const result = await service.getSnapshotHistory({
        from: '2024-01-01T00:00:00Z',
        to: '2024-12-31T23:59:59Z',
        limit: 5,
      });

      expect(result.total).toBe(1);
      expect(mockSnapshotRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getSnapshot
  // -------------------------------------------------------------------------

  describe('getSnapshot', () => {
    it('returns the snapshot when found', async () => {
      const snap = makeSnapshot('s1', [makeEntry('u1', 1, 200)]);
      mockSnapshotRepo.findOne.mockResolvedValueOnce(snap);

      const result = await service.getSnapshot('s1');
      expect(result.id).toBe('s1');
      expect(result.totalPlayers).toBe(1);
    });

    it('throws NotFoundException when snapshot does not exist', async () => {
      mockSnapshotRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.getSnapshot('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // getRankChanges
  // -------------------------------------------------------------------------

  describe('getRankChanges', () => {
    it('computes RISING trend for a player who moved up', async () => {
      const from = makeSnapshot('from', [
        makeEntry('u1', 2, 100),
        makeEntry('u2', 1, 200),
      ]);
      const to = makeSnapshot('to', [
        makeEntry('u1', 1, 300),
        makeEntry('u2', 2, 200),
      ]);

      mockSnapshotRepo.findOne
        .mockResolvedValueOnce(from)
        .mockResolvedValueOnce(to);

      const result = await service.getRankChanges('from', 'to');
      const u1Change = result.changes.find((c) => c.userId === 'u1');
      expect(u1Change?.trend).toBe(RankTrend.RISING);
      expect(u1Change?.rankDelta).toBe(1);
    });

    it('computes FALLING trend for a player who dropped', async () => {
      const from = makeSnapshot('from', [makeEntry('u1', 1, 300)]);
      const to = makeSnapshot('to', [makeEntry('u1', 3, 300)]);

      mockSnapshotRepo.findOne
        .mockResolvedValueOnce(from)
        .mockResolvedValueOnce(to);

      const result = await service.getRankChanges('from', 'to');
      expect(result.changes[0].trend).toBe(RankTrend.FALLING);
    });

    it('marks a NEW_ENTRY for a player not present in the earlier snapshot', async () => {
      const from = makeSnapshot('from', [makeEntry('u1', 1, 100)]);
      const to = makeSnapshot('to', [makeEntry('u1', 1, 100), makeEntry('u2', 2, 50)]);

      mockSnapshotRepo.findOne
        .mockResolvedValueOnce(from)
        .mockResolvedValueOnce(to);

      const result = await service.getRankChanges('from', 'to');
      const newPlayer = result.changes.find((c) => c.userId === 'u2');
      expect(newPlayer?.trend).toBe(RankTrend.NEW_ENTRY);
    });

    it('throws NotFoundException when a snapshot is missing', async () => {
      mockSnapshotRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.getRankChanges('missing', 'to'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // cleanupOldSnapshots
  // -------------------------------------------------------------------------

  describe('cleanupOldSnapshots', () => {
    it('returns the number of deleted snapshots', async () => {
      const deleted = await service.cleanupOldSnapshots();
      expect(deleted).toBe(3);
      expect(mockSnapshotRepo.delete).toHaveBeenCalled();
    });
  });
});
