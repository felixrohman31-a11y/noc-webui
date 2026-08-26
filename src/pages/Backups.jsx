/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Card, Button, Empty, Spinner, Modal, Field, inputCls, useToast } from '../components/ui';
import { Archive } from 'lucide-react';

export default function Backups() {
  const [rows, setRows] = useState(null);
  const [diff, setDiff] = useState(null);
  const [sideBySide, setSideBySide] = useState(false);
  const [cmp, setCmp] = useState({ device: null, oldId: null, newId: null });
  const toast = useToast();

  async function load() {
    const d = await api.get('/api/backups');
    setRows(d.backups);
  }
  useEffect(() => { load().catch(e => toast.push('err', e.message)); }, []);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const map = {};
    for (const r of rows) (map[r.deviceName] = map[r.deviceName] || []).push(r);
    return Object.entries(map).sort();
  }, [rows]);

  function lineDiff(a, b) {
    const al = a.split('\n'), bl = b.split('\n');
    const setA = new Set(al.map(s => s.trim()));
    const setB = new Set(bl.map(s => s.trim()));
    const out = ['=== Hanya di backup LAMA (-) / BARU (+) ===', ''];
    for (const l of al) if (!setB.has(l.trim()) && l.trim()) out.push('- ' + l);
    for (const l of bl) if (!setA.has(l.trim()) && l.trim()) out.push('+ ' + l);
    return out.join('\n') || '(tidak ada perbedaan)';
  }

  async function compareIds(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return toast.push('info', 'Pilih dua versi yang berbeda');
    try {
      const [a, b] = await Promise.all([api.get(`/api/backups/${oldId}`), api.get(`/api/backups/${newId}`)]);
      const ca = a.backup.content || '';
      const cb = b.backup.content || '';
      if (ca.startsWith('[API mode]') || cb.startsWith('[API mode]')) {
        return toast.push('err', 'Salah satu snapshot adalah backup biner on-device (bukan teks config) — tidak bisa dibandingkan');
      }
      setDiff({
        oldB: a.backup, newB: b.backup,
        title: `${a.backup.deviceName}: ${new Date(a.backup.createdAt).toLocaleString('id-ID')}  →  ${new Date(b.createdAt).toLocaleString('id-ID')}`,
        text: lineDiff(ca, cb)
      });
    } catch (e) { toast.push('err', e.message); }
  }

  async function quickCompare(deviceName) {
    const list = rows.filter(r => r.deviceName === deviceName && !r.fallback).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (list.length < 2) return toast.push('info', 'Butuh minimal 2 backup teks untuk dibandingkan (snapshot fallback tidak dihitung)');
    setCmp({ device: deviceName, oldId: list[1].id, newId: list[0].id });
    await compareIds(list[1].id, list[0].id);
  }

  if (!rows) return <Spinner />;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Archive size={20} className="text-violet-400" /> Backup Konfigurasi</h1>
      {grouped.length === 0 ? (
        <Card><Empty>Belum ada backup — buka detail perangkat lalu klik "Backup Config"</Empty></Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {grouped.map(([name, list]) => (
            <Card key={name} title={name} right={<Button variant="ghost" onClick={() => quickCompare(name)}>Bandingkan 2 terakhir</Button>}>
              <ul className="space-y-1.5 max-h-56 overflow-auto text-sm">
                {[...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(b => (
                  <li key={b.id} className="flex items-center justify-between">
                    <span className="text-slate-300">{new Date(b.createdAt).toLocaleString('id-ID')}</span>
                    <span className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500">{(b.sizeBytes / 1024).toFixed(1)} KB</span>
                      <a href={`/api/backups/${b.id}/download?token=${encodeURIComponent(localStorage.getItem('noc_token') || '')}`} download>
                        <span className="text-cyan-300 hover:underline cursor-pointer">unduh</span>
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {/* Panel pembanding bebas */}
      {grouped.length > 0 && (
        <Card title="Bandingkan Dua Versi Sembarangan">
          <div className="grid md:grid-cols-[1fr_1fr_1fr_2fr_auto] gap-3 items-end">
            <Field label="Device" mb={false}>
              <select className={inputCls} value={cmp.device || ''} onChange={e => setCmp(c => ({ ...c, device: e.target.value, oldId: null, newId: null }))}>
                <option value="">— pilih —</option>
                {grouped.map(([n]) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Versi lama" mb={false}>
              <select className={inputCls} value={cmp.oldId || ''} onChange={e => setCmp(c => ({ ...c, oldId: e.target.value }))}>
                <option value="">—</option>
                {(rows || []).filter(r => (!cmp.device || r.deviceName === cmp.device) && !r.fallback)
                  .map(b => <option key={b.id} value={b.id}>{new Date(b.createdAt).toLocaleString('id-ID')}</option>)}
              </select>
            </Field>
            <Field label="Versi baru" mb={false}>
              <select className={inputCls} value={cmp.newId || ''} onChange={e => setCmp(c => ({ ...c, newId: e.target.value }))}>
                <option value="">—</option>
                {(rows || []).filter(r => (!cmp.device || r.deviceName === cmp.device) && r.id !== cmp.oldId && !r.fallback)
                  .map(b => <option key={b.id} value={b.id}>{new Date(b.createdAt).toLocaleString('id-ID')}</option>)}
              </select>
            </Field>
            <div className="flex items-center gap-2 pb-0.5">
              <label className="text-xs text-slate-400 flex items-center gap-1.5">
                <input type="checkbox" className="accent-cyan-500" checked={sideBySide} onChange={e => setSideBySide(e.target.checked)} />
                Side-by-side
              </label>
            </div>
            <Button onClick={() => compareIds(cmp.oldId, cmp.newId)}>Bandingkan</Button>
          </div>
        </Card>
      )}

      <Modal open={!!diff} onClose={() => setDiff(null)} title={'Perbandingan Konfigurasi'} wide>
        {diff && (
          <>
            <div className="text-slate-400 text-xs mb-2">{diff.title}</div>
            {sideBySide ? (
              <div className="grid md:grid-cols-2 gap-3">
                {[{ t: 'LAMA', b: diff.oldB }, { t: 'BARU', b: diff.newB }].map(({ t, b }) => (
                  <div key={t} className="border border-[#1e2a44] rounded-lg overflow-hidden">
                    <div className="bg-slate-800/60 px-3 py-1.5 text-xs text-slate-400">{t} — {new Date(b.createdAt).toLocaleString('id-ID')} ({(b.sizeBytes / 1024).toFixed(1)} KB)</div>
                    <pre className="terminal-out bg-[#0b1220] p-3 max-h-[55vh] overflow-auto text-[11px] text-slate-300">{b.content}</pre>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="terminal-out bg-[#0b1220] border border-[#1e2a44] rounded-lg p-4 max-h-[65vh] overflow-auto text-xs">
                {diff.text.split('\n').slice(0, 4000).map((l, i) => (
                  <div key={i} className={l.startsWith('+') ? 'text-emerald-400' : l.startsWith('-') ? 'text-red-400' : 'text-slate-300'}>{l}</div>
                ))}
                {diff.text.split('\n').length > 4000 && <div className="text-slate-500 mt-2">... {diff.text.split('\n').length - 4000} baris berikutnya dipotong tampilan (unduh untuk melihat lengkap)</div>}
              </pre>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
