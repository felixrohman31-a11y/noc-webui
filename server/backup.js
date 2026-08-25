/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

const store = require('./store');
const { getVendor, devicePassword } = require('./drivers/vendors');

/**
 * Ambil backup konfigurasi sebuah device + simpan dengan retensi.
 * dipakai oleh route manual DAN auto-backup scheduler.
 */
async function performBackup(device, username, opts = {}) {
  const db = store.getDb();
  const v = getVendor(device.vendor);
  let content;
  if (typeof v.backup === 'function') {
    content = await v.backup(device, devicePassword(device));
  } else {
    const { withSession } = require('./drivers/base');
    content = await withSession(device, devicePassword(device),
      s => s.run(v.backupCommand()),
      (db.settings.sshTimeoutMs || 10000) + 45000);
  }
  if (!content || content.length < 10) throw new Error('Output backup kosong / terlalu pendek');

  const backup = {
    id: store.nextId('bkp'),
    deviceId: device.id,
    deviceName: device.name,
    command: v.backupCommand(),
    createdAt: new Date().toISOString(),
    sizeBytes: Buffer.byteLength(content),
    createdBy: username || (opts.auto ? 'auto-scheduler' : 'unknown'),
    auto: !!opts.auto,
    content
  };

  const keep = Math.max(3, Number(db.settings.retentionBackups) || 20);
  const mine = db.backups.filter(x => x.deviceId === device.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (mine.length >= keep) {
    const oldest = mine.shift();
    db.backups = db.backups.filter(x => x.id !== oldest.id);
  }
  db.backups.push(backup);
  device.lastAutoBackup = new Date().toISOString();
  store.save();

  store.audit(opts.auto ? 'backup.auto' : 'backup.taken',
    `${device.name} (${(backup.sizeBytes / 1024).toFixed(1)} KB)`,
    backup.createdBy);
  try { require('./scheduler').broadcast('backups', {}); } catch {}
  return backup;
}

module.exports = { performBackup };
