import { NavLink } from 'react-router-dom';
import { play } from '../lib/sfx';
import { CoinsIcon, DuelIcon, GiftIcon, HomeIcon, TrophyIcon } from './Icons';

const ITEMS = [
  { to: '/', label: 'Boards', icon: <HomeIcon />, end: true },
  { to: '/coins', label: 'Coins', icon: <CoinsIcon /> },
  { to: '/rewards', label: 'Rewards', icon: <GiftIcon /> },
  { to: '/records', label: 'Records', icon: <TrophyIcon /> },
  { to: '/duel', label: 'Duel', icon: <DuelIcon /> },
];

export default function MobileNav() {
  return (
    <nav className="mnav" aria-label="Main">
      {ITEMS.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} onClick={() => play('tab')} className={({ isActive }) => 'mnav-i' + (isActive ? ' on' : '')}>
          {i.icon}
          <span>{i.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}