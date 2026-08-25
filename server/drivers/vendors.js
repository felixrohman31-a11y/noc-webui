const store = require('../store');
const { decrypt } = require('../crypto');

function pick(re, text, group = 1) {
  const m = text.match(re);
  return m ? m[group].trim() : '';
}

const VENDORS = {
  mikrotik: {
    id: 'mikrotik',
    label: 'MikroTik RouterOS',
    category: 'Router',
    defaultPort: 22,
    pagerOff: '',
    color: '#29b6f6',
    async facts(session) {
      if (session.kind === 'api') {
        const [res, ident] = await Promise.all([
          session.api.sentence(['/system/resource/print']),
          session.api.sentence(['/system/identity/print'])
        ]);
        const r = res.rows[0] || {};
        return {
          hostname: (ident.rows[0] && ident.rows[0].name) || session.device.name,
          vendorLabel: this.label,
          version: r.version,
          uptime: r.uptime,
          boardName: r['board-name'],
          cpuLoad: r['cpu-load'] != null ? r['cpu-load'] + '%' : '',
          freeMemory: r['free-memory'],
          raw: { resource: r }
        };
      }
      const identity = await session.run('/system identity print');
      const res = await session.run('/system resource print without-paging');
      return {
        hostname: pick(/name:\s*(.+)/i, identity) || session.prompt || 'mikrotik',
        vendorLabel: this.label,
        version: pick(/version:\s*([^\r\n]+)/i, res),
        uptime: pick(/uptime:\s*([^\r\n]+)/i, res),
        boardName: pick(/board-name:\s*([^\r\n]+)/i, res),
        cpuLoad: pick(/cpu-load:\s*(\d+%)/i, res),
        freeMemory: pick(/free-memory:\s*([^\r\n]+)/i, res),
        raw: { identity, resource: res }
      };
    },
    async interfaces(session) {
      if (session.kind === 'api') {
        const { rows } = await session.api.sentence(['/interface/print']);
        return rows.map(r =>
          `${r.name || r['.id'] || '?'}\t${r.type || '?'}\tmtu=${r['actual-mtu'] || r.mtu || '?'}\trunning=${r.running === 'true' ? 'yes' : 'no'}${r.disabled === 'true' ? '\tDISABLED' : ''}`
        ).join('\n');
      }
      return session.run('/interface print detail without-paging');
    },
    backupCommand() { return '/export hide-sensitive'; },
    /**
     * Backup untuk MikroTik:
     * - transport API: /export tidak diekspos protokol API RouterOS.
     *   1) coba fallback SSH (host sama) untuk export teks;
     *   2) jika SSH gagal -> buat backup biner .backup langsung di perangkat via API.
     */
    async backup(device, password) {
      const { withSession } = require('./base');
      const to = (store.getDb().settings.sshTimeoutMs || 10000) + 60000;
      if (String(device.transport || 'ssh').startsWith('api')) {
        try {
          return await withSession(
            { ...device, transport: 'ssh', port: Number(device.port) || 22 },
            password,
            s => s.run(this.backupCommand()),
            to
          );
        } catch (sshErr) {
          const { RosApiSession } = require('./routeros-api');
          const s = new RosApiSession(device, password, store.getDb().settings.sshTimeoutMs);
          try {
            await s.connect();
            const name = 'noc-auto-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
            await s.api.sentence(['/system/backup/save', '=name=' + name, '=dont-encrypt=yes']);
            await s.api.sentence(['/system/backup/save', '.proplist=']);
            return `[API mode] SSH tidak dapat dijangkau (${sshErr.message}).\nBackup biner dibuat DI PERANGKAT sebagai "${name}.backup" — ambil via Winbox/Files/FTP.`;
          } finally { s.close(); }
        }
      }
      return withSession(device, password, s => s.run(this.backupCommand()), to);
    }
  },

  cisco: {
    id: 'cisco',
    label: 'Cisco IOS / IOS-XE',
    category: 'L3 Switch',
    defaultPort: 22,
    pagerOff: 'terminal length 0',
    color: '#1ba0d7',
    async facts(session) {
      const ver = await session.run('show version');
      return {
        hostname: pick(/^(\S+)[#>]/m, session.prompt || '') || pick(/^(.+?) uptime is/m, ver) || 'cisco',
        vendorLabel: this.label,
        version: pick(/Version ([^\s,]+)/i, ver),
        uptime: pick(/uptime is (.+)/i, ver),
        model: pick(/[Cc]isco (\S+) .*(?:with|bytes of)/i, ver) || pick(/^[Cc]ISCO (\S+)/mi, ver),
        serial: '',
        raw: { version: ver }
      };
    },
    async interfaces(session) {
      return session.run('show ip interface brief');
    },
    backupCommand() { return 'show running-config'; }
  },

  ruijie: {
    id: 'ruijie',
    label: 'Ruijie RGOS',
    category: 'L2 Switch',
    defaultPort: 22,
    pagerOff: 'terminal length 0',
    color: '#e53935',
    async facts(session) {
      const ver = await session.run('show version');
      return {
        hostname: pick(/^(\S+)[#>]/m, session.prompt || '') || 'ruijie',
        vendorLabel: this.label,
        version: pick(/(?:RGOS|Software Version[^\d]*)([0-9][^\s,)]*)/i, ver) || pick(/Version ([^\s,]+)/i, ver),
        uptime: pick(/uptime is (.+)/i, ver),
        model: pick(/Ruijie (\S+)/i, ver),
        raw: { version: ver }
      };
    },
    async interfaces(session) {
      return session.run('show interfaces status');
    },
    backupCommand() { return 'show running-config'; }
  },

  aruba: {
    id: 'aruba',
    label: 'Aruba (AOS-CX / AOS-Switch)',
    category: 'L2 Switch',
    defaultPort: 22,
    pagerOff: 'no paging;no page',
    color: '#ff8a1e',
    async facts(session) {
      let ver = await session.run('show version');
      if (/invalid|unrecognized|% /i.test(ver) && ver.trim().split('\n').length < 4) {
        try { ver = await session.run('show version brief'); } catch {}
      }
      return {
        hostname: pick(/^(\S+)[#>]/m, session.prompt || '') || 'aruba',
        vendorLabel: this.label,
        version: pick(/Version\s*:?\s*([A-Z]{2}[^\s]+)/i, ver) || pick(/version\s+(\S+)/i, ver),
        uptime: pick(/[Uu]ptime\s*:?\s*(.+)/, ver),
        serial: pick(/Serial [Nn]umber\s*:?\s*(\S+)/, ver),
        raw: { version: ver }
      };
    },
    async interfaces(session) {
      let out = await session.run('show interface brief');
      if (/invalid|unrecognized/i.test(out)) out = await session.run('show interfaces brief');
      return out;
    },
    backupCommand() { return 'show running-config'; }
  },

  sangfor: {
    id: 'sangfor',
    label: 'Sangfor NGAF',
    category: 'Firewall',
    defaultPort: 22,
    pagerOff: 'terminal length 0',
    color: '#7c4dff',
    async facts(session) {
      let ver = await session.run('show version');
      if (!ver || /invalid|unrecognized|not found|% |error/i.test(ver)) {
        try { ver = await session.run('display version'); } catch {}
      }
      if (!ver || !ver.trim()) {
        try { ver = await session.run('sys show version'); } catch {}
      }
      return {
        hostname: pick(/^(\S+)[#>$]/m, session.prompt || '') || 'sangfor',
        vendorLabel: this.label,
        version: pick(/version\s*:?\s*([^\r\n]+)/i, ver),
        uptime: pick(/uptime\s*:?\s*([^\r\n]+)/i, ver),
        raw: { version: ver }
      };
    },
    async interfaces(session) {
      return session.run('show interface');
    },
    backupCommand() { return 'show running-config'; }
  },

  huawei: {
    id: 'huawei',
    label: 'Huawei VRP',
    category: 'Switch',
    defaultPort: 22,
    pagerOff: 'screen-length 0 temporary',
    color: '#cf1322',
    async facts(session) {
      const ver = await session.run('display version');
      return {
        hostname: pick(/^<(.+)>/m, session.prompt || '') || 'huawei',
        vendorLabel: this.label,
        version: pick(/Version\s+\S*\s*(\S+ \S+)/i, ver) || pick(/Version\s+(\S+)/i, ver),
        uptime: pick(/uptime is (.+)/i, ver),
        raw: { version: ver }
      };
    },
    async interfaces(session) {
      return session.run('display ip interface brief');
    },
    backupCommand() { return 'display current-configuration'; }
  },

  juniper: {
    id: 'juniper',
    label: 'Juniper Junos',
    category: 'Router',
    defaultPort: 22,
    pagerOff: 'set cli screen-length 0;set cli complete-on-space off',
    color: '#33b540',
    async facts(session) {
      const ver = await session.run('show version');
      return {
        hostname: pick(/Hostname:\s*(\S+)/i, ver) || pick(/^(\S+)[#>]/m, session.prompt || '') || 'juniper',
        vendorLabel: this.label,
        version: pick(/JUNOS[^\n]*\[([^\]]+)\]/i, ver) || pick(/JUNOS\s+Software\s+Release\s+\[([^\]]+)\]/i, ver),
        model: pick(/Model:\s*(\S+)/i, ver),
        uptime: '',
        raw: { version: ver }
      };
    },
    async interfaces(session) {
      return session.run('show interfaces terse');
    },
    backupCommand() { return 'show configuration | display set'; }
  },

  fortinet: {
    id: 'fortinet',
    label: 'Fortinet FortiOS',
    category: 'Firewall',
    defaultPort: 22,
    pagerOff: '',
    color: '#da291c',
    async facts(session) {
      const ver = await session.run('get system status');
      return {
        hostname: pick(/Hostname:\s*(\S+)/i, ver) || pick(/^(\S+)[#$>]/m, session.prompt || '') || 'fortigate',
        vendorLabel: this.label,
        version: pick(/Version:\s*\S+\s+v([^\s,]+)/i, ver),
        model: pick(/Version:\s*(Forti\S+)/i, ver),
        serial: pick(/Serial-Number:\s*(\S+)/i, ver),
        uptime: pick(/Uptime:\s*([^\r\n]+)/i, ver),
        raw: { version: ver }
      };
    },
    async interfaces(session) {
      return session.run('diagnose ip route list');
    },
    backupCommand() { return 'show full-configuration'; }
  },

  generic: {
    id: 'generic',
    label: 'Generic (custom SSH)',
    category: 'Other',
    defaultPort: 22,
    pagerOff: '',
    color: '#94a3b8',
    async facts(session) {
      const s = store.getDb().settings;
      const ver = await session.run(s.genericVersionCommand || 'show version');
      return {
        hostname: pick(/^(\S+)[#>$~]/m, session.prompt || '') || session.device.name,
        vendorLabel: this.label,
        version: '',
        raw: { output: ver }
      };
    },
    async interfaces(session) {
      return '';
    },
    backupCommand() {
      const s = store.getDb().settings;
      return s.genericBackupCommand || 'show running-config';
    }
  }
};

function getVendor(id) {
  return VENDORS[id] || VENDORS.generic;
}

function devicePassword(device) {
  return decrypt(device.passwordEnc);
}

module.exports = { VENDORS, getVendor, devicePassword };
