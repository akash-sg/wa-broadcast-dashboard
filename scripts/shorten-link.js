#!/usr/bin/env node
// NOT RECOMMENDED BY DEFAULT — see PLAN.md "Link variation". WhatsApp shows
// its own caution/warning screen when a recipient taps a tinyurl.com link
// (verified with a real campaign), which defeats the point. Just use the
// direct channel link in every variant instead; the message text is
// already what varies. Kept for the rare case someone wants surface-level
// link variation despite that tradeoff.
//
// Generates one short link to the WhatsApp channel, for pasting into a new
// message variant. Run once per new variant, so each one gets a visibly
// different link. Not wired into the dashboard: this is an occasional
// admin task, not campaign logic.
//
// ponytail: is.gd/v.gd were the original plan (see PLAN.md) but were
// failing service-wide when this was written — "Error, database insert
// failed" for every URL tried, including brand-new ones, verified live.
// Switched to TinyURL's free create.php API. TinyURL dedupes by exact
// destination URL, and its free tier allows only 2 custom aliases per
// destination before erroring (verified live: attempt 3 failed the same
// way for a brand-new URL) — so aliasing the same channel link repeatedly
// doesn't scale to 5-10 variants. Fix: tag each request's destination with
// a random, WhatsApp-ignored query parameter so every variant points at a
// technically-distinct URL — no alias, no cap, unlimited distinct short
// links to the same real channel. Verified the tagged URL behaves
// identically at the HTTP level (same 200, no redirect difference) to the
// bare channel link; recommend testing the first generated link on a
// phone before trusting the rest, since that's the one thing this can't
// verify without a device.
'use strict';

const crypto = require('crypto');

const CHANNEL_URL = process.argv[2] || 'https://whatsapp.com/channel/0029VbDPeRPLCoX91A8LDQ0Q';

// Exported for testing — the one bit of actual logic here (get the
// separator right whether the URL already has a query string or not).
function buildTaggedUrl(url, tag) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}src=${tag}`;
}

async function main() {
  const tag = crypto.randomBytes(3).toString('hex');
  const taggedUrl = buildTaggedUrl(CHANNEL_URL, tag);

  const params = new URLSearchParams({ url: taggedUrl });
  const res = await fetch(`https://tinyurl.com/api-create.php?${params}`);
  const text = (await res.text()).trim();
  if (!res.ok || !text.startsWith('http')) {
    throw new Error(`TinyURL request failed: ${text}`);
  }
  console.log(text);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Could not generate a short link:', err.message);
    process.exit(1);
  });
}

module.exports = { buildTaggedUrl };
