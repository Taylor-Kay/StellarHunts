/**
 * Issue #948 – Puzzle Solution Validator Module – Controller
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PuzzleSolutionValidatorService } from '../services/puzzle-solution-validator.service';
import {
  ValidateSolutionDto,
  ValidationResponseDto,
  ValidationHistoryDto,
} from '../dto/puzzle-solution-validator.dto';

@ApiTags('Puzzle Solution Validator')
@Controller('puzzle-solution-validator')
export class PuzzleSolutionValidatorController {
  constructor(
    private readonly validatorService: PuzzleSolutionValidatorService,
  ) {}

  /**
   * POST /puzzle-solution-validator/validate
   * Validate a submitted solution against the puzzle's test cases.
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a puzzle solution',
    description:
      'Validates the submitted solution against the puzzle test cases. ' +
      'Supports TEXT, CODE and MULTIPLE_CHOICE formats. Returns per-test-case ' +
      'feedback and an overall score, including partial credit where applicable.',
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result returned',
    type: ValidationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request / no test cases found' })
  async validateSolution(
    @Body() dto: ValidateSolutionDto,
  ): Promise<ValidationResponseDto> {
    return this.validatorService.validateSolution(dto);
  }

  /**
   * GET /puzzle-solution-validator/history/:puzzleId
   * Retrieve validation history for a puzzle.
   */
  @Get('history/:puzzleId')
  @ApiOperation({
    summary: 'Get validation history for a puzzle',
    description: 'Returns past validation attempts for a puzzle, with a summary.',
  })
  @ApiParam({ name: 'puzzleId', description: 'Puzzle UUID' })
  @ApiQuery({
    name: 'userId',
    required: false,
    description: 'Filter by user UUID',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of records (default 50)',
  })
  @ApiResponse({
    status: 200,
    description: 'Validation history retrieved',
    type: ValidationHistoryDto,
  })
  async getValidationHistory(
    @Param('puzzleId') puzzleId: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: number,
  ): Promise<ValidationHistoryDto> {
    return this.validatorService.getValidationHistory(
      puzzleId,
      userId,
      limit ? Number(limit) : 50,
    );
  }
}
