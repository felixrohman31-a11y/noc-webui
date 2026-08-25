import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Button, Badge, StatusDot, Spinner, inputCls, Empty, useToast } from '../components/ui';
import { getVendorMeta } from '../vendorMeta';
import { TerminalSquare } from 'lucide-react';

const PRESETS = [
  'show version',
  'show ip interface brief',
  'display version',
  '/system resource print',
  'show interfaces status',
  'show clock'
];

export default function CommandCenter() {
  const [devices, setDevices] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState({});
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const toast = useToast();

  useEffect(() => {
    Promise.all([api.get('/api/devices'), api.get('/api/templates')])
      .then(([d, t]) => { setDevices(d.devices); setTemplates(t.templates); })
      .catch(e => toast.push('err', e.message));
  }, []);

  function toggle(id) { setSelected(s => ({ ...s, [id]: !s[id] })); }
  const selectedIds = devices ? devices.filter(d => selected[d.id]).map(d => d.id) : [];

  async function run() {
    if (!command.trim() || !selectedIds.length) return toast.push('info', 'Pilih perangkat & isi perintah');
    if (!confirm(`Jalankan "${command}" pada ${selectedIds.length} perangkat?`)) return;
    setRunning(true); setResults(null);
    try {
      const r = await api.post('/api/bulk/run', { deviceIds: selectedIds, command });
      setResults(r.results);
      toast.push(r.results.every(x => x.ok) ? 'ok' : 'err', `Selesai: ${r.results.filter(x => x.ok).length}/${r.results.length} sukses`);
    } catch (e) { toast.push('err', e.message); }
    finally { setRunning(false); }
  }

  if (!devices) return <Spinner />;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><TerminalSquare size={20} className="text-amber-400" /> Command Center — Bulk Runner</h1>

      <div className="grid md:grid-cols-3 gap-5">
        <Card title={`Pilih Perangkat (${selectedIds.length}/${devices.length})`} className="md:col-span-1">
          {devices.length === 0 ? <Empty>Belum ada perangkat</Empty> : (
            <ul className="space-y-1 max-h-[420px] overflow-auto">
              {devices.map(d => (
                <li key={d.id}>
                  <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-700/30 cursor-pointer text-sm">
                    <input type="checkbox" className="accent-cyan-500" checked={!!selected[d.id]} onChange={() => toggle(d.id)} />
                    <StatusDot status={d.status?.online} />
                    <span className="text-slate-200 flex-1 truncate">{d.name}</span>
                    <span className="text-[10px] text-slate-500">{getVendorMeta(d.vendor).label.split(' ')[0]}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 mt-3 pt-3 border-t border-[#1e2a44]">
            <Button variant="ghost" onClick={() => setSelected(Object.fromEntries(devices.map(d => [d.id, true])))}>Semua</Button>
            <Button variant="ghost" onClick={() => setSelected({})}>Kosongkan</Button>
          </div>
        </Card>

        <Card title="Perintah" className="md:col-span-2">
          <div className="flex flex-wrap gap-2 mb-3">
            {templates.map(t => (
              <button key={t.id} title={t.text} onClick={() => setCommand(t.text)}
                className="text-xs bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded-md px-2 py-1 hover:bg-violet-500/25">★ {t.name}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {PRESETS.map(p => (
              <button key={p} onClick={() => setCommand(p)} className="text-xs font-mono bg-slate-700/40 hover:bg-slate-600/50 border border-[#1e2a44] rounded-md px-2 py-1 text-slate-300">{p}</button>
            ))}
          </div>
          <input className={inputCls + ' font-mono'} placeholder="contoh: show interfaces brief" value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
          <div className="mt-4">
            <Button loading={running} onClick={run} className="w-full justify-center py-2.5">Jalankan di {selectedIds.length} Perangkat</Button>
          </div>

          {results && (
            <div className="mt-5 space-y-2">
              <h4 className="text-sm font-semibold text-slate-300">Hasil</h4>
              {results.map((r, i) => (
                <div key={i} className="border border-[#1e2a44] rounded-lg overflow-hidden">
                  <button className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-700/30 text-left text-sm" onClick={() => setExpanded(expanded === i ? null : i)}>
                    <Badge color={r.ok ? 'green' : 'red'}>{r.ok ? 'OK' : 'GAGAL'}</Badge>
                    <span className="text-slate-200 flex-1">{r.name}</span>
                    {r.error && <span className="text-red-400 text-xs truncate max-w-[300px]">{r.error}</span>}
                    <span className="text-slate-500 text-xs">{expanded === i ? '▲' : '▼'}</span>
                  </button>
                  {expanded === i && (
                    <pre className="terminal-out bg-[#0b1220] p-3 max-h-80 overflow-auto text-xs text-emerald-100/90 border-t border-[#1e2a44]">{r.output || r.error || '(kosong)'}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
