import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordDistributionDto {
  @IsNumber()
  @Min(0.000001)
  amount: number;

  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  recipient?: string;

  /** UTC day to book the reward on; defaults to today. */
  @IsOptional()
  @IsISO8601()
  distributionDate?: string;
}

export class RecordSnapshotDto {
  @IsNumber()
  @Min(0)
  circulatingSupply: number;

  @IsNumber()
  @Min(0)
  totalSupply: number;

  /** UTC day for the snapshot; defaults to today. */
  @IsOptional()
  @IsISO8601()
  snapshotDate?: string;
}

export class EconomyHistoryQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ExportEconomyHistoryQueryDto extends EconomyHistoryQueryDto {
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}
