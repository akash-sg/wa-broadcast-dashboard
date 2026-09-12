'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildTaggedUrl } = require('../scripts/shorten-link');

test('buildTaggedUrl appends with ? when the URL has no query string', () => {
  assert.strictEqual(
    buildTaggedUrl('https://whatsapp.com/channel/abc', 'xyz'),
    'https://whatsapp.com/channel/abc?src=xyz'
  );
});

test('buildTaggedUrl appends with & when the URL already has a query string', () => {
  assert.strictEqual(
    buildTaggedUrl('https://whatsapp.com/channel/abc?ref=1', 'xyz'),
    'https://whatsapp.com/channel/abc?ref=1&src=xyz'
  );
});
