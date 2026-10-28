// The legacy pipeline fixtures exercise peak-entry mode and allow held bags.
 // The production default remains realized profit with sell-required enabled;
 // realized ledger behavior has dedicated regression coverage.
process.env.WIN_MODE ??= 'peak';
process.env.WIN_REQUIRE_SELL ??= '0';
