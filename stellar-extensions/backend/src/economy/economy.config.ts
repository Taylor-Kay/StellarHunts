import config from '../../config/economy.config.json';

export interface EconomySettings {
  supply: {
    totalSupply: number;
    initialCirculatingSupply: number;
  };
  inflation: {
    targetAnnualBps: number;
    toleranceBps: number;
    historyWindowDays: number;
  };
  distribution: {
    dailyAlertPct: number;
  };
  rewardAdjustment: {
    minMultiplier: number;
    maxMultiplier: number;
  };
}

export const ECONOMY_CONFIG = Symbol('ECONOMY_CONFIG');

export const economySettings: EconomySettings = config;
