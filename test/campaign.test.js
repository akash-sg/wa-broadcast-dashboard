'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolated data dir — test files run as separate processes and would
// otherwise race on the real data/ dir (see storage.js).
process.env.OPENWA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-campaign-test-'));

const storage = require('../lib/storage');
const contactsLib = require('../lib/contacts');
const variantsLib = require('../lib/variants');
const campaign = require('../lib/campaign');

const {
  shouldEndBatch,
  nextBatchContacts,
  computeReplyRatio,
  isQuietHours,
  pickVariant,
  personalize,
  randomDelayMs,
  CampaignEngine,
} = campaign;

// ---- Pure function tests ------------------------------------------------

test('shouldEndBatch: threshold reached before timeout', () => {
  const batch = { startedAt: new Date(Date.now() - 60000).toISOString(), repliesReceived: ['a', 'b', 'c'] };
  const config = { replyThreshold: 3, timeoutMinutes: 30 };
  assert.deepStrictEqual(shouldEndBatch(batch, config), { end: true, reason: 'threshold' });
});

test('shouldEndBatch: timeout reached before threshold', () => {
  const batch = { startedAt: new Date(Date.now() - 31 * 60000).toISOString(), repliesReceived: ['a'] };
  const config = { replyThreshold: 3, timeoutMinutes: 30 };
  assert.deepStrictEqual(shouldEndBatch(batch, config), { end: true, reason: 'timeout' });
});

test('shouldEndBatch: neither threshold nor timeout reached', () => {
  const batch = { startedAt: new Date().toISOString(), repliesReceived: [] };
  const config = { replyThreshold: 3, timeoutMinutes: 30 };
  assert.deepStrictEqual(shouldEndBatch(batch, config), { end: false, reason: null });
});

test('shouldEndBatch: threshold and timeout simultaneously reports threshold (checked first)', () => {
  const batch = { startedAt: new Date(Date.now() - 31 * 60000).toISOString(), repliesReceived: ['a', 'b', 'c'] };
  const config = { replyThreshold: 3, timeoutMinutes: 30 };
  assert.deepStrictEqual(shouldEndBatch(batch, config), { end: true, reason: 'threshold' });
});

test('shouldEndBatch: null currentBatch never ends', () => {
  assert.deepStrictEqual(shouldEndBatch(null, { replyThreshold: 1, timeoutMinutes: 1 }), { end: false, reason: null });
});

test('nextBatchContacts: only Pending, respects batchSize', () => {
  const contacts = [
    { number: '1', group: 'Pending' },
    { number: '2', group: 'Replied' },
    { number: '3', group: 'Pending' },
    { number: '4', group: 'NoResponse' },
    { number: '5', group: 'Pending' },
  ];
  assert.deepStrictEqual(nextBatchContacts(contacts, 2).map((c) => c.number), ['1', '3']);
});

test('nextBatchContacts: fewer than batchSize remaining', () => {
  const contacts = [{ number: '1', group: 'Pending' }];
  assert.deepStrictEqual(nextBatchContacts(contacts, 5).map((c) => c.number), ['1']);
});

test('nextBatchContacts: zero remaining', () => {
  const contacts = [{ number: '1', group: 'Replied' }];
  assert.deepStrictEqual(nextBatchContacts(contacts, 5), []);
});

test('computeReplyRatio: cold-start guard when window not full', () => {
  const contacts = [
    { number: '1', sentAt: '2026-01-01T00:00:00Z', group: 'Replied' },
    { number: '2', sentAt: '2026-01-01T00:01:00Z', group: 'NoResponse' },
  ];
  assert.deepStrictEqual(computeReplyRatio(contacts, 5), { evaluated: false, ratio: null });
});

test('computeReplyRatio: excludes in-flight (unresolved) contacts', () => {
  const contacts = [
    { number: '1', sentAt: '2026-01-01T00:00:00Z', group: 'Replied' },
    { number: '2', sentAt: '2026-01-01T00:01:00Z', group: 'NoResponse' },
    { number: '3', sentAt: '2026-01-01T00:02:00Z', group: 'Pending' }, // in-flight, excluded
  ];
  // window=2: only the 2 resolved contacts count, ratio = 1/2
  assert.deepStrictEqual(computeReplyRatio(contacts, 2), { evaluated: true, ratio: 0.5 });
});

test('computeReplyRatio: takes the trailing window by sentAt order', () => {
  const contacts = [
    { number: '1', sentAt: '2026-01-01T00:00:00Z', group: 'NoResponse' },
    { number: '2', sentAt: '2026-01-01T00:01:00Z', group: 'Replied' },
    { number: '3', sentAt: '2026-01-01T00:02:00Z', group: 'Replied' },
  ];
  assert.deepStrictEqual(computeReplyRatio(contacts, 2), { evaluated: true, ratio: 1 });
});

test('isQuietHours: normal (non-wrapping) range', () => {
  assert.strictEqual(isQuietHours(new Date('2026-01-01T10:00:00'), 9, 17), true);
  assert.strictEqual(isQuietHours(new Date('2026-01-01T08:00:00'), 9, 17), false);
  assert.strictEqual(isQuietHours(new Date('2026-01-01T17:00:00'), 9, 17), false);
});

test('isQuietHours: midnight wraparound', () => {
  assert.strictEqual(isQuietHours(new Date('2026-01-01T23:00:00'), 21, 8), true);
  assert.strictEqual(isQuietHours(new Date('2026-01-01T02:00:00'), 21, 8), true);
  assert.strictEqual(isQuietHours(new Date('2026-01-01T12:00:00'), 21, 8), false);
});

test('isQuietHours: exact boundary minutes', () => {
  assert.strictEqual(isQuietHours(new Date('2026-01-01T21:00:00'), 21, 8), true);
  assert.strictEqual(isQuietHours(new Date('2026-01-01T08:00:00'), 21, 8), false);
});

test('pickVariant: round-robins and wraps', () => {
  const variants = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.strictEqual(pickVariant(variants, 0).id, 'a');
  assert.strictEqual(pickVariant(variants, 2).id, 'c');
  assert.strictEqual(pickVariant(variants, 3).id, 'a');
});

test('pickVariant: empty list returns null', () => {
  assert.strictEqual(pickVariant([], 0), null);
});

test('personalize: replaces {{name}} including whitespace/case variants', () => {
  assert.strictEqual(personalize('Hi {{name}}!', 'Sam'), 'Hi Sam!');
  assert.strictEqual(personalize('Hi {{ Name }}!', 'Sam'), 'Hi Sam!');
});

test('randomDelayMs: stays within the configured minute range', () => {
  for (let i = 0; i < 50; i++) {
    const ms = randomDelayMs(3, 8);
    assert.ok(ms >= 3 * 60000 && ms <= 8 * 60000, `${ms} out of range`);
  }
});

// ---- CampaignEngine integration tests -----------------------------------

const KEYS = ['campaign', 'contacts', 'variants'];
function filePath(key) { return path.join(storage.DATA_DIR, `${key}.json`); }

test.after(() => fs.rmSync(storage.DATA_DIR, { recursive: true, force: true }));
test.beforeEach(async () => {
  for (const k of KEYS) fs.rmSync(filePath(k), { force: true });
  await variantsLib.setVariants([{ id: 'v1', text: 'Hi {{name}}, check this out: link1' }]);
});

function fakeBaileys() {
  const emitter = new EventEmitter();
  emitter.status = 'connected';
  emitter.sent = [];
  emitter.sendMessage = async (number, text) => { emitter.sent.push({ number, text }); };
  return emitter;
}

test('starting a campaign sends to Pending contacts and persists currentBatch', async () => {
  await contactsLib.importCSV('name,number\nA,15551111111\nB,15552222222\n');
  const baileys = fakeBaileys();
  const engine = new CampaignEngine(baileys);
  await engine.updateConfig({ batchSize: 5, replyThreshold: 3, minDelayMin: 0, maxDelayMin: 0 });
  await engine.startCampaign();
  await engine.tick();

  assert.strictEqual(baileys.sent.length, 2);
  const state = engine.getState();
  assert.deepStrictEqual(state.currentBatch.contacts.sort(), ['15551111111', '15552222222']);
  const stored = contactsLib.getContacts();
  assert.ok(stored.every((c) => c.sentAt));
});

test('resume does not re-send contacts that already have sentAt', async () => {
  await contactsLib.importCSV('name,number\nA,15551111111\nB,15552222222\n');
  const stored = contactsLib.getContacts();
  stored[0].sentAt = new Date().toISOString(); // already sent, simulating a prior crash
  await storage.writeJSON('contacts', stored);
  await storage.writeJSON('campaign', {
    status: 'running',
    pauseReason: null,
    nextVariantIndex: 0,
    consecutiveFailures: 0,
    currentBatch: { contacts: ['15551111111', '15552222222'], startedAt: new Date().toISOString(), repliesReceived: [] },
    config: { ...campaign.DEFAULT_CONFIG, minDelayMin: 0, maxDelayMin: 0 },
  });

  const baileys = fakeBaileys();
  const engine = new CampaignEngine(baileys);
  await engine.tick();

  assert.strictEqual(baileys.sent.length, 1);
  assert.strictEqual(baileys.sent[0].number, '15552222222');
});

test('batch ends on reply threshold, moving the rest to NoResponse', async () => {
  await contactsLib.importCSV('name,number\nA,15551111111\nB,15552222222\nC,15553333333\n');
  await storage.writeJSON('campaign', {
    status: 'running',
    pauseReason: null,
    nextVariantIndex: 0,
    consecutiveFailures: 0,
    currentBatch: {
      contacts: ['15551111111', '15552222222', '15553333333'],
      startedAt: new Date().toISOString(),
      repliesReceived: ['15551111111'], // one reply already recorded by _onReply
    },
    config: { ...campaign.DEFAULT_CONFIG, replyThreshold: 1, minDelayMin: 0, maxDelayMin: 0 },
  });
  const stored = contactsLib.getContacts();
  for (const c of stored) c.sentAt = new Date().toISOString(); // all already sent
  stored[0].group = 'Replied'; // one reply landed
  await storage.writeJSON('contacts', stored);

  const engine = new CampaignEngine(fakeBaileys());
  await engine.tick(); // should detect threshold met and finalize

  const state = engine.getState();
  assert.strictEqual(state.currentBatch, null);
  const after = contactsLib.getContacts();
  assert.strictEqual(after.find((c) => c.number === '15551111111').group, 'Replied');
  assert.strictEqual(after.find((c) => c.number === '15552222222').group, 'NoResponse');
  assert.strictEqual(after.find((c) => c.number === '15553333333').group, 'NoResponse');
});

test('5 consecutive send failures auto-pauses the campaign', async () => {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => `${n},1555000000${i}`).join('\n');
  await contactsLib.importCSV(`name,number\n${rows}\n`);
  const baileys = fakeBaileys();
  baileys.sendMessage = async () => { throw new Error('boom'); };
  const engine = new CampaignEngine(baileys);
  await engine.updateConfig({ batchSize: 6, minDelayMin: 0, maxDelayMin: 0 });
  await engine.startCampaign();
  await engine.tick();

  const state = engine.getState();
  assert.strictEqual(state.status, 'paused');
  assert.strictEqual(state.pauseReason, 'consecutive_failures');
});

test('stopCampaign finalizes the current batch before marking stopped', async () => {
  await contactsLib.importCSV('name,number\nA,15551111111\nB,15552222222\n');
  await storage.writeJSON('campaign', {
    status: 'running',
    pauseReason: null,
    nextVariantIndex: 0,
    consecutiveFailures: 0,
    currentBatch: { contacts: ['15551111111', '15552222222'], startedAt: new Date().toISOString(), repliesReceived: [] },
    config: { ...campaign.DEFAULT_CONFIG },
  });

  const engine = new CampaignEngine(fakeBaileys());
  await engine.stopCampaign();

  const state = engine.getState();
  assert.strictEqual(state.status, 'stopped');
  assert.strictEqual(state.currentBatch, null);
  const after = contactsLib.getContacts();
  assert.ok(after.every((c) => c.group === 'NoResponse'));
});
