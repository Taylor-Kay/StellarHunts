import { Inject, Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { EconomySnapshot } from './entities/economy-snapshot.entity';
import { RewardDistribution } from './entities/reward-distribution.entity';
import {
  EconomyHistoryQueryDto,
  ExportEconomyHistoryQueryDto,
  RecordDistributionDto,
  RecordSnapshotDto,
} from './dto/economy.dto';
import { ECONOMY_CONFIG, EconomySettings } from './economy.config';
import {
  evaluateEconomy,
  observedAnnualInflationBps,
  toDateKey,
} from './economy.calculator';

export interface EconomyHistoryEntry {
  date: string;
  circulatingSupply: number | null;
  totalSupply: number | null;
  dailyDistribution: number;
}

export interface EconomyHealth {
  date: string;
  generatedAt: string;
  circulatingSupply: number;
  totalSupply: number;
  dailyDistribution: number;
  dailyDistributionRatePct: number;
  annualInflationBps: number;
  inflationTarget: {
    targetAnnualBps: number;
    toleranceBps: number;
  };
  inflationWithinTarget: boolean;
  distributionAlert: boolean;
  suggestedRewardMultiplier: number;
  alerts: string[];
  recommendations: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class EconomyService {
  constructor(
    @InjectRepository(EconomySnapshot)
    private readonly snapshotRepository: Repository<EconomySnapshot>,
    @InjectRepository(RewardDistribution)
    private readonly distributionRepository: Repository<RewardDistribution>,
    @Inject(ECONOMY_CONFIG)
    private readonly config: EconomySettings,
  ) {}

  /** Records a reward payout so daily issuance can be tracked. */
  async recordDistribution(dto: RecordDistributionDto): Promise<RewardDistribution> {
    if (!(dto.amount > 0)) {
      throw new BadRequestException('Distribution amount must be positive.');
    }

    const distribution = this.distributionRepository.create({
      amount: dto.amount,
      category: dto.category,
      recipient: dto.recipient ?? null,
      distributionDate: this.normalizeDateKey(dto.distributionDate),
    });

    return this.distributionRepository.save(distribution);
  }

  /** Records (or refuses to overwrite) a day's supply figures. */
  async recordSupplySnapshot(dto: RecordSnapshotDto): Promise<EconomySnapshot> {
    if (dto.circulatingSupply < 0 || dto.totalSupply < 0) {
      throw new BadRequestException('Supply figures cannot be negative.');
    }
    if (dto.circulatingSupply > dto.totalSupply) {
      throw new BadRequestException(
        'Circulating supply cannot exceed total supply.',
      );
    }

    const snapshotDate = this.normalizeDateKey(dto.snapshotDate);
    const existing = await this.snapshotRepository.findOne({
      where: { snapshotDate },
    });
    if (existing) {
      throw new ConflictException(
        `A supply snapshot already exists for ${snapshotDate}.`,
      );
    }

    const snapshot = this.snapshotRepository.create({
      snapshotDate,
      circulatingSupply: dto.circulatingSupply,
      totalSupply: dto.totalSupply,
    });

    return this.snapshotRepository.save(snapshot);
  }

  /** Latest recorded circulating/total supply. */
  async getLatestSnapshot(): Promise<EconomySnapshot | null> {
    return this.snapshotRepository.findOne({
      order: { snapshotDate: 'DESC' },
    });
  }

  /** Total rewards issued on a given UTC day. */
  async getDailyDistribution(date = toDateKey()): Promise<number> {
    const rows = await this.distributionRepository.find({
      where: { distributionDate: date },
    });
    return rows.reduce((total, row) => total + Number(row.amount ?? 0), 0);
  }

  /**
   * Current economy health: supply, daily issuance rate, annualized inflation,
   * threshold alerts, and a suggested reward-rate multiplier.
   */
  async getHealth(date = toDateKey()): Promise<EconomyHealth> {
    const latest = await this.getLatestSnapshot();
    if (!latest) {
      throw new NotFoundException(
        'No circulating supply snapshot recorded; record a snapshot before checking economy health.',
      );
    }

    const dailyDistribution = await this.getDailyDistribution(date);
    const observedAnnualInflationBps = await this.computeObservedInflationBps(
      date,
    );

    const evaluation = evaluateEconomy({
      circulatingSupply: Number(latest.circulatingSupply),
      totalSupply: Number(latest.totalSupply),
      dailyDistribution,
      observedAnnualInflationBps,
      inflation: {
        targetAnnualBps: this.config.inflation.targetAnnualBps,
        toleranceBps: this.config.inflation.toleranceBps,
      },
      dailyAlertPct: this.config.distribution.dailyAlertPct,
      bounds: this.config.rewardAdjustment,
    });

    return {
      date,
      generatedAt: new Date().toISOString(),
      ...evaluation,
      inflationTarget: {
        targetAnnualBps: this.config.inflation.targetAnnualBps,
        toleranceBps: this.config.inflation.toleranceBps,
      },
    };
  }

  /** Suggests a multiplier to apply to current reward rates. */
  async suggestRewardAdjustment(date = toDateKey()): Promise<{
    date: string;
    suggestedRewardMultiplier: number;
    reason: string;
  }> {
    const health = await this.getHealth(date);
    return {
      date: health.date,
      suggestedRewardMultiplier: health.suggestedRewardMultiplier,
      reason:
        health.suggestedRewardMultiplier === 1
          ? 'Distribution is within the alert threshold; keep current reward rates.'
          : `Distribution is above the ${this.config.distribution.dailyAlertPct}% threshold; scale reward rates by ${health.suggestedRewardMultiplier}x.`,
    };
  }

  /** Merged daily snapshot + issuance history for the requested window. */
  async getHistory(query: EconomyHistoryQueryDto): Promise<EconomyHistoryEntry[]> {
    const { from, to } = this.resolveRange(query);
    if (from > to) {
      throw new BadRequestException('`from` must be on or before `to`.');
    }

    const [snapshots, distributions] = await Promise.all([
      this.snapshotRepository.find({
        where: { snapshotDate: Between(from, to) },
        order: { snapshotDate: 'ASC' },
      }),
      this.distributionRepository.find({
        where: { distributionDate: Between(from, to) },
      }),
    ]);

    const issuedByDate = new Map<string, number>();
    for (const row of distributions) {
      const key = this.dateKeyOf(row.distributionDate);
      issuedByDate.set(key, (issuedByDate.get(key) ?? 0) + Number(row.amount ?? 0));
    }

    const entries = new Map<string, EconomyHistoryEntry>();
    for (const snapshot of snapshots) {
      const key = this.dateKeyOf(snapshot.snapshotDate);
      entries.set(key, {
        date: key,
        circulatingSupply: Number(snapshot.circulatingSupply),
        totalSupply: Number(snapshot.totalSupply),
        dailyDistribution: issuedByDate.get(key) ?? 0,
      });
    }
    for (const [key, amount] of issuedByDate) {
      if (!entries.has(key)) {
        entries.set(key, {
          date: key,
          circulatingSupply: null,
          totalSupply: null,
          dailyDistribution: amount,
        });
      }
    }

    return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Serializes history as CSV or JSON for download. */
  async exportHistory(query: ExportEconomyHistoryQueryDto): Promise<{
    contentType: string;
    filename: string;
    data: string;
  }> {
    const entries = await this.getHistory(query);
    const format = query.format ?? 'json';
    const lastEntry = entries[entries.length - 1];
    const base = `economy-history-${entries[0]?.date ?? 'empty'}-${lastEntry?.date ?? 'empty'}`;

    if (format === 'csv') {
      const header =
        'date,circulating_supply,total_supply,daily_distribution,distribution_rate_pct';
      const lines = entries.map((entry) => {
        const rate =
          entry.circulatingSupply && entry.circulatingSupply > 0
            ? ((entry.dailyDistribution / entry.circulatingSupply) * 100).toFixed(4)
            : '';
        return [
          entry.date,
          entry.circulatingSupply ?? '',
          entry.totalSupply ?? '',
          entry.dailyDistribution,
          rate,
        ].join(',');
      });
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `${base}.csv`,
        data: [header, ...lines].join('\n'),
      };
    }

    return {
      contentType: 'application/json; charset=utf-8',
      filename: `${base}.json`,
      data: JSON.stringify(entries, null, 2),
    };
  }

  /** Business days covered by the configured history window. */
  private resolveRange(query: EconomyHistoryQueryDto): { from: string; to: string } {
    const to = query.to ? this.dateKeyOf(query.to) : toDateKey();
    const from = query.from
      ? this.dateKeyOf(query.from)
      : this.shiftDays(to, -(this.config.inflation.historyWindowDays - 1));
    return { from, to };
  }

  private async computeObservedInflationBps(date: string): Promise<number | null> {
    const cutoff = this.shiftDays(date, -this.config.inflation.historyWindowDays);
    const window = await this.snapshotRepository.find({
      where: { snapshotDate: MoreThanOrEqual(cutoff) },
      order: { snapshotDate: 'ASC' },
    });
    if (window.length < 2) {
      return null;
    }

    const first = window[0];
    const last = window[window.length - 1];
    const elapsedDays =
      (Date.parse(this.dateKeyOf(last.snapshotDate)) -
        Date.parse(this.dateKeyOf(first.snapshotDate))) /
      MS_PER_DAY;

    return observedAnnualInflationBps(
      Number(last.circulatingSupply),
      Number(first.circulatingSupply),
      elapsedDays,
    );
  }

  private normalizeDateKey(value?: string): string {
    return value ? this.dateKeyOf(value) : toDateKey();
  }

  /** Accepts a Date, Date-ISO string, or YYYY-MM-DD and returns YYYY-MM-DD. */
  private dateKeyOf(value: string | Date): string {
    if (value instanceof Date) {
      return toDateKey(value);
    }
    return value.slice(0, 10);
  }

  private shiftDays(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return toDateKey(date);
  }
}
