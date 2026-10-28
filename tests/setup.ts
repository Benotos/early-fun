// Most historical end-to-end fixtures assert peak-entry ranking. The production
// default remains realized profit; tests for realized accounting exercise that
// ledger directly and can explicitly override WIN_MODE when checking scoring.
process.env.WIN_MODE ??= 'peak';
