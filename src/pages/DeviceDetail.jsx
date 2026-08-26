/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, subscribeEvents } from '../api';
import { Card, Button, Badge, StatusDot, Spinner, Empty, inputCls, useToast, Sparkline, ChartArea } from '../components/ui';
import { getVendorMeta } from '../vendorMeta';
import { ArrowLeft, RadioTower, Archive, Play, FolderTree } from 'lucide-react';

function flag(r) {
  const f = [];
  if (r.running === 'true') f.push('R');
  if (r.disabled === 'true') f.push('D');
  if (r.dynamic === 'true') f.push('d');
  return f.join('');
}

function KV({ k, v }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-[#1e2a44]/50 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-200 font-medium text-right break-all">{v || '-'}</span>
    </div>
  );
}

export default function DeviceDetail() {
  const { id } = useParams();
  const [device, setDevice] = useState(null);
  const [backups, setBackups] = useState([]);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState('');
  const [cmd, setCmd] = useState('show version');
  const [cmdOut, setCmdOut] = useState(null);
  const [pingHost, setPingHost] = useState('8.8.8.8');
  const [metrics, setMetrics] = useState(null);
  const [ifc, setIfc] = useState({ loaded: false, loading: false, mode: null, rows: null, text: '', error: '', filter: '' });
  const [autoIfc, setAutoIfc] = useState(true);
  const [ifcRates, setIfcRates] = useState({});
  const [ifcAt, setIfcAt] = useState(null);
  const ifcPrevRef = React.useRef(null);
  const lastSseRef = React.useRef(0);
  const toast = useToast();

  async function load() {
    const [d, b] = await Promise.all([api.get('/api/devices'), api.get('/api/backups')]);
    setDevice(d.devices.find(x => x.id === id));
    setBackups(b.backups.filter(x => x.deviceId === id));
  }
  useEffect(() => { load().catch(e => toast.push('err', e.message)); }, [id]);

  const isMtApi = !!(device && device.vendor === 'mikrotik' && String(device.transport || 'ssh').startsWith('api'));

  function loadMetrics() {
    if (!isMtApi) return;
    api.get(`/api/devices/${id}/metrics`).then(r => setMetrics(r)).catch(() => {});
  }
  useEffect(() => { loadMetrics(); }, [id]);

  function loadInterfaces(force) {
    if (ifc.loading || (ifc.loaded && !force)) return;
    setIfc(s => ({ ...s, loading: true, error: '' }));
    api.get(`/api/devices/${id}/interfaces`)
      .then(r => {
        // rate bps = selisih counter byte antar ambilan
        if (r.mode === 'rows' && Array.isArray(r.rows)) {
          const now = Date.now();
          const byName = {};
          r.rows.forEach(x => { if (x.name) byName[x.name] = { rx: Number(x['rx-byte'] ?? NaN), tx: Number(x['tx-byte'] ?? NaN) }; });
          const prev = ifcPrevRef.current;
          const rates = {};
          if (prev && now > prev.t) {
            const dt = (now - prev.t) / 1000;
            for (const name of Object.keys(byName)) {
              const p = prev.byName[name], c = byName[name];
              if (!p) continue;
              const rx = Number.isFinite(c.rx) && Number.isFinite(p.rx) && c.rx >= p.rx ? ((c.rx - p.rx) * 8) / dt : null;
              const tx = Number.isFinite(c.tx) && Number.isFinite(p.tx) && c.tx >= p.tx ? ((c.tx - p.tx) * 8) / dt : null;
              if (rx != null || tx != null) rates[name] = { rx, tx };
            }
          }
          ifcPrevRef.current = { t: now, byName };
          if (Object.keys(rates).length) setIfcRates(rates);
          setIfcAt(new Date());
        }
        setIfc(s => ({ ...s, loaded: true, loading: false, mode: r.mode, rows: r.rows || null, text: r.text || '' }));
      })
      .catch(e => setIfc(s => ({ ...s, loaded: true, loading: false, error: e.message })));
  }
  useEffect(() => { if (tab === 'interfaces') loadInterfaces(); }, [tab]);

  // auto-refresh interface tiap 10 detik selama tab terbuka & browser terlihat
  useEffect(() => {
    if (tab !== 'interfaces' || !autoIfc) return;
    const iv = setInterval(() => { if (!document.hidden) loadInterfaces(true); }, 10000);
    return () => clearInterval(iv);
  }, [tab, autoIfc]);

  // realtime via SSE: refresh hist/uptime/status + metrik tiap polling baru
  useEffect(() => {
    const un = subscribeEvents(ev => {
      if (ev.type !== 'status' && ev.type !== 'status-change') return;
      const now = Date.now();
      if (now - lastSseRef.current < 5000 || document.hidden) return;
      lastSseRef.current = now;
      api.get('/api/devices').then(d => {
        const f = d.devices.find(x => x.id === id);
        if (f) setDevice(f);
      }).catch(() => {});
      loadMetrics();
    });
    return un;
  }, [id, isMtApi]);

  if (!device) return <Spinner />;

  async function check() {
    setBusy('check');
    try {
      await api.post(`/api/devices/${id}/check`);
      toast.push('ok', 'SSH check berhasil');
      await load();
    } catch (e) { toast.push('err', e.message); }
    finally { setBusy(''); }
  }

  async function takeBackup() {
    setBusy('backup');
    try {
      await api.post(`/api/devices/${id}/backup`);
      toast.push('ok', 'Backup konfigurasi berhasil diambil');
      await load();
    } catch (e) { toast.push('err', e.message); }
    finally { setBusy(''); }
  }

  async function run() {
    if (!cmd.trim()) return;
    setBusy('cmd'); setCmdOut(null);
    try {
      const r = await api.post(`/api/devices/${id}/command`, { command: cmd });
      setCmdOut(r.output);
    } catch (e) { setCmdOut('[ERROR] ' + e.message); }
    finally { setBusy(''); }
  }

  async function viewBackup(bid) {
    try {
      const r = await api.get(`/api/backups/${bid}`);
      setTab('terminal');
      setCmdOut(`===== BACKUP ${r.backup.deviceName} (${r.backup.createdAt}) via ${r.backup.command} =====\n` + r.backup.content);
    } catch (e) { toast.push('err', e.message); }
  }

  const meta = getVendorMeta(device.vendor);
  const histPoints = (device.hist || []).map(h => h); // [{t,lat}]
  const uptime = device.uptimePct != null ? device.uptimePct : null;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/devices" className="text-slate-400 hover:text-white"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-bold text-slate-100">{device.name}</h1>
        <Badge color="cyan">{meta.label}</Badge>
        <span className="flex items-center gap-2 text-sm text-slate-400"><StatusDot status={device.status?.online} /> {device.host}</span>
        <Sparkline points={histPoints} />
        {uptime != null && <Badge color={uptime >= 95 ? 'green' : uptime >= 70 ? 'yellow' : 'red'}>{uptime}% up</Badge>}
        <div className="ml-auto flex gap-2">
          {!(device.vendor === 'mikrotik' && String(device.transport || 'ssh').startsWith('api')) && (
            <Button variant="ghost" onClick={() => window.location.hash = `#/devices/${id}/cli`}>
              <FolderTree size={14} /> CLI Browser
            </Button>
          )}
          {device.vendor === 'mikrotik' && (
            <Button variant="ghost" onClick={() => window.location.hash = `#/devices/${id}/winbox`}>
              <FolderTree size={14} /> Config UI
            </Button>
          )}
          <Button variant="ghost" loading={busy === 'check'} onClick={check}><RadioTower size={14} /> SSH Check</Button>
          <Button loading={busy === 'backup'} onClick={takeBackup}><Archive size={14} /> Backup Config</Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[#1e2a44]">
        {[['overview', 'Overview'], ['interfaces', 'Interfaces'], ['backups', `Backups (${backups.length})`], ['terminal', 'Terminal']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === key ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
        <Card title="Latency & Ketersediaan (riwayat polling)" className="mb-5">
          <ChartArea points={histPoints} />
          <div className="text-[11px] text-slate-500 mt-1 flex gap-4">
            <span><span className="inline-block w-2 h-2 bg-cyan-400 rounded-full mr-1"></span>latency ms</span>
            <span><span className="inline-block w-2 h-2 bg-red-500 mr-1"></span>offline</span>
            <span className="ml-auto">uptime {uptime != null ? uptime + '%' : 'mengumpulkan data...'}</span>
          </div>
        </Card>
        {isMtApi && metrics && (
          <div className="grid md:grid-cols-2 gap-5 mb-5">
            <Card title="CPU Load (%)">
              <ChartArea points={metrics.cpu || []} height={90} />
            </Card>
            <Card title="Memori Bebas (MB)">
              <ChartArea points={(metrics.freeMem || []).map(([t, v]) => [t, v == null ? null : Math.round(v / 1048576)])} height={90} />
            </Card>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-5">
          <Card title="Identitas">
            <KV k="Nama" v={device.name} />
            <KV k="Vendor" v={meta.label} />
            <KV k="Transport" v={
              String(device.transport || 'ssh').startsWith('api')
                ? `RouterOS ${device.transport === 'api-ssl' ? 'API-SSL' : 'API'} (port ${device.apiPort || (device.transport === 'api-ssl' ? 8729 : 8728)})`
                : 'SSH CLI'
            } />
            <KV k="Model" v={device.model} />
            <KV k="Lokasi" v={device.location} />
            <KV k="Tag" v={(device.tags || []).join(', ')} />
            <KV k="Catatan" v={device.notes} />
            <KV k="Ditambahkan" v={new Date(device.createdAt).toLocaleString('id-ID')} />
          </Card>
          <Card title="Facts Terakhir (SSH)" right={
            device.factsAt ? <span className="text-xs text-slate-500">{new Date(device.factsAt).toLocaleString('id-ID')}</span> : null
          }>
            {!device.facts ? <Empty>Belum pernah dicek — klik "SSH Check"</Empty> : (
              <>
                <KV k="Hostname" v={device.facts.hostname} />
                <KV k="Versi OS" v={device.facts.version} />
                <KV k="Uptime" v={device.facts.uptime} />
                <KV k="Board/Model" v={device.facts.boardName || device.facts.model} />
                <KV k="Serial" v={device.facts.serial} />
                {device.facts.cpuLoad && <KV k="CPU Load" v={device.facts.cpuLoad} />}
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-cyan-300">Raw output</summary>
                  <pre className="terminal-out bg-[#0b1220] rounded-lg p-3 mt-2 max-h-72 overflow-auto text-xs text-slate-300">{JSON.stringify(device.facts.raw, null, 2)}</pre>
                </details>
              </>
            )}
          </Card>
        </div>
        </>
      )}

      {tab === 'interfaces' && (
        <Card
          title={isMtApi ? 'Interface (live dari RouterOS API)' : 'Interface (output CLI)'}
          right={
            <div className="flex items-center gap-2">
              {ifc.mode === 'rows' && (
                <>
                  {ifcAt && <span className="text-[10px] text-slate-500 hidden md:inline">update {ifcAt.toLocaleTimeString('id-ID')}</span>}
                  <label className="text-[11px] text-slate-400 flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" className="accent-cyan-500" checked={autoIfc} onChange={e => setAutoIfc(e.target.checked)} />
                    Auto 10s {autoIfc && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />}
                  </label>
                </>
              )}
              <input className={inputCls + ' w-40 text-xs'} placeholder="Filter..." value={ifc.filter}
                onChange={e => setIfc(s => ({ ...s, filter: e.target.value }))} />
              <Button variant="ghost" loading={ifc.loading} onClick={() => loadInterfaces(true)}>Refresh</Button>
            </div>
          }>
          {ifc.error ? <Empty>{ifc.error}</Empty> :
            ifc.loading && !ifc.loaded ? <Spinner label="Mengambil data interface..." /> :
              ifc.mode === 'rows' ? (() => {
                const rows = (ifc.rows || []).filter(r =>
                  !ifc.filter || Object.values(r).some(v => String(v).toLowerCase().includes(ifc.filter.toLowerCase())));
                const fmtBytes = n => n == null || isNaN(n) ? '-' : (n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
                const fmtBps = n => n == null || isNaN(n) ? <span className="text-slate-600">—</span> : n >= 1e6 ? <span className="text-amber-300">{(n / 1e6).toFixed(2)} Mbps</span> : n >= 1e3 ? <span className="text-cyan-300">{(n / 1e3).toFixed(1)} kbps</span> : n > 5 ? <span className="text-slate-300">{Math.round(n)} bps</span> : <span className="text-slate-600">—</span>;
                return (
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500 uppercase tracking-wider">
                      <th className="pb-2 w-10">Flag</th>
                      <th className="pb-2">Name</th><th className="pb-2">Type</th><th className="pb-2">MTU</th>
                      <th className="pb-2">Running</th>
                      <th className="pb-2 text-right">RX</th><th className="pb-2 text-right">TX</th>
                      <th className="pb-2 text-right">Rate RX</th><th className="pb-2 text-right">Rate TX</th>
                      <th className="pb-2">Comment</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const rate = ifcRates[r.name];
                        return (
                        <tr key={r['.id'] || i} className={`border-t border-[#1e2a44]/60 hover:bg-slate-700/20 ${r.disabled === 'true' ? 'opacity-50 italic' : ''}`}>
                          <td className="py-1.5 font-mono text-cyan-400">
                            {flag(r)}{r.slave === 'true' ? 'S' : ''}
                          </td>
                          <td className="py-1.5 font-mono text-slate-100 font-medium">{r.name || '-'}</td>
                          <td className="py-1.5 text-slate-400">{r.type || '-'}</td>
                          <td className="py-1.5 text-slate-400 font-mono">{r['actual-mtu'] || r.mtu || '-'}</td>
                          <td className="py-1.5">
                            {r.running === 'true'
                              ? <span className="text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block"></span>up</span>
                              : <span className="text-slate-500">down</span>}
                          </td>
                          <td className="py-1.5 text-right text-slate-300 font-mono">{fmtBytes(Number(r['rx-byte'] ?? NaN))}</td>
                          <td className="py-1.5 text-right text-slate-300 font-mono">{fmtBytes(Number(r['tx-byte'] ?? NaN))}</td>
                          <td className="py-1.5 text-right font-mono">{rate ? fmtBps(rate.rx) : fmtBps(null)}</td>
                          <td className="py-1.5 text-right font-mono">{rate ? fmtBps(rate.tx) : fmtBps(null)}</td>
                          <td className="py-1.5 text-slate-400 max-w-[180px] truncate" title={r.comment || ''}>{r.comment || ''}</td>
                        </tr>
                        );
                      })}
                      {rows.length === 0 && <tr><td colSpan={10} className="py-4 text-center text-slate-500">Tidak ada interface cocok filter</td></tr>}
                    </tbody>
                  </table>
                );
              })() :
                ifc.mode === 'text' ? (
                  <pre className="terminal-out bg-[#0b1220] border border-[#1e2a44] rounded-lg p-4 max-h-[60vh] overflow-auto text-xs text-emerald-100/90">
                    {ifc.text.split('\n').filter(l => !ifc.filter || l.toLowerCase().includes(ifc.filter.toLowerCase())).join('\n') || '(tidak ada baris cocok filter)'}
                  </pre>
                ) : <Empty>Klik Refresh untuk memuat</Empty>}
        </Card>
      )}

      {tab === 'backups' && (
        <Card title="Riwayat Backup Konfigurasi">
          {backups.length === 0 ? <Empty>Belum ada backup</Empty> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500 uppercase tracking-wider"><th className="pb-2">Waktu</th><th className="pb-2">Perintah</th><th className="pb-2">Ukuran</th><th className="pb-2">Oleh</th><th className="pb-2 text-right">Aksi</th></tr></thead>
              <tbody>
                {backups.map(b => (
                  <tr key={b.id} className="border-t border-[#1e2a44]/60">
                    <td className="py-2 text-slate-300">{new Date(b.createdAt).toLocaleString('id-ID')}</td>
                    <td className="py-2 text-slate-400 font-mono text-xs">{b.command}</td>
                    <td className="py-2 text-slate-400">{(b.sizeBytes / 1024).toFixed(1)} KB</td>
                    <td className="py-2 text-slate-400">{b.createdBy}</td>
                    <td className="py-2 text-right space-x-2">
                      <Button variant="ghost" onClick={() => viewBackup(b.id)}>Lihat</Button>
                      <a href={`#/devices/${id}`} onClick={() => window.open(`/api/backups/${b.id}/download?token=${encodeURIComponent(localStorage.getItem('noc_token') || '')}`, '_blank')}>
                        <Button variant="ghost" title="Download">Unduh</Button>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'terminal' && (
        <Card title="Terminal Perintah (read-only mode)">
          {String(device.transport || 'ssh').startsWith('api') && (
            <p className="text-xs text-amber-300/90 mb-3">Mode API: tulis path API gaya CLI, contoh <code>/ip address print</code>. Perintah konfigurasi tidak tersedia lewat API.</p>
          )}
          <div className="flex gap-2 mb-3">
            <input className={inputCls + ' font-mono'} value={cmd} onChange={e => setCmd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()}
              placeholder={String(device.transport || 'ssh').startsWith('api') ? '/ip address print' : 'show interfaces brief'} />
            <Button loading={busy === 'cmd'} onClick={run}><Play size={14} /> Jalankan</Button>
          </div>
          {isMtApi && (
            <div className="flex gap-2 mb-4 items-center bg-[#0d1526] border border-[#1e2a44] rounded-lg p-2">
              <span className="text-xs text-slate-400 px-1">Tools Ping:</span>
              <input className={inputCls + ' font-mono w-56'} value={pingHost}
                onChange={e => setPingHost(e.target.value)} placeholder="8.8.8.8" />
              <Button variant="ghost" loading={busy === 'ping'}
                onClick={async () => {
                  if (!pingHost.trim()) return;
                  setBusy('ping'); setCmdOut(null);
                  try {
                    const r = await api.get(`/api/devices/${id}/ros/ping?host=${encodeURIComponent(pingHost.trim())}`);
                    const text = (r.rows || []).map(row => Object.entries(row).map(([k, v]) => `${k}=${v}`).join('  ')).join('\n') || '(tidak ada hasil)';
                    setCmdOut(`PING ${pingHost.trim()} — 4 paket:\n` + text);
                  } catch (e) { setCmdOut('[ERROR] ' + e.message); }
                  finally { setBusy(''); }
                }}>Ping</Button>
              <Button variant="ghost" loading={busy === 'trace'}
                onClick={async () => {
                  if (!pingHost.trim()) return;
                  setBusy('trace'); setCmdOut(null);
                  try {
                    const r = await api.get(`/api/devices/${id}/ros/trace?host=${encodeURIComponent(pingHost.trim())}`);
                    const lines = (r.rows || []).map(row => {
                      const hop = row['#'] != null ? row['#'] : (row.hop != null ? row.hop : '');
                      return Object.entries(row).filter(([k]) => k !== '.id').map(([k, v]) => `${k}=${v}`).join('  ');
                    });
                    setCmdOut(`TRACEROUTE ${pingHost.trim()}:\n` + (lines.join('\n') || '(tidak ada hasil)'));
                  } catch (e) { setCmdOut('[ERROR] ' + e.message); }
                  finally { setBusy(''); }
                }}>Trace</Button>
            </div>
          )}
          {cmdOut !== null ? (
            <pre className="terminal-out bg-[#0b1220] border border-[#1e2a44] rounded-lg p-4 max-h-[60vh] overflow-auto text-xs text-emerald-100/90">{cmdOut}</pre>
          ) : <Empty>Masukkan perintah lalu tekan Jalankan / Enter</Empty>}
        </Card>
      )}
    </div>
  );
}
