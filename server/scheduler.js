const { tcpProbe, probePort } = require('./drivers/base');
const store = require('./store');
const history = require('./history');
const notify = require('./notify');

const clients = new Set();

function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('retry: 3000\n\n');
  const client = { res };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

function broadcast(type, payload) {
  const data = `event: message\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const c of clients) {
    try { c.res.write(data); } catch {}
  }
}

function getPoints(id) { return history.getPoints(id); }
function uptimePct(id) { return history.uptimePct(id); }

// ---------- alert engine ----------
// state per device: { consecHigh, consecDown, notifiedLat, lastNotify: {event: ts} }
const alertState = new Map();

function shouldNotify(d, event) {
  const s = store.getDb().settings;
  const cooldown = Math.max(30, Number(s.notifyCooldownSec) || 300) * 1000;
  const st = alertState.get(d.id) || {};
  st.lastNotify = st.lastNotify || {};
  const last = st.lastNotify[event] || 0;
  if (Date.now() - last < cooldown) return false;
  st.lastNotify[event] = Date.now();
  alertState.set(d.id, st);
  return true;
}

async function evaluateAlerts(d, online, latencyMs) {
  const s = store.getDb().settings;
  const st = alertState.get(d.id) || (alertState.set(d.id, st = {}));

  // threshold latency
  const thr = Number(s.alertLatencyMs) || 0;
  const need = Math.max(1, Number(s.alertConsecutiveN) || 3);
  if (thr > 0 && online && latencyMs != null) {
    if (latencyMs > thr) {
      st.consecHigh = (st.consecHigh || 0) + 1;
      if (st.consecHigh === need && !st.notifiedLat) {
        st.notifiedLat = true;
        if (shouldNotify(d, 'latency')) {
          store.audit('alert.latency', `${d.name}: ${latencyMs} ms > ${thr} ms (beruntun ${need}x)`);
          broadcast('alert', { deviceId: d.id, name: d.name, kind: 'latency', value: latencyMs, threshold: thr });
          notify.dispatch({
            event: 'alert.latency',
            device: { id: d.id, name: d.name, host: d.host, vendor: d.vendor },
            latencyMs, threshold: thr, ts: new Date().toISOString()
          });
        }
      }
    } else {
      st.consecHigh = 0;
      st.notifiedLat = false;
    }
  } else if (!online) {
    st.consecHigh = 0;
    st.notifiedLat = false;
  }
}

// sampling resource utk device MikroTik mode API
async function sampleResource(d) {
  try {
    const { withSession, isApiTransport } = require('./drivers/base');
    if (!isApiTransport(d)) return;
    const { devicePassword } = require('./drivers/vendors');
    const out = await withSession(d, devicePassword(d),
      s2 => s2.api.sentence(['/system/resource/print']),
      (store.getDb().settings.sshTimeoutMs || 10000));
    const r = (out.rows && out.rows[0]) || {};
    const cpu = parseFloat(r['cpu-load']);
    const mem = parseFloat(r['free-memory']);
    if (!isNaN(cpu)) history.pushSeries('res:' + d.id, [cpu, isNaN(mem) ? null : mem]);
  } catch { /* device offline / bukan API — abaikan */ }
}

async function pollOnce() {
  const db = store.getDb();
  const intervalSec = db.settings.pollIntervalSec || 60;

  await Promise.all(db.devices.filter(d => d.enabled !== false).map(async d => {
    const prevOnline = d.status ? d.status.online : null;
    const r = await tcpProbe(d.host, probePort(d), Math.min(5000, intervalSec * 1000));
    d.status = { online: r.online, latencyMs: r.latencyMs, lastChecked: new Date().toISOString() };
    if (r.online) d.lastSeen = new Date().toISOString();
    history.push(d.id, r.online, r.latencyMs);

    // notifikasi perubahan status (lewati polling pertama; cooldown anti-flapping)
    if (prevOnline !== null && prevOnline !== undefined && prevOnline !== r.online) {
      if (shouldNotify(d, r.online ? 'up' : 'down')) {
        broadcast('status-change', { deviceId: d.id, name: d.name, online: r.online });
        store.audit('device.' + (r.online ? 'online' : 'offline'), `${d.name} (${d.host})`);
        notify.dispatch({
          event: r.online ? 'device.online' : 'device.offline',
          device: { id: d.id, name: d.name, host: d.host, vendor: d.vendor },
          latencyMs: r.latencyMs,
          ts: new Date().toISOString()
        });
      }
    }
    evaluateAlerts(d, r.online, r.latencyMs).catch(() => {});
    if (r.online) sampleResource(d).catch(() => {}); // CPU/mem utk MikroTik API
  }));

  store.save();
  broadcast('status', { ts: Date.now(), devices: db.devices.map(d => ({ id: d.id, status: d.status })) });
}

// ---------- auto-backup terjadwal ----------
let backupTimer = null;

async function autoBackupTick() {
  const db = store.getDb();
  if (!db.settings.autoBackupEnabled) return;
  const hours = Number(db.settings.autoBackupHours) || 24;
  const dueMs = hours * 3600 * 1000;
  const now = Date.now();

  const targets = db.devices.filter(d =>
    d.enabled !== false &&
    (!d.lastAutoBackup || now - new Date(d.lastAutoBackup).getTime() >= dueMs));

  for (const d of targets) {
    try {
      const { performBackup } = require('./backup');
      await performBackup(d, 'auto-scheduler', { auto: true });
      console.log('[auto-backup] OK:', d.name);
      broadcast('backups', {});
    } catch (e) {
      store.audit('backup.auto.failed', `${d.name}: ${e.message}`);
      console.error('[auto-backup] gagal:', d.name, e.message);
    }
  }
}

let pollTimer = null;

function startScheduler() {
  const db = store.getDb();
  clearInterval(pollTimer);
  clearInterval(backupTimer);

  pollTimer = setInterval(() => pollOnce().catch(e => console.error('[scheduler]', e.message)),
    (db.settings.pollIntervalSec || 60) * 1000);
  setTimeout(() => pollOnce().catch(() => {}), 1500);

  backupTimer = setInterval(() => autoBackupTick().catch(e => console.error('[auto-backup]', e.message)), 15 * 60 * 1000);
  setTimeout(() => autoBackupTick().catch(() => {}), 8000);

  console.log(`[scheduler] polling ${db.settings.pollIntervalSec}s | auto-backup: ${db.settings.autoBackupEnabled ? db.settings.autoBackupHours + 'h' : 'off'} | webhook: ${db.settings.webhookUrl ? 'aktif' : '-'} | telegram: ${db.settings.telegramBotToken ? 'aktif' : '-'}`);
}

module.exports = { sseHandler, broadcast, startScheduler, pollOnce, getPoints, uptimePct };
