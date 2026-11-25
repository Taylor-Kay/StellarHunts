/**
 * Issue #948 – Puzzle Solution Validator Module
 *
 * Stores the outcome of each validation attempt.
 * Follows the pattern of puzzle-test-case/entities/validation-result.entity.ts.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum SolutionFormat {
  TEXT = 'text',
  CODE = 'code',
  MULTIPLE_CHOICE = 'multiple_choice',
}

export enum ValidatorStatus {
  PASSED = 'passed',
  FAILED = 'failed',
  PARTIAL = 'partial',
  ERROR = 'error',
  TIMEOUT = 'timeout',
}

@Entity('puzzle_solution_validations')
@Index(['puzzleId', 'userId'])
@Index(['puzzleId', 'status'])
@Index(['createdAt'])
export class PuzzleSolutionValidation {
  @ApiProperty({ description: 'Unique identifier' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'ID of the puzzle being solved' })
  @Column({ type: 'uuid' })
  puzzleId: string;

  @ApiProperty({ description: 'ID of the submitting user (optional)' })
  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @ApiProperty({ description: 'Format of the submitted solution' })
  @Column({ type: 'enum', enum: SolutionFormat, default: SolutionFormat.TEXT })
  solutionFormat: SolutionFormat;

  @ApiProperty({ description: 'Raw submitted solution payload' })
  @Column({ type: 'json' })
  submittedSolution: Record<string, any>;

  @ApiProperty({ description: 'Overall validation status' })
  @Column({ type: 'enum', enum: ValidatorStatus, default: ValidatorStatus.FAILED })
  status: ValidatorStatus;

  @ApiProperty({ description: 'Normalised score 0–1 (1 = fully correct)' })
  @Column({ type: 'float', default: 0 })
  score: number;

  @ApiProperty({ description: 'Per-test-case result breakdown' })
  @Column({ type: 'json', nullable: true })
  testCaseResults: Array<{
    testCaseId: string;
    title: string;
    status: ValidatorStatus;
    score: number;
    feedback: string;
    executionTimeMs: number;
  }>;

  @ApiProperty({ description: 'Human-readable feedback message' })
  @Column({ type: 'text', nullable: true })
  feedbackMessage: string;

  @ApiProperty({ description: 'Total execution time in milliseconds' })
  @Column({ type: 'int', default: 0 })
  executionTimeMs: number;

  @ApiProperty({ description: 'Whether this was a partial-credit result' })
  @Column({ default: false })
  isPartialCredit: boolean;

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn()
  updatedAt: Date;
}
