/**
 * Pure economic calculations for the token economy monitor.
 *
 * Kept free of NestJS/TypeORM dependencies so the model can be unit tested
 * directly and reused by scripts.
 */

export const BPS_DENOMINATOR = 10_000;
export const DAYS_PER_YEAR = 365;

export interface InflationTarget {
  targetAnnualBps: number;
  toleranceBps: number;
}

export interface RewardAdjustmentBounds {
  minMultiplier: number;
  maxMultiplier: number;
}

export interface EconomyEvaluationInput {
  circulatingSupply: number;
  totalSupply: number;
  dailyDistribution: number;
  /** Supply growth over the observed window, when enough snapshots exist. */
  observedAnnualInflationBps?: number | null;
  inflation: InflationTarget;
  dailyAlertPct: number;
  bounds: RewardAdjustmentBounds;
}

export interface EconomyEvaluation {
  circulatingSupply: number;
  totalSupply: number;
  dailyDistribution: number;
  dailyDistributionRatePct: number;
  annualInflationBps: number;
  inflationWithinTarget: boolean;
  distributionAlert: boolean;
  suggestedRewardMultiplier: number;
  alerts: string[];
  recommendations: string[];
}

const round = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** UTC calendar day key (YYYY-MM-DD) for deterministic daily bucketing. */
export function toDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Daily issuance as a percentage of circulating supply.
 * A zero or negative circulating supply yields 0: the caller reports the
 * missing-supply condition as an alert rather than dividing by zero.
 */
export function dailyDistributionRatePct(
  dailyDistribution: number,
  circulatingSupply: number,
): number {
  if (!(circulatingSupply > 0) || !Number.isFinite(dailyDistribution)) {
    return 0;
  }
  return round((dailyDistribution / circulatingSupply) * 100, 4);
}

/** Annualizes a daily issuance/circulating-supply ratio into basis points. */
export function annualizeDailyRateBps(
  dailyDistribution: number,
  circulatingSupply: number,
): number {
  if (!(circulatingSupply > 0) || !Number.isFinite(dailyDistribution)) {
    return 0;
  }
  return round(
    (dailyDistribution / circulatingSupply) * BPS_DENOMINATOR * DAYS_PER_YEAR,
    2,
  );
}

/**
 * Annualizes observed circulating-supply growth between two snapshots.
 * Returns null when the window is unusable (no growth data, zero base, or
 * non-positive elapsed days) so callers can fall back to issuance-based
 * inflation instead of reporting a bogus rate.
 */
export function observedAnnualInflationBps(
  currentCirculating: number,
  previousCirculating: number,
  elapsedDays: number,
): number | null {
  if (
    !(previousCirculating > 0) ||
    !(elapsedDays > 0) ||
    !Number.isFinite(currentCirculating)
  ) {
    return null;
  }
  const growth = (currentCirculating - previousCirculating) / previousCirculating;
  return round(growth * BPS_DENOMINATOR * (DAYS_PER_YEAR / elapsedDays), 2);
}

export function isInflationWithinTarget(
  annualInflationBps: number,
  target: InflationTarget,
): boolean {
  return (
    annualInflationBps >= target.targetAnnualBps - target.toleranceBps &&
    annualInflationBps <= target.targetAnnualBps + target.toleranceBps
  );
}

/**
 * Suggests a multiplier to apply to current reward rates.
 *
 * When daily distribution is above the alert threshold, emissions are scaled
 * down so the rate lands on the threshold. Below the threshold the rate is
 * left unchanged (1.0) rather than inflated speculatively. The result is
 * always clamped to the configured bounds.
 */
export function suggestRewardMultiplier(
  distributionRatePct: number,
  dailyAlertPct: number,
  bounds: RewardAdjustmentBounds,
): number {
  if (!(dailyAlertPct > 0) || !(distributionRatePct > 0)) {
    return 1;
  }
  if (distributionRatePct <= dailyAlertPct) {
    return 1;
  }
  const raw = dailyAlertPct / distributionRatePct;
  return round(Math.min(Math.max(raw, bounds.minMultiplier), bounds.maxMultiplier), 4);
}

/** Runs the full health check and produces operator-facing messages. */
export function evaluateEconomy(input: EconomyEvaluationInput): EconomyEvaluation {
  const distributionRatePct = dailyDistributionRatePct(
    input.dailyDistribution,
    input.circulatingSupply,
  );
  const annualInflationBps =
    input.observedAnnualInflationBps ??
    annualizeDailyRateBps(input.dailyDistribution, input.circulatingSupply);

  const alerts: string[] = [];
  const recommendations: string[] = [];

  if (!(input.circulatingSupply > 0)) {
    alerts.push('Circulating supply is not available; distribution rate is unknown.');
  }

  if (input.circulatingSupply > input.totalSupply) {
    alerts.push(
      `Circulating supply (${input.circulatingSupply}) exceeds total supply (${input.totalSupply}).`,
    );
  }

  const distributionAlert =
    input.circulatingSupply > 0 && distributionRatePct > input.dailyAlertPct;

  if (distributionAlert) {
    alerts.push(
      `Daily distribution ${distributionRatePct}% of circulating supply exceeds the ${input.dailyAlertPct}% alert threshold.`,
    );
  }

  const inflationWithinTarget = isInflationWithinTarget(
    annualInflationBps,
    input.inflation,
  );
  const targetLow = input.inflation.targetAnnualBps - input.inflation.toleranceBps;
  const targetHigh = input.inflation.targetAnnualBps + input.inflation.toleranceBps;

  if (!inflationWithinTarget && input.circulatingSupply > 0) {
    if (annualInflationBps > targetHigh) {
      alerts.push(
        `Annualized inflation ${annualInflationBps} bps is above the ${targetLow}-${targetHigh} bps target band.`,
      );
    } else {
      alerts.push(
        `Annualized inflation ${annualInflationBps} bps is below the ${targetLow}-${targetHigh} bps target band.`,
      );
    }
  }

  const suggestedRewardMultiplier = suggestRewardMultiplier(
    distributionRatePct,
    input.dailyAlertPct,
    input.bounds,
  );

  if (distributionAlert) {
    recommendations.push(
      `Reduce reward rates to ${suggestedRewardMultiplier}x of current values to bring daily distribution back to ${input.dailyAlertPct}%.`,
    );
  }

  if (annualInflationBps > targetHigh) {
    recommendations.push(
      'Inflation is above target: tighten reward issuance and/or add token sinks before raising earn rates.',
    );
  } else if (annualInflationBps < targetLow && input.circulatingSupply > 0) {
    recommendations.push(
      'Inflation is below target: consider increasing utility or earn incentives while monitoring distribution.',
    );
  }

  if (!distributionAlert && inflationWithinTarget) {
    recommendations.push('Economy metrics are within their configured target ranges; no action needed.');
  }

  return {
    circulatingSupply: input.circulatingSupply,
    totalSupply: input.totalSupply,
    dailyDistribution: input.dailyDistribution,
    dailyDistributionRatePct: distributionRatePct,
    annualInflationBps,
    inflationWithinTarget,
    distributionAlert,
    suggestedRewardMultiplier,
    alerts,
    recommendations,
  };
}
