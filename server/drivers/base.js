/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

const { Client } = require('ssh2');
const { RosApiSession } = require('./routeros-api');

class ShellSession {
  constructor(device, password, timeoutMs) {
    this.device = device;
    this.password = password;
    this.timeoutMs = timeoutMs || 10000;
    this.conn = null;
    this.stream = null;
    this.prompt = null;
    this.closed = false;
    this.cleanBuf = '';   // satu-satunya buffer (sudah dibersihkan per-chunk)
  }

  static clean(s) {
    return String(s)
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')   // OSC sequences
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')        // CSI sequences
      .replace(/\r/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _wait(cond, timeoutMs, what) {
    const t0 = Date.now();
    for (;;) {
      if (cond()) return;
      if (Date.now() - t0 > timeoutMs) {
        throw new Error(`timeout ${what} (${timeoutMs}ms). Buffer terakhir: ` +
          JSON.stringify(this.cleanBuf.slice(-150)));
      }
      await this._sleep(60);
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      this.conn = conn;
      let settled = false;
      conn.on('error', err => {
        if (!settled) { settled = true; reject(new Error('SSH error: ' + err.message)); }
        this._cleanup();
      });
      conn.on('ready', () => {
        conn.shell({ term: 'dumb' }, (err, stream) => {
          if (err) { if (!settled) { settled = true; reject(err); } return; }
          this.stream = stream;
          stream.on('data', d => { this.cleanBuf += ShellSession.clean(d.toString('binary')); });
          stream.stderr.on('data', d => { this.cleanBuf += ShellSession.clean(d.toString('binary')); });
          settled = true;
          resolve(this);
        });
      });
      conn.connect({
        host: this.device.host,
        port: Number(this.device.port) || 22,
        username: this.device.username,
        password: this.password,
        readyTimeout: this.timeoutMs,
        keepaliveInterval: 5000,
        algorithms: {
          kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group14-sha256', 'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1'],
          cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm', 'aes256-gcm', 'aes128-cbc', 'aes256-cbc', '3des-cbc'],
          serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ssh-ed25519', 'rsa-sha2-256', 'rsa-sha2-512']
        }
      });
    });
  }

  _tailLine() {
    const lines = this.cleanBuf.split('\n').map(l => l.replace(/\s+$/, ''));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.length ? lines[lines.length - 1].trim() : '';
  }

  /** Ambil prompt kanonik: match TERAKHIR dari pola teks-yang-diakhiri # > $ (kebal prompt dobel ber-padding) */
  _derivePrompt() {
    const tail = this._tailLine();
    if (!tail) return null;
    const re = /[^\s][^\n]*?[#>$](?=\s|$)/g;
    let m, last = null;
    while ((m = re.exec(tail)) !== null) last = m[0].trim();
    if (!last || last.length > 60 || !/[#>]$/.test(last)) return null;
    return last;
  }

  async init() {
    const t0 = Date.now();
    const budget = this.timeoutMs + 8000;
    for (;;) {
      if (Date.now() - t0 > budget) {
        throw new Error('prompt CLI tidak terdeteksi. Buffer: ' + JSON.stringify(this.cleanBuf.slice(-200)));
      }
      const buf = this.cleanBuf;
      // MikroTik kadang menanyakan lisensi saat login SSH pertama
      if (/\[Y\/n\]\??\s*$/i.test(buf) || /show the software license[\s\S]*\[Y\/n\]/i.test(buf)) {
        this.cleanBuf = '';
        this.stream.write('n\n');
        await this._sleep(300);
        continue;
      }
      const cand = this._derivePrompt();
      if (cand && this.cleanBuf.replace(/\s+$/, '').endsWith(cand)) {
        this.prompt = cand;
        break;
      }
      await this._sleep(80);
    }
    await this.disablePager();
    return this;
  }

  async disablePager() {
    const p = String(this.device.pagerOff || '').trim();
    if (!p) return;
    for (const cmd of p.split(';').map(s => s.trim()).filter(Boolean)) {
      try { await this.raw(cmd); } catch {}
    }
  }

  async raw(cmd) {
    if (this.closed || !this.stream) throw new Error('session closed');
    const start = this.cleanBuf.length;
    this.stream.write(cmd + '\n');
    const self = this;
    // /export dsb. bisa makan waktu lama -> deadline per perintah mengikuti timeout sesi
    await this._wait(
      () => self.cleanBuf.length > start && self.cleanBuf.replace(/\s+$/, '').endsWith(self.prompt),
      Math.max(this.timeoutMs + 20000, 30000),
      'menunggu hasil "' + cmd.slice(0, 40) + '"'
    );
    let out = this.cleanBuf.slice(start);
    const lines = out.split('\n');
    // Strip awal baris-1: kombinasi apa pun dari [echo-perintah][prompt][spasi]
    // (RouterOS menggambar ulang "cmd<prompt> cmd" saat Enter ditekan)
    if (lines.length) {
      let f = lines[0].trim();
      const parts = [String(cmd).trim(), this.prompt].filter(Boolean);
      let changed = true;
      while (changed && f) {
        changed = false;
        for (const p of parts) {
          if (f.startsWith(p)) { f = f.slice(p.length).trim(); changed = true; }
        }
      }
      if (f === '') lines.shift();
      else lines[0] = f;
    }
    // buang prompt penutup (termasuk varian dobel ber-padding ala MikroTik)
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    for (let guard = 0; guard < 3 && lines.length; guard++) {
      const last = lines[lines.length - 1].trim();
      if (!last) { lines.pop(); continue; }
      if (last === this.prompt || (this.prompt && last.includes(this.prompt))) { lines.pop(); continue; }
      break;
    }
    return lines.join('\n').replace(/[ \t]+$/gm, '').trimEnd();
  }

  run(cmd) { return this.raw(cmd); }

  close() {
    this.closed = true;
    try { this.stream && this.stream.end('\nexit\n'); } catch {}
    try { this.conn && this.conn.end(); } catch {}
    setTimeout(() => this._cleanup(), 300);
  }

  _cleanup() {
    try { this.stream && this.stream.close(); } catch {}
    try { this.conn && this.conn.end(); } catch {}
    this.stream = null; this.conn = null;
  }
}

function isApiTransport(device) {
  return device.vendor === 'mikrotik' && String(device.transport || 'ssh').startsWith('api');
}

/** Port TCP yang relevan untuk cek reachability sesuai transport */
function probePort(device) {
  if (isApiTransport(device)) {
    const secure = device.transport === 'api-ssl';
    return Number(device.apiPort) || (secure ? 8729 : 8728);
  }
  return Number(device.port) || 22;
}

async function withSession(device, password, fn, timeoutMs) {
  if (isApiTransport(device)) {
    const s = new RosApiSession(device, password, timeoutMs);
    try {
      await s.connect();
      return await fn(s);
    } finally {
      s.close();
    }
  }
  const s = new ShellSession(device, password, timeoutMs);
  try {
    await s.connect();
    await s.init();
    return await fn(s);
  } finally {
    s.close();
  }
}

function tcpProbe(host, port, timeoutMs) {
  const net = require('net');
  return new Promise(resolve => {
    const started = Date.now();
    const sock = net.createConnection({ host, port: Number(port) || 22 });
    const done = ok => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok ? { online: true, latencyMs: Date.now() - started } : { online: false, latencyMs: null });
    };
    sock.setTimeout(timeoutMs || 4000);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

module.exports = { ShellSession, RosApiSession, withSession, tcpProbe, probePort, isApiTransport };
