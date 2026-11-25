/**
 * Issue #934 – Puzzle Leaderboard Snapshot Module
 *
 * Register this in AppModule. Also add ScheduleModule.forRoot() to AppModule
 * imports if it isn't already registered (required by @Cron).
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { LeaderboardSnapshot } from './entities/leaderboard-snapshot.entity';
import { LeaderboardSnapshotService } from './services/leaderboard-snapshot.service';
import { LeaderboardSnapshotController } from './controllers/leaderboard-snapshot.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([LeaderboardSnapshot]),
  ],
  controllers: [LeaderboardSnapshotController],
  providers: [LeaderboardSnapshotService],
  exports: [LeaderboardSnapshotService],
})
export class LeaderboardSnapshotModule {}
