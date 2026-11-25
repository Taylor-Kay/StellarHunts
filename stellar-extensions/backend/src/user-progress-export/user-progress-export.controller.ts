import {
  Controller,
  Get,
  Post,
  Body,
  Header,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../../backend/src/auth/decorators/current-user.decorator';
import type { User } from '../../../../backend/src/auth/entities/user.entity';
import { JwtAuthGuard } from '../../../../backend/src/auth/guards/jwt-auth.guard';
import { RateLimit } from '../../../../backend/src/rate-limiter/rate-limit.decorator';
import { RateLimitGuard } from '../../../../backend/src/rate-limiter/rate-limit.guard';
import {
  ImportProgressDto,
  ImportProgressResultDto,
  UserProgressExportDto,
} from './dto/export-progress.dto';
import { UserProgressExportService } from './user-progress-export.service';

@ApiTags('User Progress Export')
@Controller('users/me/progress')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserProgressExportController {
  constructor(
    private readonly userProgressExportService: UserProgressExportService,
  ) {}

  /**
   * Export all user progress data as a downloadable JSON file.
   * Rate-limited to 5 requests per hour to prevent abuse.
   */
  @Get('export')
  @UseGuards(RateLimitGuard)
  @RateLimit({ ttl: 3600, limit: 5 })
  @Header('Cache-Control', 'no-store, private')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces('application/json')
  @ApiOperation({
    summary: 'Export user progress as JSON',
    description:
      'Returns a JSON document with all user game progress: puzzles solved, achievements, NFTs, streaks, and on-chain verification data. Rate-limited to 5 exports per hour.',
  })
  @ApiResponse({ status: 200, description: 'Progress data exported successfully', type: UserProgressExportDto })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 429, description: 'Export rate limit exceeded' })
  async exportProgress(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserProgressExportDto> {
    const data = await this.userProgressExportService.exportProgress(user.id);

    const filename = `stellarhunts-progress-${user.id}-${data.exportedAt.slice(0, 10)}.json`;
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return data;
  }

  /**
   * Import previously exported progress data.
   * Rate-limited to 3 requests per hour.
   * Supports merge (default) or overwrite conflict resolution.
   */
  @Post('import')
  @UseGuards(RateLimitGuard)
  @RateLimit({ ttl: 3600, limit: 3 })
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Import user progress from JSON export',
    description:
      'Accepts a progress export JSON payload and imports puzzles solved, achievements, NFTs and streaks into the user account. Conflict resolution strategy can be merge (default) or overwrite. Rate-limited to 3 imports per hour.',
  })
  @ApiBody({ type: ImportProgressDto })
  @ApiResponse({ status: 200, description: 'Progress imported successfully', type: ImportProgressResultDto })
  @ApiResponse({ status: 400, description: 'Invalid import payload or schema mismatch' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 429, description: 'Import rate limit exceeded' })
  async importProgress(
    @CurrentUser() user: User,
    @Body() body: ImportProgressDto,
  ): Promise<ImportProgressResultDto> {
    return this.userProgressExportService.importProgress(
      user.id,
      body.data,
      body.conflictResolution,
    );
  }
}
