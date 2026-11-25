import { Module } from '@nestjs/common';
import { UserProgressExportController } from './user-progress-export.controller';
import { UserProgressExportService } from './user-progress-export.service';

/**
 * Module that exposes endpoints to export and import user progress data.
 *
 * Uses the shared DataSource from TypeORM (registered in AppModule) for
 * raw SQL queries rather than individual entity repositories, keeping the
 * extension decoupled from the main backend entity layer.
 */
@Module({
  controllers: [UserProgressExportController],
  providers: [UserProgressExportService],
  exports: [UserProgressExportService],
})
export class UserProgressExportModule {}
