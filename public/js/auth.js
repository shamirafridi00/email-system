// ─── Auth ─────────────────────────────────────────────────────────────────────
async function logout() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login';
}

// ─── Settings ────────────────────────────────────────────────────────────────
function loadSettings() {
  const token = localStorage.getItem('hs_token') || '';
  el('hs-token').value = token ? '••••••••••••••••••••' : '';
  el('hs-token').dataset.real = token;
  el('hs-token').addEventListener('focus', function() { this.value = this.dataset.real; }, { once: false });
  el('hs-token').addEventListener('blur', function() {
    if (this.value && this.value !== this.dataset.real) {
      this.dataset.real = this.value;
    }
    if (this.value) this.value = '••••••••••••••••••••';
  });
}

async function saveHubspotToken() {
  const token = el('hs-token').dataset.real || el('hs-token').value;
  if (!token || token.includes('•')) { toast('Enter a valid token', 'error'); return; }
  localStorage.setItem('hs_token', token);
  try {
    await api('/dashboard/settings/token', { method: 'POST', body: JSON.stringify({ token }) });
    toast('HubSpot token saved and active', 'success');
    el('hs-status').innerHTML = '<span style="color:#22c55e">✓ Token pushed to server</span>';
  } catch(e) {
    toast('Saved locally but failed to push to server: ' + e.message, 'error');
  }
}

async function restoreHubspotToken() {
  const token = localStorage.getItem('hs_token');
  if (!token) return;
  try {
    await fetch('/dashboard/settings/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    });
  } catch { /* non-critical */ }
}

async function testHubspot() {
  try {
    const s = await api('/dashboard/stats');
    el('hs-status').innerHTML = s.hubspot_connected
      ? '<span style="color:#22c55e">✓ Connected to HubSpot</span>'
      : '<span style="color:#ef4444">✗ Not connected — check token and scopes</span>';
  } catch(e) {
    el('hs-status').innerHTML = '<span style="color:#ef4444">' + e.message + '</span>';
  }
}
