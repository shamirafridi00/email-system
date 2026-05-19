// ─── Notification Settings ────────────────────────────────────────────────────
async function loadNotificationSettings() {
  try {
    var emailRes = await api('/dashboard/settings/notification-email');
    var inp = el('notif-email-input');
    if (inp) inp.value = emailRes.email || '';
  } catch(e) {}

  try {
    var sumRes = await api('/dashboard/settings/send-warmup-summary');
    updateSummaryToggle(sumRes.enabled);
  } catch(e) {}
}

function updateSummaryToggle(enabled) {
  var btn   = el('notif-summary-toggle');
  var knob  = el('notif-summary-knob');
  var badge = el('notif-summary-badge');
  if (!btn) return;
  if (enabled) {
    btn.style.background = '#22c55e';
    knob.style.left = '23px';
    if (badge) { badge.textContent = 'Enabled'; badge.style.background = '#052e16'; badge.style.color = '#22c55e'; }
  } else {
    btn.style.background = '#374151';
    knob.style.left = '3px';
    if (badge) { badge.textContent = 'Disabled'; badge.style.background = '#1f2937'; badge.style.color = '#6b7280'; }
  }
  if (btn) btn.dataset.enabled = enabled ? '1' : '0';
}

async function saveNotificationEmail() {
  var inp = el('notif-email-input');
  var email = inp ? inp.value.trim() : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Invalid email address', 'error');
    return;
  }
  try {
    await api('/dashboard/settings/notification-email', { method: 'POST', body: JSON.stringify({ email: email }) });
    toast(email ? 'Notification email saved' : 'Notification email cleared', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function toggleWarmupSummary() {
  var btn = el('notif-summary-toggle');
  var currentlyEnabled = btn && btn.dataset.enabled === '1';
  var newEnabled = !currentlyEnabled;
  try {
    await api('/dashboard/settings/send-warmup-summary', { method: 'POST', body: JSON.stringify({ enabled: newEnabled }) });
    updateSummaryToggle(newEnabled);
    toast('Daily summary ' + (newEnabled ? 'enabled' : 'disabled'), 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function sendTestSummary() {
  var spinner = el('test-summary-spinner');
  var resultEl = el('notif-action-result');
  if (spinner) spinner.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:2px"></span> ';
  if (resultEl) resultEl.innerHTML = '';
  try {
    var r = await api('/warmup/reports/send-summary', { method: 'POST' });
    if (r.success) {
      toast(r.message, 'success');
      if (resultEl) resultEl.innerHTML = '<span style="color:#22c55e">✓ ' + r.message + '</span>';
    } else {
      toast(r.message, 'error');
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">' + r.message + '</span>';
    }
  } catch(e) {
    toast(e.message, 'error');
    if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">' + e.message + '</span>';
  } finally {
    if (spinner) spinner.innerHTML = '';
  }
}

async function previewSummaryEmail() {
  var frame = el('email-preview-frame');
  var modal = el('email-preview-modal');
  if (!frame || !modal) return;
  frame.innerHTML = '<div style="text-align:center;padding:32px;color:#6b7280"><span class="spinner"></span> Loading…</div>';
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';

  try {
    var r = await api('/warmup/reports/preview-summary');
    frame.innerHTML = r.html;
  } catch(e) {
    frame.innerHTML = '<div style="color:#ef4444;padding:20px">' + e.message + '</div>';
  }
}

function closeEmailPreview(e) {
  if (e && e.target !== el('email-preview-modal') && e.type !== 'click') return;
  var modal = el('email-preview-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}
