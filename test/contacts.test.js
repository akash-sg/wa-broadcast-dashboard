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
  const rows = contacts.parseCSV('name,number\nJohn,15551234567\nJane,15559876543\n');
  assert.deepStrictEqual(rows, [
    ['name', 'number'],
    ['John', '15551234567'],
    ['Jane', '15559876543'],
  ]);
});

test('parseCSV handles quoted fields with embedded commas', () => {
  const rows = contacts.parseCSV('name,number\n"Doe, Jane",15551234567\n');
  assert.deepStrictEqual(rows, [
    ['name', 'number'],
    ['Doe, Jane', '15551234567'],
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

test('importCSV accepts valid rows as new Pending contacts', async () => {
  const result = await contacts.importCSV('name,number\nJohn,+15551234567\n');
  assert.strictEqual(result.accepted.length, 1);
  assert.strictEqual(result.rejected.length, 0);
  const stored = contacts.getContacts();
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].group, 'Pending');
  assert.strictEqual(stored[0].number, '15551234567');
});

test('importCSV rejects missing name, invalid number, and in-file duplicates', async () => {
  const csv = [
    'name,number',
    ',15551234567',
    'Bad Number,123',
    'Dup,15559876543',
    'Dup Again,15559876543',
  ].join('\n');
  const result = await contacts.importCSV(csv);
  assert.strictEqual(result.accepted.length, 1);
  assert.strictEqual(result.rejected.length, 3);
  assert.strictEqual(result.rejected[0].reason, 'missing name');
  assert.strictEqual(result.rejected[1].reason, 'invalid or missing number');
  assert.strictEqual(result.rejected[2].reason, 'duplicate number in file');
});

test('importCSV re-upload updates name but never touches group or timestamps', async () => {
  await contacts.importCSV('name,number\nJohn,15551234567\n');
  const stored = contacts.getContacts();
  stored[0].group = 'Replied';
  stored[0].repliedAt = '2026-01-01T00:00:00Z';
  await storage.writeJSON('contacts', stored);

  const result = await contacts.importCSV('name,number\nJohnny,15551234567\n');
  assert.strictEqual(result.accepted[0].name, 'Johnny');
  const after = contacts.getContacts();
  assert.strictEqual(after[0].name, 'Johnny');
  assert.strictEqual(after[0].group, 'Replied'); // untouched
  assert.strictEqual(after[0].repliedAt, '2026-01-01T00:00:00Z'); // untouched
});

test('getCounts tallies by group', async () => {
  await contacts.importCSV('name,number\nA,15551111111\nB,15552222222\n');
  const stored = contacts.getContacts();
  stored[0].group = 'Replied';
  stored[1].group = 'NoResponse';
  await storage.writeJSON('contacts', stored);
  assert.deepStrictEqual(contacts.getCounts(), { Pending: 0, Replied: 1, NoResponse: 1 });
});

test('markSent sets sentAt and lastMessageVariant', async () => {
  await contacts.importCSV('name,number\nA,15551111111\n');
  await contacts.markSent('15551111111', { variantId: 'v2', sentAt: '2026-01-01T00:00:00Z' });
  const [c] = contacts.getContacts();
  assert.strictEqual(c.sentAt, '2026-01-01T00:00:00Z');
  assert.strictEqual(c.lastMessageVariant, 'v2');
});

test('markReplied flips group to Replied unconditionally, even from NoResponse', async () => {
  await contacts.importCSV('name,number\nA,15551111111\n');
  const stored = contacts.getContacts();
  stored[0].group = 'NoResponse';
  await storage.writeJSON('contacts', stored);

  await contacts.markReplied('15551111111', { repliedAt: '2026-01-01T00:00:00Z' });
  const [c] = contacts.getContacts();
  assert.strictEqual(c.group, 'Replied');
  assert.strictEqual(c.repliedAt, '2026-01-01T00:00:00Z');
});

test('markNoResponse only moves contacts still Pending', async () => {
  await contacts.importCSV('name,number\nA,15551111111\nB,15552222222\n');
  const stored = contacts.getContacts();
  stored[0].group = 'Replied'; // already resolved, must not be touched
  await storage.writeJSON('contacts', stored);

  await contacts.markNoResponse(['15551111111', '15552222222']);
  const after = contacts.getContacts();
  assert.strictEqual(after[0].group, 'Replied');
  assert.strictEqual(after[1].group, 'NoResponse');
});

test('exportCSV prefixes formula-like cells to prevent CSV injection', () => {
  const csv = contacts.exportCSV([
    { name: '=cmd|/c calc', number: '15551234567', group: 'Pending' },
    { name: 'Normal Name', number: '15559876543', group: 'Replied' },
  ]);
  const lines = csv.split('\n');
  assert.ok(lines[1].startsWith('"\'=cmd'));
  assert.ok(lines[2].startsWith('Normal Name'));
});
