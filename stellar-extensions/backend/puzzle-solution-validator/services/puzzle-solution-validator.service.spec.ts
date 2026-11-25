/**
 * Issue #948 – Unit tests for PuzzleSolutionValidatorService
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { PuzzleSolutionValidatorService } from './puzzle-solution-validator.service';
import {
  PuzzleSolutionValidation,
  SolutionFormat,
  ValidatorStatus,
} from '../entities/puzzle-solution-validator.entity';

const mockRepo = {
  create: jest.fn((data) => ({ id: 'validation-uuid', ...data })),
  save: jest.fn(async (entity) => entity),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
};

describe('PuzzleSolutionValidatorService', () => {
  let service: PuzzleSolutionValidatorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PuzzleSolutionValidatorService,
        {
          provide: getRepositoryToken(PuzzleSolutionValidation),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<PuzzleSolutionValidatorService>(
      PuzzleSolutionValidatorService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // TEXT format
  // ---------------------------------------------------------------------------

  describe('validateSolution – TEXT format', () => {
    it('marks a correct text answer as PASSED with score 1', async () => {
      // The stub test case has an empty expectedOutput, so we patch the private
      // method via the custom validator registry to fully control the outcome.
      service.registerCustomValidator('text', (_submitted, _expected, _config) => true);

      const result = await service.validateSolution({
        puzzleId: 'puzzle-1',
        solutionFormat: SolutionFormat.TEXT,
        submittedSolution: { answer: 'correct' },
      });

      expect(result.status).toBe(ValidatorStatus.PASSED);
      expect(result.overallScore).toBe(1);
      expect(result.success).toBe(true);
      expect(result.validationId).toBeDefined();
    });

    it('marks an incorrect text answer as FAILED with score 0', async () => {
      service.registerCustomValidator('text', () => false);

      const result = await service.validateSolution({
        puzzleId: 'puzzle-1',
        solutionFormat: SolutionFormat.TEXT,
        submittedSolution: { answer: 'wrong' },
      });

      expect(result.status).toBe(ValidatorStatus.FAILED);
      expect(result.overallScore).toBe(0);
      expect(result.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // MULTIPLE_CHOICE format
  // ---------------------------------------------------------------------------

  describe('validateSolution – MULTIPLE_CHOICE format', () => {
    it('passes when the correct option is selected', async () => {
      service.registerCustomValidator(
        'multiple_choice',
        (submitted) => submitted.selectedOption === 'B',
      );

      const result = await service.validateSolution({
        puzzleId: 'puzzle-mc',
        solutionFormat: SolutionFormat.MULTIPLE_CHOICE,
        submittedSolution: { selectedOption: 'B' },
      });

      expect(result.status).toBe(ValidatorStatus.PASSED);
    });
  });

  // ---------------------------------------------------------------------------
  // Partial credit
  // ---------------------------------------------------------------------------

  describe('partial credit', () => {
    it('reports PARTIAL status when some but not all test cases pass', async () => {
      let callCount = 0;
      service.registerCustomValidator('text', () => {
        callCount += 1;
        // First call passes, second fails.
        return callCount === 1;
      });

      const result = await service.validateSolution({
        puzzleId: 'puzzle-partial',
        solutionFormat: SolutionFormat.TEXT,
        submittedSolution: { answer: 'x' },
        testCaseIds: ['tc-1', 'tc-2'],
      });

      expect(result.isPartialCredit).toBe(true);
      expect(result.status).toBe(ValidatorStatus.PARTIAL);
      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThan(1);
    });
  });

  // ---------------------------------------------------------------------------
  // No test cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('throws BadRequestException when no test cases are found', async () => {
      // Stub loadTestCases to return an empty array by clearing testCaseIds
      // and using a puzzleId that returns the stub (which has 1 entry by
      // default). We bypass this by injecting testCaseIds = [].
      // The issue: passing an empty testCaseIds array bypasses the stub.
      await expect(
        service.validateSolution({
          puzzleId: 'no-tc',
          solutionFormat: SolutionFormat.TEXT,
          submittedSolution: { answer: '' },
          testCaseIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation history
  // ---------------------------------------------------------------------------

  describe('getValidationHistory', () => {
    it('returns empty records and zeroed summary when no attempts exist', async () => {
      const history = await service.getValidationHistory('puzzle-1');

      expect(history.records).toEqual([]);
      expect(history.summary.totalAttempts).toBe(0);
      expect(history.summary.bestScore).toBe(0);
      expect(history.summary.averageScore).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Custom validators
  // ---------------------------------------------------------------------------

  describe('registerCustomValidator', () => {
    it('registers and uses a custom validator', async () => {
      const validator = jest.fn().mockReturnValue(true);
      service.registerCustomValidator('custom_type', validator);

      await service.validateSolution({
        puzzleId: 'puzzle-custom',
        solutionFormat: SolutionFormat.TEXT,
        submittedSolution: { answer: 'test' },
      });

      expect(validator).toHaveBeenCalled();
    });
  });
});
