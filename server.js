// Routes only — Baileys, storage, contacts, campaign FSM all live in lib/.
'use strict';

try {
  process.loadEnvFile();
} catch {
  // .env is optional if the environment already provides these vars
}

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const storage = require('./lib/storage');
const contactsLib = require('./lib/contacts');
const variantsLib = require('./lib/variants');
const { BaileysConnection } = require('./lib/baileys');
const { CampaignEngine } = require('./lib/campaign');

// Crash supervisor (eng review CRITICAL): this runs unattended for weeks.
// Log and keep going rather than let one unhandled rejection silently kill
// the process with nobody noticing. Still recommend a process manager
// (pm2 etc.) for real unattended use — see TODOS.md.
function logCrash(context, err) {
  console.error(`[${context}]`, err);
  storage.appendJSONL('logs', {
    ts: new Date().toISOString(),
    type: 'error',
    context,
    message: err?.message || String(err),
  }).catch(() => {});
}
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (err) => logCrash('unhandledRejection', err));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // bind locally by default (eng review HIGH)
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
if (!DASHBOARD_PASSWORD) {
  console.error('DASHBOARD_PASSWORD is not set. Copy .env.example to .env and set one.');
  process.exit(1);
}

// ---- Auth: single shared password, opaque bearer token, basic throttling ----
// (eng review HIGH: bind address + attempt throttling + apply auth globally)
const validTokens = new Set();
let failedAttempts = 0;
let lockedUntil = 0;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 5 * 60000;

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token && validTokens.has(token)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

const app = express();
app.use(express.json({ limit: '5mb' })); // CSV imports run up to ~1000 contacts
app.use(express.text({ type: 'text/csv', limit: '5mb' }));

app.post('/api/login', (req, res) => {
  if (Date.now() < lockedUntil) {
    return res.status(429).json({ error: 'too many attempts, try again later' });
  }
  const { password } = req.body || {};
  if (password !== DASHBOARD_PASSWORD) {
    failedAttempts++;
    if (failedAttempts >= LOCKOUT_THRESHOLD) lockedUntil = Date.now() + LOCKOUT_MS;
    return res.status(401).json({ error: 'wrong password' });
  }
  failedAttempts = 0;
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.add(token);
  res.json({ token });
});

app.use('/api', requireAuth); // everything else under /api requires a valid token

// Static dashboard shell. Data files (contact PII) live in lib/storage.js's
// DATA_DIR, a separate directory never passed here (eng review HIGH).
app.use(express.static(path.join(__dirname, 'public')));

const baileys = new BaileysConnection();
const engine = new CampaignEngine(baileys);

// ---- Connect ----
app.get('/api/connect/status', (req, res) => res.json(baileys.getStatus()));
app.post('/api/connect/reconnect', async (req, res) => {
  await baileys.reconnectNewNumber();
  res.json({ ok: true });
});

// ---- Contacts ----
app.get('/api/contacts', (req, res) => {
  res.json({ contacts: contactsLib.getContacts(), counts: contactsLib.getCounts() });
});
app.post('/api/contacts/import', async (req, res) => {
  const text = typeof req.body === 'string' ? req.body : req.body?.csv;
  if (!text) return res.status(400).json({ error: 'missing CSV body' });
  const result = await contactsLib.importCSV(text, { defaultCountryCode: req.query.defaultCountryCode });
  res.json(result);
});
app.get('/api/contacts/export', (req, res) => {
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="contacts-export.csv"');
  res.send(contactsLib.exportCSV());
});

// ---- Message Variants ----
app.get('/api/variants', (req, res) => res.json(variantsLib.getVariants()));
app.post('/api/variants', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'missing text' });
  const variants = variantsLib.getVariants();
  const variant = { id: crypto.randomBytes(6).toString('hex'), text };
  variants.push(variant);
  await variantsLib.setVariants(variants);
  res.json(variant);
});
app.put('/api/variants/:id', async (req, res) => {
  const { text } = req.body || {};
  const variants = variantsLib.getVariants();
  const variant = variants.find((v) => v.id === req.params.id);
  if (!variant) return res.status(404).json({ error: 'not found' });
  if (text) variant.text = text;
  await variantsLib.setVariants(variants);
  res.json(variant);
});
app.delete('/api/variants/:id', async (req, res) => {
  const variants = variantsLib.getVariants().filter((v) => v.id !== req.params.id);
  await variantsLib.setVariants(variants);
  res.json({ ok: true });
});

// ---- Pacing/Settings ----
app.get('/api/settings', (req, res) => res.json(engine.getState().config));
app.put('/api/settings', async (req, res) => {
  const state = await engine.updateConfig(req.body || {});
  res.json(state.config);
});

// ---- Campaign ----
app.get('/api/campaign', (req, res) => {
  const state = engine.getState();
  res.json({ ...state, counts: contactsLib.getCounts() });
});
app.post('/api/campaign/start', async (req, res) => res.json(await engine.startCampaign()));
app.post('/api/campaign/pause', async (req, res) => res.json(await engine.pauseCampaign()));
app.post('/api/campaign/resume', async (req, res) => res.json(await engine.resumeCampaign()));
app.post('/api/campaign/stop', async (req, res) => res.json(await engine.stopCampaign()));

// ---- Logs ----
app.get('/api/logs', (req, res) => {
  const tail = Number(req.query.tail) || 200;
  res.json(storage.readJSONL('logs', { tail }).reverse()); // reverse-chronological
});

app.listen(PORT, HOST, () => {
  console.log(`Dashboard running at http://${HOST}:${PORT}`);
  engine.init();
  baileys.start().catch((err) => logCrash('baileys.start', err));
});
