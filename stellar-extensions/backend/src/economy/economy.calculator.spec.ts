import {
  annualizeDailyRateBps,
  dailyDistributionRatePct,
  evaluateEconomy,
  isInflationWithinTarget,
  observedAnnualInflationBps,
  suggestRewardMultiplier,
  toDateKey,
} from './economy.calculator';

const bounds = { minMultiplier: 0.5, maxMultiplier: 2 };
const inflation = { targetAnnualBps: 500, toleranceBps: 200 };

describe('economy calculator', () => {
  describe('toDateKey', () => {
    it('formats a UTC calendar day', () => {
      expect(toDateKey(new Date('2026-11-22T23:59:59.000Z'))).toBe('2026-11-22');
    });
  });

  describe('dailyDistributionRatePct', () => {
    it('expresses daily issuance as a percentage of circulating supply', () => {
      expect(dailyDistributionRatePct(500, 40_000_000)).toBe(0.0013);
    });

    it('returns 0 when circulating supply is unavailable', () => {
      expect(dailyDistributionRatePct(500, 0)).toBe(0);
      expect(dailyDistributionRatePct(500, -1)).toBe(0);
    });
  });

  describe('annualizeDailyRateBps', () => {
    it('annualizes the daily ratio into basis points', () => {
      expect(annualizeDailyRateBps(500, 40_000_000)).toBe(45.63);
    });
  });

  describe('observedAnnualInflationBps', () => {
    it('annualizes supply growth over the observed window', () => {
      expect(observedAnnualInflationBps(1_100, 1_000, 365)).toBe(1_000);
      // A 60-day window extrapolates the same growth to a higher annual rate.
      expect(observedAnnualInflationBps(1_100, 1_000, 60)).toBe(6_083.33);
    });

    it('returns null for unusable windows', () => {
      expect(observedAnnualInflationBps(1_100, 0, 30)).toBeNull();
      expect(observedAnnualInflationBps(1_100, 1_000, 0)).toBeNull();
    });
  });

  describe('isInflationWithinTarget', () => {
    it('treats the target band as inclusive', () => {
      expect(isInflationWithinTarget(300, inflation)).toBe(true);
      expect(isInflationWithinTarget(700, inflation)).toBe(true);
      expect(isInflationWithinTarget(299, inflation)).toBe(false);
      expect(isInflationWithinTarget(701, inflation)).toBe(false);
    });
  });

  describe('suggestRewardMultiplier', () => {
    it('leaves rates unchanged when distribution is within the threshold', () => {
      expect(suggestRewardMultiplier(0.8, 1, bounds)).toBe(1);
      expect(suggestRewardMultiplier(1, 1, bounds)).toBe(1);
    });

    it('scales rates down to the alert threshold', () => {
      expect(suggestRewardMultiplier(2, 1, bounds)).toBe(0.5);
      expect(suggestRewardMultiplier(1.25, 1, bounds)).toBe(0.8);
    });

    it('clamps the suggestion to the configured bounds', () => {
      expect(suggestRewardMultiplier(10, 1, bounds)).toBe(0.5);
    });

    it('returns 1 when thresholds or rates are unusable', () => {
      expect(suggestRewardMultiplier(0, 1, bounds)).toBe(1);
      expect(suggestRewardMultiplier(2, 0, bounds)).toBe(1);
    });
  });

  describe('evaluateEconomy', () => {
    const base = {
      circulatingSupply: 40_000_000,
      totalSupply: 100_000_000,
      inflation,
      dailyAlertPct: 1,
      bounds,
    };

    it('reports a healthy economy inside all target ranges', () => {
      const result = evaluateEconomy({ ...base, dailyDistribution: 5_000 });

      expect(result.dailyDistributionRatePct).toBe(0.0125);
      expect(result.annualInflationBps).toBe(456.25);
      expect(result.inflationWithinTarget).toBe(true);
      expect(result.distributionAlert).toBe(false);
      expect(result.suggestedRewardMultiplier).toBe(1);
      expect(result.alerts).toEqual([]);
    });

    it('raises an alert and recommends a rate cut above the distribution threshold', () => {
      const result = evaluateEconomy({ ...base, dailyDistribution: 800_000 });

      expect(result.dailyDistributionRatePct).toBe(2);
      expect(result.distributionAlert).toBe(true);
      expect(result.suggestedRewardMultiplier).toBe(0.5);
      expect(result.alerts[0]).toContain('exceeds the 1% alert threshold');
      expect(result.recommendations[0]).toContain('0.5x');
    });

    it('flags inflation outside the target band', () => {
      const result = evaluateEconomy({
        ...base,
        dailyDistribution: 1_000,
        observedAnnualInflationBps: 1_500,
      });

      expect(result.inflationWithinTarget).toBe(false);
      expect(result.alerts.join(' ')).toContain('above the 300-700 bps target band');
    });

    it('flags when observed inflation is below target', () => {
      const result = evaluateEconomy({
        ...base,
        dailyDistribution: 1_000,
        observedAnnualInflationBps: 100,
      });

      expect(result.alerts.join(' ')).toContain('below the 300-700 bps target band');
      expect(result.recommendations.join(' ')).toContain('below target');
    });

    it('flags circulating supply above total supply', () => {
      const result = evaluateEconomy({
        ...base,
        circulatingSupply: 120_000_000,
        dailyDistribution: 0,
      });

      expect(result.alerts.join(' ')).toContain('exceeds total supply');
    });

    it('does not divide by zero when supply is missing', () => {
      const result = evaluateEconomy({
        ...base,
        circulatingSupply: 0,
        dailyDistribution: 1_000,
      });

      expect(result.dailyDistributionRatePct).toBe(0);
      expect(result.alerts.join(' ')).toContain('Circulating supply is not available');
    });
  });
});
