/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

const express = require('express');
const store = require('./store');
const auth = require('./auth');
const { getVendor, devicePassword } = require('./drivers/vendors');
const { withSession, tcpProbe, probePort, isApiTransport } = require('./drivers/base');
const { broadcast, pollOnce } = require('./scheduler');

const router = express.Router();

// ---- rate limiter ringan utk endpoint mahal ----
const rlMap = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (rlMap.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  rlMap.set(key, arr);
  return true;
}
function tooMany(res) { return res.status(429).json({ error: 'Terlalu banyak permintaan — coba lagi nanti' }); }

// ---- cache snapshot data Config UI (menstabilkan tabel dinamis spt BGP) ----
const rosDataCache = new Map(); // devId|menuKey -> {ts, rows, total}
const MAX_ROWS_SENT = 1000;

function sanitizeDevice(d) {
  const { passwordEnc, ...rest } = d;
  return rest;
}

function findDevice(id) {
  return store.getDb().devices.find(d => d.id === id);
}

// ---------- AUTH ----------
// Perintah destruktif diblokir dari panel (semua vendor)
const DESTRUCTIVE_RE = /(reboot|shutdown|reload|reset[- _]?config|restore[- _]?default|factory[- _]?reset|write?[- ]?erase|wr\s+er|erase\b|format\b|del\s+flash|delete\s+flash|\brm\s|mkfs|dd\s+if=|system\s+reset|sys\s+reset|remove\s+configuration)/i;

router.post('/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!auth.loginAllowed(ip)) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit.' });
  }
  const { username, password } = req.body || {};
  const user = auth.authenticate(username || '', password || '');
  if (!user) {
    const left = auth.loginFail(ip);
    store.audit('login.failed', `username=${username} ip=${ip}`);
    return res.status(401).json({ error: 'Username atau password salah' + (left <= 2 ? ` (${left} percobaan tersisa)` : '') });
  }
  store.audit('login', 'user logged in', user.username, ip);
  const weakPassword = user.username === 'admin' && require('bcryptjs').compareSync('admin123', user.passwordHash);
  res.json({ token: auth.sign(user), user: { id: user.id, username: user.username, role: user.role }, weakPassword });
});

router.get('/auth/me', auth.authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

router.post('/auth/logout', auth.authMiddleware, (req, res) => {
  store.audit('logout', 'user logged out', req.user.username, req.ip);
  res.json({ ok: true });
});

router.post('/auth/change-password', auth.authMiddleware, (req, res) => {
  const r = auth.changePassword(req.user.sub, req.body.oldPassword, req.body.newPassword);
  if (!r.ok) return res.status(400).json({ error: r.error });
  store.audit('password.changed', 'password changed', req.user.username, req.ip);
  res.json({ ok: true });
});

// ---------- MANAJEMEN USER (admin) ----------
router.get('/users', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  res.json({ users: auth.listUsers() });
});

router.post('/users', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const r = auth.createUser((req.body || {}).username, (req.body || {}).password, (req.body || {}).role);
  if (r.error) return res.status(400).json({ error: r.error });
  store.audit('user.created', `${r.user.username} (${r.user.role})`, req.user.username, req.ip);
  res.json({ user: r.user });
});

router.delete('/users/:id', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const r = auth.deleteUser(req.params.id, req.user.sub);
  if (r.error) return res.status(400).json({ error: r.error });
  store.audit('user.deleted', r.removed, req.user.username, req.ip);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const r = auth.resetPassword(req.params.id, (req.body || {}).newPassword);
  if (r.error) return res.status(400).json({ error: r.error });
  store.audit('user.resetpw', req.params.id, req.user.username, req.ip);
  res.json({ ok: true });
});

router.post('/users/:id/role', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const r = auth.setRole(req.params.id, (req.body || {}).role);
  if (r.error) return res.status(400).json({ error: r.error });
  store.audit('user.role', `${req.params.id} -> ${(req.body || {}).role}`, req.user.username, req.ip);
  res.json({ ok: true });
});

// ---------- DEVICES ----------
router.get('/devices', auth.authMiddleware, (req, res) => {
  const { getPoints, uptimePct } = require('./scheduler');
  res.json({
    devices: store.getDb().devices.map(d => ({
      ...sanitizeDevice(d),
      hist: getPoints(d.id),
      uptimePct: uptimePct(d.id)
    }))
  });
});

router.post('/devices', auth.authMiddleware, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.host || !b.vendor) return res.status(400).json({ error: 'name, host, vendor wajib diisi' });
  if (!devicePassword({ passwordEnc: null }) && !b.password) return res.status(400).json({ error: 'password wajib diisi' });
  const db = store.getDb();
  const v = getVendor(b.vendor);
  const device = {
    id: store.nextId('dev'),
    name: b.name,
    host: b.host,
    port: Number(b.port) || v.defaultPort,
    vendor: b.vendor,
    model: b.model || '',
    location: b.location || '',
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    username: b.username || '',
    passwordEnc: require('./crypto').encrypt(b.password || ''),
    pagerOff: b.pagerOff || '',
    transport: b.vendor === 'mikrotik' ? (b.transport === 'api' || b.transport === 'api-ssl' ? b.transport : 'ssh') : 'ssh',
    apiPort: Number(b.apiPort) || undefined,
    enabled: b.enabled !== false,
    notes: b.notes || '',
    status: { online: null, latencyMs: null, lastChecked: null },
    createdAt: new Date().toISOString()
  };
  db.devices.push(device);
  store.save();
  store.audit('device.created', `${device.name} (${device.host}, ${v.label})`, req.user.username);
  broadcast('devices', {});
  res.json({ device: sanitizeDevice(device) });
});

router.put('/devices/:id', auth.authMiddleware, (req, res) => {
  const d = findDevice(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device tidak ditemukan' });
  const b = req.body || {};
  for (const k of ['name', 'host', 'model', 'location', 'pagerOff', 'notes', 'vendor']) {
    if (b[k] !== undefined) d[k] = b[k];
  }
  if (b.port !== undefined) d.port = Number(b.port) || d.port;
  if (b.username !== undefined) d.username = b.username;
  if (b.password) d.passwordEnc = require('./crypto').encrypt(b.password);
  if (b.transport !== undefined) d.transport = b.vendor === 'mikrotik' || d.vendor === 'mikrotik' ? (['api', 'api-ssl'].includes(b.transport) ? b.transport : 'ssh') : 'ssh';
  if (b.apiPort !== undefined) d.apiPort = Number(b.apiPort) || undefined;
  if (b.tags !== undefined) d.tags = Array.isArray(b.tags) ? b.tags : String(b.tags).split(',').map(t => t.trim()).filter(Boolean);
  if (b.enabled !== undefined) d.enabled = !!b.enabled;
  store.save();
  store.audit('device.updated', d.name, req.user.username);
  broadcast('devices', {});
  res.json({ device: sanitizeDevice(d) });
});

router.delete('/devices/:id', auth.authMiddleware, (req, res) => {
  const db = store.getDb();
  const idx = db.devices.findIndex(d => d.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Device tidak ditemukan' });
  const [removed] = db.devices.splice(idx, 1);
  db.backups = db.backups.filter(x => x.deviceId !== removed.id);
  store.save();
  store.audit('device.deleted', removed.name, req.user.username);
  broadcast('devices', {});
  res.json({ ok: true });
});

// Daftar interface: tabel asli utk MikroTik-API, teks CLI utk vendor lain
router.get('/devices/:id/interfaces', auth.authMiddleware, async (req, res) => {
  const d = findDevice(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device tidak ditemukan' });
  const v = getVendor(d.vendor);
  const pw = devicePassword(d);
  const to = (store.getDb().settings.sshTimeoutMs || 10000) + 10000;
  try {
    if (isApiTransport(d)) {
      let out;
      try {
        out = await withSession(d, pw, s => s.api.sentence(['/interface/print', '=stats=']), to);
      } catch {
        out = await withSession(d, pw, s => s.api.sentence(['/interface/print']), to);
      }
      return res.json({ mode: 'rows', rows: out.rows });
    }
    const text = await withSession(d, pw, s => v.interfaces(s), to);
    res.json({ mode: 'text', text });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Deteksi fakta one-off utk form (belum perlu device tersimpan)
router.post('/devices/detect', auth.authMiddleware, async (req, res) => {
  if (!rateLimit('det:' + req.ip, 10, 60000)) return tooMany(res);
  const b = req.body || {};
  if (!b.host || !b.vendor) return res.status(400).json({ error: 'host & vendor wajib' });
  const v = getVendor(b.vendor);
  const dev = {
    name: 'detect', host: b.host, port: Number(b.port) || v.defaultPort, vendor: b.vendor,
    transport: b.vendor === 'mikrotik' ? (b.transport || 'ssh') : 'ssh',
    apiPort: Number(b.apiPort) || undefined,
    username: b.username || '', pagerOff: b.pagerOff || ''
  };
  let password = b.password || '';
  if (!password && b.deviceId) {
    const saved = findDevice(b.deviceId);
    if (saved) password = devicePassword(saved);
  }
  try {
    const facts = await withSession(dev, password, s => v.facts(s),
      (store.getDb().settings.sshTimeoutMs || 10000) + 8000);
    res.json({ facts });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- DEVICE ACTIONS ----------
router.post('/devices/:id/check', auth.authMiddleware, async (req, res) => {
  const d = findDevice(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device tidak ditemukan' });
  const v = getVendor(d.vendor);
  try {
    const facts = await withSession(d, devicePassword(d), s => v.facts(s), store.getDb().settings.sshTimeoutMs + 5000);
    d.facts = facts;
    d.factsAt = new Date().toISOString();
    // model otomatis dari firmware/board perangkat
    const autoModel = facts.boardName || facts.model;
    if (autoModel) d.model = autoModel;
    const probe = await tcpProbe(d.host, probePort(d), 3000);
    d.status = { online: true, latencyMs: probe.latencyMs, lastChecked: new Date().toISOString() };
    d.lastSeen = new Date().toISOString();
    store.save();
    store.audit('device.check', `${d.name} - SSH OK`, req.user.username);
    broadcast('status', {});
    res.json({ facts, status: d.status });
  } catch (e) {
    d.status = { online: false, latencyMs: null, lastChecked: new Date().toISOString(), error: e.message };
    store.save();
    res.status(502).json({ error: e.message });
  }
});

router.post('/devices/:id/command', auth.authMiddleware, async (req, res) => {
  const d = findDevice(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device tidak ditemukan' });
  const cmd = String(req.body.command || '').trim();
  if (!cmd) return res.status(400).json({ error: 'command kosong' });
  if (DESTRUCTIVE_RE.test(cmd)) {
    return res.status(400).json({ error: 'Perintah destruktif diblokir dari panel ini' });
  }
  if (!rateLimit('cmd:' + req.ip, 60, 60000)) return tooMany(res);
  try {
    const out = await withSession(d, devicePassword(d), async s => await s.run(cmd), store.getDb().settings.sshTimeoutMs + 15000);
    store.audit('command.run', `${d.name}: ${cmd}`, req.user.username);
    res.json({ output: out });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post('/devices/:id/backup', auth.authMiddleware, async (req, res) => {
  const d = findDevice(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device tidak ditemukan' });
  try {
    const { performBackup } = require('./backup');
    const backup = await performBackup(d, req.user.username);
    res.json({ backup: { ...backup, content: undefined } });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/backups', auth.authMiddleware, (req, res) => {
  const rows = store.getDb().backups
    .map(({ content, ...r }) => ({ ...r, hasContent: true, fallback: typeof content === 'string' && content.startsWith('[API mode]') }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ backups: rows });
});

router.get('/backups/:id', auth.authMiddleware, (req, res) => {
  const b = store.getDb().backups.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Backup tidak ditemukan' });
  res.json({ backup: b });
});

router.get('/backups/:id/download', auth.authMiddleware, (req, res) => {
  const b = store.getDb().backups.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Backup tidak ditemukan' });
  res.setHeader('Content-Disposition', `attachment; filename="${b.deviceName}-${b.createdAt.replace(/[:.]/g, '-')}.cfg"`);
  res.type('text/plain').send(b.content);
});

router.post('/bulk/run', auth.authMiddleware, async (req, res) => {
  const { deviceIds = [], command } = req.body || {};
  const cmd = String(command || '').trim();
  if (!cmd) return res.status(400).json({ error: 'command kosong' });
  if (DESTRUCTIVE_RE.test(cmd)) return res.status(400).json({ error: 'Perintah destruktif diblokir dari panel ini' });
  if (!rateLimit('bulk:' + req.ip, 10, 60000)) return tooMany(res);
  const devices = deviceIds.map(findDevice).filter(Boolean);
  if (!devices.length) return res.status(400).json({ error: 'tidak ada device dipilih' });

  const CONCURRENCY = 5;
  const results = [];
  let i = 0;
  async function worker() {
    while (i < devices.length) {
      const d = devices[i++];
      try {
        const output = await withSession(d, devicePassword(d), s => s.run(cmd), store.getDb().settings.sshTimeoutMs + 15000);
        results.push({ deviceId: d.id, name: d.name, ok: true, output });
      } catch (e) {
        results.push({ deviceId: d.id, name: d.name, ok: false, output: '', error: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, devices.length) }, worker));
  store.audit('bulk.run', `"${cmd}" pada ${devices.length} device`, req.user.username);
  res.json({ results });
});

// ---------- DASHBOARD / AUDIT / SETTINGS ----------
router.get('/dashboard', auth.authMiddleware, (req, res) => {
  const db = store.getDb();
  const devices = db.devices;
  const byVendor = {};
  let online = 0, offline = 0, unknown = 0;
  for (const d of devices) {
    byVendor[d.vendor] = (byVendor[d.vendor] || 0) + 1;
    if (d.status?.online === true) online++;
    else if (d.status?.online === false) offline++;
    else unknown++;
  }
  const { getPoints, uptimePct } = require('./scheduler');
  res.json({
    stats: {
      total: devices.length,
      online,
      offline,
      unknown,
      backups: db.backups.length,
      commands24h: db.auditLogs.filter(l => l.action.startsWith('command') && new Date(l.ts) > new Date(Date.now() - 86400000)).length
    },
    byVendor,
    devices: devices.map(d => ({
      ...sanitizeDevice(d),
      hist: getPoints(d.id),
      uptimePct: uptimePct(d.id)
    })),
    recentAudit: db.auditLogs.slice(0, 12)
  });
});

// ---------- TEMPLATE PERINTAH ----------
router.get('/templates', auth.authMiddleware, (req, res) => {
  res.json({ templates: store.getDb().settings.commandTemplates || [] });
});

router.post('/templates', auth.authMiddleware, (req, res) => {
  const { name, text } = req.body || {};
  if (!name || !text) return res.status(400).json({ error: 'name & text wajib' });
  const s = store.getDb().settings;
  s.commandTemplates = s.commandTemplates || [];
  const t = { id: 'tpl-' + Date.now().toString(36), name: String(name).slice(0, 60), text: String(text).slice(0, 2000) };
  s.commandTemplates.push(t);
  store.save();
  res.json({ template: t });
});

router.delete('/templates/:id', auth.authMiddleware, (req, res) => {
  const s = store.getDb().settings;
  s.commandTemplates = (s.commandTemplates || []).filter(t => t.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

// ---------- EXPORT DATA NOC (admin) ----------
router.get('/admin/export', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const db = store.getDb();
  const includeBackups = String(req.query.backups || '') === '1';
  const withCreds = String(req.query.credentials || '') === '1'; // plaintext utk migrasi lintas-server
  const { decrypt } = require('./crypto');
  res.setHeader('Content-Disposition', `attachment; filename="noc-export-${Date.now()}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    version: 1,
    settings: db.settings,
    users: db.users.map(({ passwordHash, ...u }) => u),
    devices: db.devices.map(d => ({
      ...d,
      status: d.status || { online: null },
      passwordPlain: withCreds ? decrypt(d.passwordEnc) : undefined
    })),
    backups: includeBackups ? db.backups : db.backups.map(({ content, ...b }) => b)
  });
});

router.get('/audit', auth.authMiddleware, (req, res) => {
  res.json({ logs: store.getDb().auditLogs.slice(0, 300) });
});

router.get('/settings', auth.authMiddleware, (req, res) => {
  const s = { ...store.getDb().settings };
  if (req.user.role !== 'admin') {
    // sembunyikan kredensial integrasi dari non-admin
    s.telegramBotToken = s.telegramBotToken ? '<tersimpan>' : '';
    s.apiKeys = undefined;
  }
  res.json({ settings: s });
});

router.put('/settings', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const s = store.getDb().settings;
  const b = req.body || {};
  if (b.pollIntervalSec !== undefined) s.pollIntervalSec = Math.max(15, Math.min(3600, Number(b.pollIntervalSec) || 60));
  if (b.sshTimeoutMs !== undefined) s.sshTimeoutMs = Math.max(2000, Math.min(60000, Number(b.sshTimeoutMs) || 10000));
  if (b.genericBackupCommand !== undefined) s.genericBackupCommand = String(b.genericBackupCommand);
  if (b.genericVersionCommand !== undefined) s.genericVersionCommand = String(b.genericVersionCommand);
  if (b.autoBackupEnabled !== undefined) s.autoBackupEnabled = !!b.autoBackupEnabled;
  if (b.autoBackupHours !== undefined) s.autoBackupHours = Math.max(1, Math.min(720, Number(b.autoBackupHours) || 24));
  if (b.retentionBackups !== undefined) s.retentionBackups = Math.max(3, Math.min(200, Number(b.retentionBackups) || 20));
  if (b.webhookUrl !== undefined) s.webhookUrl = String(b.webhookUrl).trim();
  if (b.telegramBotToken !== undefined) s.telegramBotToken = String(b.telegramBotToken).trim();
  if (b.telegramChatId !== undefined) s.telegramChatId = String(b.telegramChatId).trim();
  if (b.alertLatencyMs !== undefined) s.alertLatencyMs = Math.max(0, Math.min(60000, Number(b.alertLatencyMs) || 0));
  if (b.alertConsecutiveN !== undefined) s.alertConsecutiveN = Math.max(1, Math.min(30, Number(b.alertConsecutiveN) || 3));
  if (b.notifyCooldownSec !== undefined) s.notifyCooldownSec = Math.max(30, Math.min(86400, Number(b.notifyCooldownSec) || 300));
  if (b.dataCacheSec !== undefined) s.dataCacheSec = Math.max(5, Math.min(600, Number(b.dataCacheSec) || 20));
  store.save();
  store.audit('settings.updated', 'konfigurasi diperbarui', req.user.username, req.ip);
  require('./scheduler').startScheduler();
  res.json({ settings: s });
});

// Tools ping via RouterOS API
router.get('/devices/:id/ros/ping', auth.authMiddleware, async (req, res) => {
  try {
    const d = findDevice(req.params.id);
    rosGuard(d);
    const host = String(req.query.host || '').trim();
    if (!/^[\w.:\-]+$/.test(host)) return res.status(400).json({ error: 'host tidak valid' });
    const out = await withSession(d, devicePassword(d),
      s => s.api.sentence(['/ping', '=address=' + host, '=count=4']),
      (store.getDb().settings.sshTimeoutMs || 10000) + 20000);
    res.json({ rows: out.rows });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

// ---------- CLI BROWSER (vendor non-API) ----------
router.get('/devices/:id/cli/menu', auth.authMiddleware, (req, res) => {
  const d = findDevice(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device tidak ditemukan' });
  const menus = require('./cli-menus').forVendor(d.vendor);
  if (!menus.length) return res.status(400).json({ error: `Belum ada menu CLI untuk vendor "${d.vendor}"` });
  res.json({ vendor: d.vendor, menus });
});

router.get('/devices/:id/cli/run', auth.authMiddleware, async (req, res) => {
  const d = findDevice(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device tidak ditemukan' });
  const m = require('./cli-menus').forVendor(d.vendor).find(x => x.key === req.query.key || x.label === req.query.key);
  if (!m) return res.status(400).json({ error: 'Menu CLI tidak dikenal' });
  try {
    const outputs = await withSession(d, devicePassword(d), async s => {
      const outs = [];
      for (const c of m.cmds) outs.push({ cmd: c, text: await s.run(c) });
      return outs;
    }, (store.getDb().settings.sshTimeoutMs || 10000) + m.cmds.length * 15000);
    store.audit('cli.browse', `${d.name} [${m.label}]`, req.user.username, req.ip);
    res.json({ outputs });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- DISCOVERY ----------
const DEFAULT_SCAN_PORTS = [22, 80, 443, 8728]; // fast scan bila port tidak diisi

/** Fingerprint HTTP utk port web: baca header Server + potongan body */
function httpProbe(host, port, tlsFlag) {
  return new Promise(resolve => {
    const mod = require(tlsFlag ? 'https' : 'http');
    let done = false, server = '', body = '';
    const finish = () => {
      if (done) return; done = true;
      const t = server + ' ' + body;
      let vendor = null, os = '';
      if (/fortigate|fortinet/i.test(t)) { vendor = 'fortinet'; os = 'FortiOS Web'; }
      else if (/sangfor/i.test(t)) { vendor = 'sangfor'; os = 'Sangfor NGAF Web'; }
      else if (/mikrotik|routeros|webfig/i.test(t)) { vendor = 'mikrotik'; os = 'RouterOS Web'; }
      else if (/aruba|\bhpe\b|procurve/i.test(t)) { vendor = 'aruba'; os = 'Aruba Web'; }
      else if (/huawei/i.test(t)) { vendor = 'huawei'; os = 'Huawei Web'; }
      else if (server) os = 'web (' + server.slice(0, 28) + ')';
      resolve({ vendor, os });
    };
    try {
      const req = mod.get({ host, port: Number(port), path: '/', rejectUnauthorized: false, timeout: 1500 }, res => {
        server = res.headers.server || '';
        res.on('data', d => { body += d.toString('binary'); if (body.length > 2048) { try { req.destroy(); } catch {} finish(); } });
        res.on('end', finish);
        res.on('error', finish);
      });
      req.setTimeout(1800, () => { try { req.destroy(); } catch {} finish(); });
      req.on('error', finish);
    } catch { finish(); }
  });
}

function cidrHosts(cidr) {
  const bad = () => Object.assign(new Error('Format CIDR tidak valid (contoh 192.168.1.0/24, maks /22)'), { status: 400 });
  const [base, bitsRaw] = String(cidr || '').trim().split('/');
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(base || '')) throw bad();
  const octets = base.split('.').map(Number);
  if (octets.some(o => o > 255)) throw bad();
  const bits = bitsRaw === undefined ? 32 : parseInt(bitsRaw, 10);
  if (!(bits === 32 || (bits >= 22 && bits <= 30))) throw bad();
  const n = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  const start = (n & mask) >>> 0;
  const total = bits === 32 ? 1 : Math.pow(2, 32 - bits);
  const hosts = [];
  const lo = bits >= 31 ? 0 : 1;
  const hi = bits >= 31 ? total : total - 1;
  for (let i = lo; i < hi; i++) {
    const x = (start + i) >>> 0;
    hosts.push([(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join('.'));
  }
  return hosts;
}

// fingerprint vendor dari banner SSH
const BANNER_MAP = [
  [/rosssh/i, 'mikrotik', 'MikroTik RouterOS'],
  [/cisco/i, 'cisco', 'Cisco IOS/IOS-XE'],
  [/forti/i, 'fortinet', 'Fortinet FortiOS'],
  [/huawei|vrp/i, 'huawei', 'Huawei VRP'],
  [/junos/i, 'juniper', 'Juniper Junos'],
  [/aruba/i, 'aruba', 'Aruba'],
  [/dropbear/i, 'generic', 'Dropbear SSH'],
  [/openssh/i, 'generic', 'OpenSSH (Linux/umum)']
];
function matchBanner(banner) {
  for (const [re, vendor, label] of BANNER_MAP) {
    if (re.test(banner)) return { vendor, os: label };
  }
  return { vendor: 'generic', os: '' };
}

function sniffBanner(host, port, timeoutMs) {
  const net = require('net');
  return new Promise(resolve => {
    let done = false;
    const sock = net.createConnection({ host, port: Number(port) });
    let buf = '';
    const finish = r => { if (!done) { done = true; try { sock.destroy(); } catch {} resolve(r); } };
    sock.setTimeout(timeoutMs);
    sock.on('data', d => { buf += d.toString('binary'); if (buf.length > 200 || buf.includes('\n')) finish(buf); });
    sock.on('timeout', () => finish(buf));
    sock.on('error', () => finish(''));
  });
}

/** Deteksi OS/firmware universal: coba beberapa perintah khas vendor, kenali dari responsnya */
async function universalProbe(session) {
  const CMD_TRIES = ['/system resource print', 'show version', 'display version', 'get system status'];
  for (const cmd of CMD_TRIES) {
    let out = '';
    try { out = await session.run(cmd); } catch { continue; }
    const firstLine = (out.split('\n')[0] || '');
    if (!out || out.length < 6 || /(invalid|incomplete|unknown|bad command|% |no such)/i.test(firstLine)) continue;
    let vendor = 'generic';
    if (/RouterOS|board-name/i.test(out)) vendor = 'mikrotik';
    else if (/JUNOS/i.test(out)) vendor = 'juniper';
    else if (/FortiOS|FortiGate/i.test(out)) vendor = 'fortinet';
    else if (/Huawei|VRP/i.test(out)) vendor = 'huawei';
    else if (/Ruijie|RGOS/i.test(out)) vendor = 'ruijie';
    else if (/Cisco IOS/i.test(out)) vendor = 'cisco';
    const version = (out.match(/version[:\s]+([^\r\n]+)/i) || [])[1];
    const model = (out.match(/board-name:\s*(\S+)|Model:\s*(\S+)|^\s*\S*\s*(?:FortiGate-\S+)/im) || [])[1]
      || (out.match(/Model:\s*(\S+)/i) || [])[1] || '';
    return { vendor, version: (version || '').trim().slice(0, 60), model: (model || '').trim(), raw: out.slice(0, 400) };
  }
  return null;
}

function promptToHostname(prompt) {
  const last = String(prompt || '').replace(/\r/g, '').trimEnd().split('\n').pop().trim();
  const bracket = last.match(/\[([^\]]+)\]/);
  let name = bracket ? bracket[1] : last.replace(/[>#$\]]+\s*$/, '').trim();
  name = name.replace(/^[\w.\-]+@/, ''); // buang user@
  return (name || '').slice(0, 64);
}

// Deteksi OS/firmware satu host (dipakai tombol Deteksi di modal Discovery)
router.post('/discover/facts', auth.authMiddleware, async (req, res) => {
  if (!rateLimit('dfact:' + req.ip, 15, 60000)) return tooMany(res);
  try {
    const b = req.body || {};
    if (!b.host) return res.status(400).json({ error: 'host wajib' });
    const username = b.username || '';
    const password = b.password || '';
    if (!username) return res.status(400).json({ error: 'isi username/password kredensial di form' });

    if (b.transport === 'api') {
      const dev = { name: 'detect', host: b.host, vendor: 'mikrotik', transport: 'api', apiPort: Number(b.apiPort) || 8728, username };
      const v = getVendor('mikrotik');
      const facts = await withSession(dev, password, s2 => v.facts(s2), (store.getDb().settings.sshTimeoutMs || 10000) + 8000);
      return res.json({
        source: 'api',
        vendor: 'mikrotik',
        hostname: facts.hostname,
        os: 'RouterOS ' + (facts.version || ''),
        version: facts.version || '',
        model: facts.boardName || ''
      });
    }

    // SSH universal probe
    const dev = { name: 'detect', host: b.host, port: Number(b.sshPort) || 22, vendor: 'generic', username, pagerOff: '' };
    const out = await withSession(dev, password, async s => {
      const probe = await universalProbe(s);
      return { probe, hostname: promptToHostname(s.prompt) };
    }, (store.getDb().settings.sshTimeoutMs || 10000) + 15000);
    const p = out.probe;
    res.json({
      source: 'ssh',
      vendor: p ? p.vendor : 'generic',
      hostname: out.hostname,
      os: p ? (({ mikrotik: 'RouterOS', juniper: 'Junos', fortinet: 'FortiOS', huawei: 'VRP', ruijie: 'RGOS', cisco: 'IOS/IOS-XE' })[p.vendor] || '') + (p.version ? ' ' + p.version : '') : '',
      version: p ? p.version : '',
      model: p ? p.model : ''
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/discover/scan', auth.authMiddleware, async (req, res) => {
  if (!rateLimit('scan:' + req.ip, 5, 60000)) return tooMany(res);
  try {
    const { cidr } = req.body || {};
    const rawPorts = (req.body && req.body.ports) || [];
    // port opsional: kosong = fast scan ke port manajemen umum
    const ports = Array.isArray(rawPorts) && rawPorts.length
      ? [...new Set(rawPorts.map(Number).filter(p => p >= 1 && p <= 65535))].slice(0, 6)
      : DEFAULT_SCAN_PORTS;
    const hosts = cidrHosts(cidr);
    const found = [];
    let i = 0;
    const CONC = 200;
    async function worker() {
      while (i < hosts.length) {
        const ip = hosts[i++];
        for (const p of ports) {
          const r = await tcpProbe(ip, p, 700);
          if (!r.online) continue;
          const entry = { ip, port: p };
          found.push(entry);
          if (p === 80 || p === 443) {
            const w = await httpProbe(ip, p, p === 443);
            if (w.os) entry.bannerHint = w.os;
            if (w.vendor) entry.guessVendor = w.vendor;
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONC, Math.max(1, hosts.length * ports.length)) }, worker));
    // fingerprint banner utk port SSH
    await Promise.all(found.filter(f => f.port === 22).map(async f => {
      const b = await sniffBanner(f.ip, 22, 1500);
      const m = matchBanner(b);
      f.bannerHint = b ? m.os || b.trim().slice(0, 40) : '';
      f.guessVendor = m.vendor;
    }));
    found.filter(f => f.port === 8728 && !f.guessVendor || f.port === 8728).forEach(f => {
      if (!f.bannerHint) f.bannerHint = 'RouterOS API';
      f.guessVendor = 'mikrotik';
    });
    const db = store.getDb();
    for (const f of found) f.exists = db.devices.some(d => d.host === f.ip && Number(d.port) === Number(f.port));
    store.audit('discover.scan', `${cidr} -> ${found.length} host terbuka`, req.user.username, req.ip);
    res.json({ scanned: hosts.length, candidates: found });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.post('/discover/add', auth.authMiddleware, (req, res) => {
  try {
    const { items = [], username = '', password = '' } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items kosong' });
    const db = store.getDb();

    // gabungkan baris dengan IP sama: port 8728 -> apiPort, lainnya -> sshPort
    const mergedMap = new Map();
    for (const it of items.slice(0, 50)) {
      if (!it.ip) continue;
      const cur = mergedMap.get(it.ip) || {
        ip: it.ip, vendor: it.vendor || 'generic',
        name: it.name || ('discovered-' + it.ip),
        model: it.model || '', os: it.os || '',
        sshPort: null, apiPort: null, transport: 'ssh'
      };
      if (it.name) cur.name = it.name;
      if (it.model) cur.model = it.model;
      if (it.os) cur.os = it.os;
      if (it.vendor === 'mikrotik') cur.vendor = 'mikrotik';
      if (Number(it.apiPort)) {
        cur.apiPort = Number(it.apiPort);
        if (String(it.transport).startsWith('api')) cur.transport = it.transport;
      } else {
        cur.sshPort = Number(it.sshPort) || Number(it.port) || null;
        if (!cur.apiPort) cur.transport = 'ssh';
      }
      mergedMap.set(it.ip, cur);
    }

    const added = [];
    for (const x of mergedMap.values()) {
      // skip hanya bila device dengan IP sama + port SSH sama sudah ada
      if (db.devices.some(d => d.host === x.ip && (!x.sshPort || Number(d.port) === Number(x.sshPort)))) continue;
      const dev = {
        id: store.nextId('dev'),
        name: x.name,
        host: x.ip,
        port: Number(x.sshPort) || undefined,
        vendor: x.vendor,
        model: x.model,
        location: '', tags: ['discovered'],
        username: username || '', passwordEnc: require('./crypto').encrypt(password || ''),
        pagerOff: '',
        transport: (x.vendor === 'mikrotik' && String(x.transport).startsWith('api')) ? x.transport : 'ssh',
        apiPort: Number(x.apiPort) || undefined,
        enabled: true,
        notes: (x.os ? 'OS terdeteksi: ' + x.os + '. ' : '') + 'hasil discovery ' + new Date().toISOString().slice(0, 10),
        status: { online: null, latencyMs: null, lastChecked: null },
        createdAt: new Date().toISOString()
      };
      db.devices.push(dev);
      added.push(dev.name);
    }
    store.save();
    store.audit('discover.added', `${added.length} device dari discovery`, req.user.username, req.ip);
    require('./scheduler').broadcast('devices', {});
    res.json({ added });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---------- IMPORT (pasangan export) ----------
router.post('/admin/import', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  try {
    const j = req.body || {};
    if (!Array.isArray(j.devices)) return res.status(400).json({ error: 'Payload tidak valid (butuh array devices)' });
    const db = store.getDb();
    let aD = 0, aU = 0, aB = 0, skipD = 0;
    for (const dv of j.devices) {
      if (!dv.host) continue;
      if (db.devices.some(x => x.host === dv.host && Number(x.port) === Number(dv.port))) { skipD++; continue; }
      const plain = dv.passwordPlain;
      const enc = plain !== undefined && plain !== null ? require('./crypto').encrypt(plain) : (dv.passwordEnc || '');
      const { hist, uptimePct, ...clean } = dv;
      db.devices.push({
        ...clean, id: store.nextId('dev'), passwordEnc: enc,
        status: clean.status && typeof clean.status === 'object' ? clean.status : { online: null },
        tags: Array.isArray(clean.tags) ? clean.tags : []
      });
      aD++;
    }
    for (const u of (j.users || [])) {
      if (!u.username || db.users.some(x => x.username.toLowerCase() === u.username.toLowerCase())) continue;
      db.users.push({
        id: store.nextId('usr'), username: u.username,
        passwordHash: u.passwordHash || require('bcryptjs').hashSync('changeme123', 10),
        role: u.role || 'operator', createdAt: u.createdAt || new Date().toISOString()
      });
      aU++;
    }
    if (j.settings) {
      const s = db.settings;
      ['pollIntervalSec', 'sshTimeoutMs', 'autoBackupEnabled', 'autoBackupHours', 'retentionBackups',
        'webhookUrl', 'telegramBotToken', 'telegramChatId', 'genericBackupCommand', 'genericVersionCommand']
        .forEach(k => { if (j.settings[k] !== undefined && j.settings[k] !== null && j.settings[k] !== '') s[k] = j.settings[k]; });
      if (Array.isArray(j.settings.commandTemplates)) s.commandTemplates = j.settings.commandTemplates;
    }
    for (const b of (j.backups || [])) {
      const dev = db.devices.find(x => x.id === b.deviceId || x.name === b.deviceName);
      if (!dev) continue;
      if (db.backups.some(x => x.deviceId === dev.id && x.createdAt === b.createdAt)) continue;
      db.backups.push({ ...b, id: store.nextId('bkp'), deviceId: dev.id });
      aB++;
    }
    store.save();
    store.audit('import', `+${aD} device, +${aU} user, +${aB} backup, ${skipD} duplikat dilewati`, req.user.username, req.ip);
    require('./scheduler').broadcast('devices', {});
    res.json({ addedDevices: aD, addedUsers: aU, addedBackups: aB, skippedDevices: skipD });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Test notifikasi Telegram
router.post('/notify/test', auth.authMiddleware, auth.requireAdmin, async (req, res) => {
  const r = await require('./notify').testTelegram();
  res.json(r);
});

// ---------- API KEYS (otomasi/scripting) — disimpan sebagai hash ----------
router.get('/apikeys', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const keys = (store.getDb().settings.apiKeys || []).map(({ keyHash, key, ...k }) => k);
  res.json({ keys });
});

router.post('/apikeys', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const { name, role } = req.body || {};
  if (!name) return res.status(400).json({ error: 'nama wajib' });
  const r = ['admin', 'operator', 'viewer'].includes(role) ? role : 'operator';
  const key = require('crypto').randomBytes(24).toString('base64url');
  const s = store.getDb().settings;
  s.apiKeys = s.apiKeys || [];
  const entry = {
    id: 'key-' + Date.now().toString(36),
    name: String(name).slice(0, 40),
    role: r,
    createdAt: new Date().toISOString(),
    hint: key.slice(0, 6) + '...',
    keyHash: auth.hashKey(key)
  };
  s.apiKeys.push(entry);
  store.save();
  store.audit('apikey.created', `${entry.name} (${r})`, req.user.username, req.ip);
  res.json({ entry: { ...entry, key } }); // key hanya tampil sekali saat dibuat
});

router.delete('/apikeys/:id', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const s = store.getDb().settings;
  const before = (s.apiKeys || []).length;
  s.apiKeys = (s.apiKeys || []).filter(k => k.id !== req.params.id);
  store.save();
  store.audit('apikey.deleted', req.params.id, req.user.username, req.ip);
  res.json({ removed: before - s.apiKeys.length });
});

// ---------- SYSTEM INFO ----------
router.get('/system/info', auth.authMiddleware, (req, res) => {
  const db = store.getDb();
  const fs = require('fs');
  let dbSize = 0;
  try { dbSize = fs.statSync(require('./store').DB_FILE).size; } catch {}
  let version = '0.1.0';
  try { version = require('../package.json').version; } catch {}
  res.json({
    version,
    node: process.version,
    platform: process.platform,
    uptimeSec: Math.floor(process.uptime()),
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
    dbSizeKB: Math.round(dbSize / 1024),
    devices: db.devices.length,
    backups: db.backups.length,
    historyPoints: require('./history').totalPoints(),
    now: new Date().toISOString()
  });
});

// ---------- METRIK RESOURCE (MikroTik API) ----------
router.get('/devices/:id/metrics', auth.authMiddleware, (req, res) => {
  const history = require('./history');
  res.json({
    cpu: history.getSeries('res:' + req.params.id, 1),
    freeMem: history.getSeries('res:' + req.params.id, 2)
  });
});

// Traceroute via RouterOS API
router.get('/devices/:id/ros/trace', auth.authMiddleware, async (req, res) => {
  try {
    const d = findDevice(req.params.id);
    rosGuard(d);
    const host = String(req.query.host || '').trim();
    if (!/^[\w.:\-]+$/.test(host)) return res.status(400).json({ error: 'host tidak valid' });
    const out = await withSession(d, devicePassword(d),
      s => s.api.sentence(['/tool/trace', '=address=' + host, '=count=3', '=duration=1']),
      (store.getDb().settings.sshTimeoutMs || 10000) + 40000);
    res.json({ rows: out.rows });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

// Export audit log ke CSV (admin)
router.get('/audit/export.csv', auth.authMiddleware, auth.requireAdmin, (req, res) => {
  const rows = store.getDb().auditLogs;
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = ['id,ts,user,action,detail',
    ...rows.map(l => [l.id, l.ts, l.user, l.action, l.detail].map(esc).join(','))].join('\r\n');
  res.setHeader('Content-Disposition', `attachment; filename="noc-audit-${Date.now()}.csv"`);
  res.type('text/csv').send(csv);
});

router.get('/vendors', auth.authMiddleware, (req, res) => {
  const { VENDORS } = require('./drivers/vendors');
  res.json({ vendors: Object.values(VENDORS).map(({ id, label, category, defaultPort, color }) => ({ id, label, category, defaultPort, color })) });
});

router.post('/poll-now', auth.authMiddleware, async (req, res) => {
  await pollOnce();
  res.json({ ok: true });
});

// ---------- MIKROTIK WINBOX-STYLE CONFIG UI ----------
const ROS_MENUS = require('./drivers/ros-menus');

function rosGuard(d) {
  if (!d || d.vendor !== 'mikrotik' || !String(d.transport || 'ssh').startsWith('api')) {
    const e = new Error('Fitur ini khusus device MikroTik dengan transport RouterOS API');
    e.status = 400;
    throw e;
  }
}

function findMenu(key) {
  const m = ROS_MENUS.find(x => x.key === key);
  if (!m) {
    const e = new Error('Menu tidak dikenal');
    e.status = 400;
    throw e;
  }
  return m;
}

function buildWords(fields, params) {
  const words = [];
  for (const f of fields) {
    const v = params ? params[f.k] : undefined;
    if (v !== undefined && v !== null && String(v).trim() !== '') words.push('=' + f.k + '=' + String(v).trim());
  }
  return words;
}

/** Validasi ketat parameter static route (mencegah salah config meruntuhkan jaringan) */
function validateRouteParams(params, isAdd) {
  if (!params) return null;
  if (params['dst-address'] !== undefined && String(params['dst-address']).trim() !== '') {
    const m = String(params['dst-address']).trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    if (!m || m[1].split('.').some(o => Number(o) > 255) || Number(m[2]) > 32) {
      return 'dst-address harus CIDR IPv4 valid (contoh: 10.0.0.0/24)';
    }
  } else if (isAdd) {
    return 'dst-address wajib diisi';
  }
  if (params.gateway !== undefined && String(params.gateway).trim() !== '') {
    if (!/^[A-Za-z0-9.:%\-]{1,64}$/.test(String(params.gateway).trim())) {
      return 'gateway harus berupa IP / nama interface / "blackhole"';
    }
  } else if (isAdd) {
    return 'gateway wajib diisi';
  }
  if (params.distance !== undefined && String(params.distance).trim() !== '') {
    const d = Number(params.distance);
    if (!Number.isInteger(d) || d < 1 || d > 255) return 'distance harus angka 1-255';
  }
  return null;
}

router.get('/devices/:id/ros/menu', auth.authMiddleware, (req, res) => {
  try {
    rosGuard(findDevice(req.params.id));
    res.json({
      menus: ROS_MENUS.map(m => ({
        key: m.key, group: m.group, label: m.label, readonly: !!m.readonly,
        cols: m.cols,
        caps: m.readonly ? {} : {
          toggle: !!(m.caps && m.caps.toggle),
          remove: !!(m.caps && m.caps.remove),
          extras: ((m.caps && m.caps.extras) || []).map(e => e.label),
          add: (m.caps && m.caps.add) || null,
          edit: (m.caps && m.caps.edit) || null
        }
      }))
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Sumber opsi dinamis untuk dropdown form (mis. daftar interface live dari router)
router.get('/devices/:id/ros/options', auth.authMiddleware, async (req, res) => {
  try {
    const d = findDevice(req.params.id);
    rosGuard(d);
    const what = String(req.query.what || '');
    if (what !== 'interfaces') return res.status(400).json({ error: 'sumber opsi tidak dikenal' });
    const out = await withSession(d, devicePassword(d),
      s => s.api.sentence(['/interface/print']),
      store.getDb().settings.sshTimeoutMs);
    const options = out.rows.map(r => r.name).filter(Boolean).sort();
    res.json({ options });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

router.get('/devices/:id/ros/data', auth.authMiddleware, async (req, res) => {
  try {
    const d = findDevice(req.params.id);
    rosGuard(d);
    const m = findMenu(String(req.query.key || ''));
    const force = String(req.query.refresh || '') === '1';
    const db = store.getDb();
    const TTL = Math.max(5, Number(db.settings.dataCacheSec) || 20) * 1000;
    const cacheKey = d.id + '|' + m.key;
    const now = Date.now();

    if (!force) {
      const c = rosDataCache.get(cacheKey);
      if (c && now - c.ts < TTL) {
        return res.json({ rows: c.rows.slice(0, MAX_ROWS_SENT), total: c.total, truncated: c.total > MAX_ROWS_SENT, cachedAt: c.ts, stale: false });
      }
    }

    try {
      const bigTable = ['routes', 'fw-conn', 'logs'].includes(m.key);
      const fetchOpts = bigTable ? { maxRows: MAX_ROWS_SENT, ms: 12000 } : {};
      const extraTimeout = bigTable ? 15000 : 0;
      const out = await withSession(d, devicePassword(d),
        s => s.api.sentence([m.path + '/print'], fetchOpts),
        db.settings.sshTimeoutMs + extraTimeout);
      const rows = out.rows || [];
      const truncated = !!out.truncated || rows.length >= MAX_ROWS_SENT;
      rosDataCache.set(cacheKey, { ts: Date.now(), rows, total: rows.length, truncated });
      res.json({ rows: rows.slice(0, MAX_ROWS_SENT), total: rows.length, truncated, cachedAt: Date.now(), stale: false });
    } catch (fetchErr) {
      // fallback: kirim snapshot lama bila ada, agar UI tidak error
      const c = rosDataCache.get(cacheKey);
      if (c) {
        return res.json({ rows: c.rows.slice(0, MAX_ROWS_SENT), total: c.total, truncated: c.total > MAX_ROWS_SENT, cachedAt: c.ts, stale: true, error: fetchErr.message });
      }
      throw fetchErr;
    }
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

router.post('/devices/:id/ros/action', auth.authMiddleware, async (req, res) => {
  try {
    const d = findDevice(req.params.id);
    rosGuard(d);
    const m = findMenu(String(req.body.key || ''));
    const act = String(req.body.action || '');
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
    const params = req.body.params || {};
    const caps = m.caps || {};

    // validasi ketat format .id (cegah injeksi kata API lewat field id)
    if (ids.length && ids.some(x => !/^[A-Za-z0-9*._\-]{1,64}$/.test(x))) {
      return res.status(400).json({ error: 'format id tidak valid' });
    }
    for (const [pk, pv] of Object.entries(params)) {
      if (typeof pv === 'string' && /[\r\n]/.test(pv)) {
        return res.status(400).json({ error: `field "${pk}" mengandung karakter tidak valid` });
      }
    }

    // Catatan: tidak ada blokir blanket "readonly" — tiap aksi sudah divalidasi
    // lewat caps per-menu (menu tanpa caps otomatis menolak semua aksi tulis).

    // guardrail khusus menu Routes
    if (m.key === 'routes' && (act === 'add' || act === 'set')) {
      const err = validateRouteParams(params, act === 'add');
      if (err) throw Object.assign(new Error('Routes: ' + err), { status: 400 });
    }

    let sentences = [];
    let desc = '';

    const extra = (caps.extras || []).find(x => 'extra:' + x.label === act || x.label === act.replace('extra:', ''));
    if (act === 'enable' || act === 'disable') {
      if (!caps.toggle) throw Object.assign(new Error('Aksi toggle tidak diizinkan di menu ini'), { status: 400 });
      if (!ids.length) throw Object.assign(new Error('Tidak ada baris dipilih'), { status: 400 });
      sentences = ids.map(id => [m.path + '/' + act, '=.id=' + id]);
      desc = `${act} ${ids.length} entry`;
    } else if (act === 'remove') {
      if (!caps.remove) throw Object.assign(new Error('Hapus tidak diizinkan di menu ini'), { status: 400 });
      if (!ids.length) throw Object.assign(new Error('Tidak ada baris dipilih'), { status: 400 });
      sentences = ids.map(id => [m.path + '/remove', '=.id=' + id]);
      desc = `hapus ${ids.length} entry`;
    } else if (act === 'set') {
      if (!caps.edit) throw Object.assign(new Error('Edit tidak diizinkan di menu ini'), { status: 400 });
      if (!ids.length) throw Object.assign(new Error('Tidak ada baris dipilih'), { status: 400 });
      const words = buildWords(caps.edit, params);
      if (!words.length) throw Object.assign(new Error('Tidak ada field yang diubah'), { status: 400 });
      sentences = ids.map(id => [m.path + '/set', '=.id=' + id, ...words]);
      desc = `set ${words.length} field pada ${ids.length} entry`;
    } else if (act === 'add') {
      if (!caps.add) throw Object.assign(new Error('Tambah tidak diizinkan di menu ini'), { status: 400 });
      const words = buildWords(caps.add, params);
      if (!words.length) throw Object.assign(new Error('Data kosong'), { status: 400 });
      sentences = [[m.path + '/add', ...words]];
      desc = `tambah entry baru (${words[0].split('=')[1]}=...)`;
    } else if (extra) {
      if (!ids.length) throw Object.assign(new Error('Tidak ada baris dipilih'), { status: 400 });
      sentences = ids.map(id => extra.cmd.replace('{id}', id).split(' '));
      desc = `${extra.label} ${ids.length} entry`;
    } else {
      throw Object.assign(new Error('Aksi tidak dikenal'), { status: 400 });
    }

    await withSession(d, devicePassword(d), async s => {
      for (const w of sentences) await s.api.sentence(w);
    }, store.getDb().settings.sshTimeoutMs);

    store.audit('ros.' + act, `${d.name} [${m.label}] ${desc}`, req.user.username);
    res.json({ ok: true, affected: sentences.length });
  } catch (e) {
    if (e.message && /no such item|failure/.test(e.message)) return res.status(502).json({ error: e.message });
    res.status(e.status || 502).json({ error: e.message });
  }
});

module.exports = router;
