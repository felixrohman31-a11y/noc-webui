export const VENDOR_META = {
  mikrotik: { id: 'mikrotik', label: 'MikroTik RouterOS', color: '#29b6f6' },
  cisco: { id: 'cisco', label: 'Cisco IOS / IOS-XE', color: '#1ba0d7' },
  ruijie: { id: 'ruijie', label: 'Ruijie RGOS', color: '#e53935' },
  aruba: { id: 'aruba', label: 'Aruba', color: '#ff8a1e' },
  sangfor: { id: 'sangfor', label: 'Sangfor NGAF', color: '#7c4dff' },
  huawei: { id: 'huawei', label: 'Huawei VRP', color: '#cf1322' },
  juniper: { id: 'juniper', label: 'Juniper Junos', color: '#33b540' },
  fortinet: { id: 'fortinet', label: 'Fortinet FortiOS', color: '#da291c' },
  generic: { id: 'generic', label: 'Generic SSH', color: '#94a3b8' }
};

export function getVendorMeta(id) {
  return VENDOR_META[id] || VENDOR_META.generic;
}
