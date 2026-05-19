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
  frame.innerHTML = '<div style="text-align:center;padding:32px;color:#6b7280"><span class="spinner"></span> Building preview…</div>';
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';

  try {
    // Fetch current data to build a representative preview
    var accounts = await api('/warmup/schedule');
    var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    var yStr = yesterday.toISOString().split('T')[0];

    // Build inline HTML preview approximating the email
    var rows = accounts.map(function(a) {
      var wk = a.current_week || 0;
      var wc = { 1: '#f59e0b', 2: '#818cf8', 3: '#22c55e', 4: '#4ade80' }[wk] || '#6b7280';
      var icon = a.on_track ? '<span style="color:#22c55e;font-weight:700">✓</span>'
        : a.sent_today > 0 ? '<span style="color:#f59e0b;font-weight:700">!</span>'
        : '<span style="color:#ef4444;font-weight:700">✗</span>';
      var weekBadge = wk > 0
        ? '<span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;background:#1f1f1f;color:' + wc + ';border:1px solid ' + wc + '40">Wk ' + wk + '</span>'
        : '<span style="font-size:11px;color:#888">—</span>';
      return '<tr style="border-bottom:1px solid #f3f4f6">' +
        '<td style="padding:10px 12px;font-family:monospace;font-size:12px;color:#374151">' + a.email + '</td>' +
        '<td style="padding:10px 12px;text-align:center">' + weekBadge + '</td>' +
        '<td style="padding:10px 12px;text-align:center;font-size:13px;font-weight:700;color:#111">' + a.sent_today + '</td>' +
        '<td style="padding:10px 12px;text-align:center;font-size:13px;color:#6b7280">' + a.daily_target + '</td>' +
        '<td style="padding:10px 12px;text-align:center;font-size:16px">' + icon + '</td>' +
        '</tr>';
    }).join('');

    var onTrack = accounts.filter(function(a) { return a.on_track; }).length;
    var totalSent = accounts.reduce(function(s, a) { return s + a.sent_today; }, 0);

    var statBox = function(label, val, color) {
      return '<td style="width:25%;padding:14px;text-align:center;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">' +
        '<div style="font-size:24px;font-weight:800;color:' + color + ';line-height:1">' + val + '</div>' +
        '<div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:.04em">' + label + '</div>' +
        '</td>';
    };

    var previewDate = yesterday.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    frame.innerHTML =
      '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);font-family:Arial,sans-serif">' +
        '<div style="background:#0f0f0f;padding:24px 28px">' +
          '<div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px">Email Warmup System</div>' +
          '<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:4px">Daily Warmup Report</div>' +
          '<div style="font-size:12px;color:#9ca3af">' + previewDate + ' (preview)</div>' +
        '</div>' +
        '<div style="padding:20px 28px">' +
          '<table style="width:100%;border-collapse:separate;border-spacing:6px;margin-bottom:20px"><tr>' +
            statBox('Total Sent', totalSent, '#111') +
            statBox('Active Accounts', accounts.length, '#6366f1') +
            statBox('On Track', onTrack + '/' + accounts.length, onTrack === accounts.length ? '#22c55e' : '#f59e0b') +
            statBox('Preview', 'Live', '#818cf8') +
          '</tr></table>' +
          '<h2 style="margin:0 0 10px;font-size:14px;font-weight:700;color:#111">Account Status</h2>' +
          '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr style="background:#f9fafb">' +
              '<th style="padding:7px 12px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Account</th>' +
              '<th style="padding:7px 12px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Week</th>' +
              '<th style="padding:7px 12px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Sent Today</th>' +
              '<th style="padding:7px 12px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Target</th>' +
              '<th style="padding:7px 12px;text-align:center;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Status</th>' +
            '</tr></thead>' +
            '<tbody>' + (rows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;font-size:13px">No accounts</td></tr>') + '</tbody>' +
          '</table>' +
          '<div style="margin-top:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;font-size:11px;color:#9ca3af;text-align:center">' +
            'This is a preview. The actual report uses yesterday\'s data and is sent via email.' +
          '</div>' +
        '</div>' +
      '</div>';
  } catch(e) {
    if (frame) frame.innerHTML = '<div style="color:#ef4444;padding:20px">' + e.message + '</div>';
  }
}

function closeEmailPreview(e) {
  if (e && e.target !== el('email-preview-modal') && e.type !== 'click') return;
  var modal = el('email-preview-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}
