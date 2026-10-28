import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { SITE_NAME, TOKEN_CA, X_URL } from '../lib/config';
import { play } from '../lib/sfx';
import { copyText } from '../lib/share';
import { CheckIcon, CopyIcon, XIcon } from './Icons';
import Logo from './Logo';
import SoundToggle from './SoundToggle';

const NAV = [
  { to: '/', label: 'Boards', end: true },
  { to: '/coins', label: 'Coins' },
  { to: '/rewards', label: 'Rewards' },
  { to: '/records', label: 'Records' },
  { to: '/duel', label: 'Duel' },
];

export default function Header() {
  const [copied, setCopied] = useState(false);
  const hasCa = TOKEN_CA.length > 0;
  const onCopy = async () => {
    if (!hasCa) return;
    if (await copyText(TOKEN_CA)) {
      play('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <header className="header">
      <div className="wrap header-in">
        <Link to="/" className="brand" aria-label={SITE_NAME + ' home'}>
          <Logo />
          <span>{SITE_NAME}</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')} onClick={() => play('tab')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-r">
          <button className={'ca' + (hasCa ? '' : ' ca-off')} onClick={onCopy} disabled={!hasCa} title={hasCa ? 'Copy contract address' : 'Contract address coming soon'}>
            <span className="ca-l">CA</span>
            <span className="mono ca-v">{hasCa ? `${TOKEN_CA.slice(0, 4)}...${TOKEN_CA.slice(-4)}` : 'soon'}</span>
            {hasCa && (copied ? <CheckIcon /> : <CopyIcon />)}
          </button>
          <SoundToggle />
          <a className="icon-btn" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X">
            <XIcon />
          </a>
        </div>
      </div>
    </header>
  );
}