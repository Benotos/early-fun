import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtMult, fmtSol, shortAddr, fmtUsd } from '../../shared/format';
import Board from '../components/Board';
import CoinCard from '../components/CoinCard';
import HeroStack from '../components/HeroStack';
import MyStanding from '../components/MyStanding';
import PasteBox from '../components/PasteBox';
import StatStrip from '../components/StatStrip';
import { LOSERS_PCT, PAYOUTS_LIVE, WINNERS_PCT } from '../lib/config';
import { usePointerGlow } from '../lib/fx';
import { usePulse } from '../lib/pulse';
import { play } from '../lib/sfx';

const STEPS = [
  { n: '01', t: 'Paste a wallet', d: 'Any Solana address. No connect, no signature. Rewards can only ever go to the wallet that made the trade.' },
  { n: '02', t: 'We scan the chain', d: 'Every pump.fun coin that migrates is tracked automatically. Just trade like normal and you show up.' },
  { n: '03', t: 'Winners', d: 'Ranked by realized profit: what you sold for against what you paid. You have to actually sell to count.' },
  { n: '04', t: 'Losers', d: 'Biggest verified realized losses of the day: a real buy, a real sell, a real L.' },
];

const RULES = [
  'Coins count once they migrate from the bonding curve',
  'Buys in the creation block and the first seconds are ignored',
  'The dev wallet and wallets funded by the dev are excluded',
  'Minimum buy of 0.1 SOL, coins you created never count',
  'Winners must have sold at least part of their bag, holding alone does not count',
  'One best entry per wallet per day on each board',
  'Losses need a full exit and a real hold time, so dumping to farm the board does not work',
  'Wallets that share a funder collapse into the best one',
  'Boards reset at 00:00 UTC',
];

const FAQ = [
  ['Do I need to connect my wallet?', 'No. Paste any address. We only read public on chain data and never ask for a signature.'],
  ['Can someone claim my wallet?', 'No. Pasting an address only shows its stats. Anything tied to a trade goes to the wallet that made it.'],
  ['How are winners ranked?', 'By SOL profit you actually took: sell value minus the cost of what you sold. The x is your average sell price against your average buy price. Holding a bag does not count until you sell.'],
  ['Why is my buy missing?', 'It may be in the first seconds after launch, under 0.1 SOL, funded by the dev, or the coin has not migrated yet. Boards refresh every few minutes.'],
  ['How do losses count?', 'A real buy and a full sell with a minimum hold time. The loss is SOL spent minus SOL received.'],
  ['When do boards reset?', 'Every day at 00:00 UTC. Yesterday stays visible as a final board.'],
];

export default function Home() {
  const glow = usePointerGlow<HTMLElement>();
  const { data } = usePulse();
  const hot = (data?.coins || []).filter((c) => c.topMult >= 2).slice(0, 6);
  const rec = data?.records;
  const [open, setOpen] = useState<number | null>(0);
  return (
    <>
      <section className="hero" ref={glow.ref} onPointerMove={glow.onPointerMove}>
        <div className="wrap hero-grid">
          <div className="hero-l">
            <div className="eyebrow mono">PUMP.FUN · ON CHAIN · DAILY</div>
            <h1>
              I was <span className="grad">early.</span>
            </h1>
            <p className="lede">
              Everyone in the trenches says it. Paste your wallet and we check the chain: your earliest buys on coins that ran, and your biggest losses.
            </p>
            <PasteBox />
            {PAYOUTS_LIVE && (
              <div className="reward-pill">
                <span className="rp-k mono">CREATOR REWARDS</span>
                <span>
                  Split every day: <b className="win">{WINNERS_PCT}%</b> to the earliest winners, <b className="loss">{LOSERS_PCT}%</b> to the biggest Ls.
                </span>
              </div>
            )}
          </div>
          <HeroStack />
        </div>
        <div className="wrap">
          <StatStrip />
          <MyStanding />
        </div>
      </section>

      <Board />

      {hot.length > 0 && (
        <section className="section tight">
          <div className="wrap">
            <div className="sec-head">
              <h2>Hot coins</h2>
              <Link to="/coins" className="more-link" onClick={() => play('tab')}>
                All coins →
              </Link>
            </div>
            <div className="coin-grid">
              {hot.map((c) => (
                <CoinCard key={c.mint} c={c} />
              ))}
            </div>
          </div>
        </section>
      )}

      {rec && (rec.win.length > 0 || rec.loss.length > 0) && (
        <section className="section tight">
          <div className="wrap">
            <div className="sec-head">
              <h2>Hall of fame</h2>
              <Link to="/records" className="more-link" onClick={() => play('tab')}>
                All records →
              </Link>
            </div>
            <div className="rec-teaser">
              {rec.win[0] && (
                <Link to={`/w/${rec.win[0].wallet}`} className="rec win">
                  <span className="mono small dim">BEST ENTRY EVER</span>
                  <b className="mono">{fmtMult(rec.win[0].mult)}</b>
                  <span className="mono dim">
                    ${rec.win[0].symbol.toUpperCase()} · {fmtUsd(rec.win[0].entryMcUsd)} → {fmtUsd(rec.win[0].peakMcUsd)} · {shortAddr(rec.win[0].wallet)}
                  </span>
                </Link>
              )}
              {rec.loss[0] && (
                <Link to={`/w/${rec.loss[0].wallet}`} className="rec loss">
                  <span className="mono small dim">BIGGEST L EVER</span>
                  <b className="mono">-{fmtSol(rec.loss[0].lossSol)} SOL</b>
                  <span className="mono dim">
                    ${rec.loss[0].symbol.toUpperCase()} · {fmtUsd(rec.loss[0].buyMcUsd)} → {fmtUsd(rec.loss[0].sellMcUsd)} · {shortAddr(rec.loss[0].wallet)}
                  </span>
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      <section id="how" className="section">
        <div className="wrap">
          <h2>How it works</h2>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <span className="mono step-n">{s.n}</span>
                <h4>{s.t}</h4>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
          <div className="two">
            <div className="panel rules">
              <h4>What counts</h4>
              <ul>
                {RULES.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {PAYOUTS_LIVE && <p className="dim small">Creator rewards are split every day: {WINNERS_PCT}% to the top winners and {LOSERS_PCT}% to the biggest losers, paid to the wallet that made the trade.</p>}
            </div>
            <div className="panel faq">
              <h4>FAQ</h4>
              {FAQ.map(([q, a], i) => (
                <div className={'faq-i' + (open === i ? ' on' : '')} key={q}>
                  <button
                    onClick={() => {
                      play('click');
                      setOpen(open === i ? null : i);
                    }}
                    aria-expanded={open === i}
                  >
                    <span>{q}</span>
                    <i aria-hidden="true" />
                  </button>
                  {open === i && <p>{a}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}