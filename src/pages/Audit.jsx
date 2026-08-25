import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Badge, Spinner, Empty } from '../components/ui';
import { ScrollText } from 'lucide-react';

const ACTION_COLORS = {
  'login': 'cyan', 'login.failed': 'red', 'device.created': 'green',
  'device.updated': 'yellow', 'device.deleted': 'red',
  'command.run': 'slate', 'bulk.run': 'yellow', 'backup.taken': 'cyan',
  'settings.updated': 'yellow', 'password.changed': 'yellow'
};

export default function Audit() {
  const [logs, setLogs] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get('/api/audit').then(d => setLogs(d.logs)).catch(() => setLogs([]));
  }, []);

  if (!logs) return <Spinner />;
  const filtered = logs.filter(l =>
    !q || [l.user, l.action, l.detail, l.ts].join(' ').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><ScrollText size={20} className="text-cyan-400" /> Audit Log</h1>
        <div className="flex items-center gap-2">
          <input className="w-64 bg-[#0b1220] border border-[#1e2a44] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 placeholder-slate-600"
            placeholder="Cari user/aksi/detail..." value={q} onChange={e => setQ(e.target.value)} />
          <a href="/api/audit/export.csv?token=" onClick={e => {
            e.preventDefault();
            window.open(`/api/audit/export.csv?token=${encodeURIComponent(localStorage.getItem('noc_token') || '')}`, '_blank');
          }} className="px-3 py-2 rounded-lg border border-[#1e2a44] text-sm text-cyan-300 hover:bg-slate-700/40">Export CSV</a>
        </div>
      </div>
      <Card>
        {filtered.length === 0 ? <Empty>Belum ada aktivitas cocok</Empty> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                <th className="pb-2">Waktu</th><th className="pb-2">User</th><th className="pb-2">Aksi</th><th className="pb-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} className="border-t border-[#1e2a44]/60 hover:bg-slate-700/20">
                  <td className="py-2 text-slate-500 text-xs whitespace-nowrap">{new Date(l.ts).toLocaleString('id-ID')}</td>
                  <td className="py-2 text-cyan-300">{l.user}</td>
                  <td className="py-2"><Badge color={ACTION_COLORS[l.action] || 'slate'}>{l.action}</Badge></td>
                  <td className="py-2 text-slate-300 break-all">{l.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
