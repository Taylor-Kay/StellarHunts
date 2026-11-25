/**
 * Issue #934 – Puzzle Leaderboard Snapshot Module – DTOs
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { RankEntry, RankTrend } from '../entities/leaderboard-snapshot.entity';

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class RankChangeDto {
  @ApiProperty() userId: string;
  @ApiProperty() displayName: string;
  @ApiProperty() currentRank: number;
  @ApiProperty() previousRank: number;
  @ApiProperty() rankDelta: number;
  @ApiProperty() currentScore: number;
  @ApiProperty() previousScore: number;
  @ApiProperty() scoreDelta: number;
  @ApiProperty({ enum: RankTrend }) trend: RankTrend;
}

export class SnapshotResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) puzzleId: string | null;
  @ApiProperty() takenAt: Date;
  @ApiProperty({ type: [RankEntry] }) rankings: RankEntry[];
  @ApiProperty() totalPlayers: number;
}

export class SnapshotHistoryResponseDto {
  @ApiProperty({ type: [SnapshotResponseDto] }) snapshots: SnapshotResponseDto[];
  @ApiProperty() total: number;
}

export class RankChangesResponseDto {
  @ApiProperty() fromSnapshotId: string;
  @ApiProperty() toSnapshotId: string;
  @ApiProperty() fromTakenAt: Date;
  @ApiProperty() toTakenAt: Date;
  @ApiProperty({ type: [RankChangeDto] }) changes: RankChangeDto[];
}

// ---------------------------------------------------------------------------
// Query / command DTOs
// ---------------------------------------------------------------------------

export class GetSnapshotHistoryDto {
  @ApiProperty({
    required: false,
    description: 'Filter by puzzle ID (omit for global leaderboard)',
  })
  @IsOptional()
  @IsUUID()
  puzzleId?: string;

  @ApiProperty({ required: false, description: 'Start of date range (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ required: false, description: 'End of date range (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ required: false, description: 'Max snapshots to return', default: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class TakeSnapshotDto {
  @ApiProperty({
    required: false,
    description: 'Puzzle ID to snapshot. Omit for global leaderboard.',
  })
  @IsOptional()
  @IsUUID()
  puzzleId?: string;
}
