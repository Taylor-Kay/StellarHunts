import { UserProgressExportService, PROGRESS_EXPORT_SCHEMA_VERSION } from './user-progress-export.service';
import { ConflictResolutionStrategy } from './dto/export-progress.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockQuery = jest.fn();

const mockDataSource = {
  query: mockQuery,
  transaction: jest.fn(async (cb: (manager: any) => Promise<void>) => {
    await cb({ query: mockQuery });
  }),
};

describe('UserProgressExportService', () => {
  let service: UserProgressExportService;

  beforeEach(() => {
    mockQuery.mockReset();
    (mockDataSource.transaction as jest.Mock).mockReset().mockImplementation(
      async (cb: (manager: any) => Promise<void>) => {
        await cb({ query: mockQuery });
      },
    );
    service = new UserProgressExportService(mockDataSource as any);
  });

  describe('exportProgress', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockQuery.mockResolvedValueOnce([]); // user query returns empty
      await expect(service.exportProgress('missing-user')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns a correctly structured export object', async () => {
      const userId = 'user-123';
      // user query
      mockQuery.mockResolvedValueOnce([{ id: userId, username: 'alice', wallet_address: 'GABC' }]);
      // puzzles solved
      mockQuery.mockResolvedValueOnce([
        { puzzleId: 'p1', title: 'Intro', solvedAt: '2024-01-01T00:00:00.000Z', attemptCount: 1, score: 100, category: 'basics', difficulty: 'easy' },
      ]);
      // achievements
      mockQuery.mockResolvedValueOnce([
        { id: 'ach-1', name: 'First Solve', earnedAt: '2024-01-01T00:00:00.000Z' },
      ]);
      // nfts
      mockQuery.mockResolvedValueOnce([
        { tokenId: 'nft-1', contractAddress: '0x123', name: 'Genesis NFT', claimedAt: '2024-01-01T00:00:00.000Z' },
      ]);
      // streaks
      mockQuery.mockResolvedValueOnce([{ currentStreak: 5, longestStreak: 10 }]);
      // on-chain verification
      mockQuery.mockResolvedValueOnce([{ walletAddress: 'GABC', verifiedAt: '2024-01-01T00:00:00.000Z', network: 'testnet' }]);
      // total points
      mockQuery.mockResolvedValueOnce([{ total: '500' }]);

      const result = await service.exportProgress(userId);

      expect(result.schemaVersion).toBe(PROGRESS_EXPORT_SCHEMA_VERSION);
      expect(result.userId).toBe(userId);
      expect(result.username).toBe('alice');
      expect(result.puzzlesSolved).toHaveLength(1);
      expect(result.achievements).toHaveLength(1);
      expect(result.nfts).toHaveLength(1);
      expect(result.streaks.currentStreak).toBe(5);
      expect(result.onChainVerification?.walletAddress).toBe('GABC');
      expect(result.totalPoints).toBe(500);
    });

    it('returns empty arrays when user has no data', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'u1', username: 'bob', wallet_address: null }]);
      mockQuery.mockResolvedValueOnce([]); // puzzles
      mockQuery.mockResolvedValueOnce([]); // achievements
      mockQuery.mockResolvedValueOnce([]); // nfts
      mockQuery.mockResolvedValueOnce([]); // streaks
      mockQuery.mockResolvedValueOnce([{ total: '0' }]); // total points

      const result = await service.exportProgress('u1');
      expect(result.puzzlesSolved).toEqual([]);
      expect(result.achievements).toEqual([]);
      expect(result.nfts).toEqual([]);
      expect(result.streaks).toEqual({ currentStreak: 0, longestStreak: 0 });
      expect(result.totalPoints).toBe(0);
    });
  });

  describe('importProgress (validation)', () => {
    const validPayload = {
      schemaVersion: PROGRESS_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      userId: 'u1',
      username: 'alice',
      puzzlesSolved: [],
      achievements: [],
      nfts: [],
      streaks: { currentStreak: 0, longestStreak: 0 },
    };

    it('throws BadRequestException when schemaVersion is missing', async () => {
      await expect(
        service.importProgress('u1', { ...validPayload, schemaVersion: undefined as any }, ConflictResolutionStrategy.MERGE),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when schemaVersion is wrong', async () => {
      await expect(
        service.importProgress('u1', { ...validPayload, schemaVersion: '99.0' }, ConflictResolutionStrategy.MERGE),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when puzzlesSolved is not an array', async () => {
      await expect(
        service.importProgress('u1', { ...validPayload, puzzlesSolved: null as any }, ConflictResolutionStrategy.MERGE),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when a puzzleSolved entry has no puzzleId', async () => {
      await expect(
        service.importProgress(
          'u1',
          { ...validPayload, puzzlesSolved: [{ puzzleId: '', title: '', solvedAt: '', attemptCount: 1 }] },
          ConflictResolutionStrategy.MERGE,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('imports a valid payload successfully with MERGE', async () => {
      // existing puzzle
      mockQuery.mockResolvedValueOnce([{ id: 'sub-1' }]);
      // new puzzle → no existing
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]); // insert new puzzle
      // achievement → no existing
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]); // insert achievement
      // nft → no existing
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]); // insert nft
      // streaks → existing
      mockQuery.mockResolvedValueOnce([{ id: 's1' }]);

      const result = await service.importProgress(
        'u1',
        {
          ...validPayload,
          puzzlesSolved: [
            { puzzleId: 'p-existing', title: 'Old', solvedAt: '2024-01-01T00:00:00Z', attemptCount: 2 },
            { puzzleId: 'p-new', title: 'New', solvedAt: '2024-01-02T00:00:00Z', attemptCount: 1 },
          ],
          achievements: [{ id: 'ach-new', name: 'First', earnedAt: '2024-01-01T00:00:00Z' }],
          nfts: [{ tokenId: 'nft-new', contractAddress: '0xabc', name: 'NFT', claimedAt: '2024-01-01T00:00:00Z' }],
          streaks: { currentStreak: 10, longestStreak: 20 },
        },
        ConflictResolutionStrategy.MERGE,
      );

      expect(result.success).toBe(true);
      expect(result.puzzlesImported).toBe(1);
      expect(result.achievementsImported).toBe(1);
      expect(result.nftsImported).toBe(1);
    });
  });
});
