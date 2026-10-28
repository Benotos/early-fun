// The legacy end-to-end fixtures exercise peak-entry ranking with held bags.
// They deliberately use tiny synthetic coins, so disable production size and fee
// gates here; this does not alter the production environment or thresholds.
process.env.WIN_MODE ??= 'peak';
process.env.WIN_REQUIRE_SELL ??= '0';
process.env.MIN_COIN_WALLETS ??= '1';
process.env.MIN_COIN_TRADES ??= '1';
process.env.MIN_GLOBAL_FEES_SOL ??= '0';
