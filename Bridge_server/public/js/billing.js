const msgEl = document.getElementById('billMsg');
const subtitleEl = document.getElementById('billSubtitle');

let currentSku = 'base';
let disclaimerVersion = null;

function showMsg(text, type) {
  msgEl.textContent = text;
  msgEl.className = `bill-msg show ${type}`;
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.status = res.status; err.body = data; throw err; }
  return data;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.status = res.status; err.body = data; throw err; }
  return data;
}

function renderPlans(me) {
  currentSku = me.sku;
  subtitleEl.textContent = `Signed in as ${me.email}.`;

  document.querySelectorAll('.bill-plan').forEach(planEl => {
    const sku = planEl.dataset.sku;
    const btn = planEl.querySelector('.bill-btn[data-sku]');
    const isCurrent = sku === currentSku;
    planEl.classList.toggle('current', isCurrent);

    if (isCurrent) {
      btn.textContent = 'Current plan';
      btn.disabled = true;
    } else {
      btn.textContent = 'Subscribe';
      btn.disabled = false;
    }
  });

  const fullPlan = document.querySelector('.bill-plan[data-sku="full"]');
  const existingNote = fullPlan.querySelector('.bill-plan-review');
  if (existingNote) existingNote.remove();
  if (me.sku === 'full' && me.reviewStatus === 'pending') {
    const note = document.createElement('div');
    note.className = 'bill-plan-review';
    note.textContent = 'Account flagged for manual review — we’ll reach out shortly to finish setup.';
    fullPlan.appendChild(note);
  }
}

async function startCheckout(sku) {
  const data = await postJson('/api/billing/checkout', { sku });
  window.location.href = data.approveUrl;
}

async function handleSubscribeClick(sku) {
  try {
    await startCheckout(sku);
  } catch (err) {
    if (sku === 'full' && err.status === 403 && err.body?.disclaimerRequired) {
      await showFullDisclaimer();
      return;
    }
    showMsg(err.message, 'error');
  }
}

async function showFullDisclaimer() {
  const box = document.getElementById('fullDisclaimer');
  const textEl = document.getElementById('fullDisclaimerText');
  try {
    const d = await getJson('/api/disclaimer');
    disclaimerVersion = d.version;
    textEl.textContent = d.text;
    box.classList.add('show');
  } catch (err) {
    showMsg(err.message, 'error');
  }
}

document.getElementById('fullDisclaimerCheck').addEventListener('change', (e) => {
  document.getElementById('fullDisclaimerContinue').disabled = !e.target.checked;
});

document.getElementById('fullDisclaimerContinue').addEventListener('click', async () => {
  const btn = document.getElementById('fullDisclaimerContinue');
  btn.disabled = true;
  try {
    await postJson('/api/disclaimer/accept', { version: disclaimerVersion });
    await startCheckout('full');
  } catch (err) {
    showMsg(err.message, 'error');
    btn.disabled = false;
  }
});

document.querySelectorAll('.bill-btn[data-sku]').forEach(btn => {
  btn.addEventListener('click', () => handleSubscribeClick(btn.dataset.sku));
});

document.getElementById('logoutLink').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await postJson('/api/logout'); } catch { /* clearing the cookie either way */ }
  window.location.href = '/login';
});

function showReturnStatus() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');
  if (status === 'active') showMsg('Subscription active — you’re all set.', 'info');
  else if (status === 'pending') showMsg('PayPal hasn’t confirmed the subscription yet — this can take a minute. Refresh to check again.', 'warn');
  else if (status === 'error') showMsg('Could not confirm the subscription. If you completed checkout, refresh in a moment.', 'error');
}

async function init() {
  showReturnStatus();
  try {
    const me = await getJson('/api/me');
    renderPlans(me);
  } catch (err) {
    if (err.status === 401) { window.location.href = '/login'; return; }
    subtitleEl.textContent = 'Could not load your account.';
    showMsg(err.message, 'error');
  }
}

init();
