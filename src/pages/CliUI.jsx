import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Card, Button, Badge, Spinner, Empty, inputCls, useToast } from '../components/ui';
import { ArrowLeft, FolderTree, RefreshCw } from 'lucide-react';

const GROUP_ORDER = ['System', 'Interfaces', 'Switching', 'Routing', 'Bridging', 'Health', 'HA', 'Logs'];

export default function CliUI() {
  const { id } = useParams();
  const [device, setDevice] = useState(null);
  const [menus, setMenus] = useState(null);
  const [curKey, setCurKey] = useState(null);
  const [outputs, setOutputs] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const toast = useToast();

  async function loadBase() {
    const [dv, mn] = await Promise.all([
      api.get('/api/devices').then(x => x.devices.find(d => d.id === id)),
      api.get(`/api/devices/${id}/cli/menu`)
    ]);
    setDevice(dv);
    setMenus(mn.menus.map((m, i) => ({ ...m, key: m.key || m.label + '-' + i })));
    return mn;
  }

  function runMenu(m) {
    setCurKey(m.label); setBusy(true); setErr(''); setOutputs(null);
    api.get(`/api/devices/${id}/cli/run?key=${encodeURIComponent(m.label)}`)
      .then(r => setOutputs(r.outputs))
      .catch(e => setErr(e.message))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    loadBase().then(mn => {
      if (mn.menus.length) runMenu({ ...mn.menus[0], key: mn.menus[0].key || mn.menus[0].label + '-0' });
    }).catch(e => { setErr(e.message); setMenus([]); });
  }, [id]);

  if (!menus && !err) return <Spinner />;
  const cur = (menus || []).find(m => m.label === curKey);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to={`/devices/${id}`} className="text-slate-400 hover:text-white"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <FolderTree size={20} className="text-emerald-400" /> CLI Browser
        </h1>
        {device && <Badge color="cyan">{device.name} · {device.host}:{device.port}</Badge>}
      </div>

      {!err || menus?.length ? null : (
        <Card><div className="text-amber-300 text-sm">{err}</div></Card>
      )}

      {menus && menus.length === 0 ? (
        <Card><Empty>Vendor "{device?.vendor}" belum punya menu CLI. Tambahkan di server/cli-menus.js</Empty></Card>
      ) : (
        <div className="flex gap-4 items-stretch">
          <aside className="w-52 shrink-0 bg-[#0d1526] border border-[#1e2a44] rounded-xl p-2 self-start">
            {[...GROUP_ORDER, 'Lainnya'].map(g => {
              const items = (menus || []).filter(m => (m.group || 'Lainnya') === g);
              if (!items.length) return null;
              return (
                <div key={g} className="mb-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 pt-2 pb-1">{g}</div>
                  {items.map(m => (
                    <button key={m.label}
                      onClick={() => runMenu(m)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors ${curKey === m.label ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-slate-700/40'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>

          <div className="flex-1 min-w-0 bg-[#111a2c] border border-[#1e2a44] rounded-xl flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#1e2a44] flex-wrap">
              <Button variant="ghost" loading={busy} onClick={() => cur && runMenu(cur)}><RefreshCw size={13} /> Refresh</Button>
              <input className={inputCls + ' ml-auto w-56'} placeholder="Saring output..." value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <p className="px-3 pt-2 text-[11px] text-slate-500">Mode baca-aman: hanya perintah show/display. Untuk eksekusi manual gunakan tab Terminal.</p>
            <div className="overflow-auto p-3 max-h-[64vh] space-y-4">
              {err ? <Empty>{err}</Empty> :
                !outputs ? <Spinner label="Menjalankan perintah via SSH..." /> :
                  outputs.map((o, i) => {
                    const lines = o.text.split('\n').filter(l =>
                      !q || l.toLowerCase().includes(q.toLowerCase()));
                    return (
                      <div key={i} className="border border-[#1e2a44] rounded-lg overflow-hidden">
                        <div className="bg-slate-800/60 px-3 py-1.5 text-xs font-mono text-slate-400">$ {o.cmd}</div>
                        <pre className="terminal-out bg-[#0b1220] p-3 max-h-96 overflow-auto text-xs text-emerald-100/90">
                          {lines.join('\n') || '(tidak ada baris cocok filter)'}
                        </pre>
                      </div>
                    );
                  })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
