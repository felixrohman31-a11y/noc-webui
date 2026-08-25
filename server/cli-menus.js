/**
 * Menu CLI Browser untuk vendor berbasis SSH (non-API).
 * Setiap menu = kumpulan show/display command read-only yang dijalankan
 * dalam SATU sesi SSH. Tidak ada aksi tulis di sini (keamanan screen-scraping).
 */
const G = (group, label, cmds) => ({ group, label, cmds });

const MENUS_BY_VENDOR = {
  cisco: [
    G('System', 'Version', ['show version']),
    G('System', 'Inventory', ['show inventory']),
    G('System', 'Clock', ['show clock detail']),
    G('Interfaces', 'Status', ['show interfaces status']),
    G('Interfaces', 'IP Brief', ['show ip interface brief']),
    G('Switching', 'VLAN', ['show vlan brief']),
    G('Switching', 'MAC Table', ['show mac address-table']),
    G('Routing', 'Routes', ['show ip route']),
    G('Routing', 'ARP', ['show ip arp']),
    G('Health', 'CPU', ['show processes cpu sorted | exclude 0.00']),
    G('Health', 'Environment', ['show environment all']),
    G('Logs', 'Logging', ['show logging'])
  ],
  ruijie: [
    G('System', 'Version', ['show version']),
    G('Interfaces', 'Status', ['show interfaces status']),
    G('Interfaces', 'IP Brief', ['show ip interface brief']),
    G('Switching', 'VLAN', ['show vlan']),
    G('Switching', 'MAC Table', ['show mac-address-table']),
    G('Routing', 'Routes', ['show ip route']),
    G('Routing', 'ARP', ['show arp']),
    G('Logs', 'Logging', ['show logging'])
  ],
  aruba: [
    G('System', 'Version', ['show version', 'show system']),
    G('Interfaces', 'Brief', ['show interface brief']),
    G('Switching', 'VLAN', ['show vlan']),
    G('Switching', 'MAC Table', ['show mac-address-table']),
    G('Routing', 'Routes', ['show ip route']),
    G('Routing', 'ARP / ND', ['show arp']),
    G('Logs', 'Logging', ['show logging -r'])
  ],
  huawei: [
    G('System', 'Version', ['display version']),
    G('Interfaces', 'Brief', ['display interface brief']),
    G('Switching', 'VLAN', ['display vlan']),
    G('Switching', 'MAC Table', ['display mac-address']),
    G('Routing', 'Routes', ['display ip routing-table']),
    G('Routing', 'ARP', ['display arp']),
    G('Logs', 'Logbuffer', ['display logbuffer size 50'])
  ],
  juniper: [
    G('System', 'Version', ['show version']),
    G('System', 'Uptime', ['show system uptime']),
    G('Interfaces', 'Terse', ['show interfaces terse']),
    G('Routing', 'Route Summary', ['show route summary']),
    G('Routing', 'ARP', ['show arp']),
    G('Bridging', 'Switching Table', ['show ethernet-switching table']),
    G('Logs', 'Messages (last 50)', ['show log messages | last 50'])
  ],
  fortinet: [
    G('System', 'Status', ['get system status']),
    G('System', 'Performance', ['get system performance status']),
    G('Interfaces', 'Config', ['show system interface']),
    G('Routing', 'Route List', ['diagnose ip route list']),
    G('Routing', 'Route Summary', ['get router info routing-table summary']),
    G('HA', 'Cluster Status', ['get system ha status'])
  ],
  sangfor: [
    G('System', 'Version', ['show version']),
    G('Interfaces', 'Interface', ['show interface']),
    G('Routing', 'Routes', ['show ip route'])
  ]
};

function forVendor(vendorId) {
  return MENUS_BY_VENDOR[vendorId] || [];
}

module.exports = { forVendor, MENUS_BY_VENDOR };
