import { Link } from 'react-router-dom';
import { LOSERS_PCT, PAYOUTS_LIVE, SITE_NAME, WINNERS_PCT, X_URL } from '../lib/config';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap foot-grid">
        <div>
          <b className="foot-brand">{SITE_NAME}</b>
          <p>
            Reads public on chain data only. No wallet connect, no signing, we never ask for keys.
            {PAYOUTS_LIVE ? ` Creator rewards are split ${WINNERS_PCT}/${LOSERS_PCT} between winners and losers, paid to the wallet that made the trade.` : ''}
          </p>
          <p className="dim">Not financial advice. Boards can lag the chain by several minutes and entries can be removed if they fail checks.</p>
        </div>
        <div className="foot-links">
          <Link to="/">Boards</Link>
          <Link to="/coins">Coins</Link>
          <Link to="/rewards">Rewards</Link>
          <Link to="/records">Records</Link>
          <Link to="/duel">Duel</Link>
          <a href={X_URL} target="_blank" rel="noopener noreferrer">
            X
          </a>
        </div>
      </div>
    </footer>
  );
}