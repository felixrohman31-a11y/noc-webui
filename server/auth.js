/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const TOKEN_TTL = '12h';
let _secret = null;

/** Secret JWT: dari env, atau auto-generate + persist (tidak ada lagi default hardcoded) */
function getSecret() {
  if (_secret) return _secret;
  if (process.env.NOC_JWT_SECRET) { _secret = process.env.NOC_JWT_SECRET; return _secret; }
  const f = path.join(store.DATA_DIR, 'jwt.secret');
  try {
    _secret = fs.readFileSync(f, 'utf8').trim();
    if (_secret) return _secret;
  } catch {}
  _secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, _secret, { mode: 0o600 });
  console.warn('[auth] NOC_JWT_SECRET tidak diset — secret acak digenerate & disimpan di ' + f);
  console.warn('[auth] CATATAN: restart menghapus sesi login jika file ini hilang. Set NOC_JWT_SECRET untuk deployment multi-instans.');
  return _secret;
}

// ---- rate limit login sederhana (per IP) ----
const attempts = new Map(); // ip -> {count, resetAt}
const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a) return true;
  if (Date.now() > a.resetAt) { attempts.delete(ip); return true; }
  return a.count < MAX_FAILS;
}
function loginFail(ip) {
  const a = attempts.get(ip) || { count: 0, resetAt: Date.now() + WINDOW_MS };
  if (Date.now() > a.resetAt) { a.count = 0; a.resetAt = Date.now() + WINDOW_MS; }
  a.count++;
  attempts.set(ip, a);
  return MAX_FAILS - a.count;
}

const ROLES = ['admin', 'operator', 'viewer'];

function ensureAdminUser() {
  const db = store.getDb();
  if (db.users.length === 0) {
    db.users.push({
      id: store.nextId('usr'),
      username: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    store.save();
    console.log('[auth] seeded default user -> admin / admin123');
  }
}

function sign(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role || 'operator' }, getSecret(), { expiresIn: TOKEN_TTL });
}

function verify(token) {
  try { return jwt.verify(token, getSecret()); } catch { return null; }
}

// ---- API key: disimpan sebagai SHA-256 hash (bukan plaintext) ----
function hashKey(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}
function safeEqualHex(aHex, bHex) {
  const a = Buffer.from(aHex, 'hex'), b = Buffer.from(bHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function findApiKey(plainKey) {
  const list = store.getDb().settings.apiKeys || [];
  const inputHash = hashKey(plainKey);
  for (const k of list) {
    if (k.key && !k.keyHash) { // migrasi entri lama yang masih plaintext
      k.keyHash = hashKey(k.key);
      k.hint = k.key.slice(0, 6) + '...';
      delete k.key;
      store.save();
    }
    if (k.keyHash && safeEqualHex(inputHash, k.keyHash)) return k;
  }
  return null;
}

function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || (req.query && req.query.api_key);
  if (apiKey) {
    const entry = findApiKey(String(apiKey));
    if (!entry) return res.status(401).json({ error: 'API key tidak valid' });
    req.user = { sub: 'apikey:' + entry.name, username: 'apikey:' + entry.name, role: entry.role || 'operator' };
    return next();
  }
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query && req.query.token);
  const payload = token && verify(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = payload;

  // viewer = read-only untuk seluruh API kecuali ganti password sendiri
  if ((payload.role || 'viewer') === 'viewer' && req.method !== 'GET' &&
      !req.path.startsWith('/auth/change-password')) {
    return res.status(403).json({ error: 'Akun viewer hanya memiliki akses baca' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Khusus akun admin' });
  next();
}

function authenticate(username, password) {
  const db = store.getDb();
  const user = db.users.find(u => u.username === username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.passwordHash)) return null;
  return user;
}

function changePassword(userId, oldPass, newPass) {
  const db = store.getDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) return { ok: false, error: 'user not found' };
  if (!bcrypt.compareSync(oldPass, user.passwordHash)) return { ok: false, error: 'Password lama salah' };
  if (!newPass || newPass.length < 6) return { ok: false, error: 'Password baru minimal 6 karakter' };
  user.passwordHash = bcrypt.hashSync(newPass, 10);
  store.save();
  return { ok: true };
}

// ---- manajemen user (admin) ----
function listUsers() {
  return store.getDb().users.map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
}
function createUser(username, password, role) {
  const db = store.getDb();
  if (!username || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return { error: 'Username 3-32 char (huruf/angka/._-)' };
  if (!password || password.length < 6) return { error: 'Password minimal 6 karakter' };
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return { error: 'Username sudah dipakai' };
  const r = ROLES.includes(role) ? role : 'operator';
  const u = { id: store.nextId('usr'), username, passwordHash: bcrypt.hashSync(password, 10), role: r, createdAt: new Date().toISOString() };
  db.users.push(u);
  store.save();
  return { user: { id: u.id, username: u.username, role: u.role } };
}
function deleteUser(id, requesterId) {
  const db = store.getDb();
  if (id === requesterId) return { error: 'Tidak bisa menghapus akun sendiri' };
  const idx = db.users.findIndex(u => u.id === id);
  if (idx < 0) return { error: 'User tidak ditemukan' };
  if (db.users[idx].username === 'admin') return { error: 'User admin utama tidak boleh dihapus' };
  const [rm] = db.users.splice(idx, 1);
  store.save();
  return { removed: rm.username };
}
function resetPassword(id, newPass) {
  const db = store.getDb();
  const u = db.users.find(x => x.id === id);
  if (!u) return { error: 'User tidak ditemukan' };
  if (!newPass || newPass.length < 6) return { error: 'Password minimal 6 karakter' };
  u.passwordHash = bcrypt.hashSync(newPass, 10);
  store.save();
  return { ok: true };
}
function setRole(id, role) {
  if (!ROLES.includes(role)) return { error: 'Role tidak valid' };
  const u = store.getDb().users.find(x => x.id === id);
  if (!u) return { error: 'User tidak ditemukan' };
  if (u.username === 'admin' && role !== 'admin') return { error: 'Role admin utama tidak boleh diubah' };
  u.role = role;
  store.save();
  return { ok: true };
}

module.exports = {
  ROLES, ensureAdminUser, sign, verify, authMiddleware, requireAdmin,
  authenticate, changePassword, loginAllowed, loginFail,
  listUsers, createUser, deleteUser, resetPassword, setRole, hashKey
};
