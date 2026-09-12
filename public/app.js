'use strict';

// ---- Auth ----------------------------------------------------------------

let token = localStorage.getItem('openwa-token') || null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body && !(options.headers && options.headers['Content-Type'] === 'text/csv')
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    token = null;
    localStorage.removeItem('openwa-token');
    showLogin();
    throw new Error('unauthorized');
  }
  return res;
}

function showLogin() {
  document.getElementById('login-screen').hidden = false;
  document.getElementById('app-screen').hidden = true;
}

function showApp() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-screen').hidden = false;
  showTab('dashboard');
  startPolling();
}

// Sets a small colored dot: 'green' | 'yellow' | 'red' | 'gray'.
function setStatusDot(el, color) {
  el.className = `status-dot status-dot--${color}`;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.hidden = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorEl.textContent = body.error || 'login failed';
      errorEl.hidden = false;
      return;
    }
    const body = await res.json();
    token = body.token;
    localStorage.setItem('openwa-token', token);
    showApp();
  } catch {
    errorEl.textContent = 'network error';
    errorEl.hidden = false;
  }
});

// ---- Tabs ------------------------------------------------------------------

const TAB_LOADERS = {
  dashboard: loadDashboard,
  connect: loadConnect,
  contacts: loadContacts,
  variants: loadVariants,
  settings: loadSettings,
  campaign: loadCampaign,
  logs: loadLogs,
};

let activeTab = 'dashboard';

function showTab(name) {
  activeTab = name;
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.id === `tab-${name}`);
  }
  TAB_LOADERS[name]?.().catch((err) => { if (err.message !== 'unauthorized') console.error(err); });
}

for (const btn of document.querySelectorAll('.tab-btn')) {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
}

function startPolling() {
  setInterval(() => {
    TAB_LOADERS[activeTab]?.().catch((err) => { if (err.message !== 'unauthorized') console.error(err); });
  }, 4000);
}

// ---- Dashboard (live overview) ---------------------------------------------

async function loadDashboard() {
  const [connect, campaignState, contactsData] = await Promise.all([
    loadConnect(),
    loadCampaign(),
    api('/api/contacts').then((r) => r.json()),
  ]);

  document.getElementById('dash-connect-text').textContent = connect.status;
  setStatusDot(document.getElementById('dash-connect-dot'), CONNECT_DOT_COLOR[connect.status] || 'gray');

  document.getElementById('dash-campaign-text').textContent = campaignState.status;
  setStatusDot(document.getElementById('dash-campaign-dot'), CAMPAIGN_DOT_COLOR[campaignState.status] || 'gray');

  renderCounts(document.getElementById('dash-counts'), contactsData.counts);

  const banner = document.getElementById('dash-banner');
  if (campaignState.status === 'paused' && campaignState.pauseReason && PAUSE_REASON_TEXT[campaignState.pauseReason]) {
    banner.textContent = PAUSE_REASON_TEXT[campaignState.pauseReason];
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

// ---- Connect ----------------------------------------------------------------

const CONNECT_DOT_COLOR = { connected: 'green', connecting: 'yellow', disconnected: 'red' };

async function loadConnect() {
  const res = await api('/api/connect/status');
  const { status, qr } = await res.json();
  document.getElementById('connect-status').textContent = status;
  setStatusDot(document.getElementById('connect-dot'), CONNECT_DOT_COLOR[status] || 'gray');
  const img = document.getElementById('connect-qr');
  if (qr) {
    img.src = qr;
    img.hidden = false;
  } else {
    img.hidden = true;
  }
  return { status, qr };
}

document.getElementById('reconnect-btn').addEventListener('click', async () => {
  await api('/api/connect/reconnect', { method: 'POST' });
  loadConnect();
});

// ---- Contacts ----------------------------------------------------------------

function renderCounts(el, counts) {
  el.textContent = '';
  for (const [group, n] of Object.entries(counts)) {
    const span = document.createElement('span');
    span.textContent = `${group}: ${n}`; // textContent only — never innerHTML with data-derived text
    el.appendChild(span);
  }
}

async function loadContacts() {
  const res = await api('/api/contacts');
  const { contacts, counts } = await res.json();
  renderCounts(document.getElementById('contacts-counts'), counts);

  const tbody = document.querySelector('#contacts-table tbody');
  tbody.textContent = '';
  for (const c of contacts) {
    const tr = document.createElement('tr');
    for (const value of [c.number, c.group]) {
      const td = document.createElement('td');
      td.textContent = value; // never innerHTML — untrusted contact data must never be parsed as markup
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

document.getElementById('import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = document.getElementById('import-file').files[0];
  const countryCode = document.getElementById('import-country-code').value.trim();
  if (!file) return;
  const text = await file.text();
  const qs = countryCode ? `?defaultCountryCode=${encodeURIComponent(countryCode)}` : '';
  const res = await api(`/api/contacts/import${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: text,
  });
  const result = await res.json();
  document.getElementById('import-result').textContent =
    `Accepted ${result.accepted.length}, rejected ${result.rejected.length}` +
    (result.rejected.length ? `: ${result.rejected.map((r) => r.reason).join(', ')}` : '');
  loadContacts();
});

async function downloadReport(e) {
  e.preventDefault();
  const res = await api('/api/contacts/export');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contacts-report.csv';
  a.click();
  URL.revokeObjectURL(url);
}
document.getElementById('export-link').addEventListener('click', downloadReport);
document.getElementById('dash-export-link').addEventListener('click', downloadReport);

// ---- Message Variants ----------------------------------------------------------------

async function loadVariants() {
  const res = await api('/api/variants');
  const variants = await res.json();
  const list = document.getElementById('variant-list');
  list.textContent = '';
  for (const v of variants) {
    const li = document.createElement('li');
    const text = document.createElement('div');
    text.textContent = v.text; // never innerHTML
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      await api(`/api/variants/${v.id}`, { method: 'DELETE' });
      loadVariants();
    });
    li.appendChild(text);
    li.appendChild(del);
    list.appendChild(li);
  }
}

document.getElementById('variant-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const textarea = document.getElementById('variant-text');
  const text = textarea.value.trim();
  if (!text) return;
  await api('/api/variants', { method: 'POST', body: JSON.stringify({ text }) });
  textarea.value = '';
  loadVariants();
});

// ---- Pacing/Settings ----------------------------------------------------------------

async function loadSettings() {
  const res = await api('/api/settings');
  const config = await res.json();
  const form = document.getElementById('settings-form');
  for (const [key, value] of Object.entries(config)) {
    if (form.elements[key]) form.elements[key].value = value;
  }
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const partial = {};
  for (const el of form.elements) {
    if (el.name) partial[el.name] = Number(el.value);
  }
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(partial) });
  const saved = document.getElementById('settings-saved');
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 2000);
});

// ---- Campaign ----------------------------------------------------------------

const PAUSE_REASON_TEXT = {
  reply_ratio: 'Paused: reply ratio dropped below the configured threshold. Check your WhatsApp connection and messaging before resuming.',
  consecutive_failures: 'Paused: 5 failures in a row — check your WhatsApp connection.',
  disconnected: 'Paused: WhatsApp connection lost. Waiting to reconnect.',
  manual: 'Paused.',
};

const CAMPAIGN_DOT_COLOR = { running: 'green', paused: 'yellow', quiet_hours: 'yellow', idle: 'gray', stopped: 'gray' };

async function loadCampaign() {
  const res = await api('/api/campaign');
  const state = await res.json();
  renderCounts(document.getElementById('campaign-counts'), state.counts);
  document.getElementById('campaign-status').textContent = state.status;
  setStatusDot(document.getElementById('campaign-dot'), CAMPAIGN_DOT_COLOR[state.status] || 'gray');

  const banner = document.getElementById('campaign-banner');
  if (state.status === 'paused' && state.pauseReason && PAUSE_REASON_TEXT[state.pauseReason]) {
    banner.textContent = PAUSE_REASON_TEXT[state.pauseReason];
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  const batchEl = document.getElementById('campaign-batch');
  batchEl.textContent = '';
  if (state.currentBatch) {
    batchEl.textContent =
      `Current batch: ${state.currentBatch.repliesReceived.length}/${state.config.replyThreshold} replies, ` +
      `started ${new Date(state.currentBatch.startedAt).toLocaleTimeString()}`;
  }
  return state;
}

document.getElementById('campaign-start').addEventListener('click', () => api('/api/campaign/start', { method: 'POST' }).then(loadCampaign));
document.getElementById('campaign-pause').addEventListener('click', () => api('/api/campaign/pause', { method: 'POST' }).then(loadCampaign));
document.getElementById('campaign-resume').addEventListener('click', () => api('/api/campaign/resume', { method: 'POST' }).then(loadCampaign));
document.getElementById('campaign-stop').addEventListener('click', () => api('/api/campaign/stop', { method: 'POST' }).then(loadCampaign));

// ---- Logs ----------------------------------------------------------------

async function loadLogs() {
  const res = await api('/api/logs?tail=200');
  const logs = await res.json();
  const list = document.getElementById('log-list');
  list.textContent = '';
  for (const entry of logs) {
    const li = document.createElement('li');
    li.textContent = `${entry.ts} ${JSON.stringify(entry)}`; // JSON.stringify escapes for text content, not HTML
    list.appendChild(li);
  }
}

// ---- Boot ----------------------------------------------------------------

if (token) {
  api('/api/campaign').then(() => showApp()).catch(() => showLogin());
} else {
  showLogin();
}
