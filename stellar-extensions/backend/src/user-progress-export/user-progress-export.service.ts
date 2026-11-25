import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  UserProgressExportDto,
  PuzzleSolvedExportDto,
  AchievementExportDto,
  NftExportDto,
  StreakExportDto,
  OnChainVerificationDto,
  ConflictResolutionStrategy,
  ImportProgressResultDto,
} from './dto/export-progress.dto';

export const PROGRESS_EXPORT_SCHEMA_VERSION = '1.0';

/**
 * Service responsible for exporting and importing user game progress data,
 * including puzzles solved, achievements, NFTs, streaks, and on-chain verification.
 *
 * Follows the same pattern as DataExportService in backend/src/data-export/,
 * using TypeORM DataSource for entity queries.
 */
@Injectable()
export class UserProgressExportService {
  private readonly logger = new Logger(UserProgressExportService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Export all user progress data as a structured JSON object.
   * Covers: puzzles solved, achievements, NFTs, streaks, on-chain verification.
   */
  async exportProgress(userId: string): Promise<UserProgressExportDto> {
    this.logger.log(`Exporting progress for user=${userId}`);

    // Load user basic info from raw query to remain decoupled from specific entity imports
    const userRows: Array<{
      id: string;
      username: string;
      wallet_address: string | null;
    }> = await this.dataSource.query(
      `SELECT id, username, wallet_address FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );

    if (!userRows.length) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const user = userRows[0];
    const walletAddress = user.wallet_address;

    const [puzzlesSolved, achievements, nfts, streaks, onChainVerification] =
      await Promise.all([
        this.loadPuzzlesSolved(userId),
        this.loadAchievements(userId),
        this.loadNfts(userId, walletAddress),
        this.loadStreaks(userId),
        walletAddress ? this.loadOnChainVerification(walletAddress) : Promise.resolve(undefined),
      ]);

    const totalPointsRows: Array<{ total: string }> = await this.dataSource
      .query(
        `SELECT COALESCE(SUM(score), 0) AS total FROM puzzle_submissions WHERE user_id = $1 AND is_correct = true`,
        [userId],
      )
      .catch(() => [{ total: '0' }]);

    return {
      schemaVersion: PROGRESS_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      userId,
      username: user.username,
      puzzlesSolved,
      achievements,
      nfts,
      streaks,
      onChainVerification,
      totalPoints: parseInt(totalPointsRows[0]?.total ?? '0', 10),
    };
  }

  /**
   * Import progress data for the authenticated user.
   * Validates the JSON schema, then applies with the specified conflict resolution.
   */
  async importProgress(
    userId: string,
    data: UserProgressExportDto,
    conflictResolution: ConflictResolutionStrategy = ConflictResolutionStrategy.MERGE,
  ): Promise<ImportProgressResultDto> {
    this.logger.log(
      `Importing progress for user=${userId} strategy=${conflictResolution}`,
    );

    this.validateImportPayload(data);

    const warnings: string[] = [];
    let puzzlesImported = 0;
    let achievementsImported = 0;
    let nftsImported = 0;
    let conflictsResolved = 0;

    // We run inside a single transaction for atomicity
    await this.dataSource.transaction(async (manager) => {
      // ── Puzzles ──────────────────────────────────────────────────────────
      for (const puzzle of data.puzzlesSolved ?? []) {
        const existing: Array<{ id: string }> = await manager.query(
          `SELECT id FROM puzzle_submissions
           WHERE user_id = $1 AND puzzle_id = $2 AND is_correct = true
           LIMIT 1`,
          [userId, puzzle.puzzleId],
        ).catch(() => []);

        if (existing.length > 0) {
          if (conflictResolution === ConflictResolutionStrategy.OVERWRITE) {
            await manager
              .query(
                `UPDATE puzzle_submissions
                 SET score = $1, attempt_count = $2, updated_at = NOW()
                 WHERE user_id = $3 AND puzzle_id = $4 AND is_correct = true`,
                [puzzle.score ?? 0, puzzle.attemptCount, userId, puzzle.puzzleId],
              )
              .catch((err) => {
                warnings.push(`Could not overwrite puzzle ${puzzle.puzzleId}: ${err.message}`);
              });
            conflictsResolved++;
          } else {
            // merge: skip existing
            warnings.push(`Puzzle ${puzzle.puzzleId} already solved – skipped`);
          }
        } else {
          await manager
            .query(
              `INSERT INTO puzzle_submissions
               (user_id, puzzle_id, is_correct, attempt_count, score, created_at)
               VALUES ($1, $2, true, $3, $4, $5)
               ON CONFLICT DO NOTHING`,
              [
                userId,
                puzzle.puzzleId,
                puzzle.attemptCount,
                puzzle.score ?? 0,
                puzzle.solvedAt ?? new Date().toISOString(),
              ],
            )
            .catch((err) => {
              warnings.push(`Could not import puzzle ${puzzle.puzzleId}: ${err.message}`);
            });
          puzzlesImported++;
        }
      }

      // ── Achievements ──────────────────────────────────────────────────────
      for (const ach of data.achievements ?? []) {
        const existing: Array<{ id: string }> = await manager
          .query(
            `SELECT id FROM user_achievements WHERE user_id = $1 AND achievement_id = $2 LIMIT 1`,
            [userId, ach.id],
          )
          .catch(() => []);

        if (existing.length > 0) {
          conflictsResolved++;
          warnings.push(`Achievement ${ach.id} already exists – skipped`);
        } else {
          await manager
            .query(
              `INSERT INTO user_achievements (user_id, achievement_id, earned_at)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [userId, ach.id, ach.earnedAt ?? new Date().toISOString()],
            )
            .catch((err) => {
              warnings.push(`Could not import achievement ${ach.id}: ${err.message}`);
            });
          achievementsImported++;
        }
      }

      // ── NFTs ───────────────────────────────────────────────────────────────
      for (const nft of data.nfts ?? []) {
        const existing: Array<{ id: string }> = await manager
          .query(
            `SELECT id FROM nft_claims WHERE user_id = $1 AND token_id = $2 LIMIT 1`,
            [userId, nft.tokenId],
          )
          .catch(() => []);

        if (existing.length > 0) {
          conflictsResolved++;
          warnings.push(`NFT ${nft.tokenId} already claimed – skipped`);
        } else {
          await manager
            .query(
              `INSERT INTO nft_claims (user_id, token_id, contract_address, name, claimed_at, on_chain_tx_hash)
               VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
              [
                userId,
                nft.tokenId,
                nft.contractAddress,
                nft.name,
                nft.claimedAt ?? new Date().toISOString(),
                nft.onChainTxHash ?? null,
              ],
            )
            .catch((err) => {
              warnings.push(`Could not import NFT ${nft.tokenId}: ${err.message}`);
            });
          nftsImported++;
        }
      }

      // ── Streaks ────────────────────────────────────────────────────────────
      if (data.streaks) {
        const existing: Array<{ id: string }> = await manager
          .query(`SELECT id FROM streaks WHERE user_id = $1 LIMIT 1`, [userId])
          .catch(() => []);

        if (existing.length > 0 && conflictResolution === ConflictResolutionStrategy.OVERWRITE) {
          await manager
            .query(
              `UPDATE streaks
               SET current_streak = GREATEST(current_streak, $1),
                   longest_streak = GREATEST(longest_streak, $2),
                   updated_at = NOW()
               WHERE user_id = $3`,
              [data.streaks.currentStreak, data.streaks.longestStreak, userId],
            )
            .catch((err) => {
              warnings.push(`Could not update streaks: ${err.message}`);
            });
          conflictsResolved++;
        } else if (existing.length === 0) {
          await manager
            .query(
              `INSERT INTO streaks (user_id, current_streak, longest_streak)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [userId, data.streaks.currentStreak, data.streaks.longestStreak],
            )
            .catch((err) => {
              warnings.push(`Could not import streaks: ${err.message}`);
            });
        }
      }
    });

    return {
      success: true,
      puzzlesImported,
      achievementsImported,
      nftsImported,
      conflictsResolved,
      warnings,
      message: `Import complete. Puzzles: ${puzzlesImported}, Achievements: ${achievementsImported}, NFTs: ${nftsImported}`,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async loadPuzzlesSolved(userId: string): Promise<PuzzleSolvedExportDto[]> {
    const rows = await this.dataSource
      .query(
        `SELECT
           ps.puzzle_id    AS "puzzleId",
           p.title         AS "title",
           ps.created_at   AS "solvedAt",
           ps.attempt_count AS "attemptCount",
           ps.score        AS "score",
           p.category      AS "category",
           p.difficulty    AS "difficulty",
           ps.on_chain_tx_hash AS "onChainTxHash"
         FROM puzzle_submissions ps
         LEFT JOIN puzzles p ON p.id = ps.puzzle_id
         WHERE ps.user_id = $1 AND ps.is_correct = true
         ORDER BY ps.created_at DESC`,
        [userId],
      )
      .catch(() => []);
    return rows as PuzzleSolvedExportDto[];
  }

  private async loadAchievements(userId: string): Promise<AchievementExportDto[]> {
    const rows = await this.dataSource
      .query(
        `SELECT
           ua.achievement_id AS "id",
           a.name            AS "name",
           a.description     AS "description",
           ua.earned_at      AS "earnedAt",
           a.badge_image_url AS "badgeImageUrl"
         FROM user_achievements ua
         LEFT JOIN achievements a ON a.id = ua.achievement_id
         WHERE ua.user_id = $1
         ORDER BY ua.earned_at DESC`,
        [userId],
      )
      .catch(() => []);
    return rows as AchievementExportDto[];
  }

  private async loadNfts(
    userId: string,
    walletAddress: string | null,
  ): Promise<NftExportDto[]> {
    const rows = await this.dataSource
      .query(
        `SELECT
           nc.token_id           AS "tokenId",
           nc.contract_address   AS "contractAddress",
           nc.name               AS "name",
           nc.claimed_at         AS "claimedAt",
           nc.on_chain_tx_hash   AS "onChainTxHash",
           nc.on_chain_verified  AS "onChainVerified",
           nc.metadata           AS "metadata"
         FROM nft_claims nc
         WHERE nc.user_id = $1
         ORDER BY nc.claimed_at DESC`,
        [userId],
      )
      .catch(() => []);
    return rows as NftExportDto[];
  }

  private async loadStreaks(userId: string): Promise<StreakExportDto> {
    const rows: Array<{
      currentStreak: number;
      longestStreak: number;
      lastActivityDate?: string;
    }> = await this.dataSource
      .query(
        `SELECT current_streak AS "currentStreak",
                longest_streak AS "longestStreak",
                last_activity_date AS "lastActivityDate"
         FROM streaks WHERE user_id = $1 LIMIT 1`,
        [userId],
      )
      .catch(() => []);

    return rows[0] ?? { currentStreak: 0, longestStreak: 0 };
  }

  private async loadOnChainVerification(
    walletAddress: string,
  ): Promise<OnChainVerificationDto | undefined> {
    const rows: Array<{
      walletAddress: string;
      verifiedAt: string;
      network?: string;
      verificationTxHash?: string;
    }> = await this.dataSource
      .query(
        `SELECT
           wallet_address       AS "walletAddress",
           verified_at          AS "verifiedAt",
           network              AS "network",
           verification_tx_hash AS "verificationTxHash"
         FROM wallet_verifications WHERE wallet_address = $1 LIMIT 1`,
        [walletAddress],
      )
      .catch(() => []);

    return rows[0];
  }

  /**
   * Validate the shape of the imported payload.
   * Throws BadRequestException if required fields are missing.
   */
  private validateImportPayload(data: UserProgressExportDto): void {
    if (!data || typeof data !== 'object') {
      throw new BadRequestException('Import payload must be a JSON object');
    }
    if (!data.schemaVersion) {
      throw new BadRequestException('Missing schemaVersion in import payload');
    }
    if (!data.userId) {
      throw new BadRequestException('Missing userId in import payload');
    }
    if (!Array.isArray(data.puzzlesSolved)) {
      throw new BadRequestException('puzzlesSolved must be an array');
    }
    if (!Array.isArray(data.achievements)) {
      throw new BadRequestException('achievements must be an array');
    }
    if (!Array.isArray(data.nfts)) {
      throw new BadRequestException('nfts must be an array');
    }
    if (!data.streaks || typeof data.streaks !== 'object') {
      throw new BadRequestException('streaks must be an object');
    }
    if (data.schemaVersion !== PROGRESS_EXPORT_SCHEMA_VERSION) {
      throw new BadRequestException(
        `Unsupported schema version: ${data.schemaVersion}. Expected: ${PROGRESS_EXPORT_SCHEMA_VERSION}`,
      );
    }

    for (const puzzle of data.puzzlesSolved) {
      if (!puzzle.puzzleId || typeof puzzle.puzzleId !== 'string') {
        throw new BadRequestException('Each puzzleSolved entry must have a puzzleId string');
      }
    }
  }
}
