import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Footer from './components/Footer';
import Header from './components/Header';
import MobileNav from './components/MobileNav';
import Ticker from './components/Ticker';
import { PulseProvider } from './lib/pulse';
import Admin from './pages/Admin';
import CoinPage from './pages/CoinPage';
import Coins from './pages/Coins';
import Duel from './pages/Duel';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import Records from './pages/Records';
import Rewards from './pages/Rewards';
import Wallet from './pages/Wallet';

function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <PulseProvider>
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="app">
        <ScrollManager />
        <Header />
        <Ticker />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/w/:address" element={<Wallet />} />
            <Route path="/c/:mint" element={<CoinPage />} />
            <Route path="/coins" element={<Coins />} />
            <Route path="/records" element={<Records />} />
            <Route path="/rewards" element={<Rewards />} />
            <Route path="/duel" element={<Duel />} />
            <Route path="/duel/:a/:b" element={<Duel />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
        <MobileNav />
      </div>
    </PulseProvider>
  );
}