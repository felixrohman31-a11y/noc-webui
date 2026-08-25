import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, StatusDot, Badge, Empty, Spinner, Button, useToast, Sparkline } from '../components/ui';
import { getVendorMeta } from '../vendorMeta';
import { subscribeEvents } from '../api';
import { Activity, Server, Archive, TerminalSquare, RefreshCw } from 'lucide-react';

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-[#111a2c] border border-[#1e2a44] rounded-xl p-4 flex items-center gap-4">
      <div className={`p-2.5 rounded-lg border ${accent}`}><Icon size={20} /></div>
      <div>
        <div className="text-2xl font-bold text-slate-100">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [polling, setPolling] = useState(false);
  const toast = useToast();

  async function load() {
    try { setData(await api.get('/api/dashboard')); } catch {}
  }
  useEffect(() => { load(); }, []);
  const lastLoad = React.useRef(0);
  useEffect(() => subscribeEvents(() => {
    if (Date.now() - lastLoad.current > 3000) { lastLoad.current = Date.now(); load(); }
  }), []);

  async function pollNow() {
    setPolling(true);
    try {
      await api.post('/api/poll-now');
      await load();
      toast.push('ok', 'Pemeriksaan reachability selesai');
    } catch (e) {
      toast.push('err', e.message);
    } finally { setPolling(false); }
  }

  if (!data) return <Spinner />;
  const { stats, byVendor, devices, recentAudit } = data;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Dashboard</h1>
        <Button variant="ghost" loading={polling} onClick={pollNow}><RefreshCw size={14} /> Poll Sekarang</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Server} label="Total Perangkat" value={stats.total} accent="bg-cyan-500/10 text-cyan-400 border-cyan-500/30" />
        <StatCard icon={Activity} label="Online" value={stats.online} accent="bg-emerald-500/10 text-emerald-400 border-emerald-500/30" />
        <StatCard icon={Archive} label="Backup Tersimpan" value={stats.backups} accent="bg-violet-500/10 text-violet-400 border-violet-500/30" />
        <StatCard icon={TerminalSquare} label="Perintah 24 Jam" value={stats.commands24h} accent="bg-amber-500/10 text-amber-400 border-amber-500/30" />
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <Card title="Distribusi Vendor" className="md:col-span-1">
          {Object.keys(byVendor).length === 0 ? <Empty>Belum ada perangkat</Empty> : (
            <div className="space-y-3">
              {Object.entries(byVendor).map(([v, n]) => {
                const meta = getVendorMeta(v);
                return (
                  <div key={v} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                    <Badge>{n}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Status Perangkat" className="md:col-span-2">
          {devices.length === 0 ? <Empty>Tambahkan perangkat pertama di menu Perangkat</Empty> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                  <th className="pb-2">Nama</th><th className="pb-2">Host</th><th className="pb-2">Vendor</th><th className="pb-2">Status</th><th className="pb-2">Uptime 24j</th><th className="pb-2">Latency</th>
                </tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id} className="border-t border-[#1e2a44]/60 hover:bg-slate-700/20">
                    <td className="py-2"><Link className="text-cyan-300 hover:underline" to={`/devices/${d.id}`}>{d.name}</Link></td>
                    <td className="py-2 text-slate-400 font-mono text-xs">{d.host}:{d.port}</td>
                    <td className="py-2 text-slate-400 text-xs">{getVendorMeta(d.vendor).label}</td>
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <StatusDot status={d.status?.online} />
                        {d.status?.online === true
                          ? <span className="text-emerald-400 text-xs">{d.status.latencyMs != null ? d.status.latencyMs + ' ms' : 'online'}</span>
                          : d.status?.online === false ? <span className="text-red-400 text-xs">offline</span>
                          : <span className="text-slate-500 text-xs">unknown</span>}
                      </span>
                    </td>
                    <td className="py-2">
                      {d.uptimePct != null
                        ? <Badge color={d.uptimePct >= 95 ? 'green' : d.uptimePct >= 70 ? 'yellow' : 'red'}>{d.uptimePct}%</Badge>
                        : <span className="text-slate-600 text-xs">-</span>}
                    </td>
                    <td className="py-2"><Sparkline points={d.hist} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Aktivitas Terbaru">
        {recentAudit.length === 0 ? <Empty>Belum ada aktivitas</Empty> : (
          <ul className="space-y-2 text-sm">
            {recentAudit.map(l => (
              <li key={l.id} className="flex items-start gap-3 text-slate-300">
                <span className="text-slate-600 text-xs mt-0.5 w-36 shrink-0">{new Date(l.ts).toLocaleString('id-ID')}</span>
                <span><span className="text-cyan-300 font-medium">{l.user}</span> — {l.action}: {l.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
