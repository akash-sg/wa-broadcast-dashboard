'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const storage = require('../lib/storage');

// Uses the real data/ dir with a test- prefix, cleaned up after.
const names = ['test-unit-file', 'test-race', 'test-log', 'test-log-tail'];
test.after(() => {
  for (const n of names) {
    fs.rmSync(path.join(storage.DATA_DIR, `${n}.json`), { force: true });
    fs.rmSync(path.join(storage.DATA_DIR, `${n}.jsonl`), { force: true });
  }
});

test('writeJSON then readJSON round-trips', async () => {
  await storage.writeJSON('test-unit-file', { hello: 'world' });
  assert.deepStrictEqual(storage.readJSON('test-unit-file'), { hello: 'world' });
});

test('readJSON returns default value when file missing', () => {
  assert.strictEqual(storage.readJSON('test-does-not-exist', null), null);
  assert.deepStrictEqual(storage.readJSON('test-does-not-exist', []), []);
});

test('concurrent writeJSON calls to the same file never corrupt it', async () => {
  const writes = [];
  for (let i = 0; i < 20; i++) {
    writes.push(storage.writeJSON('test-race', { i }));
  }
  await Promise.all(writes);
  const result = storage.readJSON('test-race');
  assert.strictEqual(typeof result.i, 'number');
});

test('appendJSONL then readJSONL round-trips in order', async () => {
  await storage.appendJSONL('test-log', { n: 1 });
  await storage.appendJSONL('test-log', { n: 2 });
  await storage.appendJSONL('test-log', { n: 3 });
  assert.deepStrictEqual(storage.readJSONL('test-log'), [{ n: 1 }, { n: 2 }, { n: 3 }]);
});

test('readJSONL tail option returns only the last N entries', async () => {
  await storage.appendJSONL('test-log-tail', { n: 1 });
  await storage.appendJSONL('test-log-tail', { n: 2 });
  await storage.appendJSONL('test-log-tail', { n: 3 });
  assert.deepStrictEqual(storage.readJSONL('test-log-tail', { tail: 2 }), [{ n: 2 }, { n: 3 }]);
});

test('readJSONL returns empty array when file missing', () => {
  assert.deepStrictEqual(storage.readJSONL('test-no-such-log'), []);
});
