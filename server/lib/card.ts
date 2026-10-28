import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { fmtMult, fmtPct, fmtPnl, fmtSol, fmtUsd, shortAddr } from '../../shared/format';
import { ShareCard } from '../../shared/types';
import { displayB64, monoB64, wasmB64 } from './assets.generated';
import { getEnv } from './env';

const host = () => (getEnv('SITE_URL') || 'https://early.fun').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
const payoutsLive = () => getEnv('VITE_PAYOUTS_LIVE') === '1';

const W = 1200;
const H = 630;
const ACCENT = '#8B5CFF';
const GREEN = '#3DFFA2';
const RED = '#FF4D6A';
const INK = '#F4F3FF';
const MUTE = '#8C8AA8';

let ready: Promise<void> | null = null;
function init(): Promise<void> {
  if (!ready) ready = initWasm(Buffer.from(wasmB64, 'base64')).catch((e) => {
    ready = null;
    // initWasm throws if already initialised, which is fine
    if (!String(e?.message || e).includes('Already initialized')) throw e;
  });
  return ready;
}

const fonts = () => [
  { name: 'Display', data: Buffer.from(displayB64, 'base64'), weight: 800 as const, style: 'normal' as const },
  { name: 'Mono', data: Buffer.from(monoB64, 'base64'), weight: 700 as const, style: 'normal' as const },
];

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const h = (style: Record<string, unknown>, children?: unknown, type = 'div'): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children },
});

function frame(inner: Node[], dateLabel: string, tint: string): Node {
  return h(
    {
      width: W,
      height: H,
      flexDirection: 'column',
      backgroundColor: '#07070D',
      backgroundImage: `radial-gradient(circle at 88% 8%, ${tint}55 0%, #07070D00 46%), radial-gradient(circle at 0% 100%, ${ACCENT}22 0%, #07070D00 40%)`,
      padding: 28,
      fontFamily: 'Display',
    },
    [
      h(
        {
          flex: 1,
          flexDirection: 'column',
          border: '2px solid #2A2A44',
          borderRadius: 28,
          padding: '40px 52px',
          justifyContent: 'space-between',
        },
        [
          h({ justifyContent: 'space-between', alignItems: 'center' }, [
            h({ fontSize: 34, color: ACCENT, letterSpacing: -0.5 }, 'EARLY.FUN'),
            h({ fontFamily: 'Mono', fontSize: 24, color: MUTE }, dateLabel),
          ]),
          ...inner,
        ]
      ),
    ]
  );
}

function stat(label: string, value: string, color = INK): Node {
  return h({ flexDirection: 'column', gap: 6 }, [
    h({ fontFamily: 'Mono', fontSize: 22, color: MUTE, letterSpacing: 2 }, label),
    h({ fontFamily: 'Mono', fontSize: 52, color }, value),
  ]);
}

function dateLabel(day: string): string {
  const d = new Date(day + 'T00:00:00Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
}

export function cardTree(card: ShareCard): Node {
  if (card.type === 'win' && card.win) {
    const w = card.win;
    return frame(
      [
        h({ flexDirection: 'column', gap: 4 }, [
          h({ fontSize: 40, color: MUTE }, 'I WAS EARLY ON'),
          h({ fontSize: 132, color: INK, letterSpacing: -4, lineHeight: 1 }, '$' + w.symbol.toUpperCase()),
        ]),
        h({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
          h({ gap: 56 }, [stat('BOUGHT AT', fmtUsd(w.entryMcUsd)), stat(w.realized ? 'SOLD AT' : 'IT HIT', fmtUsd(w.peakMcUsd), GREEN)]),
          h({ flexDirection: 'column', alignItems: 'flex-end' }, [
            h({ fontFamily: 'Mono', fontSize: 22, color: MUTE, letterSpacing: 2 }, w.realized ? 'REALIZED' : 'MULTIPLE'),
            h({ fontFamily: 'Mono', fontSize: 120, color: GREEN, lineHeight: 1 }, fmtMult(w.mult)),
          ]),
        ]),
        ...(w.inSol !== undefined
          ? [
              h({ fontFamily: 'Mono', fontSize: 30, gap: 18 }, [
                ...(w.pnlSol !== undefined ? [h({ color: w.pnlSol >= 0 ? GREEN : RED }, fmtPnl(w.pnlSol))] : []),
                h({ color: MUTE }, `spent ${fmtSol(w.inSol)} SOL -> sold for ${fmtSol(w.outSol || 0)} SOL`),
              ]),
            ]
          : w.pnlSol !== undefined
            ? [h({ fontFamily: 'Mono', fontSize: 30, color: w.pnlSol >= 0 ? GREEN : RED }, fmtPnl(w.pnlSol) + ' profit')]
            : []),
        h({ justifyContent: 'space-between', fontFamily: 'Mono', fontSize: 24, color: MUTE }, [
          h({}, shortAddr(w.wallet)),
          h({}, 'prove yours at ' + host()),
        ]),
      ],
      dateLabel(w.day),
      GREEN
    );
  }
  const l = card.loss!;
  return frame(
    [
      h({ flexDirection: 'column', gap: 4 }, [
        h({ fontSize: 40, color: MUTE }, 'I GOT REKT ON'),
        h({ fontSize: 132, color: INK, letterSpacing: -4, lineHeight: 1 }, '$' + l.symbol.toUpperCase()),
      ]),
      h({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
        h({ gap: 56 }, [stat('BOUGHT AT', fmtUsd(l.buyMcUsd)), stat('SOLD AT', fmtUsd(l.sellMcUsd), RED)]),
        h({ flexDirection: 'column', alignItems: 'flex-end' }, [
          h({ fontFamily: 'Mono', fontSize: 22, color: MUTE, letterSpacing: 2 }, 'REALIZED'),
          h({ fontFamily: 'Mono', fontSize: 120, color: RED, lineHeight: 1 }, '-' + fmtPct(l.lossPct)),
        ]),
      ]),
      h({ fontFamily: 'Mono', fontSize: 30, gap: 18 }, [
        h({ color: RED }, '-' + fmtSol(l.lossSol) + ' SOL'),
        h({ color: MUTE }, `spent ${fmtSol(l.buySol)} SOL -> sold for ${fmtSol(l.sellSol)} SOL`),
      ]),
      h({ justifyContent: 'space-between', fontFamily: 'Mono', fontSize: 24, color: MUTE }, [
        h({}, shortAddr(l.wallet)),
        h({}, 'the L\'s count too at ' + host()),
      ]),
    ],
    dateLabel(l.day),
    RED
  );
}

export function ogTree(): Node {
  return frame(
    [
      h({ flexDirection: 'column', gap: 8 }, [
        h({ fontSize: 60, color: MUTE }, 'EVERYONE SAYS'),
        h({ fontSize: 150, color: INK, letterSpacing: -5, lineHeight: 1 }, 'I WAS EARLY'),
        h({ fontSize: 60, color: ACCENT }, 'NOW PROVE IT ON CHAIN'),
      ]),
      h({ justifyContent: 'space-between', fontFamily: 'Mono', fontSize: 26, color: MUTE }, [
        h({}, payoutsLive() ? 'winners and biggest losers share the daily rewards' : 'winners and biggest losers, ranked daily'),
        h({}, 'paste a wallet'),
      ]),
    ],
    'DAILY BOARD',
    ACCENT
  );
}

async function toPng(tree: Node): Promise<Buffer> {
  await init();
  const svg = await satori(tree as any, { width: W, height: H, fonts: fonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  return Buffer.from(png);
}

export const renderCard = (card: ShareCard) => toPng(cardTree(card));
export const renderOg = () => toPng(ogTree());