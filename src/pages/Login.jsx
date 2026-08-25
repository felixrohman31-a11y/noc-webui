/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { Button, inputCls } from '../components/ui';
import { Network } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const d = await api.post('/api/auth/login', { username, password });
      setToken(d.token);
      nav('/');
      window.location.reload();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-[#0b1220]">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#111a2c] border border-[#1e2a44] rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3">
            <Network className="text-cyan-400" size={28} />
          </div>
        </div>
        <h1 className="text-center text-lg font-bold text-slate-100 mb-1">NOC Control Center</h1>
        <p className="text-center text-xs text-slate-500 mb-6">Kendali terpusat perangkat jaringan multi-vendor</p>
        {err && <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{err}</div>}
        <label className="block mb-3 text-sm">
          <span className="text-slate-400 text-xs">Username</span>
          <input className={inputCls + ' mt-1'} value={username} onChange={e => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="block mb-5 text-sm">
          <span className="text-slate-400 text-xs">Password</span>
          <input type="password" className={inputCls + ' mt-1'} value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <Button type="submit" loading={loading} className="w-full justify-center py-2">Masuk</Button>
        <p className="text-center text-[11px] text-slate-600 mt-5">Default: admin / admin123 — ganti setelah login pertama</p>
      </form>
    </div>
  );
}
