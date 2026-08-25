/**
 * Registry menu "gaya Winbox" untuk MikroTik via RouterOS API.
 *
 * Field form: {k, t:'text'|'num'|'pass', src:'interfaces', opts:[...]}
 *   src='interfaces' -> frontend merender <select> diisi live dari /interface/print
 *   opts=[...]       -> datalist (saran dropdown, tetap bisa isi manual)
 */
const F = (k, o = {}) => ({ k, t: o.t || 'text', src: o.src, opts: o.opts });

const FW_ACTIONS = ['accept', 'drop', 'reject', 'log', 'return', 'jump', 'fasttrack-connection'];
const NAT_ACTIONS = ['masquerade', 'src-nat', 'dst-nat', 'redirect', 'netmap', 'same', 'log'];
const PROTOCOLS = ['tcp', 'udp', 'icmp', 'gre', 'esp', 'ah', 'ipip', 'ipencap'];
const PPP_SERVICES = ['pppoe', 'pptp', 'l2tp', 'sstp'];

module.exports = [
  {
    key: 'interfaces', group: '', label: 'Interfaces', path: '/interface',
    cols: ['name', 'type', 'actual-mtu'],
    caps: { toggle: true, remove: false, edit: [F('name'), F('mtu', { t: 'num' }), F('comment')], add: null }
  },
  {
    key: 'addresses', group: 'IP', label: 'Addresses', path: '/ip/address',
    cols: ['address', 'interface', 'network'],
    caps: {
      toggle: true, remove: true,
      edit: [F('address'), F('interface', { src: 'interfaces' }), F('comment')],
      add: [F('address'), F('interface', { src: 'interfaces' }), F('comment')]
    }
  },
  {
    key: 'routes', group: 'IP', label: 'Routes', path: '/ip/route',
    cols: ['dst-address', 'gateway', 'distance', 'target-scope'],
    readonly: true // routing terlalu berisiko untuk diedit dari web panel
  },
  {
    key: 'services', group: 'IP', label: 'Services', path: '/ip/service',
    cols: ['name', 'port'],
    caps: { toggle: true, remove: false, edit: null, add: null }
  },
  {
    key: 'dhcp-leases', group: 'IP', label: 'DHCP Leases', path: '/ip/dhcp-server/lease',
    cols: ['host-name', 'mac-address', 'address', 'active-address'],
    caps: {
      toggle: true, remove: true,
      edit: [F('comment')],
      add: null,
      extras: [{ label: 'Make Static', cmd: '/ip/dhcp-server/lease/make-static =.id={id}' }]
    }
  },
  {
    key: 'dhcp-servers', group: 'IP', label: 'DHCP Server', path: '/ip/dhcp-server',
    cols: ['name', 'interface', 'lease-time'],
    caps: {
      toggle: true, remove: false,
      edit: [F('interface', { src: 'interfaces' }), F('comment')],
      add: null
    }
  },
  {
    key: 'dhcp-clients', group: 'IP', label: 'DHCP Client', path: '/ip/dhcp-client',
    cols: ['interface', 'status'],
    caps: {
      toggle: true, remove: false,
      edit: [F('interface', { src: 'interfaces' }), F('comment')],
      add: null
    }
  },
  {
    key: 'fw-filter', group: 'Firewall', label: 'Filter Rules', path: '/ip/firewall/filter',
    cols: ['chain', 'action', 'protocol', 'src-address', 'dst-address', 'dst-port'],
    caps: {
      toggle: true, remove: true,
      edit: [
        F('chain'), F('action', { opts: FW_ACTIONS }), F('protocol', { opts: PROTOCOLS }),
        F('src-address'), F('dst-address'), F('dst-port', { t: 'num' }),
        F('in-interface', { src: 'interfaces' }), F('out-interface', { src: 'interfaces' }),
        F('comment')
      ],
      add: [
        F('chain'), F('action', { opts: FW_ACTIONS }), F('protocol', { opts: PROTOCOLS }),
        F('src-address'), F('dst-address'), F('dst-port', { t: 'num' }),
        F('in-interface', { src: 'interfaces' }), F('out-interface', { src: 'interfaces' }),
        F('comment')
      ]
    }
  },
  {
    key: 'fw-nat', group: 'Firewall', label: 'NAT', path: '/ip/firewall/nat',
    cols: ['chain', 'action', 'out-interface', 'to-addresses'],
    caps: {
      toggle: true, remove: true,
      edit: [
        F('chain', { opts: ['srcnat', 'dstnat'] }), F('action', { opts: NAT_ACTIONS }),
        F('in-interface', { src: 'interfaces' }), F('out-interface', { src: 'interfaces' }),
        F('to-addresses'), F('comment')
      ],
      add: [
        F('chain', { opts: ['srcnat', 'dstnat'] }), F('action', { opts: NAT_ACTIONS }),
        F('in-interface', { src: 'interfaces' }), F('out-interface', { src: 'interfaces' }),
        F('to-addresses'), F('comment')
      ]
    }
  },
  {
    key: 'fw-address-list', group: 'Firewall', label: 'Address Lists', path: '/ip/firewall/address-list',
    cols: ['list', 'address', 'creation-time'],
    caps: {
      toggle: true, remove: true,
      edit: [F('address'), F('comment')],
      add: [F('list'), F('address'), F('comment')]
    }
  },
  {
    key: 'ip-pool', group: 'IP', label: 'Pool', path: '/ip/pool',
    cols: ['name', 'ranges', 'total', 'used', 'available'],
    caps: {
      toggle: false, remove: true,
      edit: [F('ranges'), F('comment')],
      add: [F('name'), F('ranges'), F('comment')]
    }
  },
  {
    key: 'ip-neighbors', group: 'IP', label: 'Neighbors', path: '/ip/neighbor',
    cols: ['identity', 'platform', 'version', 'mac-address', 'interface'],
    caps: { toggle: false, remove: true, edit: null, add: null }
  },
  {
    key: 'queues', group: 'Queue', label: 'Simple Queues', path: '/queue/simple',
    cols: ['name', 'target', 'max-limit'],
    caps: {
      toggle: true, remove: true,
      edit: [F('target'), F('max-limit'), F('comment')],
      add: [F('name'), F('target'), F('max-limit'), F('comment')]
    }
  },
  {
    key: 'ppp-active', group: 'PPP', label: 'Active Connections', path: '/ppp/active',
    cols: ['name', 'service', 'caller-id', 'address', 'uptime'],
    readonly: true
  },
  {
    key: 'ppp-secrets', group: 'PPP', label: 'Secrets', path: '/ppp/secret',
    cols: ['name', 'service', 'profile'],
    caps: {
      toggle: true, remove: true,
      edit: [F('profile'), F('password', { t: 'pass' }), F('service', { opts: PPP_SERVICES }), F('comment')],
      add: [F('name'), F('password', { t: 'pass' }), F('service', { opts: PPP_SERVICES }), F('profile'), F('comment')]
    }
  },
  {
    key: 'dhcp-networks', group: 'IP', label: 'DHCP Networks', path: '/ip/dhcp-server/network',
    cols: ['address', 'gateway', 'dns-server', 'netmask'],
    caps: {
      toggle: true, remove: true,
      edit: [F('address'), F('gateway'), F('dns-server'), F('netmask', { t: 'num' }), F('comment')],
      add: [F('address'), F('gateway'), F('dns-server'), F('netmask', { t: 'num' }), F('comment')]
    }
  },
  {
    key: 'fw-conn', group: 'Firewall', label: 'Connections', path: '/ip/firewall/connection',
    cols: ['src-address', 'dst-address', 'protocol'],
    readonly: true,
    caps: { toggle: false, remove: true, edit: null, add: null } // drop koneksi aktif diperbolehkan
  },
  {
    key: 'sched', group: 'System', label: 'Scheduler', path: '/system/scheduler',
    cols: ['name', 'start-time', 'interval', 'on-event'],
    caps: {
      toggle: true, remove: true,
      edit: [F('start-time'), F('interval'), F('on-event'), F('comment')],
      add: [F('name'), F('start-time', { opts: ['startup'] }), F('interval'), F('on-event'), F('comment')]
    }
  },
  {
    key: 'resource', group: 'System', label: 'Resources', path: '/system/resource',
    cols: ['version', 'board-name', 'uptime', 'cpu-load', 'free-memory'],
    readonly: true
  },
  {
    key: 'clock', group: 'System', label: 'Clock', path: '/system/clock',
    cols: ['time', 'date', 'time-zone-name', 'gmt-offset'],
    readonly: true
  },
  {
    key: 'logs', group: 'System', label: 'Logs', path: '/log',
    cols: ['time', 'topics', 'message'],
    readonly: true
  },
  {
    key: 'identity', group: 'System', label: 'Identity', path: '/system/identity',
    cols: ['name'],
    caps: { toggle: false, remove: false, edit: [F('name')], add: null }
  }
];
