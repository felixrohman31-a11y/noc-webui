const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.NOC_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  users: [],
  devices: [],
  backups: [],
  auditLogs: [],
  settings: {
    pollIntervalSec: 60,
    sshTimeoutMs: 10000,
    genericBackupCommand: 'show running-config',
    genericVersionCommand: 'show version',
    autoBackupEnabled: false,
    autoBackupHours: 24,
    retentionBackups: 20,
    webhookUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
    commandTemplates: [],
    alertLatencyMs: 0,
    alertConsecutiveN: 3,
    notifyCooldownSec: 300,
    apiKeys: []
  },
  meta: { seq: 1 }
};

let db = null;
let saveTimer = null;

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('[store] db.json corrupt, starting fresh:', e.message);
      db = JSON.parse(JSON.stringify(DEFAULTS));
    }
  } else {
    db = JSON.parse(JSON.stringify(DEFAULTS));
    saveNow();
  }
  for (const k of Object.keys(DEFAULTS)) {
    if (db[k] === undefined) db[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
  }
  // deep-merge settings: field baru di versi berikutnya dapat default otomatis
  for (const k of Object.keys(DEFAULTS.settings)) {
    if (db.settings[k] === undefined) db.settings[k] = DEFAULTS.settings[k];
  }
  return db;
}

function saveNow() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}

function nextId(prefix) {
  const id = `${prefix}-${db.meta.seq++}`;
  save();
  return id;
}

function getDb() {
  if (!db) load();
  return db;
}

function audit(action, detail, user) {
  getDb().auditLogs.unshift({
    id: nextId('log'),
    ts: new Date().toISOString(),
    user: user || 'system',
    action,
    detail: String(detail).slice(0, 500)
  });
  if (getDb().auditLogs.length > 2000) getDb().auditLogs.length = 2000;
  save();
}

module.exports = { DATA_DIR, DB_FILE, getDb, load, save, saveNow, nextId, audit };
