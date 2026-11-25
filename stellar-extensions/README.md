# StellarHunts extensions

Optional, self-contained extensions that build on StellarHunts without modifying
the core `frontend/`, `backend/`, `onchain/` or `docs/` trees.

Backend extensions live under `backend/src/<feature>` and share
`backend/tsconfig.json` plus `backend/jest.config.js`, which resolve their
dependencies from the main `backend/node_modules`. Each feature folder keeps its
own tests next to the implementation.

| Folder | Purpose |
| --- | --- |
| `backend/src/ws-auth/` | WebSocket connection auth guard: JWT / session token validation, token refresh, per-IP rate limiting, audit logging, expiry disconnect. |
| `backend/src/puzzle-collaboration/` | Collaborative puzzle sections, comments and locks. |
| `backend/src/puzzle-difficulty-auto-adjustment/` | Automatic puzzle difficulty analysis. |
| `backend/src/puzzle-submission-throttle/` | Submission throttling guard and interceptor. |
| `backend/src/puzzle-version-comparison/` | Puzzle version comparison and history. |
| `backend/src/maintenance-mode/` | Maintenance-mode HTTP guard. |

## JudeDaniel6 — Issues #931, #945, #953, #969

| Issue | Description | Path |
|-------|-------------|------|
| #931  | Puzzle Tagging System Module | `backend/puzzle-tagging/` |
| #945  | Game Season Management Module | `backend/game-season/` |
| #953  | Puzzle Cache Invalidation Service | `backend/puzzle-cache/` |
| #969  | Puzzle Referral Tracking Contract | `onchain/puzzle-referral/` |
