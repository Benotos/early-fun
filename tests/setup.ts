// The legacy end-to-end fixtures exercise peak-entry ranking with held bags.
// They deliberately use tiny synthetic coins, so disable production size and fee
// gates and scanner backoff in tests only. Production settings remain unchanged.
process.env.WIN_MODE ??= 'peak';
process.env.WIN_REQUIRE_SELL ??= '0';
process.env.MIN_COIN_WALLETS ??= '1';
process.env.MIN_COIN_TRADES ??= '1';
process.env.MIN_GLOBAL_FEES_SOL ??= '0';
process.env.MAX_PER_COIN ??= '0';
process.env.RESCAN_BACKOFF ??= '0';
