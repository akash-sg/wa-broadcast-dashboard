// Flat-JSON storage: contacts, message variants, campaign state, logs.
// Single-writer queue per file — the HTTP handlers and the Baileys reply
// listener both mutate campaign state concurrently (see eng review).
'use strict';

const fs = require('fs');
const path = require('path');

// Overridable so test files (which run as separate processes and would
// otherwise race on the same real data/ dir) can point at an isolated tmp dir.
const DATA_DIR = process.env.OPENWA_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// One promise chain per file path serializes writes to that file, so a
// racing HTTP handler and reply listener never interleave.
const writeQueues = new Map();

function queueWrite(filePath, task) {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(task, task);
  writeQueues.set(filePath, next.finally(() => {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  }));
  return next;
}

function jsonPath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJSON(name, defaultValue) {
  const filePath = jsonPath(name);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return defaultValue;
    throw err;
  }
}

// Atomic write: write to a temp file, then rename over the target. A crash
// mid-write leaves the old file intact instead of a half-written one.
function writeJSON(name, data) {
  const filePath = jsonPath(name);
  return queueWrite(filePath, async () => {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2));
    await fs.promises.rename(tmpPath, filePath);
  });
}

function jsonlPath(name) {
  return path.join(DATA_DIR, `${name}.jsonl`);
}

// Append-only, one JSON object per line — cheap to append to at any size,
// unlike rewriting a whole JSON array on every log event.
function appendJSONL(name, entry) {
  const filePath = jsonlPath(name);
  return queueWrite(filePath, () =>
    fs.promises.appendFile(filePath, JSON.stringify(entry) + '\n')
  );
}

// Reads all entries, optionally only the last N (for a reverse-chronological
// Logs tab without loading unbounded history into memory-sensitive callers).
function readJSONL(name, { tail } = {}) {
  const filePath = jsonlPath(name);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const lines = text.split('\n').filter(Boolean);
  const slice = tail ? lines.slice(-tail) : lines;
  return slice.map((line) => JSON.parse(line));
}

module.exports = { readJSON, writeJSON, appendJSONL, readJSONL, DATA_DIR };
