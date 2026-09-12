// Batching FSM: pull batch -> send with variant round-robin -> listen for
// replies -> end on threshold-or-timeout -> resume-on-restart -> quiet
// hours -> consecutive-failure guard -> reply-ratio circuit breaker.
//
// Pure decision functions (below) take plain data and are unit-testable
// without mocking Baileys or the clock. CampaignEngine is the thin
// orchestrator that owns timers, the Baileys connection, and disk writes
// (eng review: split pure logic from IO so the FSM is actually testable).
'use strict';

const storage = require('./storage');
const contactsLib = require('./contacts');
const variantsLib = require('./variants');

const STATE_KEY = 'campaign';
const TICK_MS = 30000; // poll wall-clock time rather than trust one long
                        // setTimeout, which drifts across system sleep

const DEFAULT_CONFIG = {
  batchSize: 5,
  replyThreshold: 3,
  timeoutMinutes: 30,
  minDelayMin: 3,
  maxDelayMin: 8,
  quietStartHour: 21,
  quietEndHour: 8,
  replyRatioThreshold: 0.10,
  replyRatioWindow: 30,
};

function defaultState() {
  return {
    status: 'idle', // idle | running | paused | quiet_hours | stopped
    pauseReason: null, // null | 'manual' | 'reply_ratio' | 'consecutive_failures' | 'disconnected'
    nextVariantIndex: 0,
    consecutiveFailures: 0,
    currentBatch: null, // { contacts: [number,...], startedAt, repliesReceived: [number,...] }
    config: { ...DEFAULT_CONFIG },
  };
}

// ---- Pure decision functions ----------------------------------------

function shouldEndBatch(currentBatch, config, now = new Date()) {
  if (!currentBatch) return { end: false, reason: null };
  if (currentBatch.repliesReceived.length >= config.replyThreshold) {
    return { end: true, reason: 'threshold' };
  }
  const elapsedMs = now.getTime() - new Date(currentBatch.startedAt).getTime();
  if (elapsedMs >= config.timeoutMinutes * 60000) {
    return { end: true, reason: 'timeout' };
  }
  return { end: false, reason: null };
}

function nextBatchContacts(contacts, batchSize) {
  return contacts.filter((c) => c.group === 'Pending').slice(0, batchSize);
}

// Excludes in-flight (unresolved) contacts from the trailing window — a
// contact still in the current unfinished batch has sentAt set but group
// still Pending, and counting it as "not a reply" would silently bias the
// ratio down every time a batch is in progress (eng review finding).
function computeReplyRatio(contacts, window) {
  const resolved = contacts
    .filter((c) => c.sentAt && c.group !== 'Pending')
    .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
  if (resolved.length < window) return { evaluated: false, ratio: null };
  const last = resolved.slice(-window);
  const replied = last.filter((c) => c.group === 'Replied').length;
  return { evaluated: true, ratio: replied / window };
}

// Handles midnight wraparound (e.g. quietStartHour 21, quietEndHour 8).
function isQuietHours(now, quietStartHour, quietEndHour) {
  if (quietStartHour === quietEndHour) return false;
  const hour = now.getHours();
  if (quietStartHour < quietEndHour) {
    return hour >= quietStartHour && hour < quietEndHour;
  }
  return hour >= quietStartHour || hour < quietEndHour;
}

function pickVariant(variants, index) {
  if (!variants.length) return null;
  return variants[index % variants.length];
}

function personalize(text, name) {
  return text.replace(/\{\{\s*name\s*\}\}/gi, name);
}

function randomDelayMs(minDelayMin, maxDelayMin) {
  const minutes = minDelayMin + Math.random() * (maxDelayMin - minDelayMin);
  return Math.round(minutes * 60000);
}

// ---- Orchestrator ------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CampaignEngine {
  constructor(baileys) {
    this.baileys = baileys;
    this._sending = false;
    this._timer = null;
  }

  getState() {
    return storage.readJSON(STATE_KEY, defaultState());
  }

  async saveState(state) {
    await storage.writeJSON(STATE_KEY, state);
    return state;
  }

  // Atomic read-modify-write for campaign state. The send loop, the reply
  // listener, and the HTTP routes all mutate this concurrently — a plain
  // getState()+saveState() pair races (verified with a repro during review:
  // two concurrent mutations on different fields silently discard one
  // side's change). mutatorFn must be synchronous and side-effect-free
  // (pure transition on the state object); do async I/O outside it.
  updateState(mutatorFn) {
    return storage.mutateJSON(STATE_KEY, mutatorFn, defaultState());
  }

  async log(entry) {
    await storage.appendJSONL('logs', { ts: new Date().toISOString(), ...entry });
  }

  // Wires Baileys events and starts the poll loop. Call once at server
  // startup, independent of whether a campaign is actively running.
  init() {
    this.baileys.on('message', (evt) => this._onReply(evt).catch((err) => this.log({ type: 'error', context: 'onReply', message: err.message })));
    this.baileys.on('disconnected', ({ loggedOut }) => this._onDisconnected(loggedOut).catch(() => {}));
    this.baileys.on('connected', () => this._onConnected().catch(() => {}));
    this._timer = setInterval(() => this.tick().catch((err) => this.log({ type: 'error', context: 'tick', message: err.message })), TICK_MS);
    this.tick().catch((err) => this.log({ type: 'error', context: 'tick', message: err.message }));
  }

  stopPolling() {
    if (this._timer) clearInterval(this._timer);
  }

  async startCampaign() {
    return this.updateState((state) => {
      if (state.status === 'idle' || state.status === 'stopped') {
        state.status = 'running';
        state.pauseReason = null;
      }
      return state;
    });
  }

  async pauseCampaign() {
    return this.updateState((state) => {
      if (state.status === 'running' || state.status === 'quiet_hours') {
        state.status = 'paused';
        state.pauseReason = 'manual';
      }
      return state;
    });
  }

  async resumeCampaign() {
    return this.updateState((state) => {
      if (state.status === 'paused') {
        state.status = 'running';
        state.pauseReason = null;
        state.consecutiveFailures = 0;
      }
      return state;
    });
  }

  // Stop finalizes currentBatch exactly like a normal batch-end (unreplied
  // Pending contacts -> NoResponse) before setting status: stopped, so
  // nothing is ever "in flight" under a stopped campaign (eng review fix —
  // resume-on-restart only checks currentBatch, not status).
  async stopCampaign() {
    await this._finalizeBatch();
    return this.updateState((state) => {
      state.status = 'stopped';
      state.pauseReason = null;
      return state;
    });
  }

  async updateConfig(partial) {
    return this.updateState((state) => {
      state.config = { ...state.config, ...partial };
      return state;
    });
  }

  async _onReply({ from }) {
    const number = String(from).replace(/@.*/, '');
    await contactsLib.markReplied(number);
    await this.log({ type: 'reply', number });

    await this.updateState((state) => {
      if (state.currentBatch && state.currentBatch.contacts.includes(number)) {
        // markReplied above already landed, so this read reflects it.
        const contacts = contactsLib.getContacts();
        state.currentBatch.repliesReceived = state.currentBatch.contacts.filter(
          (n) => contacts.find((c) => c.number === n)?.group === 'Replied'
        );
      }
      return state;
    });
  }

  // A dead socket is an immediate pause, not something that burns through
  // the consecutive-failures counter alongside genuinely bad numbers (eng
  // review finding). loggedOut sessions stay paused until the user re-pairs.
  async _onDisconnected(loggedOut) {
    await this.updateState((state) => {
      if (state.status === 'running' || state.status === 'quiet_hours') {
        state.status = 'paused';
        state.pauseReason = 'disconnected';
      }
      return state;
    });
    await this.log({ type: 'disconnected', loggedOut });
  }

  async _onConnected() {
    await this.updateState((state) => {
      if (state.pauseReason === 'disconnected') {
        state.status = 'running';
        state.pauseReason = null;
      }
      return state;
    });
    await this.log({ type: 'connected' });
  }

  async tick() {
    if (this._sending) return;
    const state = this.getState();
    if (state.status === 'stopped' || state.status === 'idle' || state.status === 'paused') return;

    if (state.currentBatch) {
      await this._continueBatch(state);
      return;
    }

    await this._maybeStartBatch(state);
  }

  async _continueBatch(state) {
    const contacts = contactsLib.getContacts();
    const unsent = state.currentBatch.contacts
      .map((n) => contacts.find((c) => c.number === n))
      .filter((c) => c && !c.sentAt);

    if (unsent.length > 0) {
      if (!this.baileys || this.baileys.status !== 'connected') return; // wait, don't count as failure
      this._sending = true;
      try {
        await this._sendToContacts(unsent, state);
      } finally {
        this._sending = false;
      }
      return;
    }

    const { end } = shouldEndBatch(state.currentBatch, state.config, new Date());
    if (end) await this._finalizeBatch();
  }

  async _maybeStartBatch(state) {
    if (!this.baileys || this.baileys.status !== 'connected') return;

    const now = new Date();
    const quiet = isQuietHours(now, state.config.quietStartHour, state.config.quietEndHour);
    if (quiet) {
      await this.updateState((s) => {
        if (s.status === 'running') s.status = 'quiet_hours';
        return s;
      });
      return;
    }
    if (state.status === 'quiet_hours') {
      await this.updateState((s) => {
        if (s.status === 'quiet_hours') s.status = 'running';
        return s;
      });
    }

    const contacts = contactsLib.getContacts();
    const ratio = computeReplyRatio(contacts, state.config.replyRatioWindow);
    await this.log({ type: 'reply_ratio_check', evaluated: ratio.evaluated, ratio: ratio.ratio });
    if (ratio.evaluated && ratio.ratio < state.config.replyRatioThreshold) {
      await this.updateState((s) => {
        s.status = 'paused';
        s.pauseReason = 'reply_ratio';
        return s;
      });
      return;
    }

    const nextContacts = nextBatchContacts(contacts, state.config.batchSize);
    if (nextContacts.length === 0) {
      await this.updateState((s) => {
        s.status = 'idle';
        return s;
      });
      return;
    }

    const newBatch = {
      contacts: nextContacts.map((c) => c.number),
      startedAt: now.toISOString(),
      repliesReceived: [],
    };
    await this.updateState((s) => {
      s.currentBatch = newBatch;
      return s;
    });

    this._sending = true;
    try {
      await this._sendToContacts(nextContacts, state);
    } finally {
      this._sending = false;
    }
  }

  async _sendToContacts(contacts, state) {
    const variants = variantsLib.getVariants();
    for (const contact of contacts) {
      if (!this.baileys || this.baileys.status !== 'connected') return; // pause, don't fail

      const currentState = this.getState();
      const variant = pickVariant(variants, currentState.nextVariantIndex);
      if (!variant) {
        await this.log({ type: 'error', context: 'send', message: 'no message variants configured' });
        return;
      }
      const text = personalize(variant.text, contact.name);

      let failed = false;
      try {
        await this.baileys.sendMessage(contact.number, text);
        await contactsLib.markSent(contact.number, { variantId: variant.id });
        await this.log({ type: 'sent', number: contact.number, variantId: variant.id });
      } catch (err) {
        failed = true;
        await this.log({ type: 'send_failed', number: contact.number, message: err.message });
      }

      let pausedForFailures = false;
      await this.updateState((s) => {
        if (!failed) {
          s.nextVariantIndex = (s.nextVariantIndex + 1) % variants.length;
          s.consecutiveFailures = 0;
        } else {
          s.consecutiveFailures = (s.consecutiveFailures || 0) + 1;
          if (s.consecutiveFailures >= 5) {
            s.status = 'paused';
            s.pauseReason = 'consecutive_failures';
            pausedForFailures = true;
          }
        }
        return s;
      });
      if (pausedForFailures) return;

      await sleep(randomDelayMs(state.config.minDelayMin, state.config.maxDelayMin));
    }
  }

  // Batch-end: anyone still Pending in the batch -> NoResponse. Also used
  // by stopCampaign() so nothing is ever "in flight" under a stopped status.
  async _finalizeBatch() {
    const state = this.getState();
    if (!state.currentBatch) return;
    await contactsLib.markNoResponse(state.currentBatch.contacts);
    await this.log({ type: 'batch_end', contacts: state.currentBatch.contacts });
    await this.updateState((s) => {
      s.currentBatch = null;
      return s;
    });
  }
}

module.exports = {
  CampaignEngine,
  shouldEndBatch,
  nextBatchContacts,
  computeReplyRatio,
  isQuietHours,
  pickVariant,
  personalize,
  randomDelayMs,
  defaultState,
  DEFAULT_CONFIG,
};
