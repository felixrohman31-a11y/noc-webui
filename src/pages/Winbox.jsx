/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { Card, Button, Badge, Spinner, Modal, Field, inputCls, Empty, useToast, Checkbox, SelectedChip } from '../components/ui';
import { ArrowLeft, RefreshCw, Plus, Pencil, Trash2, FolderTree, AlertTriangle } from 'lucide-react';

const GROUP_ORDER = ['', 'IP', 'Firewall', 'Queue', 'PPP', 'System'];

function flagLetters(row) {
  const f = [];
  if (row.running === 'true') f.push('R');
  if (row.active === 'true') f.push('A');
  if (row.disabled === 'true') f.push('D');
  if (row.invalid === 'true') f.push('I');
  if (row.dynamic === 'true') f.push('d');
  return f.join('');
}

function pretty(k) {
  return k.replace(/^\./, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function Winbox() {
  const { id } = useParams();
  const [device, setDevice] = useState(null);
  const [menus, setMenus] = useState(null);
  const [curKey, setCurKey] = useState(null);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', rid?, fields:[{k,t,src,opts}], params:{}}
  const [ifcOpts, setIfcOpts] = useState({ list: null, loading: false });
  const toast = useToast();

  async function loadBase() {
    const [dv, mn] = await Promise.all([
      api.get('/api/devices').then(x => x.devices.find(d => d.id === id)),
      api.get(`/api/devices/${id}/ros/menu`)
    ]);
    setDevice(dv);
    setMenus(mn.menus);
    return mn.menus;
  }

  async function loadRows(key) {
    if (!key) return;
    setBusy(true); setErr('');
    try {
      const r = await api.get(`/api/devices/${id}/ros/data?key=${encodeURIComponent(key)}`);
      setRows(r.rows);
      setSel({});
    } catch (e) {
      setErr(e.message); setRows([]);
    } finally { setBusy(false); }
  }

  useEffect(() => {
    loadBase().then(m => {
      const first = (m && m.find(x => !x.readonly)) || (m && m[0]);
      if (first) { setCurKey(first.key); loadRows(first.key); }
      else setMenus(Array.isArray(m) ? m : []);
    }).catch(e => { setErr(e.message); setMenus([]); });
  }, [id]);

  if (!Array.isArray(menus) && !err) return <Spinner />;
  const cur = Array.isArray(menus) ? menus.find(m => m.key === curKey) : null;

  const isApi = !!(device && device.vendor === 'mikrotik' && String(device.transport || 'ssh').startsWith('api'));

  async function doAction(action, ids, params, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await api.post(`/api/devices/${id}/ros/action`, { key: curKey, action, ids, params });
      toast.push('ok', `Aksi "${action}" berhasil`);
      await loadRows(curKey);
    } catch (e) { toast.push('err', e.message); }
    finally { setBusy(false); }
  }

  // Muat daftar interface live dari router bila form membutuhkannya
  async function ensureIfcOptions(fields) {
    if (!fields.some(f => f.src === 'interfaces')) return;
    setIfcOpts(s => ({ ...s, loading: true }));
    try {
      const r = await api.get(`/api/devices/${id}/ros/options?what=interfaces`);
      setIfcOpts({ list: r.options, loading: false });
    } catch (e) {
      setIfcOpts({ list: [], loading: false });
      toast.push('err', 'Gagal memuat daftar interface: ' + e.message);
    }
  }

  function openAdd() {
    const fields = (cur?.caps?.add) || [];
    if (!fields.length) return;
    setModal({ mode: 'add', fields, params: {} });
    ensureIfcOptions(fields);
  }

  function openEdit(row) {
    const fields = (cur?.caps?.edit) || [];
    if (!fields.length) return toast.push('info', 'Menu ini tidak punya field yang bisa diedit');
    const params = {};
    fields.forEach(f => { params[f.k] = row[f.k] === true ? '' : (row[f.k] || ''); });
    setModal({ mode: 'edit', rid: row['.id'], fields, params });
    ensureIfcOptions(fields);
  }

  function renderField(f) {
    const val = modal.params[f.k] || '';
    const set = v => setModal(m => ({ ...m, params: { ...m.params, [f.k]: v } }));

    if (f.src === 'interfaces') {
      return (
        <select className={inputCls} value={val} onChange={e => set(e.target.value)}>
          <option value="">{ifcOpts.loading ? 'Memuat interface...' : '— pilih interface —'}</option>
          {(ifcOpts.list || []).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    }
    if (Array.isArray(f.opts)) {
      return (
        <>
          <input list={`dl-${f.k}`} className={inputCls + ' font-mono'} value={val}
            onChange={e => set(e.target.value)} placeholder={f.opts[0]} />
          <datalist id={`dl-${f.k}`}>
            {f.opts.map(o => <option key={o} value={o} />)}
          </datalist>
        </>
      );
    }
    return (
      <input type={f.t === 'pass' ? 'password' : 'text'} className={inputCls + ' font-mono'}
        value={val} onChange={e => set(e.target.value)} />
    );
  }

  const filtered = (rows || []).filter(r =>
    !q || Object.values(r).some(v => String(v).toLowerCase().includes(q.toLowerCase()))
  );
  const selectedIds = Object.keys(sel).filter(k => sel[k]);
  const caps = cur?.caps || {};

  function toggleSel(rid) { setSel(s => ({ ...s, [rid]: !s[rid] })); }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to={`/devices/${id}`} className="text-slate-400 hover:text-white"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <FolderTree size={20} className="text-cyan-400" /> Config UI — MikroTik
        </h1>
        {device && <Badge color="cyan">{device.host}{String(device.transport || 'ssh').startsWith('api') ? ` :${device.apiPort || (device.transport === 'api-ssl' ? 8729 : 8728)}` : ''}</Badge>}
      </div>

      {!isApi ? (
        <Card>
          <div className="flex items-start gap-3 text-amber-300">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div className="text-sm">
              Device ini belum memakai transport RouterOS API.
              Buka <Link className="text-cyan-300 underline" to={`/devices/${id}`}>detail perangkat</Link>, edit,
              lalu pilih <b>Transport: RouterOS API</b> (aktifkan dulu di router: <code>/ip service enable api</code>).
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex gap-4 items-stretch">
          {/* Sidebar ala Winbox */}
          <aside className="w-52 shrink-0 bg-[#0d1526] border border-[#1e2a44] rounded-xl p-2 self-start">
            {GROUP_ORDER.map(g => {
              const items = (menus || []).filter(m => (m.group || '') === g);
              if (!items.length) return null;
              return (
                <div key={g || '_root'} className="mb-1.5">
                  {g && <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 pt-2 pb-1">{g}</div>}
                  {items.map(m => (
                    <button key={m.key}
                      onClick={() => { setCurKey(m.key); loadRows(m.key); }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors flex justify-between items-center ${curKey === m.key ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-300 hover:bg-slate-700/40'}`}>
                      <span>{m.label}</span>
                      {m.readonly && <span className="text-[9px] text-slate-500">RO</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>

          {/* Area tabel */}
          <div className="flex-1 min-w-0 bg-[#111a2c] border border-[#1e2a44] rounded-xl flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#1e2a44] flex-wrap">
              <Button variant="ghost" loading={busy} onClick={() => loadRows(curKey)}><RefreshCw size={13} /> Refresh</Button>
              {caps.add && caps.add.length > 0 && <Button onClick={openAdd}><Plus size={14} /> Add</Button>}
              {caps.toggle && (
                <>
                  <Button variant="subtle" disabled={!selectedIds.length || busy} onClick={() => doAction('enable', selectedIds)}>Enable</Button>
                  <Button variant="subtle" disabled={!selectedIds.length || busy} onClick={() => doAction('disable', selectedIds)}>Disable</Button>
                </>
              )}
              {caps.edit && caps.edit.length > 0 && (
                <Button variant="ghost" disabled={selectedIds.length !== 1 || busy}
                  onClick={() => { const r = rows.find(x => x['.id'] === selectedIds[0]); r && openEdit(r); }}>
                  <Pencil size={13} /> Edit
                </Button>
              )}
              {caps.remove && (
                <Button variant="danger" disabled={!selectedIds.length || busy}
                  onClick={() => doAction('remove', selectedIds, null, `Hapus ${selectedIds.length} entry dari ${cur?.label}?`)}>
                  <Trash2 size={13} /> Remove
                </Button>
              )}
              <SelectedChip count={selectedIds.length} onClear={() => setSel({})} label="dipilih" />
              {cur?.readonly && !caps.remove && (
                <span className="text-xs text-slate-600">{rows ? rows.length + ' entry' : ''}</span>
              )}
              <input className={inputCls + ' ml-auto w-56'} placeholder="Filter..." value={q} onChange={e => setQ(e.target.value)} />
            </div>

            {cur?.readonly && (
              <div className="px-3 py-1.5 text-xs text-amber-300/90 bg-amber-500/10 border-b border-amber-500/20">
                Menu ini hanya-baca (perlindungan keselamatan)
              </div>
            )}

            <div className="overflow-auto max-h-[62vh]">
              {err ? <Empty>{err}</Empty> :
                !rows ? <Spinner /> :
                  filtered.length === 0 ? <Empty>Tidak ada data</Empty> : (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#111a2c]">
                        <tr className="text-left text-slate-500 uppercase tracking-wider">
                          <th className="px-2 py-2 w-8"><Checkbox size={15}
                            checked={filtered.length > 0 && filtered.every(r => sel[r['.id']])}
                            onChange={v => {
                              const v2 = {}; filtered.forEach(r => v2[r['.id']] = v); setSel(s => ({ ...s, ...v2 }));
                            }} title="Pilih semua" /></th>
                          <th className="px-2 py-2 w-10">Flag</th>
                          {(cur?.cols || []).map(c => <th key={c} className="px-2 py-2">{pretty(c)}</th>)}
                          <th className="px-2 py-2">Comment</th>
                          <th className="px-2 py-2 w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((r, i) => {
                          const dis = r.disabled === 'true';
                          return (
                            <tr key={r['.id'] || i} className={`border-t border-[#1e2a44]/60 hover:bg-slate-700/20 ${dis ? 'opacity-50 italic' : ''}`}>
                              <td className="px-2 py-1.5"><Checkbox size={15}
                                checked={!!sel[r['.id']]} onChange={() => toggleSel(r['.id'])} /></td>
                              <td className="px-2 py-1.5 font-mono text-cyan-400">{flagLetters(r)}</td>
                              {(cur?.cols || []).map(c => (
                                <td key={c} className={`px-2 py-1.5 font-mono ${r[c] === 'true' ? 'text-emerald-400' : r[c] === 'false' ? 'text-slate-500' : 'text-slate-200'} max-w-[220px] truncate`} title={String(r[c] ?? '')}>
                                  {r[c] ?? '-'}
                                </td>
                              ))}
                              <td className="px-2 py-1.5 text-slate-400 max-w-[180px] truncate" title={r.comment || ''}>{r.comment || ''}</td>
                              <td className="px-2 py-1.5 text-right space-x-1 whitespace-nowrap">
                                {(caps.extras || []).map(ex => (
                                  <button key={ex.label || ex} className="text-[11px] text-violet-300 hover:underline"
                                    onClick={() => doAction('extra:' + ex.label, [r['.id']], null, `${ex.label} untuk entry ini?`)}>{ex.label}</button>
                                ))}
                                {caps.edit && caps.edit.length > 0 && <button className="text-slate-400 hover:text-cyan-300" onClick={() => openEdit(r)}><Pencil size={12} /></button>}
                                {caps.remove && <button className="text-slate-400 hover:text-red-400" onClick={() => doAction('remove', [r['.id']], null, 'Hapus entry ini?')}><Trash2 size={12} /></button>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
            </div>

            <div className="px-3 py-2 border-t border-[#1e2a44] text-[11px] text-slate-500 flex justify-between">
              <span>{cur ? cur.label + ' — ' + (rows ? rows.length : 0) + ' entry' : ''}</span>
              <span>{selectedIds.length} dipilih</span>
            </div>
          </div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'add' ? 'Add Entry — ' + (cur?.label || '') : 'Edit Entry — ' + (cur?.label || '')}>
        {modal && (
          <>
            {modal.fields.map(f => (
              <Field key={f.k} label={pretty(f.k) + (f.src === 'interfaces' ? ' ↧' : '')}>
                {renderField(f)}
              </Field>
            ))}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setModal(null)}>Batal</Button>
              <Button loading={busy}
                onClick={async () => {
                  if (modal.mode === 'add') await doAction('add', [], modal.params);
                  else await doAction('set', [modal.rid], modal.params);
                  setModal(null);
                }}>{modal.mode === 'add' ? 'Tambahkan' : 'Simpan'}</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
