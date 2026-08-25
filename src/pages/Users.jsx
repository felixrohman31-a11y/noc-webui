/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Button, Badge, Field, inputCls, Spinner, Empty, Modal, useToast } from '../components/ui';
import { Users as UsersIcon, Trash2, KeyRound } from 'lucide-react';

const ROLE_COLOR = { admin: 'red', operator: 'cyan', viewer: 'slate' };

export default function Users() {
  const [users, setUsers] = useState(null);
  const { user: me } = useAuth();
  const [form, setForm] = useState({ username: '', password: '', role: 'operator' });
  const [reset, setReset] = useState(null); // {id, username}
  const toast = useToast();

  async function load() {
    setUsers((await api.get('/api/users')).users);
  }
  useEffect(() => { load().catch(e => toast.push('err', e.message)); }, []);

  if (!users) return <Spinner />;

  async function add() {
    try {
      await api.post('/api/users', form);
      toast.push('ok', `User ${form.username} dibuat`);
      setForm({ username: '', password: '', role: 'operator' });
      await load();
    } catch (e) { toast.push('err', e.message); }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><UsersIcon size={20} className="text-cyan-400" /> Manajemen Pengguna</h1>

      <Card title="Tambah User">
        <div className="grid md:grid-cols-3 gap-x-4">
          <Field label="Username"><input className={inputCls} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="teknisi1" /></Field>
          <Field label="Password" hint="min. 6 karakter"><input type="password" className={inputCls} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></Field>
          <Field label="Role" hint="viewer = hanya lihat; operator = boleh eksekusi perintah; admin = penuh">
            <select className={inputCls} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end mt-2"><Button onClick={add}>Buat User</Button></div>
      </Card>

      <Card title={`Daftar User (${users.length})`}>
        {users.length === 0 ? <Empty>Belum ada user</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
              <th className="pb-2">Username</th><th className="pb-2">Role</th><th className="pb-2">Dibuat</th><th className="pb-2 text-right">Aksi</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-[#1e2a44]/60 hover:bg-slate-700/20">
                  <td className="py-2 text-slate-200 font-medium">{u.username}{u.id === me?.sub && <span className="text-slate-500 text-xs"> (anda)</span>}</td>
                  <td className="py-2"><Badge color={ROLE_COLOR[u.role] || 'slate'}>{u.role}</Badge></td>
                  <td className="py-2 text-slate-400 text-xs">{new Date(u.createdAt).toLocaleDateString('id-ID')}</td>
                  <td className="py-2 text-right space-x-2 whitespace-nowrap">
                    <Button variant="ghost" onClick={() => setReset({ id: u.id, username: u.username })}><KeyRound size={13} /> Reset PW</Button>
                    <Button variant="ghost" disabled={u.username === 'admin' || u.id === me?.sub}
                      onClick={async () => {
                        if (!confirm(`Hapus user ${u.username}?`)) return;
                        try { await api.del(`/api/users/${u.id}`); toast.push('ok', 'User dihapus'); await load(); }
                        catch (e) { toast.push('err', e.message); }
                      }} className="hover:text-red-400 disabled:opacity-30"><Trash2 size={13} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={!!reset} onClose={() => setReset(null)} title={'Reset Password — ' + (reset?.username || '')}>
        {reset && <ResetForm reset={reset} done={() => { setReset(null); load(); }} />}
      </Modal>
    </div>
  );
}

function ResetForm({ reset, done }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <Field label="Password Baru"><input type="password" className={inputCls} value={pw} onChange={e => setPw(e.target.value)} autoFocus /></Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="subtle" loading={busy}
          onClick={async () => {
            setBusy(true);
            try { await api.post(`/api/users/${reset.id}/reset-password`, { newPassword: pw }); toast.push('ok', 'Password direset'); done(); }
            catch (e) { toast.push('err', e.message); }
            finally { setBusy(false); }
          }}>Simpan</Button>
      </div>
    </>
  );
}
