/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider, Spinner } from './components/ui';
import { subscribeEvents } from './api';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import Winbox from './pages/Winbox';
import CliUI from './pages/CliUI';
import Backups from './pages/Backups';
import CommandCenter from './pages/CommandCenter';
import Audit from './pages/Audit';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/Users';

import { LayoutDashboard, Server, Archive, TerminalSquare, ScrollText, Settings, Network, Users, Heart } from 'lucide-react';
import { Modal, Button } from './components/ui';

const BNB_ADDRESS = '0x4649b364523D4DdC329583E218f20d52b2997367';
const APP_VERSION = 'v0.1.0';


import { Users as UsersIcon } from 'lucide-react';

const NAV_UNUSED = null;

function Shell({ children }) {
  const [conn, setConn] = React.useState('connecting');
  const { user } = useAuth();
  React.useEffect(() => {
    const unsub = subscribeEvents(() => setConn('live'));
    return unsub;
  }, []);
  const NAV = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/devices', label: 'Perangkat', icon: Server },
    { to: '/backups', label: 'Backup Konfig', icon: Archive },
    { to: '/command', label: 'Command Center', icon: TerminalSquare },
    { to: '/audit', label: 'Audit Log', icon: ScrollText },
    ...(user?.role === 'admin' ? [{ to: '/users', label: 'Pengguna', icon: Users }] : []),
    { to: '/settings', label: 'Pengaturan', icon: Settings }
  ];  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 bg-[#0d1526] border-r border-[#1e2a44] flex flex-col">
        {localStorage.getItem('noc_weakpw') === '1' && (
          <a href="#/settings" className="block px-3 py-2 text-[11px] bg-amber-500/15 text-amber-300 border-b border-amber-500/30 hover:bg-amber-500/25">
            ⚠ Password admin masih default — <b>klik untuk ganti</b>
          </a>
        )}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-[#1e2a44]">
          <Network className="text-cyan-400" size={22} />
          <div>
            <div className="font-bold text-slate-100 leading-tight">NOC Control</div>
            <div className="text-[10px] text-slate-500 tracking-wider uppercase">{user ? 'Role: ' + (user.role || 'operator') : ''}</div>
          </div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <a key={to} href={`#${to}`}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700/40 hover:text-white transition-colors [&.active]:bg-cyan-500/10 [&.active]:text-cyan-300"
              onClick={e => {
                document.querySelectorAll('aside nav a').forEach(a => a.classList.remove('active'));
                e.currentTarget.classList.add('active');
              }}
            >
              <Icon size={16} /> {label}
            </a>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-[#1e2a44] space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={`inline-block w-2 h-2 rounded-full ${conn === 'live' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            {conn === 'live' ? 'Live feed aktif' : 'Menyambungkan...'}
            <span className="ml-auto text-slate-600">{APP_VERSION}</span>
          </div>
          <DonateLink />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

function DonateLink() {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  return (
    <>
      <button onClick={() => { setOpen(true); setCopied(false); }}
        className="w-full flex items-center justify-center gap-1.5 text-xs text-amber-400/90 hover:text-amber-300 border border-[#1e2a44] rounded-lg py-1.5 hover:bg-slate-700/30 transition-colors">
        <Heart size={11} className="text-amber-400" fill="currentColor" /> Support
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Dukung Pengembangan ☕">
        <p className="text-sm text-slate-300 mb-3">
          NOC Control Center gratis & open-source. Kalau bermanfaat, dukung pengembangan lanjutan via <b>BNB (BEP-20 / BSC)</b>:
        </p>
        <div className="bg-[#0b1220] border border-[#1e2a44] rounded-lg p-3 font-mono text-xs text-amber-300 break-all select-all">
          {BNB_ADDRESS}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setOpen(false)}>Tutup</Button>
          <Button onClick={() => {
            navigator.clipboard?.writeText(BNB_ADDRESS).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
              () => {}
            );
          }}>{copied ? '✔ Tersalin!' : 'Salin Alamat'}</Button>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">Pastikan jaringan pengiriman <b>BEP-20 (BSC)</b> — alamat ini bukan wallet ERC-20/BTC.</p>
      </Modal>
    </>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[ui-crash]', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 m-6 bg-red-500/10 border border-red-500/40 rounded-xl text-sm">
          <div className="font-bold text-red-300 mb-2">Terjadi error pada tampilan</div>
          <pre className="terminal-out text-red-200 whitespace-pre-wrap">{String(this.state.error && (this.state.error.stack || this.state.error.message))}</pre>
          <button className="mt-3 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100"
            onClick={() => { this.setState({ error: null }); window.location.hash = '#/'; }}>
            Kembali ke Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Guard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="h-full flex items-center justify-center"><Spinner label="Memeriksa sesi..." /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell><ErrorBoundary>{children}</ErrorBoundary></Shell>;
}

function MarkActive() {
  // highlight current route on load
  React.useEffect(() => {
    const hash = window.location.hash.replace('#', '') || '/';
    document.querySelectorAll('aside nav a').forEach(a => {
      const target = a.getAttribute('href')?.replace('#', '');
      if (target === hash || (target !== '/' && hash.startsWith(target))) a.classList.add('active');
    });
  }, []);
  return null;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter>
          <MarkActive />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Guard><Dashboard /></Guard>} />
            <Route path="/devices" element={<Guard><Devices /></Guard>} />
            <Route path="/devices/:id" element={<Guard><DeviceDetail /></Guard>} />
            <Route path="/devices/:id/winbox" element={<Guard><Winbox /></Guard>} />
            <Route path="/devices/:id/cli" element={<Guard><CliUI /></Guard>} />
            <Route path="/backups" element={<Guard><Backups /></Guard>} />
            <Route path="/command" element={<Guard><CommandCenter /></Guard>} />
            <Route path="/audit" element={<Guard><Audit /></Guard>} />
            <Route path="/users" element={<Guard><UsersPage /></Guard>} />
            <Route path="/settings" element={<Guard><SettingsPage /></Guard>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
