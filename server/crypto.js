/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

let KEY = null;

function getKey() {
  if (KEY) return KEY;
  const keyFile = path.join(store.DATA_DIR, '.secret.key');
  if (fs.existsSync(keyFile)) {
    KEY = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  } else {
    KEY = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, KEY.toString('hex'), { mode: 0o600 });
  }
  return KEY;
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(payload) {
  if (!payload) return '';
  try {
    const [ivB64, tagB64, dataB64] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { encrypt, decrypt };
