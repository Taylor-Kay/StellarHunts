/**
 * Issue #934 – Puzzle Leaderboard Snapshot Module – Controller
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Delete,
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
import { LeaderboardSnapshotService } from '../services/leaderboard-snapshot.service';
import {
  GetSnapshotHistoryDto,
  RankChangesResponseDto,
  SnapshotHistoryResponseDto,
  SnapshotResponseDto,
  TakeSnapshotDto,
} from '../dto/leaderboard-snapshot.dto';

@ApiTags('Leaderboard Snapshots')
@Controller('leaderboard-snapshots')
export class LeaderboardSnapshotController {
  constructor(
    private readonly snapshotService: LeaderboardSnapshotService,
  ) {}

  /**
   * POST /leaderboard-snapshots – Trigger an on-demand snapshot.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Take a leaderboard snapshot',
    description:
      'Manually triggers a snapshot. The scheduled job does this hourly automatically.',
  })
  @ApiResponse({ status: 201, description: 'Snapshot taken', type: SnapshotResponseDto })
  async takeSnapshot(@Body() dto: TakeSnapshotDto): Promise<SnapshotResponseDto> {
    return this.snapshotService.takeSnapshot(dto.puzzleId ?? null);
  }

  /**
   * GET /leaderboard-snapshots – Query snapshot history.
   */
  @Get()
  @ApiOperation({
    summary: 'Get snapshot history',
    description: 'Retrieve historical snapshots, optionally filtered by puzzle and date range.',
  })
  @ApiResponse({
    status: 200,
    description: 'Snapshot history returned',
    type: SnapshotHistoryResponseDto,
  })
  async getSnapshotHistory(
    @Query() dto: GetSnapshotHistoryDto,
  ): Promise<SnapshotHistoryResponseDto> {
    return this.snapshotService.getSnapshotHistory(dto);
  }

  /**
   * GET /leaderboard-snapshots/:id – Get a single snapshot.
   */
  @Get(':id')
  @ApiParam({ name: 'id', description: 'Snapshot UUID' })
  @ApiOperation({ summary: 'Get a single snapshot by ID' })
  @ApiResponse({ status: 200, type: SnapshotResponseDto })
  @ApiResponse({ status: 404, description: 'Snapshot not found' })
  async getSnapshot(@Param('id') id: string): Promise<SnapshotResponseDto> {
    return this.snapshotService.getSnapshot(id);
  }

  /**
   * GET /leaderboard-snapshots/compare/:fromId/:toId – Rank change diff.
   */
  @Get('compare/:fromId/:toId')
  @ApiParam({ name: 'fromId', description: 'Earlier snapshot UUID' })
  @ApiParam({ name: 'toId', description: 'Later snapshot UUID' })
  @ApiOperation({
    summary: 'Compare two snapshots',
    description:
      'Returns per-player rank changes (delta, trend) between two snapshots.',
  })
  @ApiResponse({ status: 200, type: RankChangesResponseDto })
  @ApiResponse({ status: 404, description: 'One or both snapshots not found' })
  async getRankChanges(
    @Param('fromId') fromId: string,
    @Param('toId') toId: string,
  ): Promise<RankChangesResponseDto> {
    return this.snapshotService.getRankChanges(fromId, toId);
  }

  /**
   * DELETE /leaderboard-snapshots/cleanup – Remove old snapshots.
   */
  @Delete('cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clean up old snapshots',
    description: `Deletes snapshots older than the retention window (30 days).`,
  })
  @ApiResponse({ status: 200, description: 'Cleanup complete' })
  async cleanup(): Promise<{ deleted: number }> {
    const deleted = await this.snapshotService.cleanupOldSnapshots();
    return { deleted };
  }
}
