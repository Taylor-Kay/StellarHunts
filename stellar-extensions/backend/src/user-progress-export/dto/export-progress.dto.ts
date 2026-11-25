import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsArray,
  IsString,
  IsBoolean,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  IsDateString,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ConflictResolutionStrategy {
  MERGE = 'merge',
  OVERWRITE = 'overwrite',
}

export class AchievementExportDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() earnedAt: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() badgeImageUrl?: string;
}

export class NftExportDto {
  @ApiProperty() tokenId: string;
  @ApiProperty() contractAddress: string;
  @ApiProperty() name: string;
  @ApiProperty() claimedAt: string;
  @ApiPropertyOptional() onChainTxHash?: string;
  @ApiPropertyOptional() onChainVerified?: boolean;
  @ApiPropertyOptional() metadata?: Record<string, unknown>;
}

export class PuzzleSolvedExportDto {
  @ApiProperty() puzzleId: string;
  @ApiProperty() title: string;
  @ApiProperty() solvedAt: string;
  @ApiProperty() attemptCount: number;
  @ApiPropertyOptional() score?: number;
  @ApiPropertyOptional() category?: string;
  @ApiPropertyOptional() difficulty?: string;
  @ApiPropertyOptional() onChainTxHash?: string;
}

export class StreakExportDto {
  @ApiProperty() currentStreak: number;
  @ApiProperty() longestStreak: number;
  @ApiPropertyOptional() lastActivityDate?: string;
}

export class OnChainVerificationDto {
  @ApiProperty() walletAddress: string;
  @ApiProperty() verifiedAt: string;
  @ApiPropertyOptional() network?: string;
  @ApiPropertyOptional() verificationTxHash?: string;
}

export class UserProgressExportDto {
  @ApiProperty() schemaVersion: string;
  @ApiProperty() exportedAt: string;
  @ApiProperty() userId: string;
  @ApiProperty() username: string;
  @ApiProperty({ type: [PuzzleSolvedExportDto] }) puzzlesSolved: PuzzleSolvedExportDto[];
  @ApiProperty({ type: [AchievementExportDto] }) achievements: AchievementExportDto[];
  @ApiProperty({ type: [NftExportDto] }) nfts: NftExportDto[];
  @ApiProperty({ type: StreakExportDto }) streaks: StreakExportDto;
  @ApiPropertyOptional({ type: OnChainVerificationDto }) onChainVerification?: OnChainVerificationDto;
  @ApiPropertyOptional() totalPoints?: number;
  @ApiPropertyOptional() rank?: number;
}

export class ImportProgressDto {
  @ApiProperty({
    description: 'Full progress export JSON object',
    type: 'object',
  })
  @IsObject()
  data: UserProgressExportDto;

  @ApiPropertyOptional({
    enum: ConflictResolutionStrategy,
    description: 'How to handle conflicts: merge (default) or overwrite',
  })
  @IsOptional()
  @IsEnum(ConflictResolutionStrategy)
  conflictResolution?: ConflictResolutionStrategy;
}

export class ImportProgressResultDto {
  @ApiProperty() success: boolean;
  @ApiProperty() puzzlesImported: number;
  @ApiProperty() achievementsImported: number;
  @ApiProperty() nftsImported: number;
  @ApiProperty() conflictsResolved: number;
  @ApiPropertyOptional({ type: [String] }) warnings?: string[];
  @ApiPropertyOptional() message?: string;
}
