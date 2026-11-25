# Token Economy Balancing Service

NestJS module that monitors the health of the StellarHunts points/token economy:
circulating supply, daily reward issuance, annualized inflation, threshold
alerts, reward-rate suggestions, and historical data export.

All code lives under `stellar-extensions/` and does not modify the core backend.

## Layout

```
backend/
├── config/economy.config.json          # supply targets, inflation band, alert threshold
└── src/economy/
    ├── economy.module.ts               # TypeORM wiring + config provider
    ├── economy.controller.ts           # admin-protected REST routes
    ├── economy.service.ts              # persistence + health orchestration
    ├── economy.calculator.ts           # pure economic math (no framework deps)
    ├── economy.config.ts               # typed config loader + DI token
    ├── dto/economy.dto.ts              # validated request shapes
    ├── entities/
    │   ├── economy-snapshot.entity.ts  # daily circulating/total supply
    │   └── reward-distribution.entity.ts
    ├── economy.calculator.spec.ts
    └── economy.service.spec.ts
```

## Metrics

| Metric | Formula |
| --- | --- |
| Daily distribution rate | `dailyDistribution / circulatingSupply * 100` |
| Inflation (observed) | Annualized circulating-supply growth between the first and last snapshot in the window |
| Inflation (fallback) | `dailyDistribution / circulatingSupply * 10000 * 365` bps |
| Suggested multiplier | `dailyAlertPct / distributionRatePct`, clamped to the configured bounds and `1.0` when no cut is needed |

An alert is raised when the daily distribution rate exceeds
`distribution.dailyAlertPct`, when annualized inflation leaves
`targetAnnualBps ± toleranceBps`, or when circulating supply exceeds total
supply. The service never divides by zero: a missing supply snapshot surfaces as
a `404`, and a zero supply is reported as an alert.

## Configuration

`config/economy.config.json`:

```json
{
  "supply": { "totalSupply": 100000000, "initialCirculatingSupply": 40000000 },
  "inflation": { "targetAnnualBps": 500, "toleranceBps": 200, "historyWindowDays": 30 },
  "distribution": { "dailyAlertPct": 1.0 },
  "rewardAdjustment": { "minMultiplier": 0.5, "maxMultiplier": 2.0 }
}
```

The same finance inputs as `backend/config/economy.config.json` are reused for
concepts that overlap (reward categories); this file adds the monitoring targets
that the core config does not carry.

## API

All routes are under `/api/v1/economy` and require an admin JWT
(`JwtAuthGuard` + `RolesGuard`).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health?date=YYYY-MM-DD` | Supply, daily rate, inflation, alerts, suggestions |
| `GET` | `/adjustment?date=YYYY-MM-DD` | Suggested reward multiplier with a reason |
| `GET` | `/history?from=&to=` | Merged daily supply + issuance history |
| `GET` | `/export?from=&to=&format=csv\|json` | Downloadable history (default `json`) |
| `POST` | `/distributions` | Record a reward payout |
| `POST` | `/snapshots` | Record a day's supply figures |

Record a payout:

```http
POST /api/v1/economy/distributions
{
  "amount": 35,
  "category": "puzzle",
  "recipient": "G...",
  "distributionDate": "2026-11-22"
}
```

Record a supply snapshot (one per UTC day; overwriting returns `409`):

```http
POST /api/v1/economy/snapshots
{
  "circulatingSupply": 40000000,
  "totalSupply": 100000000
}
```

Health response (abridged):

```json
{
  "date": "2026-11-22",
  "circulatingSupply": 40000000,
  "totalSupply": 100000000,
  "dailyDistribution": 5000,
  "dailyDistributionRatePct": 0.0125,
  "annualInflationBps": 456.25,
  "inflationWithinTarget": true,
  "distributionAlert": false,
  "suggestedRewardMultiplier": 1,
  "alerts": [],
  "recommendations": ["Economy metrics are within their configured target ranges; no action needed."]
}
```

CSV export columns:
`date,circulating_supply,total_supply,daily_distribution,distribution_rate_pct`.

## Integration

Import `EconomyModule` into an application that already configures TypeORM:

```ts
import { EconomyModule } from './economy/economy.module';

@Module({ imports: [/* TypeOrmModule.forRoot(...) */ EconomyModule] })
export class AppModule {}
```

Persistence uses the `economy_snapshots` and `reward_distributions` tables
discovered through `autoLoadEntities`; add migrations when promoting the module
into the core backend.

## Tests

```bash
cd stellar-extensions/backend
../../node_modules/.bin/jest --config jest.config.js src/economy
```

`economy.calculator.spec.ts` covers the math directly (17 tests);
`economy.service.spec.ts` covers persistence orchestration, alerting, suggestion,
history merging, and CSV/JSON export with mocked repositories (18 tests).
