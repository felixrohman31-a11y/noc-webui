import React, { useEffect, useState } from 'react';
import { api, getToken } from '../api';
import { Card, Button, Field, inputCls, useToast, Badge } from '../components/ui';
import { Download, Plus, Trash2, Upload, Cpu, KeyRound } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [savingS, setSavingS] = useState(false);
  const [savingP, setSavingP] = useState(false);
  const [tpl, setTpl] = useState({ name: '', text: '' });
  const [templates, setTemplates] = useState([]);
  const [sysinfo, setSysinfo] = useState(null);
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState(null); // tampil sekali
  const [keyForm, setKeyForm] = useState({ name: '', role: 'operator' });
  const toast = useToast();

  async function loadAll() {
    const [s, t] = await Promise.all([api.get('/api/settings'), api.get('/api/templates')]);
    setSettings(s.settings);
    setTemplates(t.templates);
    try { setSysinfo((await api.get('/api/system/info'))); } catch {}
    try { setKeys((await api.get('/api/apikeys')).keys); } catch {}
  }
  useEffect(() => { loadAll().catch(e => toast.push('err', e.message)); }, []);

  async function saveSettings() {
    setSavingS(true);
    try {
      await api.put('/api/settings', settings);
      toast.push('ok', 'Pengaturan disimpan — scheduler dimuat ulang');
    } catch (e) { toast.push('err', e.message); }
    finally { setSavingS(false); }
  }

  async function changePassword() {
    setSavingP(true);
    try {
      await api.post('/api/auth/change-password', { oldPassword: oldPw, newPassword: newPw });
      toast.push('ok', 'Password berhasil diganti');
      setOldPw(''); setNewPw('');
    } catch (e) { toast.push('err', e.message); }
    finally { setSavingP(false); }
  }

  async function addTemplate() {
    if (!tpl.name || !tpl.text) return;
    try { await api.post('/api/templates', tpl); setTpl({ name: '', text: '' }); await loadAll(); toast.push('ok', 'Template disimpan'); }
    catch (e) { toast.push('err', e.message); }
  }
  async function delTemplate(id) {
    try { await api.del('/api/templates/' + id); await loadAll(); } catch (e) { toast.push('err', e.message); }
  }

  async function testTelegram() {
    try {
      await api.put('/api/settings', { telegramBotToken: settings.telegramBotToken, telegramChatId: settings.telegramChatId });
      const r = await api.post('/api/notify/test');
      r.ok ? toast.push('ok', 'Pesan test terkirim!') : toast.push('err', r.error);
    } catch (e) { toast.push('err', e.message); }
  }

  if (!settings) return null;
  const set = k => v => setSettings(s => ({ ...s, [k]: v }));
  const num = k => e => set(k)(e.target.value === '' ? '' : Number(e.target.value));

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-100">Pengaturan</h1>

      {/* ---------- MONITORING ---------- */}
      <Card title="Monitoring & SSH">
        <div className="grid md:grid-cols-2 gap-x-5 gap-y-1">
          <Field label="Interval polling status (detik)" hint="15 – 3600 detik">
            <input type="number" className={inputCls} value={settings.pollIntervalSec ?? 60} onChange={num('pollIntervalSec')} />
          </Field>
          <Field label="Timeout SSH/API (ms)" hint="2000 – 60000 ms">
            <input type="number" className={inputCls} value={settings.sshTimeoutMs ?? 10000} onChange={num('sshTimeoutMs')} />
          </Field>
          <Field label="Perintah backup — Generic" hint="Dipakai driver Generic">
            <input className={inputCls + ' font-mono'} value={settings.genericBackupCommand ?? ''} onChange={e => set('genericBackupCommand')(e.target.value)} />
          </Field>
          <Field label="Perintah versi — Generic" hint="Dipakai driver Generic">
            <input className={inputCls + ' font-mono'} value={settings.genericVersionCommand ?? ''} onChange={e => set('genericVersionCommand')(e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* ---------- AUTO BACKUP ---------- */}
      <Card title="Backup Otomatis & Retensi">
        <div className="grid md:grid-cols-3 gap-x-5 gap-y-1">
          <Field label="Status auto-backup">
            <select className={inputCls} value={settings.autoBackupEnabled ? '1' : '0'} onChange={e => set('autoBackupEnabled')(e.target.value === '1')}>
              <option value="0">Mati</option>
              <option value="1">Aktif</option>
            </select>
          </Field>
          <Field label="Interval (jam)" hint="1 – 720 jam">
            <input type="number" className={inputCls} value={settings.autoBackupHours ?? 24} onChange={num('autoBackupHours')} />
          </Field>
          <Field label="Retensi per device" hint="3 – 200 snapshot">
            <input type="number" className={inputCls} value={settings.retentionBackups ?? 20} onChange={num('retentionBackups')} />
          </Field>
        </div>
      </Card>

      {/* ---------- NOTIFIKASI ---------- */}
      <Card title="Notifikasi">
        <div className="grid md:grid-cols-2 gap-x-5 gap-y-1">
          <Field label="Webhook URL" hint="POST JSON saat status berubah (n8n/Discord relay). Kosong = mati" mb={false}>
            <input className={inputCls + ' font-mono'} placeholder="https://..." value={settings.webhookUrl ?? ''} onChange={e => set('webhookUrl')(e.target.value)} />
          </Field>
          <div />
          <Field label="Telegram Chat ID" hint="Dapatkan via @userinfobot" mb={false}>
            <input className={inputCls + ' font-mono'} placeholder="123456789" value={settings.telegramChatId ?? ''} onChange={e => set('telegramChatId')(e.target.value)} />
          </Field>
          <Field label="Telegram Bot Token" hint="Dari @BotFather" mb={false}>
            <input type="password" className={inputCls + ' font-mono'} placeholder="123456:ABC-DEF..." value={settings.telegramBotToken ?? ''} onChange={e => set('telegramBotToken')(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#1e2a44]">
          <span className="text-xs text-slate-500">Payload: {'{ event, device: {name,host,vendor}, ts }'}</span>
          <Button variant="ghost" onClick={testTelegram}>Kirim Pesan Test</Button>
        </div>
      </Card>

      {/* ---------- SIMPAN ---------- */}
      <div className="flex justify-end">
        <Button loading={savingS} onClick={saveSettings} className="px-6">Simpan Semua Pengaturan</Button>
      </div>

      {/* ---------- TEMPLATE ---------- */}
      <Card title="Template Perintah" right={<Badge color="cyan">{templates.length} tersimpan</Badge>}>
        {templates.length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">Belum ada template — template muncul sebagai tombol ★ di Command Center</p>
        ) : (
          <ul className="space-y-1.5 mb-4">
            {templates.map(t => (
              <li key={t.id} className="flex items-center gap-2 text-sm bg-[#0b1220] border border-[#1e2a44] rounded-lg px-3 py-2">
                <Badge color="cyan">{t.name}</Badge>
                <code className="text-xs text-slate-300 flex-1 truncate font-mono">{t.text}</code>
                <button className="text-slate-500 hover:text-red-400" onClick={() => delTemplate(t.id)}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid md:grid-cols-[1fr_2fr_auto] gap-3 items-end pt-3 border-t border-[#1e2a44]">
          <Field label="Nama" mb={false}>
            <input className={inputCls} value={tpl.name} onChange={e => setTpl(t => ({ ...t, name: e.target.value }))} placeholder="Cek interface down" />
          </Field>
          <Field label="Perintah" mb={false}>
            <input className={inputCls + ' font-mono'} value={tpl.text} onChange={e => setTpl(t => ({ ...t, text: e.target.value }))} placeholder="/interface print" />
          </Field>
          <Button variant="subtle" onClick={addTemplate} className="mb-0.5"><Plus size={14} /> Tambah</Button>
        </div>
      </Card>

      {/* ---------- ALERTING ---------- */}
      <Card title="Alerting & Ambang Batas">
        <div className="grid md:grid-cols-3 gap-x-5 gap-y-1">
          <Field label="Ambang latency (ms)" hint="0 = mati. Alert bila latency > nilai ini">
            <input type="number" className={inputCls} value={settings.alertLatencyMs ?? 0} onChange={num('alertLatencyMs')} />
          </Field>
          <Field label="Beruntun (x polling)" hint="Harus melewati ambang sebanyak N kali">
            <input type="number" className={inputCls} value={settings.alertConsecutiveN ?? 3} onChange={num('alertConsecutiveN')} />
          </Field>
          <Field label="Cooldown notifikasi (detik)" hint="Jeda minimal notifikasi per device — anti flapping">
            <input type="number" className={inputCls} value={settings.notifyCooldownSec ?? 300} onChange={num('notifyCooldownSec')} />
          </Field>
        </div>
      </Card>

      {/* ---------- API KEYS ---------- */}
      <Card title="API Key Otomasi" right={<KeyRound size={15} className="text-slate-500" />}>
        <p className="text-xs text-slate-500 mb-3">Pakai untuk script/curl: header <code className="text-cyan-300">X-API-Key</code> atau query <code className="text-cyan-300">?api_key=</code>. Role mengikuti batasan viewer/operator.</p>
        <ul className="space-y-1.5 mb-4">
          {keys.length === 0 && <li className="text-sm text-slate-500">Belum ada API key</li>}
          {keys.map(k => (
            <li key={k.id} className="flex items-center gap-2 text-sm bg-[#0b1220] border border-[#1e2a44] rounded-lg px-3 py-2">
              <Badge color="cyan">{k.name}</Badge>
              <span className="text-xs font-mono text-slate-400">{k.hint}</span>
              <Badge color={k.role === 'admin' ? 'red' : k.role === 'viewer' ? 'slate' : 'green'}>{k.role}</Badge>
              <span className="flex-1" />
              <button className="text-slate-500 hover:text-red-400" onClick={async () => {
                try { await api.del('/api/apikeys/' + k.id); await loadAll(); } catch (e) { toast.push('err', e.message); }
              }}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        {newKey && (
          <div className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="text-xs text-emerald-300 mb-1">Key baru (SALIN SEKARANG — tidak ditampilkan lagi):</div>
            <code className="text-xs font-mono text-emerald-200 break-all">{newKey}</code>
          </div>
        )}
        <div className="grid md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
          <Field label="Nama key" mb={false}>
            <input className={inputCls} value={keyForm.name} onChange={e => setKeyForm(f => ({ ...f, name: e.target.value }))} placeholder="grafana-bot" />
          </Field>
          <Field label="Role" mb={false}>
            <select className={inputCls} value={keyForm.role} onChange={e => setKeyForm(f => ({ ...f, role: e.target.value }))}>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </Field>
          <Button variant="subtle" onClick={async () => {
            if (!keyForm.name) return;
            try {
              const r = await api.post('/api/apikeys', keyForm);
              setNewKey(r.entry.key);
              setKeyForm({ name: '', role: 'operator' });
              await loadAll();
            } catch (e) { toast.push('err', e.message); }
          }} className="mb-0.5">Buat Key</Button>
        </div>
      </Card>

      {/* ---------- SYSTEM INFO ---------- */}
      {sysinfo && (
        <Card title="Kesehatan Server" right={<Cpu size={15} className="text-slate-500" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            {[
              ['Node', sysinfo.node],
              ['Uptime server', Math.floor(sysinfo.uptimeSec / 3600) + 'j ' + (Math.floor(sysinfo.uptimeSec / 60) % 60) + 'm'],
              ['RAM proses', sysinfo.rssMB + ' MB'],
              ['Ukuran DB', sysinfo.dbSizeKB + ' KB'],
              ['Device', sysinfo.devices],
              ['Backup', sysinfo.backups],
              ['Titik riwayat', sysinfo.historyPoints],
              ['Platform', sysinfo.platform]
            ].map(([k, v]) => (
              <div key={k} className="bg-[#0b1220] border border-[#1e2a44] rounded-lg py-2">
                <div className="text-sm font-semibold text-slate-200">{v}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">{k}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ---------- PASSWORD ---------- */}
      <Card title="Ganti Password Akun Saya">
        <div className="grid md:grid-cols-2 gap-x-5 gap-y-1">
          <Field label="Password Lama" mb={false}>
            <input type="password" className={inputCls} value={oldPw} onChange={e => setOldPw(e.target.value)} />
          </Field>
          <Field label="Password Baru" hint="Minimal 6 karakter" mb={false}>
            <input type="password" className={inputCls} value={newPw} onChange={e => setNewPw(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end mt-4 pt-3 border-t border-[#1e2a44]">
          <Button variant="subtle" loading={savingP} onClick={changePassword}>Ganti Password</Button>
        </div>
      </Card>

      {/* ---------- DATA ---------- */}
      <Card title="Data & Deployment">
        <div className="flex flex-wrap gap-3">
          <a href={`/api/admin/export?backups=1&token=${encodeURIComponent(getToken() || '')}`} download
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#1e2a44] text-sm text-cyan-300 hover:bg-slate-700/40">
            <Download size={14} /> Export (tanpa kredensial)
          </a>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#1e2a44] text-sm text-violet-300 hover:bg-slate-700/40 cursor-pointer">
            <Upload size={14} /> Import dari file JSON
            <input type="file" accept=".json" className="hidden" onChange={e => {
              const file = e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = async ev => {
                try {
                  const data = JSON.parse(ev.target.result);
                  if (!confirm(`Import ${data.devices?.length || 0} device, ${data.users?.length || 0} user, ${(data.backups || []).length} backup? Duplikat otomatis dilewati.`)) return;
                  const r = await api.post('/api/admin/import', data);
                  toast.push('ok', `Import selesai: +${r.addedDevices} device, +${r.addedUsers} user, +${r.addedBackups} backup (${r.skippedDevices} duplikat dilewati)`);
                  await loadAll();
                } catch (ex) { toast.push('err', 'Import gagal: ' + ex.message); }
              };
              reader.readAsText(file);
            }} />
          </label>
        </div>
        <ul className="text-sm text-slate-400 space-y-1.5 list-disc list-inside mt-4 pt-3 border-t border-[#1e2a44]">
          <li>Berjalan di Windows & Linux (Node.js ≥ 18), tanpa dependensi native</li>
          <li>Data di folder <code className="text-cyan-300">data/</code> (db.json + history.json + kunci enkripsi)</li>
          <li>Docker: <code className="text-cyan-300">docker compose up -d</code></li>
        </ul>
      </Card>
    </div>
  );
}
