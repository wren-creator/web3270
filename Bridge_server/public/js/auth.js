const RESEND_COOLDOWN_MS = 60 * 1000;

const tabs = document.querySelectorAll('.auth-tab');
const panels = {
  login: document.getElementById('panelLogin'),
  signup: document.getElementById('panelSignup'),
  verify: document.getElementById('panelVerify'),
};
const msgEl = document.getElementById('authMsg');

let pendingSignupEmail = null;
let lastCodeSentAt = 0;
let resendTimer = null;

function showTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  Object.values(panels).forEach(p => p.classList.remove('active'));
  panels[name].classList.add('active');
  hideMsg();
}

function showMsg(text, type) {
  msgEl.textContent = text;
  msgEl.className = `auth-msg show ${type}`;
}

function hideMsg() {
  msgEl.className = 'auth-msg';
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
});

document.querySelectorAll('#tierGroup .auth-tier').forEach(label => {
  label.addEventListener('click', () => {
    document.querySelectorAll('#tierGroup .auth-tier').forEach(l => l.classList.remove('selected'));
    label.classList.add('selected');
  });
});

document.getElementById('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMsg();
  const submitBtn = document.getElementById('loginSubmit');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  submitBtn.disabled = true;
  try {
    await postJson('/api/login', { email, password });
    // If they just came from signing up for a paid tier, send them
    // straight to checkout instead of the terminal client — the
    // account itself always starts on 'base' (routes/auth.js), so
    // whatever they asked for still needs a subscription to activate.
    const requestedSku = sessionStorage.getItem('requestedSku');
    sessionStorage.removeItem('requestedSku');
    window.location.href = (requestedSku && requestedSku !== 'base') ? '/billing' : '/';
  } catch (err) {
    showMsg(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('formSignup').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMsg();
  const submitBtn = document.getElementById('signupSubmit');
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const firstName = document.getElementById('signupFirstName').value.trim();
  const lastName = document.getElementById('signupLastName').value.trim();
  const phone = document.getElementById('signupPhone').value.trim();
  const sku = document.querySelector('#tierGroup input[name="sku"]:checked').value;

  submitBtn.disabled = true;
  try {
    await postJson('/api/signup', { email, password, firstName, lastName, phone, sku });
    pendingSignupEmail = email;
    lastCodeSentAt = Date.now();
    document.getElementById('verifySubtitle').textContent = `Enter the 6-digit code we texted to ${phone}.`;
    showTab('verify');
    startResendCooldown();
  } catch (err) {
    showMsg(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('formVerify').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMsg();
  const submitBtn = document.getElementById('verifySubmit');
  const code = document.getElementById('verifyCode').value.trim();

  submitBtn.disabled = true;
  try {
    const { requestedSku } = await postJson('/api/verify-phone', { email: pendingSignupEmail, code });
    if (requestedSku && requestedSku !== 'base') sessionStorage.setItem('requestedSku', requestedSku);
    showTab('login');
    document.getElementById('loginEmail').value = pendingSignupEmail;
    showMsg('Account created — log in to continue.', 'info');
  } catch (err) {
    showMsg(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('verifyBack').addEventListener('click', () => showTab('signup'));

document.getElementById('resendLink').addEventListener('click', async (e) => {
  e.preventDefault();
  if (e.target.classList.contains('disabled')) return;
  hideMsg();
  try {
    await postJson('/api/resend-code', { email: pendingSignupEmail });
    lastCodeSentAt = Date.now();
    showMsg('A new code is on its way.', 'info');
    startResendCooldown();
  } catch (err) {
    showMsg(err.message, 'error');
  }
});

function startResendCooldown() {
  const link = document.getElementById('resendLink');
  link.classList.add('disabled');
  clearInterval(resendTimer);

  const tick = () => {
    const remaining = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - lastCodeSentAt)) / 1000);
    if (remaining <= 0) {
      link.textContent = 'Resend code';
      link.classList.remove('disabled');
      clearInterval(resendTimer);
    } else {
      link.textContent = `Resend code (${remaining}s)`;
    }
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}
