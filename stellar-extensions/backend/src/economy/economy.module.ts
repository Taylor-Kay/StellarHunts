import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EconomyController } from './economy.controller';
import { EconomyService } from './economy.service';
import { EconomySnapshot } from './entities/economy-snapshot.entity';
import { RewardDistribution } from './entities/reward-distribution.entity';
import { ECONOMY_CONFIG, economySettings } from './economy.config';

@Module({
  imports: [TypeOrmModule.forFeature([EconomySnapshot, RewardDistribution])],
  controllers: [EconomyController],
  providers: [
    EconomyService,
    { provide: ECONOMY_CONFIG, useValue: economySettings },
  ],
  exports: [EconomyService],
})
export class EconomyModule {}
