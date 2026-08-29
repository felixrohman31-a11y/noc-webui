# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-29

### Security
- Replaced in-memory `rlMap` with **Redis + `rate-limiter-flexible`** in `server/rate-limiter.js`
- Key: `ip|route` — configurable per endpoint via `settings.rateLimit` (UI coming later)
- Default limits:
  - `/api/devices/:id/command` → 60 req/min
  - `/api/devices/detect` → 10 req/min
  - `/api/bulk/run` → 10 req/min
- Graceful fallback: Redis down → log warning + allow request (no crash)

### Added
- Backup streaming to disk + S3/MinIO support in `server/backup.js`
- Stream directly to file (avoid OOM on large backups)
- S3/MinIO support via env `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- Metadata stays in `db.json` (lightweight), content on filesystem/object store
- Audit log rotation: automatic rotation per 10,000 entries or 30 days (whichever comes first)
- Archives to `data/audit-<timestamp>.json.gz` (compressed)
- `/api/audit` endpoint now supports pagination (`?page=&limit=`)

### Fixed
- Graceful shutdown: persist `db.json` + flush audit before exit
- Health checks `/healthz` + `/readyz` (DB + Redis reachability)

## [1.1.0] - 2026-08-28

### Added
- Routing CRUD, discovery fingerprint+deep-detect, api-config-snapshot backup
- BGP-safe fetch, UI polish
- Backup MikroTik API: api-config-snapshot teks sebagai jalur utama
- Backup compare: guard konten fallback + batasi render diff besar
- UI: kolom Host tampil IP saja tanpa port
- Fix: import SecretInput di Devices.jsx (penyebab ReferenceError saat buka Perangkat)