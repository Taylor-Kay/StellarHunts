import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EconomyService } from './economy.service';
import { EconomySnapshot } from './entities/economy-snapshot.entity';
import { RewardDistribution } from './entities/reward-distribution.entity';
import { ECONOMY_CONFIG, economySettings } from './economy.config';

const snapshotRepository = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((value) => value),
  save: jest.fn((value) => Promise.resolve({ id: 'snapshot-1', ...value })),
};

const distributionRepository = {
  find: jest.fn(),
  create: jest.fn((value) => value),
  save: jest.fn((value) => Promise.resolve({ id: 'distribution-1', ...value })),
};

const latestSnapshot = {
  circulatingSupply: 40_000_000,
  totalSupply: 100_000_000,
  snapshotDate: '2026-11-22',
};

describe('EconomyService', () => {
  let service: EconomyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-11-22T12:00:00.000Z'));

    snapshotRepository.findOne.mockResolvedValue(latestSnapshot);
    snapshotRepository.find.mockResolvedValue([]);
    distributionRepository.find.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EconomyService,
        {
          provide: getRepositoryToken(EconomySnapshot),
          useValue: snapshotRepository,
        },
        {
          provide: getRepositoryToken(RewardDistribution),
          useValue: distributionRepository,
        },
        { provide: ECONOMY_CONFIG, useValue: economySettings },
      ],
    }).compile();

    service = moduleRef.get(EconomyService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('recordDistribution', () => {
    it('records a payout on today by default', async () => {
      const result = await service.recordDistribution({
        amount: 20,
        category: 'puzzle',
      });

      expect(distributionRepository.create).toHaveBeenCalledWith({
        amount: 20,
        category: 'puzzle',
        recipient: null,
        distributionDate: '2026-11-22',
      });
      expect(result.id).toBe('distribution-1');
    });

    it('books a payout on an explicit day', async () => {
      await service.recordDistribution({
        amount: 5,
        category: 'daily_check_in',
        recipient: 'GABC',
        distributionDate: '2026-11-20',
      });

      expect(distributionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ distributionDate: '2026-11-20', recipient: 'GABC' }),
      );
    });

    it('rejects non-positive amounts', async () => {
      await expect(
        service.recordDistribution({ amount: 0, category: 'puzzle' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(distributionRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('recordSupplySnapshot', () => {
    it('stores a snapshot for the day', async () => {
      snapshotRepository.findOne.mockResolvedValue(null);

      const result = await service.recordSupplySnapshot({
        circulatingSupply: 41_000_000,
        totalSupply: 100_000_000,
      });

      expect(snapshotRepository.create).toHaveBeenCalledWith({
        snapshotDate: '2026-11-22',
        circulatingSupply: 41_000_000,
        totalSupply: 100_000_000,
      });
      expect(result.id).toBe('snapshot-1');
    });

    it('rejects circulating supply above total supply', async () => {
      await expect(
        service.recordSupplySnapshot({
          circulatingSupply: 101,
          totalSupply: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to overwrite an existing day', async () => {
      snapshotRepository.findOne.mockResolvedValue({ snapshotDate: '2026-11-22' });

      await expect(
        service.recordSupplySnapshot({
          circulatingSupply: 41_000_000,
          totalSupply: 100_000_000,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(snapshotRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getDailyDistribution', () => {
    it('sums all payouts booked on the day', async () => {
      distributionRepository.find.mockResolvedValue([
        { amount: 20 },
        { amount: 35 },
        { amount: 5 },
      ]);

      await expect(service.getDailyDistribution('2026-11-22')).resolves.toBe(60);
      expect(distributionRepository.find).toHaveBeenCalledWith({
        where: { distributionDate: '2026-11-22' },
      });
    });
  });

  describe('getHealth', () => {
    it('requires a supply snapshot', async () => {
      snapshotRepository.findOne.mockResolvedValue(null);

      await expect(service.getHealth()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports healthy metrics inside the target ranges', async () => {
      distributionRepository.find.mockResolvedValue([{ amount: 2_500 }, { amount: 2_500 }]);

      const health = await service.getHealth('2026-11-22');

      expect(health.circulatingSupply).toBe(40_000_000);
      expect(health.dailyDistribution).toBe(5_000);
      expect(health.dailyDistributionRatePct).toBe(0.0125);
      expect(health.annualInflationBps).toBe(456.25);
      expect(health.inflationWithinTarget).toBe(true);
      expect(health.distributionAlert).toBe(false);
      expect(health.alerts).toEqual([]);
    });

    it('alerts when daily distribution exceeds the threshold', async () => {
      distributionRepository.find.mockResolvedValue([{ amount: 800_000 }]);

      const health = await service.getHealth('2026-11-22');

      expect(health.distributionAlert).toBe(true);
      expect(health.suggestedRewardMultiplier).toBe(0.5);
      expect(health.alerts[0]).toContain('exceeds the 1% alert threshold');
    });

    it('uses observed supply growth for inflation when snapshots span the window', async () => {
      distributionRepository.find.mockResolvedValue([{ amount: 40_000 }]);
      snapshotRepository.find.mockResolvedValue([
        { snapshotDate: '2026-10-23', circulatingSupply: 39_000_000, totalSupply: 100_000_000 },
        { snapshotDate: '2026-11-22', circulatingSupply: 40_000_000, totalSupply: 100_000_000 },
      ]);

      const health = await service.getHealth('2026-11-22');

      expect(health.annualInflationBps).toBe(3119.66);
      expect(health.inflationWithinTarget).toBe(false);
      expect(health.alerts.join(' ')).toContain('above the 300-700 bps target band');
    });
  });

  describe('suggestRewardAdjustment', () => {
    it('keeps rates when distribution is within the threshold', async () => {
      const suggestion = await service.suggestRewardAdjustment('2026-11-22');

      expect(suggestion.suggestedRewardMultiplier).toBe(1);
      expect(suggestion.reason).toContain('within the alert threshold');
    });

    it('scales rates down when distribution is too high', async () => {
      distributionRepository.find.mockResolvedValue([{ amount: 800_000 }]);

      const suggestion = await service.suggestRewardAdjustment('2026-11-22');

      expect(suggestion.suggestedRewardMultiplier).toBe(0.5);
      expect(suggestion.reason).toContain('scale reward rates by 0.5x');
    });
  });

  describe('getHistory', () => {
    const snapshots = [
      {
        snapshotDate: '2026-11-20',
        circulatingSupply: 100,
        totalSupply: 200,
      },
      {
        snapshotDate: '2026-11-22',
        circulatingSupply: 120,
        totalSupply: 200,
      },
    ];
    const distributions = [
      { distributionDate: '2026-11-20', amount: 5 },
      { distributionDate: '2026-11-21', amount: 7 },
      { distributionDate: '2026-11-22', amount: 3 },
    ];

    beforeEach(() => {
      snapshotRepository.find.mockResolvedValue(snapshots);
      distributionRepository.find.mockResolvedValue(distributions);
    });

    it('merges snapshot-only and distribution-only days in date order', async () => {
      const history = await service.getHistory({
        from: '2026-11-20',
        to: '2026-11-22',
      });

      expect(history).toEqual([
        {
          date: '2026-11-20',
          circulatingSupply: 100,
          totalSupply: 200,
          dailyDistribution: 5,
        },
        {
          date: '2026-11-21',
          circulatingSupply: null,
          totalSupply: null,
          dailyDistribution: 7,
        },
        {
          date: '2026-11-22',
          circulatingSupply: 120,
          totalSupply: 200,
          dailyDistribution: 3,
        },
      ]);
    });

    it('defaults to the configured history window', async () => {
      await service.getHistory({});

      expect(snapshotRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { snapshotDate: expect.anything() } }),
      );
      // 30-day window ending today (inclusive).
      expect(snapshotRepository.find.mock.calls[0][0].where.snapshotDate.value).toEqual([
        '2026-10-24',
        '2026-11-22',
      ]);
    });

    it('rejects inverted ranges', async () => {
      await expect(
        service.getHistory({ from: '2026-11-22', to: '2026-11-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('exportHistory', () => {
    beforeEach(() => {
      snapshotRepository.find.mockResolvedValue([
        { snapshotDate: '2026-11-20', circulatingSupply: 100, totalSupply: 200 },
        { snapshotDate: '2026-11-21', circulatingSupply: 110, totalSupply: 200 },
      ]);
      distributionRepository.find.mockResolvedValue([
        { distributionDate: '2026-11-20', amount: 5 },
        { distributionDate: '2026-11-21', amount: 4 },
      ]);
    });

    it('exports CSV with a rate column', async () => {
      const result = await service.exportHistory({
        from: '2026-11-20',
        to: '2026-11-21',
        format: 'csv',
      });

      expect(result.contentType).toContain('text/csv');
      expect(result.filename).toBe('economy-history-2026-11-20-2026-11-21.csv');
      const lines = result.data.split('\n');
      expect(lines[0]).toBe(
        'date,circulating_supply,total_supply,daily_distribution,distribution_rate_pct',
      );
      expect(lines[1]).toBe('2026-11-20,100,200,5,5.0000');
      expect(lines[2]).toBe('2026-11-21,110,200,4,3.6364');
    });

    it('exports JSON by default', async () => {
      snapshotRepository.find.mockResolvedValue([
        { snapshotDate: '2026-11-20', circulatingSupply: 100, totalSupply: 200 },
      ]);
      distributionRepository.find.mockResolvedValue([
        { distributionDate: '2026-11-20', amount: 5 },
      ]);

      const result = await service.exportHistory({
        from: '2026-11-20',
        to: '2026-11-20',
      });

      expect(result.contentType).toContain('application/json');
      expect(JSON.parse(result.data)).toEqual([
        {
          date: '2026-11-20',
          circulatingSupply: 100,
          totalSupply: 200,
          dailyDistribution: 5,
        },
      ]);
    });
  });
});
