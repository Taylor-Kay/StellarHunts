/**
 * Issue #948 – Puzzle Solution Validator Module – DTOs
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
} from 'class-validator';
import { SolutionFormat, ValidatorStatus } from '../entities/puzzle-solution-validator.entity';

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export class ValidateSolutionDto {
  @ApiProperty({
    description: 'Puzzle ID to validate against',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  puzzleId: string;

  @ApiProperty({
    description: 'Format of the submitted solution',
    enum: SolutionFormat,
    default: SolutionFormat.TEXT,
  })
  @IsEnum(SolutionFormat)
  solutionFormat: SolutionFormat;

  @ApiProperty({
    description:
      'Submitted solution payload. Shape depends on solutionFormat: ' +
      '{ answer: string } for TEXT, { code: string, language: string } for CODE, ' +
      '{ selectedOption: string } for MULTIPLE_CHOICE.',
    example: { answer: 'Proof of Work' },
  })
  @IsObject()
  submittedSolution: Record<string, any>;

  @ApiProperty({
    description: 'Optional list of specific test-case IDs to run',
    required: false,
    example: ['test-id-1', 'test-id-2'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  testCaseIds?: string[];

  @ApiProperty({
    description: 'Optional user ID for history tracking',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class TestCaseResultDto {
  @ApiProperty() testCaseId: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ValidatorStatus }) status: ValidatorStatus;
  @ApiProperty({ description: 'Normalised score 0–1' }) score: number;
  @ApiProperty() feedback: string;
  @ApiProperty() executionTimeMs: number;
}

export class ValidationResponseDto {
  @ApiProperty({ description: 'True if all test cases passed' }) success: boolean;
  @ApiProperty({ enum: ValidatorStatus }) status: ValidatorStatus;
  @ApiProperty({ description: 'Normalised overall score (0–1)' }) overallScore: number;
  @ApiProperty() totalTestCases: number;
  @ApiProperty() passedTestCases: number;
  @ApiProperty() failedTestCases: number;
  @ApiProperty() isPartialCredit: boolean;
  @ApiProperty({ type: [TestCaseResultDto] }) testCaseResults: TestCaseResultDto[];
  @ApiProperty() feedbackMessage: string;
  @ApiProperty() executionTimeMs: number;
  @ApiProperty({ description: 'ID of the persisted validation record' }) validationId: string;
}

export class ValidationHistorySummaryDto {
  @ApiProperty() totalAttempts: number;
  @ApiProperty() bestScore: number;
  @ApiProperty() averageScore: number;
  @ApiProperty({ required: false }) lastAttempt?: Date;
}

export class ValidationHistoryDto {
  @ApiProperty({ type: [Object] }) records: any[];
  @ApiProperty() summary: ValidationHistorySummaryDto;
}

// ---------------------------------------------------------------------------
// Query DTOs
// ---------------------------------------------------------------------------

export class GetValidationHistoryDto {
  @ApiProperty({ required: false, description: 'Filter by user ID' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ required: false, description: 'Filter by puzzle ID' })
  @IsOptional()
  @IsUUID()
  puzzleId?: string;

  @ApiProperty({ required: false, description: 'Max records to return', default: 50 })
  @IsOptional()
  limit?: number;
}
