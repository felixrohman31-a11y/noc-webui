/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, Button, Badge, StatusDot, Modal, Field, inputCls, Empty, Spinner, useToast, Checkbox } from '../components/ui';
import { getVendorMeta } from '../vendorMeta';
import { Plus, Pencil, Trash2, RadioTower, Radar } from 'lucide-react';

const EMPTY = { name: '', host: '', port: 22, vendor: 'mikrotik', model: '', location: '', tags: '', username: '', password: '', pagerOff: '', notes: '', transport: 'ssh', apiPort: 8728 };

export default function Devices() {
  const [devices, setDevices] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', data}
  const [disc, setDisc] = useState(null); // {cidr, ports, scanning, results, picked, username, password}
  const [saving, setSaving] = useState(false);
  const [detect, setDetect] = useState({ busy: false, msg: '' });
  const [gpsBusy, setGpsBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const toast = useToast();

  async function load() {
    const [d, v] = await Promise.all([api.get('/api/devices'), api.get('/api/vendors')]);
    setDevices(d.devices);
    setVendors(v.vendors);
  }
  useEffect(() => { load().catch(e => toast.push('err', e.message)); }, []);

  function openAdd() { setModal({ mode: 'add', data: { ...EMPTY, pagerOff: vendors.find(v => v.id === EMPTY.vendor)?.defaultPort ? '' : '' } }); }
  function openEdit(d) {
    setModal({ mode: 'edit', data: { ...d, tags: (d.tags || []).join(', '), password: '' } });
  }

  async function detectFacts() {
    const d = modal.data;
    if (!d.host || !d.vendor) return toast.push('info', 'Isi host & vendor dulu');
    setDetect({ busy: true, msg: 'Menyambung ke perangkat...' });
    try {
      const r = await api.post('/api/devices/detect', {
        host: d.host, port: d.port, vendor: d.vendor, transport: d.transport,
        apiPort: d.apiPort, username: d.username, password: d.password,
        pagerOff: d.pagerOff, deviceId: modal.mode === 'edit' ? d.id : undefined
      });
      const f = r.facts || {};
      const model = f.boardName || f.model || '';
      setModal(m => ({ ...m, data: { ...m.data, model: model || m.data.model, name: m.data.name || f.hostname || m.data.name } }));
      setDetect({ busy: false, msg: `✔ ${f.hostname || '?'} · ${f.version || 'versi ?'}${model ? ' · ' + model : ''}` });
    } catch (e) {
      setDetect({ busy: false, msg: '✖ ' + e.message });
    }
  }

  // deteksi OS/firmware satu baris hasil discovery (pakai kredensial di form)
  async function detectRow(ip, port) {
    let result = null;
    setDisc(s => ({ ...s, results: s.results.map(c => c.ip === ip && c.port === port ? { ...c, detecting: true } : c) }));
    try {
      result = await api.post('/api/discover/facts', {
        host: ip, sshPort: port === 8728 ? undefined : port,
        transport: port === 8728 ? 'api' : 'ssh',
        apiPort: port === 8728 ? port : undefined,
        username: disc.username, password: disc.password
      });
      setDisc(s => ({
        ...s,
        results: s.results.map(c => c.ip === ip && c.port === port
          ? { ...c, os: result.os, hostName: result.hostname, model: result.model, vendor: c.port === 8728 ? 'mikrotik' : (result.vendor || c.guessVendor), detecting: false }
          : c)
      }));
    } catch (e) {
      setDisc(s => ({ ...s, results: s.results.map(c => c.ip === ip && c.port === port ? { ...c, os: '✖ ' + e.message.slice(0, 60), detecting: false } : c) }));
    }
  }

  function fillGps() {
    if (!navigator.geolocation) return toast.push('err', 'Browser tidak mendukung GPS');
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGpsBusy(false);
        setModal(m => ({ ...m, data: { ...m.data, location: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}` } }));
        toast.push('ok', `Koordinat terisi (akurasi ±${Math.round(pos.coords.accuracy)} m)`);
      },
      err => {
        setGpsBusy(false);
        toast.push('err', 'GPS gagal: ' + (err.code === 1 ? 'izin lokasi ditolak' : err.code === 2 ? 'posisi tidak tersedia' : 'timeout') + ' — isi manual');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  async function save() {
    setSaving(true);
    try {
      const body = { ...modal.data };
      if (modal.mode === 'add') await api.post('/api/devices', body);
      else await api.put(`/api/devices/${modal.data.id}`, body);
      toast.push('ok', modal.mode === 'add' ? 'Perangkat ditambahkan' : 'Perangkat diperbarui');
      setModal(null);
      await load();
    } catch (e) {
      toast.push('err', e.message);
    } finally { setSaving(false); }
  }

  async function remove(d) {
    if (!confirm(`Hapus perangkat "${d.name}" beserta backup-nya?`)) return;
    try {
      await api.del(`/api/devices/${d.id}`);
      toast.push('ok', 'Perangkat dihapus');
      await load();
    } catch (e) { toast.push('err', e.message); }
  }

  async function quickCheck(d) {
    toast.push('info', `Mengecek SSH ${d.name}...`);
    try {
      const r = await api.post(`/api/devices/${d.id}/check`);
      toast.push('ok', `${d.name}: online (${r.facts.hostname}, ${r.facts.version || '?'})`);
      await load();
    } catch (e) { toast.push('err', `${d.name}: ${e.message}`); }
  }

  if (!devices) return <Spinner />;
  const filtered = devices.filter(d =>
    !filter || [d.name, d.host, d.vendor, ...(d.tags || [])].join(' ').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-slate-100">Perangkat</h1>
        <div className="flex items-center gap-2">
          <input className={inputCls + ' w-64'} placeholder="Cari nama / host / tag..." value={filter} onChange={e => setFilter(e.target.value)} />
          <Button variant="ghost" onClick={() => setDisc({ cidr: '', ports: '22,8728', scanning: false, results: null, username: '', password: '' })}>
            <Radar size={14} /> Discovery
          </Button>          <Button onClick={openAdd}><Plus size={15} /> Tambah Perangkat</Button>
        </div>
      </div>

      <Card>
        {filtered.length === 0 ? <Empty>Belum ada perangkat yang cocok</Empty> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                <th className="pb-2">Nama</th><th className="pb-2">Host</th><th className="pb-2">Vendor</th><th className="pb-2">Lokasi</th><th className="pb-2">Tag</th><th className="pb-2">Status</th><th className="pb-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} className="border-t border-[#1e2a44]/60 hover:bg-slate-700/20">
                  <td className="py-2.5"><Link className="text-cyan-300 hover:underline font-medium" to={`/devices/${d.id}`}>{d.name}</Link></td>
                  <td className="py-2.5 text-slate-400 font-mono text-xs">{d.host}:{d.port}</td>
                  <td className="py-2.5"><Badge color="cyan">{getVendorMeta(d.vendor).label}</Badge></td>
                  <td className="py-2.5 text-slate-400 text-xs">{d.location || '-'}</td>
                  <td className="py-2.5">{(d.tags || []).length ? <span className="text-xs text-slate-500">{d.tags.join(', ')}</span> : '-'}</td>
                  <td className="py-2.5">
                    <span className="flex items-center gap-2">
                      <StatusDot status={d.status?.online} />
                      <span className="text-xs text-slate-400">{d.status?.online === true ? `${d.status.latencyMs != null ? d.status.latencyMs + ' ms' : 'online'}` : d.status?.online === false ? 'offline' : 'unknown'}</span>
                    </span>
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="ghost" title="Cek SSH" onClick={() => quickCheck(d)}><RadioTower size={14} /></Button>
                      <Button variant="ghost" title="Edit" onClick={() => openEdit(d)}><Pencil size={14} /></Button>
                      <Button variant="ghost" title="Hapus" onClick={() => remove(d)} className="hover:text-red-400"><Trash2 size={14} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={!!disc} onClose={() => setDisc(null)} title="Discovery — Scan Subnet + Deteksi OS/Firmware" wide>
        {disc && (
          <>
            <div className="grid md:grid-cols-2 gap-x-4">
              <Field label="Subnet (CIDR)" hint="Maksimal /22. Contoh: 10.9.0.0/24">
                <input className={inputCls + ' font-mono'} value={disc.cidr} onChange={e => setDisc(s => ({ ...s, cidr: e.target.value }))} placeholder="192.168.1.0/24" />
              </Field>
              <Field label="Port yang dicek (opsional)" hint="Kosong = fast scan: 22, 80, 443, 8728. Maks 6 port">
                <div className="flex gap-2">
                  <input className={inputCls + ' font-mono'} value={disc.ports} onChange={e => setDisc(s => ({ ...s, ports: e.target.value }))} placeholder="22, 8728" />
                  <Button loading={disc.scanning} onClick={async () => {
                    setDisc(s => ({ ...s, scanning: true, results: null }));
                    try {
                      const ports = disc.ports.split(',').map(x => Number(x.trim())).filter(Boolean);
                      const r = await api.post('/api/discover/scan', { cidr: disc.cidr, ...(ports.length ? { ports } : {}) });
                      const cands = r.candidates.map(c => ({ ...c, os: c.bannerHint || '', hostName: '', model: '', detecting: false }));
                      setDisc(s => ({ ...s, results: cands, scanning: false }));
                      // auto deep-detect (maks 12 host baru) bila kredensial diisi
                      if (disc.username && !document.hidden) {
                        const targets = cands.filter(c => !c.exists).slice(0, 12);
                        for (const t of targets) await detectRow(t.ip, t.port);
                      }
                    } catch (e) { toast.push('err', e.message); setDisc(s => ({ ...s, scanning: false })); }
                  }}><Radar size={14} /> Scan</Button>
                </div>
              </Field>
            </div>

            <div className="grid md:grid-cols-2 gap-x-4 mt-2 mb-3">
              <Field label="Username kredensial" hint="Untuk deteksi OS/firmware otomatis (opsional tapi disarankan)">
                <input className={inputCls} value={disc.username} onChange={e => setDisc(s => ({ ...s, username: e.target.value }))} placeholder="admin" autoComplete="off" />
              </Field>
              <Field label="Password"><SecretInput className={inputCls} value={disc.password} onChange={v => setDisc(s => ({ ...s, password: v }))} /></Field>
            </div>

            {disc.results && (
              <>
                <table className="w-full text-xs my-2">
                  <thead><tr className="text-left text-slate-500 uppercase tracking-wider">
                    <th className="pb-2 w-8"></th><th className="pb-2">IP</th><th className="pb-2">Port</th><th className="pb-2">Vendor</th><th className="pb-2">OS / Firmware</th><th className="pb-2">Hostname</th><th className="pb-2">Status</th><th className="pb-2"></th>
                  </tr></thead>
                  <tbody>
                    {disc.results.map((c, i) => (
                      <tr key={i} className={`border-t border-[#1e2a44]/60 ${c.exists ? 'opacity-40' : ''}`}>
                        <td className="py-2"><Checkbox size={14} disabled={c.exists}
                          checked={!c.exists && (disc.picked?.[i] ?? true)}
                          onChange={v => setDisc(s => ({ ...s, picked: { ...(s.picked || {}), [i]: v } }))} /></td>
                        <td className="py-2 font-mono">{c.ip}</td>
                        <td className="py-2 font-mono">{c.port} <Badge color={c.port === 8728 ? 'violet' : 'slate'}>{c.port === 8728 ? 'API' : 'SSH'}</Badge></td>
                        <td className="py-2">
                          <select className="bg-[#0b1220] border border-[#1e2a44] rounded px-1 py-0.5 text-[11px] text-slate-200"
                            value={c.guessVendor}
                            onChange={e => setDisc(s => ({ ...s, results: s.results.map((x, j) => j === i ? { ...x, guessVendor: e.target.value } : x) }))}>
                            {['mikrotik','cisco','ruijie','aruba','huawei','juniper','fortinet','sangfor','generic'].map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </td>
                        <td className="py-2 max-w-[180px] truncate text-slate-300" title={c.os}>{c.detecting ? '⟳ mendeteksi...' : (c.os || '-')}</td>
                        <td className="py-2 text-cyan-300 max-w-[120px] truncate">{c.hostName || '-'}</td>
                        <td className="py-2 text-xs">{c.exists ? <Badge color="slate">sudah ada</Badge> : <Badge color="green">baru</Badge>}</td>
                        <td className="py-2 text-right">
                          {!c.exists && (
                            <Button variant="ghost" loading={c.detecting} onClick={() => detectRow(c.ip, c.port)}>Deteksi</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {disc.results.length > 0 && !disc.results.some(c => !c.exists) && <Empty>Semua host yang ditemukan sudah terdaftar</Empty>}
              </>
            )}

            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" onClick={() => setDisc(null)}>Tutup</Button>
              <Button disabled={!disc.results || disc.scanning}
                onClick={async () => {
                  // gabungkan baris per IP: port 8728 = API, lainnya = SSH
                  const byIp = new Map();
                  disc.results.forEach((c, i) => {
                    if (c.exists) return;
                    const sel = disc.picked ? disc.picked[i] !== false : true;
                    if (!sel) return;
                    const cur = byIp.get(c.ip) || {
                      ip: c.ip, vendor: 'generic', name: c.hostName || c.ip,
                      model: c.model || '', os: c.os || '',
                      sshPort: null, apiPort: null, transport: 'ssh'
                    };
                    if (c.hostName) cur.name = c.hostName;
                    if (c.model) cur.model = c.model;
                    if (c.os) cur.os = c.os;
                    if (c.port === 8728) {
                      cur.apiPort = c.port;
                      if (c.guessVendor === 'mikrotik') cur.vendor = 'mikrotik';
                      if (cur.sshPort === null) cur.transport = 'api'; // hanya API tanpa SSH
                    } else {
                      cur.sshPort = c.port;
                      cur.transport = cur.apiPort ? 'api' : 'ssh';
                    }
                    byIp.set(c.ip, cur);
                  });
                  const items = [...byIp.values()].map(x => ({
                    ip: x.ip, ...(x.sshPort ? { port: x.sshPort } : {}), vendor: x.vendor,
                    transport: x.transport, apiPort: x.apiPort || undefined,
                    name: x.name, model: x.model, os: x.os
                  }));
                  if (!items.length) return toast.push('info', 'Tidak ada host dipilih');
                  try {
                    const r = await api.post('/api/discover/add', {
                      items,
                      username: disc.username, password: disc.password
                    });
                    toast.push('ok', `${r.added.length} perangkat ditambahkan`);
                    setDisc(null); await load();
                  } catch (e) { toast.push('err', e.message); }
                }}>Tambahkan Terpilih</Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'add' ? 'Tambah Perangkat' : 'Edit Perangkat'} wide>
        {modal && (
          <>
            <div className="grid md:grid-cols-2 gap-x-4">
              <Field label="Nama *"><input className={inputCls} value={modal.data.name} onChange={e => setModal(m => ({ ...m, data: { ...m.data, name: e.target.value } }))} placeholder="Router-GW-Jakarta" /></Field>
              <Field label="Vendor *">
                <select className={inputCls} value={modal.data.vendor} onChange={e => {
                  const v = vendors.find(x => x.id === e.target.value);
                  setModal(m => ({ ...m, data: { ...m.data, vendor: e.target.value, port: v ? v.defaultPort : m.data.port } }));
                }}>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.label} ({v.category})</option>)}
                </select>
              </Field>
              <Field label="Host / IP *"><input className={inputCls} value={modal.data.host} onChange={e => setModal(m => ({ ...m, data: { ...m.data, host: e.target.value } }))} placeholder="192.168.1.1" /></Field>
              <Field label="Port SSH"><input type="number" className={inputCls} value={modal.data.port} onChange={e => setModal(m => ({ ...m, data: { ...m.data, port: e.target.value } }))} /></Field>
              {modal.data.vendor === 'mikrotik' && (
                <>
                  <Field label="Transport MikroTik" hint="API = protokol RouterOS API (8728). Backup teks tetap fallback ke SSH bila aktif.">
                    <select className={inputCls} value={modal.data.transport || 'ssh'}
                      onChange={e => setModal(m => ({
                        ...m,
                        data: {
                          ...m.data,
                          transport: e.target.value,
                          apiPort: m.data.apiPort || (e.target.value === 'api-ssl' ? 8729 : 8728)
                        }
                      }))}>
                      <option value="ssh">SSH CLI (port 22)</option>
                      <option value="api">RouterOS API (8728)</option>
                      <option value="api-ssl">RouterOS API-SSL (8729)</option>
                    </select>
                  </Field>
                  {(modal.data.transport || 'ssh') !== 'ssh' && (
                    <Field label="Port API"><input type="number" className={inputCls} value={modal.data.apiPort || ''} onChange={e => setModal(m => ({ ...m, data: { ...m.data, apiPort: e.target.value } }))} placeholder="8728 / 8729" /></Field>
                  )}
                </>
              )}
              <Field label="Username"><input className={inputCls} value={modal.data.username} onChange={e => setModal(m => ({ ...m, data: { ...m.data, username: e.target.value } }))} placeholder="admin" /></Field>
              <Field label={modal.mode === 'edit' ? 'Password (kosongkan = tetap)' : 'Password'}><SecretInput className={inputCls} value={modal.data.password} onChange={v => setModal(m => ({ ...m, data: { ...m.data, password: v } }))} /></Field>
              <Field label="Model" hint={detect.msg || 'Klik Deteksi untuk ambil otomatis dari perangkat'}>
                <div className="flex gap-2">
                  <input className={inputCls} value={modal.data.model} onChange={e => setModal(m => ({ ...m, data: { ...m.data, model: e.target.value } }))} placeholder="otomatis via Deteksi..." />
                  <Button variant="ghost" loading={detect.busy} onClick={detectFacts}>Deteksi</Button>
                </div>
              </Field>
              <Field label="Lokasi" hint="Klik GPS untuk isi koordinat otomatis">
                <div className="flex gap-2">
                  <input className={inputCls + ' font-mono'} value={modal.data.location} onChange={e => setModal(m => ({ ...m, data: { ...m.data, location: e.target.value } }))} placeholder="-6.200000, 106.816667" />
                  <Button variant="ghost" loading={gpsBusy} onClick={fillGps}>GPS</Button>
                </div>
              </Field>
              <Field label="Tag (pisah koma)"><input className={inputCls} value={modal.data.tags} onChange={e => setModal(m => ({ ...m, data: { ...m.data, tags: e.target.value } }))} placeholder="core, production" /></Field>
              <Field label="Pager-off override" hint="Perintah nonaktifkan paging; pisah dengan ';'. Kosong = default driver">
                <input className={inputCls} value={modal.data.pagerOff || ''} onChange={e => setModal(m => ({ ...m, data: { ...m.data, pagerOff: e.target.value } }))} placeholder="terminal length 0" />
              </Field>
            </div>
            <Field label="Catatan"><textarea rows={2} className={inputCls} value={modal.data.notes || ''} onChange={e => setModal(m => ({ ...m, data: { ...m.data, notes: e.target.value } }))} /></Field>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setModal(null)}>Batal</Button>
              <Button loading={saving} onClick={save}>Simpan</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
