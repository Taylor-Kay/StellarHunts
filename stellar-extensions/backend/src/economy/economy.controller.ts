import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AdminRole } from '../../../../backend/src/admin/admin-role.enum';
import { JwtAuthGuard } from '../../../../backend/src/admin/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../backend/src/admin/guards/roles.guard';
import { Roles } from '../../../../backend/src/admin/roles.decorator';
import { EconomyService } from './economy.service';
import {
  EconomyHistoryQueryDto,
  ExportEconomyHistoryQueryDto,
  RecordDistributionDto,
  RecordSnapshotDto,
} from './dto/economy.dto';

@Controller('economy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AdminRole.ADMIN)
export class EconomyController {
  constructor(private readonly economyService: EconomyService) {}

  /** Current supply, issuance rate, inflation, alerts, and suggestions. */
  @Get('health')
  getHealth(@Query('date') date?: string) {
    return this.economyService.getHealth(date);
  }

  @Get('adjustment')
  getSuggestedAdjustment(@Query('date') date?: string) {
    return this.economyService.suggestRewardAdjustment(date);
  }

  @Get('history')
  getHistory(@Query() query: EconomyHistoryQueryDto) {
    return this.economyService.getHistory(query);
  }

  /** Historical economy data as a downloadable CSV or JSON file. */
  @Get('export')
  async exportHistory(
    @Query() query: ExportEconomyHistoryQueryDto,
    @Res({ passthrough: true }) response: any,
  ) {
    const result = await this.economyService.exportHistory(query);
    response.setHeader('Content-Type', result.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return result.data;
  }

  @Post('distributions')
  recordDistribution(@Body() dto: RecordDistributionDto) {
    return this.economyService.recordDistribution(dto);
  }

  @Post('snapshots')
  recordSnapshot(@Body() dto: RecordSnapshotDto) {
    return this.economyService.recordSupplySnapshot(dto);
  }
}
