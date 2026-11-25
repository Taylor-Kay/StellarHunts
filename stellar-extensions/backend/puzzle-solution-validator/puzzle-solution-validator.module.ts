/**
 * Issue #948 – Puzzle Solution Validator Module
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PuzzleSolutionValidation } from './entities/puzzle-solution-validator.entity';
import { PuzzleSolutionValidatorService } from './services/puzzle-solution-validator.service';
import { PuzzleSolutionValidatorController } from './controllers/puzzle-solution-validator.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PuzzleSolutionValidation])],
  controllers: [PuzzleSolutionValidatorController],
  providers: [PuzzleSolutionValidatorService],
  exports: [PuzzleSolutionValidatorService],
})
export class PuzzleSolutionValidatorModule {}
