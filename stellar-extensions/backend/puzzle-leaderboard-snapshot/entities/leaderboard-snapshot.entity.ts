/**
 * Issue #934 – Puzzle Leaderboard Snapshot Module – Entities
 *
 * Follows patterns in backend/src/user-ranking/entities/user-ranking.entity.ts
 * and backend/src/analytics/entities/analytics.entity.ts.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

// ---------------------------------------------------------------------------
// Rank entry embedded in a snapshot
// ---------------------------------------------------------------------------

export enum RankTrend {
  RISING = 'rising',
  FALLING = 'falling',
  STABLE = 'stable',
  NEW_ENTRY = 'new_entry',
}

export class RankEntry {
  @ApiProperty() rank: number;
  @ApiProperty() userId: string;
  @ApiProperty() displayName: string;
  @ApiProperty() score: number;
  @ApiProperty() achievements: number;
  @ApiProperty() activityPoints: number;
}

// ---------------------------------------------------------------------------
// LeaderboardSnapshot
// ---------------------------------------------------------------------------

@Entity('leaderboard_snapshots')
@Index(['takenAt'])
@Index(['puzzleId', 'takenAt'])
export class LeaderboardSnapshot {
  @ApiProperty({ description: 'Unique identifier' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description:
      'Optional puzzle ID. NULL = global leaderboard snapshot; ' +
      'set = per-puzzle leaderboard.',
  })
  @Column({ type: 'uuid', nullable: true })
  puzzleId: string | null;

  @ApiProperty({ description: 'Timestamp when this snapshot was taken' })
  @CreateDateColumn()
  takenAt: Date;

  @ApiProperty({ description: 'Ordered rank entries at snapshot time' })
  @Column({ type: 'json' })
  rankings: RankEntry[];

  @ApiProperty({ description: 'Total number of players in this snapshot' })
  @Column({ type: 'int', default: 0 })
  totalPlayers: number;
}
