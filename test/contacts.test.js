'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolated data dir — test files run as separate processes and would
// otherwise race on the real data/ dir (see storage.js).
process.env.OPENWA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-contacts-test-'));

const storage = require('../lib/storage');
const contacts = require('../lib/contacts');

test.after(() => fs.rmSync(storage.DATA_DIR, { recursive: true, force: true }));
test.beforeEach(() => fs.rmSync(path.join(storage.DATA_DIR, 'contacts.json'), { force: true }));

test('parseCSV splits simple rows', () => {
  const rows = contacts.parseCSV('15551234567\n15559876543\n');
  assert.deepStrictEqual(rows, [['15551234567'], ['15559876543']]);
});

test('parseCSV handles quoted fields with embedded commas', () => {
  const rows = contacts.parseCSV('number,note\n15551234567,"Doe, Jane"\n');
  assert.deepStrictEqual(rows, [
    ['number', 'note'],
    ['15551234567', 'Doe, Jane'],
  ]);
});

test('normalizeNumber strips punctuation and validates length', () => {
  assert.strictEqual(contacts.normalizeNumber('+1 (555) 123-4567'), '15551234567');
  assert.strictEqual(contacts.normalizeNumber('123'), null); // too short, no default country code
  assert.strictEqual(contacts.normalizeNumber('12345678901234567'), null); // too long
});

test('normalizeNumber prepends a default country code for short numbers', () => {
  assert.strictEqual(contacts.normalizeNumber('1234567', '1'), '11234567');
});

test('normalizeNumber prepends a default country code even to an already-long bare local number', () => {
  // Regression: a 10-digit Indian mobile with no +91 used to pass length
  // validation on its own and never get the country code prepended.
  assert.strictEqual(contacts.normalizeNumber('9148291767', '91'), '919148291767');
});

test('normalizeNumber does not double-prepend when the country code is already present', () => {
  assert.strictEqual(contacts.normalizeNumber('+91 94800 07470', '91'), '919480007470');
});

test('importCSV accepts a plain number-only CSV, no header required', async () => {
  const result = await contacts.importCSV('+15551234567\n');
  assert.strictEqual(result.accepted.length, 1);
  assert.strictEqual(result.rejected.length, 0);
  const stored = contacts.getContacts();
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].group, 'Pending');
  assert.strictEqual(stored[0].number, '15551234567');
  assert.strictEqual(stored[0].name, undefined); // no name field at all
});

test('importCSV finds the number column via header, ignoring other columns', async () => {
  const csv = 'name,number\nJohn,15551234567\nJane,15559876543\n';
  const result = await contacts.importCSV(csv);
  assert.strictEqual(result.accepted.length, 2);
  const stored = contacts.getContacts();
  assert.deepStrictEqual(stored.map((c) => c.number).sort(), ['15551234567', '15559876543']);
});

test('importCSV rejects invalid numbers and in-file duplicates', async () => {
  const csv = ['number', '123', '15559876543', '15559876543'].join('\n');
  const result = await contacts.importCSV(csv);
  assert.strictEqual(result.accepted.length, 1);
  assert.strictEqual(result.rejected.length, 2);
  assert.strictEqual(result.rejected[0].reason, 'invalid or missing number');
  assert.strictEqual(result.rejected[1].reason, 'duplicate number in file');
});

test('importCSV re-upload never touches group or timestamps for existing contacts', async () => {
  await contacts.importCSV('15551234567\n');
  const stored = contacts.getContacts();
  stored[0].group = 'Replied';
  stored[0].repliedAt = '2026-01-01T00:00:00Z';
  await storage.writeJSON('contacts', stored);

  await contacts.importCSV('15551234567\n'); // re-upload the same number
  const after = contacts.getContacts();
  assert.strictEqual(after.length, 1); // not duplicated
  assert.strictEqual(after[0].group, 'Replied'); // untouched
  assert.strictEqual(after[0].repliedAt, '2026-01-01T00:00:00Z'); // untouched
});

test('getCounts tallies by group, including Invalid', async () => {
  await contacts.importCSV('15551111111\n15552222222\n');
  const stored = contacts.getContacts();
  stored[0].group = 'Replied';
  stored[1].group = 'Invalid';
  await storage.writeJSON('contacts', stored);
  assert.deepStrictEqual(contacts.getCounts(), { Pending: 0, Replied: 1, NoResponse: 0, Invalid: 1, Sent: 0 });
});

test('getCounts "Sent" counts Pending contacts that already have sentAt (in-flight, awaiting reply)', async () => {
  await contacts.importCSV('15551111111\n15552222222\n15553333333\n');
  const stored = contacts.getContacts();
  stored[0].sentAt = new Date().toISOString(); // sent, still Pending (in-flight)
  stored[1].group = 'Replied';
  stored[1].sentAt = new Date().toISOString(); // sent AND resolved — not counted as "Sent"
  await storage.writeJSON('contacts', stored);
  assert.deepStrictEqual(contacts.getCounts(), { Pending: 2, Replied: 1, NoResponse: 0, Invalid: 0, Sent: 1 });
});

test('markSent sets sentAt and lastMessageVariant', async () => {
  await contacts.importCSV('15551111111\n');
  await contacts.markSent('15551111111', { variantId: 'v2', sentAt: '2026-01-01T00:00:00Z' });
  const [c] = contacts.getContacts();
  assert.strictEqual(c.sentAt, '2026-01-01T00:00:00Z');
  assert.strictEqual(c.lastMessageVariant, 'v2');
});

test('markReplied flips group to Replied unconditionally, even from NoResponse', async () => {
  await contacts.importCSV('15551111111\n');
  const stored = contacts.getContacts();
  stored[0].group = 'NoResponse';
  await storage.writeJSON('contacts', stored);

  await contacts.markReplied('15551111111', { repliedAt: '2026-01-01T00:00:00Z' });
  const [c] = contacts.getContacts();
  assert.strictEqual(c.group, 'Replied');
  assert.strictEqual(c.repliedAt, '2026-01-01T00:00:00Z');
});

test('concurrent markSent and markReplied on different contacts both land (no lost update)', async () => {
  await contacts.importCSV('15551111111\n15552222222\n');
  await Promise.all([
    contacts.markSent('15551111111', { variantId: 'v1' }),
    contacts.markReplied('15552222222'),
  ]);
  const stored = contacts.getContacts();
  assert.ok(stored.find((c) => c.number === '15551111111').sentAt, 'markSent was not lost');
  assert.strictEqual(stored.find((c) => c.number === '15552222222').group, 'Replied');
});

test('markNoResponse only moves contacts still Pending', async () => {
  await contacts.importCSV('15551111111\n15552222222\n');
  const stored = contacts.getContacts();
  stored[0].group = 'Replied'; // already resolved, must not be touched
  await storage.writeJSON('contacts', stored);

  await contacts.markNoResponse(['15551111111', '15552222222']);
  const after = contacts.getContacts();
  assert.strictEqual(after[0].group, 'Replied');
  assert.strictEqual(after[1].group, 'NoResponse');
});

test('markInvalid only moves contacts still Pending', async () => {
  await contacts.importCSV('15551111111\n15552222222\n');
  const stored = contacts.getContacts();
  stored[0].group = 'Replied'; // already resolved, must not be touched
  await storage.writeJSON('contacts', stored);

  await contacts.markInvalid(['15551111111', '15552222222']);
  const after = contacts.getContacts();
  assert.strictEqual(after[0].group, 'Replied');
  assert.strictEqual(after[1].group, 'Invalid');
});

test('resetAll puts every contact back to Pending and clears timestamps, regardless of prior group', async () => {
  await contacts.importCSV('15551111111\n15552222222\n15553333333\n');
  const stored = contacts.getContacts();
  stored[0].group = 'Replied';
  stored[0].sentAt = '2026-01-01T00:00:00Z';
  stored[0].repliedAt = '2026-01-01T01:00:00Z';
  stored[1].group = 'NoResponse';
  stored[1].sentAt = '2026-01-01T00:00:00Z';
  stored[2].group = 'Invalid';
  await storage.writeJSON('contacts', stored);

  await contacts.resetAll();
  const after = contacts.getContacts();
  assert.ok(after.every((c) => c.group === 'Pending'));
  assert.ok(after.every((c) => c.sentAt === null));
  assert.ok(after.every((c) => c.repliedAt === null));
  assert.ok(after.every((c) => c.lastMessageVariant === null));
});

test('deleteContacts removes only the given numbers and reports how many were actually deleted', async () => {
  await contacts.importCSV('15551111111\n15552222222\n15553333333\n');

  const result = await contacts.deleteContacts(['15551111111', '15553333333', '15559999999']); // last one doesn't exist
  assert.strictEqual(result.deletedCount, 2); // only the 2 that actually existed
  const after = contacts.getContacts();
  assert.deepStrictEqual(after.map((c) => c.number), ['15552222222']);
  assert.deepStrictEqual(result.counts, { Pending: 1, Replied: 0, NoResponse: 0, Invalid: 0, Sent: 0 });
});

test('exportCSV prefixes formula-like cells to prevent CSV injection', () => {
  const csv = contacts.exportCSV([
    { number: '=cmd|/c calc', group: 'Pending' },
    { number: '15559876543', group: 'Replied' },
  ]);
  const lines = csv.split('\n');
  assert.ok(lines[1].startsWith('"\'=cmd'));
  assert.ok(lines[2].startsWith('15559876543'));
});

test('exportCSV includes group and timestamps (it is a report, not just a list)', () => {
  const csv = contacts.exportCSV([
    { number: '15551111111', group: 'Replied', sentAt: '2026-01-01T00:00:00Z', repliedAt: '2026-01-01T01:00:00Z' },
  ]);
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], 'number,group,sentAt,repliedAt');
  assert.strictEqual(lines[1], '15551111111,Replied,2026-01-01T00:00:00Z,2026-01-01T01:00:00Z');
});
