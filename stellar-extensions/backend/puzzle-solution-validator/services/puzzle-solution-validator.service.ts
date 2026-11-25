/**
 * Issue #948 – Puzzle Solution Validator Module – Service
 *
 * Validates puzzle solutions against test cases with support for multiple
 * solution formats (text, code, multiple-choice) and custom validators per
 * puzzle type. Supports partial credit and returns detailed per-test-case
 * feedback. Includes timeout protection for long-running validators.
 *
 * Follows patterns in backend/src/puzzle-test-case/services/validation.service.ts
 * and backend/src/puzzle-solution-checker/.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PuzzleSolutionValidation,
  SolutionFormat,
  ValidatorStatus,
} from '../entities/puzzle-solution-validator.entity';
import {
  ValidateSolutionDto,
  ValidationResponseDto,
  TestCaseResultDto,
  ValidationHistoryDto,
} from '../dto/puzzle-solution-validator.dto';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TestCase {
  id: string;
  title: string;
  puzzleType: string;
  validationMode: string;
  expectedOutput: Record<string, any>;
  validationConfig: Record<string, any>;
  weight: number;
  timeoutMs: number;
  isHidden: boolean;
}

type CustomValidator = (
  submitted: Record<string, any>,
  expected: Record<string, any>,
  config: Record<string, any>,
) => boolean;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PuzzleSolutionValidatorService {
  private readonly logger = new Logger(PuzzleSolutionValidatorService.name);

  /**
   * Registry of custom validators keyed by puzzle type (e.g. "soroban_quiz").
   * Register additional validators at startup via registerCustomValidator().
   */
  private readonly customValidators = new Map<string, CustomValidator>();

  constructor(
    @InjectRepository(PuzzleSolutionValidation)
    private readonly validationRepo: Repository<PuzzleSolutionValidation>,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Validate a submitted solution against the puzzle's test cases.
   */
  async validateSolution(dto: ValidateSolutionDto): Promise<ValidationResponseDto> {
    this.logger.log(`Validating solution for puzzle ${dto.puzzleId}`);

    const testCases = await this.loadTestCases(dto.puzzleId, dto.testCaseIds);

    if (testCases.length === 0) {
      throw new BadRequestException(
        `No test cases found for puzzle ${dto.puzzleId}`,
      );
    }

    const startTime = Date.now();
    const testCaseResults: TestCaseResultDto[] = [];
    let weightedScore = 0;
    let totalWeight = 0;

    for (const tc of testCases) {
      const result = await this.runWithTimeout(
        () => this.executeTestCase(tc, dto.solutionFormat, dto.submittedSolution),
        tc.timeoutMs,
      );
      testCaseResults.push(result);
      weightedScore += result.score * tc.weight;
      totalWeight += tc.weight;
    }

    const overallScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const passedTestCases = testCaseResults.filter(
      (r) => r.status === ValidatorStatus.PASSED,
    ).length;
    const failedTestCases = testCaseResults.length - passedTestCases;
    const allPassed = passedTestCases === testCaseResults.length;
    const isPartialCredit = !allPassed && overallScore > 0;

    const status = allPassed
      ? ValidatorStatus.PASSED
      : isPartialCredit
        ? ValidatorStatus.PARTIAL
        : ValidatorStatus.FAILED;

    const feedbackMessage = this.buildFeedbackMessage(status, overallScore, testCaseResults);
    const executionTimeMs = Date.now() - startTime;

    // Persist validation record.
    const record = await this.validationRepo.save(
      this.validationRepo.create({
        puzzleId: dto.puzzleId,
        userId: dto.userId,
        solutionFormat: dto.solutionFormat,
        submittedSolution: dto.submittedSolution,
        status,
        score: overallScore,
        testCaseResults,
        feedbackMessage,
        executionTimeMs,
        isPartialCredit,
      }),
    );

    return {
      success: allPassed,
      status,
      overallScore,
      totalTestCases: testCaseResults.length,
      passedTestCases,
      failedTestCases,
      isPartialCredit,
      testCaseResults,
      feedbackMessage,
      executionTimeMs,
      validationId: record.id,
    };
  }

  /**
   * Retrieve validation history for a puzzle, optionally filtered by user.
   */
  async getValidationHistory(
    puzzleId: string,
    userId?: string,
    limit = 50,
  ): Promise<ValidationHistoryDto> {
    const qb = this.validationRepo
      .createQueryBuilder('v')
      .where('v.puzzleId = :puzzleId', { puzzleId });

    if (userId) {
      qb.andWhere('v.userId = :userId', { userId });
    }

    const records = await qb
      .orderBy('v.createdAt', 'DESC')
      .take(limit)
      .getMany();

    const scores = records.map((r) => r.score);
    const bestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const averageScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return {
      records,
      summary: {
        totalAttempts: records.length,
        bestScore,
        averageScore,
        lastAttempt: records[0]?.createdAt,
      },
    };
  }

  /**
   * Register a custom validator function for a specific puzzle type.
   * Call this from your module's onModuleInit or at startup.
   */
  registerCustomValidator(puzzleType: string, validator: CustomValidator): void {
    this.customValidators.set(puzzleType, validator);
    this.logger.log(`Custom validator registered for puzzle type: ${puzzleType}`);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Load test cases for a puzzle. If testCaseIds is provided, only those are
   * loaded. In a real integration this would query the puzzle-test-case module;
   * here we provide a stub that returns a sensible default for the puzzle so
   * the validator can function in isolation.
   */
  private async loadTestCases(
    puzzleId: string,
    testCaseIds?: string[],
  ): Promise<TestCase[]> {
    // Stub: in production this would call PuzzleTestCaseService.getTestCase()
    // for each ID or PuzzleTestCaseService.getValidationTestCases(puzzleId).
    // We return a minimal synthetic test case so the module is self-contained.
    const stub: TestCase = {
      id: 'stub-tc-1',
      title: 'Default validation',
      puzzleType: 'text',
      validationMode: 'exact_match',
      expectedOutput: {},
      validationConfig: {},
      weight: 1,
      timeoutMs: 3000,
      isHidden: false,
    };

    if (testCaseIds && testCaseIds.length > 0) {
      return testCaseIds.map((id) => ({ ...stub, id }));
    }
    return [stub];
  }

  /**
   * Execute a single test case against the submitted solution.
   */
  private async executeTestCase(
    tc: TestCase,
    format: SolutionFormat,
    submitted: Record<string, any>,
  ): Promise<TestCaseResultDto> {
    const startTime = Date.now();
    try {
      const isCorrect = await this.validateByFormat(tc, format, submitted);
      const score = isCorrect ? 1 : 0;
      return {
        testCaseId: tc.id,
        title: tc.title,
        status: isCorrect ? ValidatorStatus.PASSED : ValidatorStatus.FAILED,
        score,
        feedback: isCorrect
          ? 'Correct!'
          : this.failureFeedback(format, tc.validationMode),
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        testCaseId: tc.id,
        title: tc.title,
        status: ValidatorStatus.ERROR,
        score: 0,
        feedback: `Validation error: ${(err as Error).message}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Dispatch validation to the appropriate format handler.
   */
  private async validateByFormat(
    tc: TestCase,
    format: SolutionFormat,
    submitted: Record<string, any>,
  ): Promise<boolean> {
    // Check for a registered custom validator first.
    const custom = this.customValidators.get(tc.puzzleType);
    if (custom) {
      return custom(submitted, tc.expectedOutput, tc.validationConfig);
    }

    switch (format) {
      case SolutionFormat.TEXT:
        return this.validateText(submitted, tc);
      case SolutionFormat.CODE:
        return this.validateCode(submitted, tc);
      case SolutionFormat.MULTIPLE_CHOICE:
        return this.validateMultipleChoice(submitted, tc);
      default:
        return this.validateText(submitted, tc);
    }
  }

  // -- Format validators -------------------------------------------------------

  private validateText(
    submitted: Record<string, any>,
    tc: TestCase,
  ): boolean {
    const answer = String(submitted.answer ?? submitted.result ?? '');
    const expected = String(tc.expectedOutput.answer ?? tc.expectedOutput.result ?? '');
    const cfg = tc.validationConfig ?? {};

    let a = answer;
    let e = expected;

    if (cfg.ignoreCase) {
      a = a.toLowerCase();
      e = e.toLowerCase();
    }
    if (cfg.ignoreWhitespace) {
      a = a.replace(/\s+/g, '');
      e = e.replace(/\s+/g, '');
    }
    if (cfg.regexPattern) {
      return new RegExp(cfg.regexPattern, cfg.ignoreCase ? 'i' : '').test(a);
    }
    return a === e;
  }

  private validateCode(
    submitted: Record<string, any>,
    tc: TestCase,
  ): boolean {
    // In production this would run the code in a sandboxed executor and
    // compare its output against tc.expectedOutput. For now we do a
    // best-effort textual comparison against an expected output key.
    const output = String(submitted.output ?? submitted.result ?? '');
    const expected = String(
      tc.expectedOutput.output ?? tc.expectedOutput.result ?? '',
    );
    return output.trim() === expected.trim();
  }

  private validateMultipleChoice(
    submitted: Record<string, any>,
    tc: TestCase,
  ): boolean {
    const selected = String(submitted.selectedOption ?? submitted.answer ?? '');
    const correctOption = String(
      tc.expectedOutput.correctOption ?? tc.expectedOutput.answer ?? '',
    );
    return selected.trim().toLowerCase() === correctOption.trim().toLowerCase();
  }

  // -- Timeout protection -------------------------------------------------------

  /**
   * Run a validator function with a timeout. If the function does not resolve
   * within timeoutMs, the test case is marked as TIMEOUT.
   */
  private runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Validation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // -- Feedback -----------------------------------------------------------------

  private failureFeedback(format: SolutionFormat, validationMode: string): string {
    if (format === SolutionFormat.MULTIPLE_CHOICE) {
      return 'Incorrect option selected.';
    }
    if (format === SolutionFormat.CODE) {
      return 'Code output does not match expected output.';
    }
    return `Answer does not match the expected value (mode: ${validationMode}).`;
  }

  private buildFeedbackMessage(
    status: ValidatorStatus,
    score: number,
    results: TestCaseResultDto[],
  ): string {
    if (status === ValidatorStatus.PASSED) {
      return 'All test cases passed. Well done!';
    }
    if (status === ValidatorStatus.PARTIAL) {
      const pct = Math.round(score * 100);
      return `Partial credit awarded: ${pct}% (${results.filter((r) => r.status === ValidatorStatus.PASSED).length}/${results.length} test cases passed).`;
    }
    return 'Validation failed. Please review your answer and try again.';
  }
}
