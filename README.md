# EARLY.FUN v1

## Deploy
1. Vercel: import the project, framework Vite. Build command `npm run build` (already the default).
2. Add the Upstash Redis integration in Vercel Storage. Any env prefix works.
3. Add env vars (see `.env.example`): `HELIUS_API_KEY` (Developer plan), `ADMIN_KEY`, `CRON_SECRET`, `SITE_URL`, `VITE_TOKEN_CA`, `VITE_X_URL`.
4. Redeploy, open `/api/health`. Both `db` and `rpc` must say ok.
5. Start the scanner (pick one, both free):
   - cron-job.org: new job, GET `https://YOURSITE/api/scan?secret=CRON_SECRET`, every 1 minute. Recommended.
   - GitHub Actions: `.github/workflows/scan.yml`, add the 3 repo secrets.
6. Boards fill in 5 to 15 minutes. Backfill covers yesterday and today.

## Check the live data once
`cp .env.example .env`, fill `HELIUS_API_KEY`, then `npm run probe`. It pulls the latest migration, parses the curve and pool trades and prints them. If the numbers look sane the parser is good.

## Admin
`/admin?key=ADMIN_KEY` then enter the pool in SOL. Pay only when the banner says FINAL (after 00:00 UTC plus about 10 minutes). Payouts go to the trading wallet shown.

## Reward wording
The site makes no payout promises. Set `VITE_PAYOUTS_LIVE=1` only once Trencher is funding payouts.

## Offline switch
`npm run offline` then deploy (maintenance page on every route). `npm run online` then deploy to restore.
Without npm: replace `vercel.json` content with `vercel.offline.json` content.

## Scoring
- Winners: `peak market cap after your buy / market cap at your buy`. Best entry per wallet per day.
- Losers: `buy cost minus sell proceeds` in SOL, fully exited coins only. Ranked by SOL lost.
- Board day = UTC day the coin migrated. Peak and sells are measured until 00:00 UTC.
- Tunables in env: `MIN_BUY_SOL`, `SKIP_SLOTS`, `MIN_MULT`, `MIN_LOSS_SOL`, `MIN_HOLD_SECONDS`, `LOSS_CAP_PCT`, `PAYOUT_WEIGHTS`, `WINNERS_SHARE`, `BOARD_SIZE`.

## Anti abuse
Creation window skipped (12 slots), dev excluded, wallets funded by the dev excluded (2 hop trace), minimum buy, sniper wallets excluded from losers, minimum hold 5 minutes, loser payout capped at 25% of the loss, wallets that share a funder collapse to the best one (exchange style hub funders are ignored), failed funding lookups never put a wallet on the board.

## Layout
`server/` API source and scanner, bundled by `scripts/build-api.mjs` into one CommonJS file per route in `api/`. Clients only read cached snapshots, never the RPC or Redis.
`npm test` runs 22 tests. `npm run dev:mock` runs the whole site on a fake seeded chain at localhost:3001 (admin key `dev-admin`).
