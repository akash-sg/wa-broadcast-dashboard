// CSV import/export and group management (Pending/Replied/NoResponse/Invalid).
'use strict';

const storage = require('./storage');

const CONTACTS_KEY = 'contacts';
const MIN_DIGITS = 8; // ITU E.164 practical minimum
const MAX_DIGITS = 15; // ITU E.164 maximum
const GROUPS = ['Pending', 'Replied', 'NoResponse', 'Invalid'];

// ponytail: heuristic normalization (strip non-digits, optionally prepend a
// default country code for short numbers), not full E.164/libphonenumber
// validation. Upgrade to a real phone-number library if imports start
// silently mis-normalizing real numbers.
function normalizeNumber(raw, defaultCountryCode) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < MIN_DIGITS && defaultCountryCode) {
    digits = String(defaultCountryCode).replace(/\D/g, '') + digits;
  }
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return digits;
}

// Minimal RFC 4180-style CSV parser: handles quoted fields, embedded commas,
// and escaped quotes ("").
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // swallow; \r\n handled by the following \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => r.length > 0 && r.some((cell) => cell.trim() !== ''));
}

// No name column — contacts are number-only. Still tolerant of a CSV that
// has a header row: if the first row has a cell literally "number"
// (case-insensitive), that column is used and every other column (e.g. an
// old name column) is ignored. With no such header, column 0 is the number.
function numberColumnIndex(rows) {
  if (!rows.length) return 0;
  const idx = rows[0].findIndex((cell) => cell?.trim().toLowerCase() === 'number');
  return idx === -1 ? 0 : idx;
}

function looksLikeHeaderRow(rows) {
  return rows.length > 0 && rows[0].some((cell) => cell?.trim().toLowerCase() === 'number');
}

// Merges a freshly-uploaded CSV into the existing contact list by number:
// new contacts start Pending; existing contacts are left untouched (their
// group/sentAt/repliedAt survive) — a re-upload must not silently erase
// campaign progress (eng review HIGH finding).
// All mutators below go through storage.mutateJSON — a plain read-then-write
// (readJSON followed later by writeJSON) is NOT safe here: the campaign send
// loop and the Baileys reply listener call these concurrently, and two
// independent read-modify-write cycles can race, silently discarding one
// side's change (a lost update — verified with a repro during review).
// mutateJSON runs the whole cycle inside the same per-file queue, so
// concurrent callers are serialized against the latest state, not a stale
// snapshot.
async function importCSV(text, { defaultCountryCode } = {}) {
  const rows = parseCSV(text);
  const numberCol = numberColumnIndex(rows);
  const dataRows = looksLikeHeaderRow(rows) ? rows.slice(1) : rows;

  const accepted = [];
  const rejected = [];
  const seenInFile = new Set();

  const merged = await storage.mutateJSON(CONTACTS_KEY, (existing) => {
    const byNumber = new Map(existing.map((c) => [c.number, c]));
    accepted.length = 0;
    rejected.length = 0;
    seenInFile.clear();

    for (const row of dataRows) {
      const number = normalizeNumber(row[numberCol], defaultCountryCode);
      if (!number) {
        rejected.push({ row, reason: 'invalid or missing number' });
        continue;
      }
      if (seenInFile.has(number)) {
        rejected.push({ row, reason: 'duplicate number in file' });
        continue;
      }
      seenInFile.add(number);

      if (!byNumber.has(number)) {
        byNumber.set(number, {
          number,
          group: 'Pending',
          lastMessageVariant: null,
          sentAt: null,
          repliedAt: null,
        });
      }
      accepted.push({ number });
    }
    return Array.from(byNumber.values());
  }, []);

  return { accepted, rejected, counts: getCountsFrom(merged) };
}

function getContacts() {
  return storage.readJSON(CONTACTS_KEY, []);
}

async function setContacts(contacts) {
  await storage.writeJSON(CONTACTS_KEY, contacts);
  return contacts;
}

// Mutation helpers used by campaign.js — keeps this module the sole owner
// of the contacts storage key rather than every caller re-deriving it.
async function markSent(number, { variantId, sentAt = new Date().toISOString() } = {}) {
  return storage.mutateJSON(CONTACTS_KEY, (contacts) => {
    const c = contacts.find((x) => x.number === number);
    if (c) { c.sentAt = sentAt; c.lastMessageVariant = variantId; }
    return contacts;
  }, []);
}

// A reply flips a contact to Replied unconditionally, regardless of its
// current group — a late reply after a NoResponse timeout must not be lost
// (eng review finding), and it must not silently corrupt the reply-ratio
// breaker's input.
async function markReplied(number, { repliedAt = new Date().toISOString() } = {}) {
  return storage.mutateJSON(CONTACTS_KEY, (contacts) => {
    const c = contacts.find((x) => x.number === number);
    if (c) { c.group = 'Replied'; c.repliedAt = repliedAt; }
    return contacts;
  }, []);
}

// Anyone still Pending in the given batch, at batch-end, moves to NoResponse.
async function markNoResponse(numbers) {
  const set = new Set(numbers);
  return storage.mutateJSON(CONTACTS_KEY, (contacts) => {
    for (const c of contacts) {
      if (set.has(c.number) && c.group === 'Pending') c.group = 'NoResponse';
    }
    return contacts;
  }, []);
}

// A number that's syntactically valid but isn't registered on WhatsApp
// (checked via Baileys' onWhatsApp before sending) is sorted out of the
// Pending pool entirely, rather than burning send attempts / the
// consecutive-failure counter on it every campaign run.
async function markInvalid(numbers) {
  const set = new Set(numbers);
  return storage.mutateJSON(CONTACTS_KEY, (contacts) => {
    for (const c of contacts) {
      if (set.has(c.number) && c.group === 'Pending') c.group = 'Invalid';
    }
    return contacts;
  }, []);
}

// Full reset for starting a fresh campaign with the same contact list:
// every contact goes back to Pending, every send/reply timestamp is
// cleared. Destructive (the dashboard downloads a report before calling
// this, so the prior campaign's results aren't lost).
async function resetAll() {
  return storage.mutateJSON(CONTACTS_KEY, (contacts) => {
    for (const c of contacts) {
      c.group = 'Pending';
      c.sentAt = null;
      c.repliedAt = null;
      c.lastMessageVariant = null;
    }
    return contacts;
  }, []);
}

function getCountsFrom(contacts) {
  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const c of contacts) counts[c.group] = (counts[c.group] || 0) + 1;
  return counts;
}

function getCounts() {
  return getCountsFrom(getContacts());
}

// CSV-injection guard: a cell starting with = + - @ can execute as a
// formula in a spreadsheet app that later opens the export.
function csvSafeCell(value) {
  const s = String(value ?? '');
  const needsQuoting = /[",\n]/.test(s);
  const escaped = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (needsQuoting || /^[=+\-@]/.test(s)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

// Full report, not just the raw list — group + timestamps so it's useful
// on its own (who replied, when, who never responded) without needing the
// dashboard open.
function exportCSV(contacts = getContacts()) {
  const lines = ['number,group,sentAt,repliedAt'];
  for (const c of contacts) {
    lines.push([
      csvSafeCell(c.number),
      csvSafeCell(c.group),
      csvSafeCell(c.sentAt),
      csvSafeCell(c.repliedAt),
    ].join(','));
  }
  return lines.join('\n');
}

module.exports = {
  GROUPS,
  parseCSV,
  normalizeNumber,
  importCSV,
  getContacts,
  setContacts,
  markSent,
  markReplied,
  markNoResponse,
  markInvalid,
  resetAll,
  getCounts,
  exportCSV,
  csvSafeCell,
};
