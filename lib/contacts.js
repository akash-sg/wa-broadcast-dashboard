// CSV import/export and group management (Pending/Replied/NoResponse).
'use strict';

const storage = require('./storage');

const CONTACTS_KEY = 'contacts';
const MIN_DIGITS = 8; // ITU E.164 practical minimum
const MAX_DIGITS = 15; // ITU E.164 maximum

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
// and escaped quotes ("") — a name like "Doe, Jane" must not split in two.
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

function isHeaderRow(row) {
  return row[0]?.trim().toLowerCase() === 'name' && row[1]?.trim().toLowerCase() === 'number';
}

// Merges a freshly-uploaded CSV into the existing contact list by number:
// new contacts start Pending; existing contacts get their name updated but
// group/sentAt/repliedAt are never touched — a re-upload must not silently
// erase campaign progress (eng review HIGH finding).
async function importCSV(text, { defaultCountryCode } = {}) {
  const rows = parseCSV(text);
  const dataRows = rows.length && isHeaderRow(rows[0]) ? rows.slice(1) : rows;

  const existing = storage.readJSON(CONTACTS_KEY, []);
  const byNumber = new Map(existing.map((c) => [c.number, c]));

  const accepted = [];
  const rejected = [];
  const seenInFile = new Set();

  for (const row of dataRows) {
    const [rawName, rawNumber] = row;
    const name = (rawName || '').trim();
    if (!name) {
      rejected.push({ row, reason: 'missing name' });
      continue;
    }
    const number = normalizeNumber(rawNumber, defaultCountryCode);
    if (!number) {
      rejected.push({ row, reason: 'invalid or missing number' });
      continue;
    }
    if (seenInFile.has(number)) {
      rejected.push({ row, reason: 'duplicate number in file' });
      continue;
    }
    seenInFile.add(number);

    const current = byNumber.get(number);
    if (current) {
      current.name = name; // update name only, never touch group/timestamps
    } else {
      byNumber.set(number, {
        number,
        name,
        group: 'Pending',
        lastMessageVariant: null,
        sentAt: null,
        repliedAt: null,
      });
    }
    accepted.push({ name, number });
  }

  const merged = Array.from(byNumber.values());
  await storage.writeJSON(CONTACTS_KEY, merged);
  return { accepted, rejected, counts: getCountsFrom(merged) };
}

function getContacts() {
  return storage.readJSON(CONTACTS_KEY, []);
}

function getCountsFrom(contacts) {
  const counts = { Pending: 0, Replied: 0, NoResponse: 0 };
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

function exportCSV(contacts = getContacts()) {
  const lines = ['name,number,group'];
  for (const c of contacts) {
    lines.push([csvSafeCell(c.name), csvSafeCell(c.number), csvSafeCell(c.group)].join(','));
  }
  return lines.join('\n');
}

module.exports = {
  parseCSV,
  normalizeNumber,
  importCSV,
  getContacts,
  getCounts,
  exportCSV,
  csvSafeCell,
};
