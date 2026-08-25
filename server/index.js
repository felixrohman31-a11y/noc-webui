const express = require('express');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const auth = require('./auth');
const routes = require('./routes');
const scheduler = require('./scheduler');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

store.load();
store.saveNow();
auth.ensureAdminUser();
require('./history').load();
scheduler.startScheduler();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api', routes);
app.get('/api/events', auth.authMiddleware, scheduler.sseHandler);

// serve built frontend in production (index.html selalu fresh, asset hashed boleh cache)
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1d', setHeaders: (res, p) => {
    if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  } }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[server]', err.message);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, HOST, () => {
  const os = process.platform;
  console.log(`[noc-webui] listening on http://${HOST}:${PORT}  (platform: ${os})`);
  console.log(`[noc-webui] config-ui: ${require('./drivers/ros-menus').length} menu MikroTik terdaftar`);
});
