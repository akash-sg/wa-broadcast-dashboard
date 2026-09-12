// Baileys connection/pairing wrapper. Exposes only a connection handle plus
// an EventEmitter ('message', 'disconnected', 'reconnected', 'qr',
// 'connected') — campaign.js subscribes to this and never reaches into
// Baileys internals directly (resolves the circular-dependency risk flagged
// in eng review: campaign depends on baileys, never the reverse).
'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const QRCode = require('qrcode');
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

// Baileys' own session credentials, persisted separately from campaign JSON
// storage (data/). Without this, every crash/restart forces a fresh QR
// pairing — the CRITICAL gap flagged in eng review.
const AUTH_DIR = path.join(__dirname, '..', 'auth');

// Message content keys that are protocol noise, not a genuine reply — a
// reaction, a receipt-like protocol message, or a poll vote update. Any
// other message key (conversation, extendedTextMessage, imageMessage, ...)
// counts as a real reply per PLAN.md ("any reply at all counts as success").
const NON_REPLY_MESSAGE_KEYS = new Set(['reactionMessage', 'protocolMessage', 'pollUpdateMessage']);

function isGenuineReply(msg) {
  if (!msg.message || msg.key.fromMe) return false;
  const keys = Object.keys(msg.message);
  return keys.some((k) => !NON_REPLY_MESSAGE_KEYS.has(k));
}

// A tap-a-reaction reply (👍 ❤️ etc.) counts the same as a text reply — no
// sentiment classification, any reply at all is success (PLAN.md). Baileys
// delivers reactions via the dedicated 'messages.reaction' event, not
// messages.upsert; reaction.text is falsey when a reaction is REMOVED, not
// added, so that case must not count.
function isGenuineReaction(entry) {
  return Boolean(entry?.reaction?.text);
}

function toJID(number) {
  const digits = String(number).replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

class BaileysConnection extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this.latestQR = null; // data URL, or null once paired
  }

  async start() {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    this.status = 'connecting';
    this.sock = makeWASocket({ version, auth: state });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.latestQR = await QRCode.toDataURL(qr);
        this.emit('qr', this.latestQR);
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.latestQR = null;
        this.emit('connected');
      }

      if (connection === 'close') {
        this.status = 'disconnected';
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        this.emit('disconnected', { loggedOut });
        if (!loggedOut) {
          // Transient drop (not a logout) — reconnect with the SAME auth
          // state, no new pairing needed.
          await this.start();
          this.emit('reconnected');
        }
      }
    });

    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (isGenuineReply(msg)) {
          this.emit('message', { from: msg.key.remoteJid, raw: msg });
        }
      }
    });

    this.sock.ev.on('messages.reaction', (reactions) => {
      for (const entry of reactions) {
        if (isGenuineReaction(entry)) {
          this.emit('message', { from: entry.key.remoteJid, raw: entry });
        }
      }
    });
  }

  // Retry with the SAME session credentials — for a transient-looking drop
  // where the user just wants to try again before nuking to a fresh QR.
  // If the session really was logged out, Baileys will surface a fresh QR
  // itself (via the normal 'qr' event) once it discovers the creds are
  // invalid; this never wipes auth/ itself, only reconnectNewNumber does.
  async reconnect() {
    if (this.status === 'connecting' || this.status === 'connected') return;
    if (this.sock) {
      try { this.sock.end(undefined); } catch { /* already closed */ }
      this.sock = null;
    }
    await this.start();
  }

  // "Connect a different number": disconnect + discard the current
  // session + start a fresh pairing. Campaign state is untouched — it lives
  // entirely in data/, never in auth/.
  async reconnectNewNumber() {
    if (this.sock) {
      try { this.sock.end(undefined); } catch { /* already closed */ }
      this.sock = null;
    }
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    this.latestQR = null;
    this.status = 'disconnected';
    await this.start();
  }

  getStatus() {
    return { status: this.status, qr: this.latestQR };
  }

  // Every send is wrapped in a timeout — a hung socket that never resolves
  // or rejects must still count as a failure (eng review HIGH finding),
  // or the campaign FSM stalls indefinitely with nobody noticing.
  async sendMessage(number, text, timeoutMs = 30000) {
    if (this.status !== 'connected') throw new Error('not connected');
    const jid = toJID(number);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('send timed out')), timeoutMs);
    });
    try {
      await Promise.race([this.sock.sendMessage(jid, { text }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Checks which of the given numbers are actually registered on WhatsApp,
  // via one batched USync query rather than N individual lookups. Baileys'
  // own onWhatsApp only returns entries that DO exist (it silently omits
  // the rest), so the result here fills in exists:false for every number
  // it left out, matching order 1:1 with the input.
  async checkOnWhatsApp(numbers) {
    if (this.status !== 'connected') throw new Error('not connected');
    const results = await this.sock.onWhatsApp(...numbers.map(toJID));
    const existingDigits = new Set((results || []).map((r) => String(r.jid).replace(/\D/g, '')));
    return numbers.map((number) => ({
      number,
      exists: existingDigits.has(String(number).replace(/\D/g, '')),
    }));
  }
}

module.exports = { BaileysConnection, toJID, isGenuineReply, isGenuineReaction };
