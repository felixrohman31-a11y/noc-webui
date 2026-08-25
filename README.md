# Network Control Center

WebUI full-stack untuk **kontrol terpusat perangkat jaringan multi-vendor** — dibangun murni dengan Node.js, tanpa dependensi native, jalan di Windows & Linux.

![stack](https://img.shields.io/badge/React-Vite-cyan) ![backend](https://img.shields.io/badge/Express-SSH%20%2B%20RouterOS%20API-blue) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20-success) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) ![free](https://img.shields.io/badge/100%25-FREE_to_use-brightgreen)

> ✅ **100% GRATIS** — bebas diunduh, dipasang, digunakan (termasuk komersial), dan dimodifikasi di bawah lisensi [MIT](LICENSE). Tanpa biaya, tanpa limitasi fitur, tanpa telemetri.

**Author:** [felixrohman31-a11y](https://github.com/felixrohman31-a11y) · [Releases](https://github.com/felixrohman31-a11y/noc-webui/releases) · [Laporkan bug](https://github.com/felixrohman31-a11y/noc-webui/issues)

---

## Requirements

| Komponen | Minimal | Catatan |
|---|---|---|
| Node.js | **v18.17+** | Debian 12 repo: `apt install nodejs npm` |
| npm | v9+ | Ikut dengan Node.js |
| RAM | 512 MB | Cukup untuk panel + SSH session |
| Disk | 100 MB | Source + node_modules |
| OS | Debian 11/12, Ubuntu 22.04+ | Juga jalan di Windows |

> Tidak ada dependency native, tidak perlu Docker, tidak perlu database.

---

## Deploy — Step by Step

### 1. Install Node.js

```bash
# Debian 12 / Ubuntu 22.04+
apt update
apt install -y nodejs npm
node -v   # harus >= 18.17
```

### 2. Clone & Build

```bash
git clone https://github.com/felixrohman31-a11y/noc-webui.git /opt/noc-webui
cd /opt/noc-webui
npm install
npm run build
```

### 3. Konfigurasi

```bash
cat > .env <<'EOF'
PORT=3000
SESSION_SECRET=ganti-dengan-secret-acak-panjang
EOF
chmod 600 .env
```

### 4. Jalankan

```bash
npm start
# Panel jalan di http://<ip>:3000
# Login default: admin / admin123 — segera ganti di menu Pengaturan
```

### 5. Systemd (auto-start)

```bash
cat > /etc/systemd/system/noc-webui.service <<'EOF'
[Unit]
Description=NOC WebUI - Network Control Center
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/noc-webui
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now noc-webui
```

### 6. Nginx Reverse Proxy (opsional, untuk HTTPS)

```bash
apt install -y nginx
# Buat self-signed cert
openssl req -x509 -nodes -days 3650 -newkey rsa:2048   -keyout /etc/nginx/ssl/noc.key -out /etc/nginx/ssl/noc.crt   -subj "/CN=$(hostname -I | awk '{print $1}')"

cat > /etc/nginx/sites-available/noc-webui <<'EOF'
server {
    listen 80;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    ssl_certificate /etc/nginx/ssl/noc.crt;
    ssl_certificate_key /etc/nginx/ssl/noc.key;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/noc-webui /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### Updating

```bash
cd /opt/noc-webui && git pull && npm install && npm run build && systemctl restart noc-webui
```

---



## Vendor yang Didukung

| Vendor | Transport | Catatan |
|---|---|---|
| **MikroTik RouterOS** | SSH CLI **atau** RouterOS API (8728/API-SSL 8729) | Client protokol API biner *pure-JS* buatan sendiri; **Config UI ala Winbox** 22 menu |
| Cisco IOS / IOS-XE | SSH | |
| Ruijie RGOS | SSH | |
| Aruba AOS-CX / AOS-Switch | SSH | |
| Huawei VRP | SSH | |
| Juniper Junos | SSH | |
| Fortinet FortiOS | SSH | |
| Sangfor NGAF | SSH | |
| Generic (custom SSH) | SSH | Perintah backup/versi bisa diatur |

## Fitur

**Monitoring**
- Polling reachability otomatis (interval bisa diatur) + latency
- Grafik historis **persisten** (latency, uptime%, CPU & memori untuk MikroTik API) — bertahan lintas restart
- Dashboard live via SSE, sparkline, badge uptime
- Tab **Interfaces realtime**: tabel live + **traffic rate Mbps** per interface (MikroTik API), auto-refresh

**Konfigurasi & Otomasi**
- **Config UI ala Winbox** untuk MikroTik: 22 menu (Address, Firewall Filter/NAT/Address List, DHCP, Queue, PPP, Scheduler, dll) dengan flag khas Winbox (R/D/I), dropdown interface live, datalist action/protocol, proteksi per-menu (Routes read-only, Services hanya toggle)
- **CLI Browser** untuk vendor lain: menu perintah show/display terstruktur
- Tools **Ping & Traceroute** via API
- **Backup konfigurasi** manual + **auto-backup terjadwal** dengan retensi; diff dua versi (unified & side-by-side)
- **Bulk Command Runner** paralel + template perintah tersimpan
- **Discovery subnet**: scan TCP + fingerprint banner (`ROSSSH` → MikroTik), tambah massal

**Keamanan & Operasional**
- Auth JWT + **multi-user ber-role** (admin/operator/viewer — viewer read-only ditegakkan server)
- **API Key** untuk otomasi/scripting (`X-API-Key`), role-bound
- Rate-limit login, audit log lengkap (termasuk IP) + export CSV
- Kredensial device terenkripsi **AES-256-GCM**, password user bcrypt
- **Notifikasi**: Webhook (n8n/Discord relay) & **Telegram Bot** langsung + tombol test; cooldown anti-flapping
- Export/Import data NOC (JSON) untuk migrasi antar-server
- Deteksi otomatis **model perangkat** dari firmware; koordinat GPS sekali klik

## Menjalankan

### Development
```bash
npm install
npm run dev        # API :3000 + UI hot-reload :5173
```

### Produksi
```bash
npm install
npm run build      # frontend -> dist/
npm start          # serve semuanya di http://0.0.0.0:3000
```

Login default: `admin / admin123` — **segera ganti** di menu Pengaturan.

### Windows (klik-2x)
Double-click `start.bat` — otomatis install/build/start lalu buka browser.

### Service permanen
- **Linux (systemd)**: lihat contoh unit di bawah
- **Windows**: `nssm` atau `pm2`

```ini
# /etc/systemd/system/noc-webui.service
[Unit]
Description=NOC WebUI
After=network.target

[Service]
WorkingDirectory=/opt/noc-webui
ExecStart=/usr/bin/node server/index.js
Environment=PORT=3000 HOST=0.0.0.0
Environment=NOC_JWT_SECRET=ganti-dengan-rahasia
Restart=always

[Install]
WantedBy=multi-user.target
```

Environment: `PORT` (3000), `HOST` (0.0.0.0), `NOC_DATA_DIR` (folder data), `NOC_JWT_SECRET`.

## API (contoh cepat)

```bash
# login
curl -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin123"}'

# pakai JWT atau X-API-Key
curl localhost:3000/api/devices -H "X-API-Key: <key-anda>"
curl localhost:3000/api/dashboard -H "Authorization: Bearer <token>"
```

Dokumentasi endpoint lengkap: lihat `server/routes.js` (semua route dalam satu file).

## Struktur

```
server/
  index.js            # entry: express + static dist
  routes.js           # seluruh REST API
  auth.js             # JWT, role, rate-limit, user mgmt, API key auth
  store.js            # persistensi db.json (atomic write)
  history.js          # riwayat metrik -> history.json
  scheduler.js        # polling, alert engine, auto-backup
  backup.js           # backup + retensi
  notify.js           # webhook + Telegram
  drivers/
    base.js           # SSH ShellSession (prompt detection lintas vendor)
    routeros-api.js   # client RouterOS API biner pure-JS
    vendors.js        # driver 9 vendor (facts/interfaces/backup)
    ros-menus.js      # registry menu Config UI MikroTik
  cli-menus.js        # menu CLI Browser per vendor
src/                  # React (Vite + Tailwind v4)
data/                 # runtime (di-gitignore): db.json, history.json, .secret.key
```

## Menambah Vendor / Menu Baru

- Vendor SSH baru: tambah entry di `server/drivers/vendors.js` (facts/interfaces/backup/pagerOff) + `server/cli-menus.js`
- Menu Config UI MikroTik baru: tambah entry di `server/drivers/ros-menus.js` (field & kapabilitas tulis per menu di-whitelist di sini)

## Keamanan

- Folder `data/` berisi `db.json` (kredensial terenkripsi) dan `.secret.key` — **backup keduanya bersama-sama**, dan **jangan pernah dibagikan**
- Untuk produksi: taruh di balik reverse-proxy HTTPS (nginx/Caddy/IIS), batasi akses jaringan manajemen
- Ganti `NOC_JWT_SECRET` via environment variable

## 🗺️ Roadmap

### Fase 1 — Quick Wins
- [ ] **Prometheus exporter** (`/metrics`) → grafik Grafana tanpa chart sendiri
- [ ] **Syslog server** (UDP 514) — pusat log semua device + alert dari log
- [ ] **Notifikasi Email (SMTP) + Slack**
- [ ] **Cek firmware update** MikroTik via API
- [ ] **IPAM ringan** (visualisasi pemakaian IP dari DHCP lease/pool/address-list)
- [ ] **PWA / mobile-friendly**

### Fase 2 — Core NMS
- [ ] **SNMP monitoring traffic** — bandwidth per interface untuk semua vendor (gap terbesar)
- [ ] **Alert rule engine** — aturan per device/tag, jadwal senyap, eskalasi, acknowledge
- [ ] **Config drift detection** — alert bila config berubah dari baseline known-good
- [ ] **Backup off-site** (SCP/S3/git)

### Fase 3 — Premium
- [ ] **Topology map** otomatis dari LLDP/CDP/neighbor
- [ ] **Laporan SLA bulanan** (HTML/PDF)
- [ ] **HTTPS built-in + 2FA (TOTP)**
- [ ] **NetFlow/sFlow**

> Progress di-update di [Releases](https://github.com/felixrohman31-a11y/noc-webui/releases) — request fitur? Buka [Issue](https://github.com/felixrohman31-a11y/noc-webui/issues).

## Author & Lisensi

**© 2026 [felixrohman31-a11y](https://github.com/felixrohman31-a11y)** — [noc-webui](https://github.com/felixrohman31-a11y/noc-webui)

Dirilis di bawah lisensi [MIT](LICENSE). Anda bebas menggunakan/memodifikasi, **asal notice copyright & lisensi ini disertakan** di setiap salinan. Menghapus atribusi = pelanggaran lisensi.

> Jika proyek ini bermanfaat, mohon jangan hapus tautan repo asli dari README turunannya.

---

## 💰 Dukung Pengembangan

Proyek ini gratis dan open-source. Kalau bermanfaat, ada beberapa jalur dukungan:

### Private Wallet — Crypto
**BNB (BEP-20 / BSC Network)**
```
0x4649b364523D4DdC329583E218f20d52b2997367
```




