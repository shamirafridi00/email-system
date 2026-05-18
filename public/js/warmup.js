// ─── Shared grade metadata (used by both progress cards and accounts table) ───
var GRADE_META = {
  Excellent: { color: '#4ade80', bg: '#052e16', border: '#166534' },
  Good:      { color: '#818cf8', bg: '#1e1b4b', border: '#3730a3' },
  Fair:      { color: '#f59e0b', bg: '#1c1917', border: '#78350f' },
  Poor:      { color: '#fb923c', bg: '#1c0a00', border: '#9a3412' },
  Critical:  { color: '#f87171', bg: '#1c0000', border: '#7f1d1d' },
};

// ─── Warmup Status ───────────────────────────────────────────────────────────
async function loadWarmupStatus() {
  try {
    const s = await api('/warmup/status');
    el('warmup-status-badge').innerHTML = s.warmup_running
      ? '<span class="badge badge-replied" style="font-size:12px;padding:4px 10px">● Running</span>'
      : '<span class="badge badge-bounced" style="font-size:12px;padding:4px 10px">■ Paused</span>';
  } catch(e) { el('warmup-status-badge').innerHTML = ''; }
}

// ─── Warmup Accounts ─────────────────────────────────────────────────────────
async function loadWarmupAccounts() {
  await Promise.all([loadWarmupAccountsTable(), loadWarmupStatsCard(), loadWarmupStatus()]);
}

async function loadWarmupAccountsTable() {
  try {
    const rows = await api('/warmup/accounts');
    // Fetch scores in parallel and build a lookup map by email
    var scoreMap = {};
    try {
      var prog = await api('/warmup/accounts/progress');
      if (Array.isArray(prog)) {
        prog.forEach(function(p) { scoreMap[p.email] = p; });
      }
    } catch(e) {}

    el('warmup-accounts-table').innerHTML = rows.length
      ? '<table><thead><tr><th>Email</th><th>Daily Limit</th><th style="text-align:center">Health</th><th>Status</th><th>Last Active</th><th></th></tr></thead><tbody>' +
        rows.map(function(r) {
          var p = scoreMap[r.email];
          var scoreBadge = '<span style="color:#4b5563;font-size:12px">—</span>';
          if (p && p.health_grade) {
            var gm = GRADE_META[p.health_grade] || GRADE_META.Critical;
            scoreBadge =
              '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;background:' + gm.bg + ';color:' + gm.color + '">' +
                '<span style="width:6px;height:6px;border-radius:50%;background:' + gm.color + ';flex-shrink:0"></span>' +
                p.health_score + ' ' + p.health_grade +
              '</span>';
          }

          // Warning icon if 3+ consecutive failures
          var failWarn = (r.consecutive_failures > 2)
            ? '<span title="Multiple authentication failures detected. Re-verify this account." style="color:#ef4444;cursor:help;margin-left:5px;font-size:12px">⚠</span>'
            : '';

          // Shield indicator based on last_verified_at
          var shield = '';
          if (r.last_verified_at) {
            var verifiedMs = Date.now() - new Date(r.last_verified_at).getTime();
            var recentVerify = verifiedMs < 24 * 60 * 60 * 1000;
            shield = '<span title="' + (recentVerify ? 'Verified within last 24h' : 'Verification older than 24h') + '" style="margin-right:4px;font-size:12px;color:' + (recentVerify ? '#22c55e' : '#6b7280') + '">🛡</span>';
          }

          return '<tr>' +
            '<td style="font-family:monospace;font-size:12px">' + r.email + failWarn + '</td>' +
            '<td>' + r.daily_volume + '</td>' +
            '<td style="text-align:center">' + scoreBadge + '</td>' +
            '<td>' +
              '<button class="btn btn-sm ' + (r.active ? 'btn-primary' : 'btn-ghost') + '" ' +
                'onclick="toggleWarmupAccount(' + r.id + ',' + r.active + ')" ' +
                'style="min-width:70px">' +
                (r.active ? '● Active' : '■ Paused') +
              '</button>' +
            '</td>' +
            '<td style="color:' + (r.last_active ? '#888' : '#555') + ';white-space:nowrap">' + shield + (r.last_active ? formatTime(r.last_active) : 'Never') + '</td>' +
            '<td style="display:flex;gap:6px;align-items:center">' +
              '<button id="verify-btn-' + r.id + '" class="btn btn-ghost btn-sm" onclick="verifyAccount(' + r.id + ',\'' + r.email + '\')" style="min-width:74px">✓ Verify</button>' +
              '<button class="btn btn-danger btn-sm" onclick="deleteWarmupAccount(' + r.id + ')">Delete</button>' +
            '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>'
      : '<div class="no-data">No warmup accounts yet</div>';
  } catch(e) {
    el('warmup-accounts-table').innerHTML = '<div class="no-data" style="color:#ef4444">' + e.message + '</div>';
  }
}

async function loadWarmupStatsCard() {
  try {
    const s = await api('/warmup/stats');
    const html = '<div style="font-size:32px;font-weight:700;color:#22c55e">' + s.sent_today + '</div><div class="text-muted">warmup emails sent today</div>';
    if (el('warmup-stats')) el('warmup-stats').innerHTML = html;
    if (el('warmup-stats-log')) el('warmup-stats-log').innerHTML = html;
  } catch(e) {}
}

async function addWarmupAccount() {
  const email = el('wa-email').value.trim();
  const pass = el('wa-pass').value.trim();
  if (!email || !pass) { toast('Email and password required', 'error'); return; }
  try {
    await api('/warmup/accounts', { method: 'POST', body: JSON.stringify({ email: email, app_password: pass }) });
    el('wa-email').value = '';
    el('wa-pass').value = '';
    toast('Warmup account added', 'success');
    loadWarmupAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

async function toggleWarmupAccount(id, currentActive) {
  try {
    await api('/warmup/accounts/' + id, { method: 'PUT', body: JSON.stringify({ active: currentActive ? 0 : 1 }) });
    loadWarmupAccountsTable();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteWarmupAccount(id) {
  if (!confirm('Delete this warmup account?')) return;
  try {
    await api('/warmup/accounts/' + id, { method: 'DELETE' });
    toast('Deleted', 'success');
    loadWarmupAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

async function verifyAccount(id, email) {
  var btn = el('verify-btn-' + id);
  var orig = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:2px"></span> Verifying'; btn.disabled = true; }
  try {
    var r = await api('/warmup/accounts/' + id + '/verify', { method: 'POST' });
    if (r.success) {
      toast((email || 'Account') + ' verified successfully', 'success');
      // Update the last-active cell to "just now" without a full reload
      if (btn) { btn.innerHTML = '✓ Verified'; btn.style.color = '#22c55e'; }
      setTimeout(function() { loadWarmupAccountsTable(); }, 1200);
    } else {
      toast((email || 'Account') + ' failed verification. Check app password.', 'error');
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
      setTimeout(function() { loadWarmupAccountsTable(); }, 1200);
    }
  } catch(e) {
    toast(e.message, 'error');
    if (btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}

async function verifyFromProgress(id, email) {
  var btn = el('verify-prog-btn-' + id);
  if (btn) { btn.textContent = '…'; btn.disabled = true; }
  try {
    var r = await api('/warmup/accounts/' + id + '/verify', { method: 'POST' });
    if (r.success) {
      toast(email + ' verified successfully', 'success');
      if (btn) { btn.textContent = '✓ OK'; btn.style.color = '#4ade80'; btn.style.borderColor = '#166534'; }
      setTimeout(loadWarmupProgress, 1000);
    } else {
      toast(email + ' failed verification. Check app password.', 'error');
      if (btn) { btn.textContent = '✗ Fail'; btn.style.color = '#f87171'; btn.style.borderColor = '#7f1d1d'; }
      setTimeout(loadWarmupProgress, 1000);
    }
  } catch(e) {
    toast(e.message, 'error');
    if (btn) { btn.textContent = '✓ Verify'; btn.disabled = false; }
  }
}

async function verifyAllAccounts() {
  var btn = el('verify-all-btn');
  if (btn) { btn.textContent = 'Verifying…'; btn.disabled = true; }
  try {
    var results = await api('/warmup/accounts/verify-all', { method: 'POST' });
    var passed = results.filter(function(r) { return r.success; }).length;
    var total = results.length;
    toast(passed + ' of ' + total + ' accounts verified successfully', passed === total ? 'success' : 'error');
    loadWarmupAccountsTable();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.textContent = '✓ Verify All'; btn.disabled = false; }
  }
}

async function startWarmup() {
  try {
    await api('/warmup/start', { method: 'POST' });
    toast('Warmup started', 'success');
    await loadWarmupStatus();
    await api('/warmup/run', { method: 'POST' });
    setTimeout(loadWarmupAccountsTable, 2000);
  } catch(e) { toast(e.message, 'error'); }
}

async function stopWarmup() {
  try {
    await api('/warmup/stop', { method: 'POST' });
    toast('Warmup paused', 'success');
    loadWarmupStatus();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Warmup Log ──────────────────────────────────────────────────────────────
var warmupLogRows = [];

async function loadWarmupLog() {
  await loadWarmupStatsCard();
  try {
    const convIds = await api('/warmup/log/conversations');
    const filter = el('warmup-log-filter');
    const current = filter ? filter.value : '';
    if (filter) {
      filter.innerHTML = '<option value="">All Conversations</option>' +
        convIds.map(function(id) {
          return '<option value="' + id + '"' + (id === current ? ' selected' : '') + '>' + id + '</option>';
        }).join('');
    }
    const convId = filter ? filter.value : '';
    const url = convId ? '/warmup/log?conversation_id=' + encodeURIComponent(convId) : '/warmup/log';
    warmupLogRows = await api(url);
    if (el('warmup-log-refresh')) el('warmup-log-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString();
    renderWarmupLog();
  } catch(e) {}
}

function renderWarmupLog() {
  const convId = el('warmup-log-filter') ? el('warmup-log-filter').value : '';
  const fromVal = el('warmup-log-from') ? el('warmup-log-from').value : '';
  const toVal = el('warmup-log-to') ? el('warmup-log-to').value : '';

  const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const toDate = toVal ? new Date(toVal + 'T23:59:59') : null;

  var rows = warmupLogRows.filter(function(r) {
    if (convId && r.conversation_id !== convId) return false;
    if (fromDate || toDate) {
      var sent = new Date(r.sent_at);
      if (fromDate && sent < fromDate) return false;
      if (toDate && sent > toDate) return false;
    }
    return true;
  });

  el('warmup-log-table').innerHTML = rows.length
    ? '<table><thead><tr><th>From</th><th>To</th><th>Subject</th><th>Conversation</th><th>Replied</th><th>Time</th></tr></thead><tbody>' +
      rows.map(function(r) {
        return '<tr>' +
          '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.from_email + '</td>' +
          '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.to_email + '</td>' +
          '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.subject + '</td>' +
          '<td><span style="font-size:11px;color:#888;font-family:monospace">' + (r.conversation_id || '—') + '</span></td>' +
          '<td>' + (r.replied ? '<span class="badge badge-replied">Yes</span>' : '—') + '</td>' +
          '<td>' + formatTime(r.sent_at) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>'
    : '<div class="no-data">No warmup emails sent yet</div>';
}

async function resetWarmupLog() {
  if (!confirm('This will delete all warmup log entries. Are you sure?')) return;
  try {
    await api('/warmup/log', { method: 'DELETE' });
    warmupLogRows = [];
    toast('Warmup log cleared', 'success');
    loadWarmupLog();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Conversations ────────────────────────────────────────────────────────────
function toggleChatGPTPrompt() {
  var panel = el('chatgpt-prompt-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function copyConvPrompt() {
  var text = el('chatgpt-prompt-text').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('Prompt copied to clipboard', 'success');
  } catch(e) {
    el('chatgpt-prompt-text').select();
    document.execCommand('copy');
    toast('Prompt copied to clipboard', 'success');
  }
}
async function loadConversations() {
  try {
    const rows = await api('/warmup/conversations');
    el('conv-history-table').innerHTML = rows.length
      ? '<table><thead><tr><th>Filename</th><th>Emails Scheduled</th><th>Uploaded At</th><th>Status</th></tr></thead><tbody>' +
        rows.map(function(r) {
          return '<tr>' +
            '<td style="font-family:monospace;font-size:12px">' + r.filename + '</td>' +
            '<td>' + r.email_count + '</td>' +
            '<td>' + formatTime(r.uploaded_at) + '</td>' +
            '<td><span class="badge badge-active">' + r.status + '</span></td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>'
      : '<div class="no-data">No conversation files uploaded yet</div>';
  } catch(e) {
    el('conv-history-table').innerHTML = '<div class="no-data" style="color:#ef4444">' + e.message + '</div>';
  }
}

// ─── Warmup Progress ─────────────────────────────────────────────────────────
var progressData = [];
var progressSortedDesc = true;

var STATUS_META = {
  not_started:       { label: 'Not Started',       color: '#6b7280', bg: '#1f2937', bar: '#6b7280' },
  early_warmup:      { label: 'Early Warmup',       color: '#f59e0b', bg: '#292010', bar: '#f59e0b' },
  mid_warmup:        { label: 'Mid Warmup',         color: '#818cf8', bg: '#1e1b4b', bar: '#818cf8' },
  ready:             { label: 'Ready',              color: '#22c55e', bg: '#052e16', bar: '#22c55e' },
  needs_more_volume: { label: 'Needs More Volume',  color: '#f97316', bg: '#1c1000', bar: '#f97316' },
};

async function loadWarmupProgress() {
  var container = el('warmup-progress-cards');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    var result = await api('/warmup/accounts/progress');
    if (!Array.isArray(result)) {
      container.innerHTML = '<div class="no-data" style="color:#ef4444">Unexpected response from server</div>';
      return;
    }
    progressData = result;
    renderWarmupProgress();
  } catch(e) {
    container.innerHTML = '<div class="no-data" style="color:#ef4444">' + (e.message || 'Failed to load progress') + '</div>';
  }
}

function sortProgressByScore() {
  progressSortedDesc = !progressSortedDesc;
  var btn = el('progress-sort-btn');
  if (btn) btn.textContent = progressSortedDesc ? '↓ Score: High to Low' : '↑ Score: Low to High';
  renderWarmupProgress();
}

function renderWarmupProgress() {
  var container = el('warmup-progress-cards');
  if (!container) return;
  if (!progressData || !progressData.length) {
    container.innerHTML = '<div class="no-data">No warmup accounts found. Add accounts on the Warmup Accounts page.</div>';
    return;
  }

  var sorted = progressData.slice().sort(function(a, b) {
    return progressSortedDesc
      ? (b.health_score || 0) - (a.health_score || 0)
      : (a.health_score || 0) - (b.health_score || 0);
  });

  container.innerHTML = sorted.map(function(a) {
    var meta   = STATUS_META[a.readiness_status] || STATUS_META.not_started;
    var grade  = a.health_grade || 'Critical';
    var gm     = GRADE_META[grade] || GRADE_META.Critical;
    var score  = a.health_score || 0;
    var pct    = a.progress_percentage;
    var onTrack = a.emails_sent_today >= a.daily_target;
    var bd     = a.score_breakdown || { consistency:{score:0,max:40}, volume:{score:0,max:30}, reply_rate:{score:0,max:20}, reliability:{score:0,max:10} };
    var cardId = 'breakdown-' + a.id;

    var readyBanner = a.readiness_status === 'ready'
      ? '<div style="margin-top:10px;background:#052e16;border:1px solid #166534;border-radius:6px;padding:10px 14px;font-size:12px;font-weight:600;color:#22c55e">✓ This account is ready for real campaigns</div>'
      : '';
    var failureBanner = a.consecutive_failures > 2
      ? '<div style="margin-top:10px;background:#1c0a0a;border:1px solid #7f1d1d;border-radius:6px;padding:10px 14px;font-size:12px;font-weight:600;color:#ef4444">⚠ Authentication issues detected. Check app password.</div>'
      : '';

    return '<div class="card" style="margin-bottom:12px">' +

      // Top row: email + verify button left, health score tag right
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:16px">' +
        '<div style="min-width:0;flex:1">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="font-size:14px;font-weight:600;color:#e5e7eb;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + a.email + '</div>' +
            '<button id="verify-prog-btn-' + a.id + '" onclick="verifyFromProgress(' + a.id + ',\'' + a.email + '\')" title="Verify app password" style="flex-shrink:0;background:#1f2937;border:1px solid #374151;border-radius:6px;color:#9ca3af;font-size:11px;font-weight:600;padding:2px 8px;cursor:pointer;line-height:1.6">✓ Verify</button>' +
          '</div>' +
          '<span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:' + meta.bg + ';color:' + meta.color + ';border:1px solid ' + meta.color + '40;text-transform:uppercase;letter-spacing:.05em;display:inline-block;margin-top:5px">' + meta.label + '</span>' +
        '</div>' +
        // Compact score tag
        '<div style="flex-shrink:0;width:52px;height:52px;border-radius:10px;background:' + gm.bg + ';display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:1px" onclick="toggleBreakdown(\'' + cardId + '\')" title="Click to see score breakdown">' +
          '<div style="font-size:18px;font-weight:800;color:#fff;line-height:1">' + score + '</div>' +
          '<div style="font-size:9px;font-weight:600;color:' + gm.color + ';text-transform:uppercase;letter-spacing:.03em">' + grade + '</div>' +
        '</div>' +
      '</div>' +

      // Score breakdown (collapsed by default)
      '<div id="' + cardId + '" style="display:none;margin-bottom:14px;background:#0d0d0d;border:1px solid #1f2937;border-radius:8px;padding:12px">' +
        '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Health Score Breakdown</div>' +
        scoreFactor('Consistency', bd.consistency.score, bd.consistency.max, 'Days sending in last 7') +
        scoreFactor('Volume',      bd.volume.score,      bd.volume.max,      'Avg sends vs daily target') +
        scoreFactor('Reply Rate',  bd.reply_rate.score,  bd.reply_rate.max,  'Warmup emails that got replies') +
        scoreFactor('Reliability', bd.reliability.score, bd.reliability.max, 'No auth failures') +
        '<div style="border-top:1px solid #1f2937;margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:12px;font-weight:700;color:#9ca3af">Total</span>' +
          '<span style="font-size:14px;font-weight:800;color:' + gm.color + '">' + score + ' / 100</span>' +
        '</div>' +
      '</div>' +

      // Progress bar
      '<div style="margin-bottom:4px;display:flex;align-items:center;gap:10px">' +
        '<div style="flex:1;height:10px;background:#1f2937;border-radius:999px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + meta.bar + ';border-radius:999px;transition:width .4s"></div>' +
        '</div>' +
        '<span style="font-size:12px;font-weight:700;color:' + meta.color + ';min-width:36px;text-align:right">' + pct + '%</span>' +
      '</div>' +
      '<div style="font-size:11px;color:#6b7280;margin-bottom:14px">Day ' + a.days_active + ' of ' + a.warmup_target_days + '</div>' +

      // Stats row
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">' +
        statBox('Days Active', a.days_active) +
        statBox('Days Left', a.days_remaining) +
        statBox('Sent Total', a.emails_sent_total) +
        statBox('Received', a.emails_received_total) +
      '</div>' +

      // Today's sending
      '<div style="display:flex;align-items:center;justify-content:space-between;background:#111;border:1px solid #1f2937;border-radius:6px;padding:10px 14px">' +
        '<span style="font-size:12px;color:#9ca3af">Today\'s sending</span>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:13px;font-weight:700;color:#e5e7eb">' + a.emails_sent_today + ' of ' + a.daily_target + ' emails</span>' +
          (onTrack
            ? '<span style="font-size:11px;font-weight:600;color:#22c55e;background:#052e16;border:1px solid #166534;border-radius:999px;padding:2px 8px">✓ On track</span>'
            : '<span style="font-size:11px;font-weight:600;color:#f59e0b;background:#292010;border:1px solid #78350f;border-radius:999px;padding:2px 8px">⚠ Behind target</span>') +
        '</div>' +
      '</div>' +

      readyBanner +
      failureBanner +

    '</div>';
  }).join('');
}

function toggleBreakdown(id) {
  var el2 = document.getElementById(id);
  if (el2) el2.style.display = el2.style.display === 'none' ? 'block' : 'none';
}

function scoreFactor(label, score, max, hint) {
  var pct = max > 0 ? Math.round((score / max) * 100) : 0;
  var barColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#818cf8' : pct >= 25 ? '#f59e0b' : '#ef4444';
  return '<div style="margin-bottom:8px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
      '<span style="font-size:12px;font-weight:600;color:#d1d5db">' + label + '</span>' +
      '<span style="font-size:12px;font-weight:700;color:#e5e7eb">' + score + ' / ' + max + '</span>' +
    '</div>' +
    '<div style="height:5px;background:#1f2937;border-radius:999px;overflow:hidden;margin-bottom:2px">' +
      '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:999px"></div>' +
    '</div>' +
    '<div style="font-size:10px;color:#6b7280">' + hint + '</div>' +
  '</div>';
}

function statBox(label, value) {
  return '<div style="background:#111;border:1px solid #1f2937;border-radius:6px;padding:10px;text-align:center">' +
    '<div style="font-size:18px;font-weight:700;color:#e5e7eb">' + value + '</div>' +
    '<div style="font-size:11px;color:#6b7280;margin-top:2px">' + label + '</div>' +
  '</div>';
}

async function uploadConversation() {
  const filename = el('conv-filename').value.trim();
  const content = el('conv-content').value.trim();
  if (!filename || !content) { toast('Filename and content required', 'error'); return; }
  try {
    const r = await api('/warmup/upload', { method: 'POST', body: JSON.stringify({ filename: filename, content: content }) });
    toast('Scheduled ' + r.scheduled_emails + ' emails from ' + r.filename, 'success');
    el('conv-result').innerHTML = '<div style="color:#22c55e;font-size:13px">✓ Scheduled ' + r.scheduled_emails + ' emails from <strong>' + r.filename + '</strong></div>';
    el('conv-filename').value = '';
    el('conv-content').value = '';
    loadConversations();
  } catch(e) {
    el('conv-result').innerHTML = '<div style="color:#ef4444;font-size:13px">' + e.message + '</div>';
    toast(e.message, 'error');
  }
}
