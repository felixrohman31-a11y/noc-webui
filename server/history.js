/**
 * Riwayat persisten ke data/history.json.
 * Format: { key: [[ts, ...values], ...] }
 *   key deviceId      -> [t, ok(0/1), latencyMs|null]
 *   key 'res:<devId>' -> [t, cpu%, freeMemBytes]   (device MikroTik mode API)
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.NOC_DATA_DIR || path.join(__dirname, '..', 'data'), 'history.json');
const MAX_POINTS = 1000;
const MAX_AGE_MS = 7 * 86400000;

let data = {};
let timer = null;

function load() {
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { data = {}; }
  console.log(`[history] dimuat: ${Object.keys(data).length} seri`);
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, FILE);
    } catch (e) { console.error('[history] save gagal:', e.message); }
  }, 2000);
}

function _trim(arr) {
  while (arr.length > MAX_POINTS) arr.shift();
  const cutoff = Date.now() - MAX_AGE_MS;
  return arr.filter(p => p[0] >= cutoff);
}

/** seri latency/status device */
function push(id, ok, lat) {
  const arr = _trim(data[id] || (data[id] = []));
  arr.push([Date.now(), ok ? 1 : 0, ok ? lat : null]);
  data[id] = arr;
  save();
}

/** seri generik utk metrik lain */
function pushSeries(key, values) {
  const arr = _trim(data[key] || (data[key] = []));
  arr.push([Date.now(), ...values]);
  data[key] = arr;
  save();
}

function getRaw(key) { return data[key] || []; }

/** titik grafik latency: [t, lat|null] */
function getPoints(id) {
  return getRaw(id).map(p => [p[0], p[1] ? p[2] : null]);
}

/** kolom tertentu dari seri generik: [t, col] */
function getSeries(key, col) {
  return getRaw(key).map(p => [p[0], p[col] ?? null]);
}

function totalPoints() {
  return Object.values(data).reduce((a, arr) => a + arr.length, 0);
}

function uptimePct(id, sinceMs) {
  const cutoff = Date.now() - (sinceMs || 86400000);
  const pts = getRaw(id).filter(p => p[0] >= cutoff);
  if (!pts.length) return null;
  return Math.round((100 * pts.reduce((a, p) => a + p[1], 0)) / pts.length);
}

module.exports = { load, push, pushSeries, getPoints, getSeries, getRaw, totalPoints, uptimePct };
