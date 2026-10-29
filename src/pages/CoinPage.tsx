import { Link, useParams } from 'react-router-dom';
import { fmtMult, fmtPct, fmtSol, fmtUsd, isSolAddress, shortAddr, winSol, lossSolText } from '../../shared/format';
import CandleChart from '../components/CandleChart';
import WalletCheckBox from '../components/WalletCheckBox';
import { useCoin } from '../lib/api';
import { pumpUrl } from '../lib/config';
import { play } from '../lib/sfx';
import { copyText } from '../lib/share';
import { ago } from '../lib/time';
import { useState } from 'react';
import { CheckIcon, CopyIcon, ExternalIcon } from '../components/Icons';

export default function CoinPage() {
  const { mint = '' } = useParams();
  const valid = isSolAddress(mint);
  const { data, error } = useCoin(valid ? mint : '');
  const [copied, setCopied] = useState(false);

  if (!valid) {
    return (
      <section className="section">
        <div className="wrap narrow">
          <h2>Invalid coin</h2>
          <p className="dim">That does not look like a coin address.</p>
          <Link className="btn btn-primary" to="/coins">
            All coins
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className="section">
      <div className="wrap">
        <Link to="/coins" className="back mono small">
          ← all coins
        </Link>
        {error && <div className="panel empty err">{error}</div>}
        {!data && !error && (
          <div className="panel">
            <div className="skel tall" />
          </div>
        )}
        {data && (
          <>
            <div className="coin-head">
              <div>
                <div className="eyebrow mono">MIGRATED {ago(data.coin.mig).toUpperCase()}</div>
                <h2>${data.coin.symbol.toUpperCase()}</h2>
              </div>
              <div className="coin-actions">
                <button
                  className="btn small-btn"
                  onClick={async () => {
                    if (await copyText(mint)) {
                      play('copy');
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }
                  }}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />} {shortAddr(mint)}
                </button>
                <a className="btn small-btn" href={pumpUrl(mint)} target="_blank" rel="noopener noreferrer">
                  pump.fun <ExternalIcon />
                </a>
                <a className="btn small-btn" href={`https://solscan.io/token/${mint}`} target="_blank" rel="noopener noreferrer">
                  Solscan <ExternalIcon />
                </a>
              </div>
            </div>

            <div className="stats stats-3">
              <div className="stat">
                <span className="stat-k mono">Peak market cap</span>
                <b className="stat-v mono">{fmtUsd(data.coin.peakMcUsd)}</b>
              </div>
              <div className="stat">
                <span className="stat-k mono">Qualifying early wallets</span>
                <b className="stat-v mono win">{data.coin.wCount}</b>
              </div>
              <div className="stat">
                <span className="stat-k mono">Qualifying losses</span>
                <b className="stat-v mono loss">{data.coin.lCount}</b>
              </div>
            </div>

            <div className="panel chart-panel">
              <div className="panel-bar">
                <span className="live">
                  <i /> {data.coin.final ? 'FINAL' : 'LIVE'}
                </span>
                <span className="dim mono small">market cap · {data.coin.trades.toLocaleString('en-US')} trades read</span>
              </div>
              <CandleChart mint={mint} />
            </div>

            <div className="two coin-cols">
              <div className="panel">
                <div className="admin-h">
                  <h4 className="win">Earliest entries</h4>
                </div>
                {data.winners.length === 0 && <p className="dim small pad">No qualifying early buys on this coin.</p>}
                {data.winners.map((r, i) => (
                  <Link to={`/w/${r.wallet}`} className="arow link" key={r.wallet}>
                    <span className="mono rk">{i + 1}</span>
                    <div className="who">
                      <span className="mono addr-line">{shortAddr(r.wallet)}</span>
                      <span className="dim small mono">
                        {fmtUsd(r.entryMcUsd)} → {r.realized ? 'sold ' : ''}{fmtUsd(r.peakMcUsd)} · <span className={winSol(r).cls}>{winSol(r).text}</span>
                      </span>
                    </div>
                    <span className="mono sol win">
                      {fmtMult(r.mult)}
                      {r.onBoard && <i className="chk" title="On the verified board" />}
                    </span>
                  </Link>
                ))}
              </div>
              <div className="panel">
                <div className="admin-h">
                  <h4 className="loss">Biggest losses</h4>
                </div>
                {data.losers.length === 0 && <p className="dim small pad">No qualifying losses on this coin.</p>}
                {data.losers.map((r, i) => (
                  <Link to={`/w/${r.wallet}`} className="arow link" key={r.wallet}>
                    <span className="mono rk">{i + 1}</span>
                    <div className="who">
                      <span className="mono addr-line">{shortAddr(r.wallet)}</span>
                      <span className="dim small mono">
                        {fmtUsd(r.buyMcUsd)} → {fmtUsd(r.sellMcUsd)} · {lossSolText(r)}
                      </span>
                    </div>
                    <span className="mono sol loss">
                      -{fmtPct(r.lossPct)}
                      {r.onBoard && <i className="chk" title="On the verified board" />}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            <p className="dim small foot-note">A check mark means the wallet passed the funding checks and is on the day board. Other rows are still ranked by raw trades.</p>
          </>
        )}
        {mint && <WalletCheckBox mint={mint} />}
      </div>
    </section>
  );
}