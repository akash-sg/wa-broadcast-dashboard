'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toJID, isGenuineReply, isGenuineReaction } = require('../lib/baileys');

test('toJID strips non-digit characters and appends the WhatsApp suffix', () => {
  assert.strictEqual(toJID('+1 (555) 123-4567'), '15551234567@s.whatsapp.net');
  assert.strictEqual(toJID('5551234567'), '5551234567@s.whatsapp.net');
});

test('isGenuineReply accepts a plain text message from someone else', () => {
  const msg = { key: { fromMe: false }, message: { conversation: 'hi' } };
  assert.strictEqual(isGenuineReply(msg), true);
});

test('isGenuineReply accepts an extended text / media message', () => {
  const msg = { key: { fromMe: false }, message: { extendedTextMessage: { text: 'hi' } } };
  assert.strictEqual(isGenuineReply(msg), true);
  const img = { key: { fromMe: false }, message: { imageMessage: {} } };
  assert.strictEqual(isGenuineReply(img), true);
});

test('isGenuineReply rejects our own outgoing messages', () => {
  const msg = { key: { fromMe: true }, message: { conversation: 'hi' } };
  assert.strictEqual(isGenuineReply(msg), false);
});

test('isGenuineReply rejects reactions, protocol, and poll-update messages', () => {
  assert.strictEqual(isGenuineReply({ key: { fromMe: false }, message: { reactionMessage: {} } }), false);
  assert.strictEqual(isGenuineReply({ key: { fromMe: false }, message: { protocolMessage: {} } }), false);
  assert.strictEqual(isGenuineReply({ key: { fromMe: false }, message: { pollUpdateMessage: {} } }), false);
});

test('isGenuineReply rejects a message with no content', () => {
  assert.strictEqual(isGenuineReply({ key: { fromMe: false }, message: null }), false);
});

test('isGenuineReaction accepts a reaction with text (someone reacted)', () => {
  assert.strictEqual(isGenuineReaction({ key: { remoteJid: '15551234567@s.whatsapp.net' }, reaction: { text: '❤️' } }), true);
});

test('isGenuineReaction rejects a removed reaction (falsey text)', () => {
  assert.strictEqual(isGenuineReaction({ key: { remoteJid: '15551234567@s.whatsapp.net' }, reaction: { text: '' } }), false);
  assert.strictEqual(isGenuineReaction({ key: { remoteJid: '15551234567@s.whatsapp.net' }, reaction: {} }), false);
});
