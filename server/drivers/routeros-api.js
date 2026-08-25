/**
 * Minimal pure-JS client untuk RouterOS API (protokol biner, port 8728/8729).
 * Bagian dari NOC Control Center — © 2026 felixrohman31-a11y (MIT)
 * Referensi protokol: MikroTik Wiki - API / API protocol.
 * Tanpa dependensi eksternal -> aman dipakai di Windows/Linux/Docker.
 */
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

// ---------- encoding ----------
function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) { len |= 0x8000; return Buffer.from([(len >> 8) & 0xff, len & 0xff]); }
  if (len < 0x200000) { len |= 0xc00000; return Buffer.from([(len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]); }
  if (len < 0x10000000) {
    len |= 0xe0000000;
    return Buffer.from([(len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  const b = Buffer.alloc(5);
  b[0] = 0xf0;
  b.writeUInt32BE(len >>> 0, 1);
  return b;
}

function encodeWord(str) {
  const b = Buffer.from(String(str), 'utf8');
  return Buffer.concat([encodeLength(b.length), b]);
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

function parseKv(sentenceWords) {
  const o = {};
  for (const w of sentenceWords.slice(1)) {
    if (!w.startsWith('=')) continue;
    const i = w.indexOf('=', 1);
    if (i > 1) o[w.slice(1, i)] = w.slice(i + 1);
    else o[w.slice(1)] = true;
  }
  return o;
}

// ---------- connection ----------
class RosConnection {
  constructor(opts = {}) {
    this.host = opts.host;
    this.port = opts.port || 8728;
    this.secure = !!opts.secure;
    this.timeout = opts.timeout || 10000;
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.pending = null;
    this._queue = Promise.resolve();
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = err => { if (!settled) { settled = true; reject(err); } };
      const sock = this.secure
        ? tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false })
        : net.createConnection({ host: this.host, port: this.port });
      this.socket = sock;
      sock.setNoDelay(true);
      sock.setTimeout(this.timeout, () => {
        sock.destroy();
        fail(new Error(`timeout menyambung ke ${this.host}:${this.port}`));
      });
      sock.on('error', e => {
        fail(new Error(`API connect gagal (${this.host}:${this.port}): ${e.message}`));
        this._failPending(new Error('socket error: ' + e.message));
      });
      sock.on('data', d => {
        this.buf = Buffer.concat([this.buf, d]);
        this._drain();
      });
      sock.on('connect', () => { settled = true; resolve(); });
      sock.on('close', () => this._failPending(new Error('koneksi API ditutup perangkat')));
    });
  }

  /** Kirim satu kalimat (diantrekan otomatis), tunggu balasan sampai !done / !trap */
  sentence(words) {
    const exec = () => new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) return reject(new Error('koneksi API sudah tertutup'));
      const p = {
        rows: [],
        resolve,
        reject,
        timer: setTimeout(() => this._failPending(new Error('API timeout menunggu respons')), Math.max(this.timeout, 25000))
      };
      this.pending = p;
      try { this.socket.write(encodeSentence(words)); }
      catch (e) { this._failPending(e); }
    });
    const result = this._queue.then(exec, exec);
    this._queue = result.then(() => {}, () => {});
    return result;
  }

  async login(username, password) {
    const r = await this.sentence(['/login', '=name=' + username, '=password=' + password]);
    // Server lama (<6.43) membalas !done dengan challenge =ret=
    if (r && r.ret !== undefined) {
      const md5 = crypto.createHash('md5');
      md5.update(Buffer.concat([
        Buffer.from([0]),
        Buffer.from(String(password), 'utf8'),
        Buffer.from(String(r.ret), 'hex')
      ]));
      await this.sentence(['/login', '=response=00' + md5.digest('hex')]);
    }
  }

  _drain() {
    for (;;) {
      const p = this.pending;
      if (!p) return;
      const sent = this._readSentence();
      if (sent === null) break;               // data belum lengkap
      if (this.pending !== p) continue;       // respons basi dari sesi sebelumnya
      const tag = sent[0];
      if (tag === '!re') p.rows.push(parseKv(sent));
      else if (tag === '!done') { this._finish(p, { rows: p.rows, ret: parseKv(sent).ret }); return; }
      else if (tag === '!trap') { this._finish(p, null, new Error(parseKv(sent).message || 'perintah API ditolak')); return; }
      else if (tag === '!fatal') { this._finish(p, null, new Error(parseKv(sent).message || 'fatal')); return; }
      else p.rows.push(parseKv(sent));
    }
  }

  _finish(p, val, err) {
    clearTimeout(p.timer);
    this.pending = null;
    err ? p.reject(err) : p.resolve(val);
  }

  _failPending(err) {
    if (this.pending) this._finish(this.pending, null, err);
  }

  /** Baca satu kalimat lengkap; null jika buffer belum cukup (tidak mengonsumsi parsial) */
  _readSentence() {
    const words = [];
    for (;;) {
      const w = this._readWord();
      if (w === null) return null;
      if (w.length === 0) return words;
      words.push(w.toString('utf8'));
    }
  }

  _readWord() {
    if (this.buf.length < 1) return null;
    const b0 = this.buf[0];
    let len, off;
    if (b0 < 0x80) { len = b0; off = 1; }
    else if (b0 < 0xc0) { if (this.buf.length < 2) return null; len = (((b0 << 8) | this.buf[1]) & 0x3fff); off = 2; }
    else if (b0 < 0xe0) { if (this.buf.length < 3) return null; len = ((((b0 << 16) | (this.buf[1] << 8) | this.buf[2])) & 0x1fffff); off = 3; }
    else if (b0 < 0xf0) { if (this.buf.length < 4) return null; len = (((((b0 << 24) | (this.buf[1] << 16) | (this.buf[2] << 8) | this.buf[3])) >>> 0) & 0x0fffffff); off = 4; }
    else { if (this.buf.length < 5) return null; len = this.buf.readUInt32BE(1); off = 5; }
    if (this.buf.length < off + len) return null;
    const w = Buffer.from(this.buf.subarray(off, off + len));
    this.buf = this.buf.subarray(off + len);
    return w;
  }

  close() {
    try { this.socket && this.socket.end(); } catch {}
    setTimeout(() => { try { this.socket && this.socket.destroy(); } catch {} }, 200);
  }
}

/** Wrapper dengan antarmuka mirip ShellSession agar transparan bagi driver/route */
class RosApiSession {
  constructor(device, password, timeoutMs) {
    this.kind = 'api';
    this.device = device;
    this.password = password;
    this.timeout = timeoutMs || 10000;
    this.api = null;
  }

  apiPort() {
    const secure = this.device.transport === 'api-ssl';
    return Number(this.device.apiPort) || (secure ? 8729 : 8728);
  }

  async connect() {
    this.api = new RosConnection({
      host: this.device.host,
      port: this.apiPort(),
      secure: this.device.transport === 'api-ssl',
      timeout: this.timeout
    });
    await this.api.connect();
    await this.api.login(this.device.username || 'admin', this.password);
    return this;
  }

  /** Terima gaya CLI "ip address print" -> panggil /ip/address/print lewat API */
  async run(cmd) {
    const t = String(cmd).trim().replace(/\s+/g, ' ');
    if (!t) throw new Error('perintah kosong');
    const path = '/' + t.replace(/^\//, '').split(' ').join('/');
    const { rows } = await this.api.sentence([path]);
    if (!rows.length) return '(kosong - tidak ada entry)';
    return rows.map((r, i) => {
      const kv = Object.entries(r)
        .filter(([k]) => k !== '.id')
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      return `${i} ${kv}`;
    }).join('\n');
  }

  close() { this.api && this.api.close(); }
}

module.exports = { RosConnection, RosApiSession, encodeSentence };
