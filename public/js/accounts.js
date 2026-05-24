// ─── Accounts ────────────────────────────────────────────────────────────────
var _bounceStats = {}; // keyed by account email

async function loadAccounts() {
  try {
    var [accounts, bounceStats] = await Promise.all([
      api('/accounts'),
      api('/dashboard/bounce-stats').catch(function() { return []; }),
    ]);
    state.accounts = accounts;
    _bounceStats = {};
    bounceStats.forEach(function(s) { _bounceStats[s.email] = s; });
    renderAccounts(state.accounts);
  } catch(e) { toast(e.message, 'error'); }
}

function bounceRateBadge(email) {
  var s = _bounceStats[email];
  if (!s) return '<span style="font-size:11px;color:#6b7280">—</span>';
  var rate = s.bounce_rate_7d;
  if (rate === -1) return '<span style="font-size:11px;color:#6b7280" title="Fewer than 10 emails sent">N/A</span>';
  var color = rate > 10 ? '#dc2626' : rate > 5 ? '#d97706' : '#22c55e';
  var icon = rate > 10 ? ' ⚠' : rate > 5 ? ' ⚡' : '';
  return '<span style="font-size:12px;font-weight:700;color:' + color + '" title="7-day bounce rate (' + s.bounced_7d + '/' + s.total_7d + ')">' + rate.toFixed(1) + '%' + icon + '</span>';
}

function renderAccounts(rows) {
  el('accounts-table').innerHTML = rows.length
    ? '<table><thead><tr>' +
      '<th onclick="sortAccounts(\'email\')">Email' + sortIcon('accounts', 'email') + '</th>' +
      '<th>Domain</th>' +
      '<th onclick="sortAccounts(\'daily_limit\')">Daily Limit' + sortIcon('accounts', 'daily_limit') + '</th>' +
      '<th>Sent Today</th>' +
      '<th>Bounce Rate (7d)</th>' +
      '<th onclick="sortAccounts(\'status\')">Status' + sortIcon('accounts', 'status') + '</th>' +
      '<th></th>' +
      '</tr></thead><tbody>' +
      rows.map(function(r) {
        const pct = Math.min(100, Math.round((r.emails_sent_today / r.daily_limit) * 100)) || 0;
        const statusOptions = ['warming', 'ready', 'paused', 'flagged'].map(function(s) {
          return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
        }).join('');
        return '<tr>' +
          '<td>' + r.email + '</td>' +
          '<td>' + (r.domain || '—') + '</td>' +
          '<td>' + r.daily_limit + '</td>' +
          '<td><div style="display:flex;align-items:center;gap:8px">' +
            '<div class="progress" style="width:70px"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
            '<span style="font-size:12px;color:#888">' + r.emails_sent_today + '/' + r.daily_limit + '</span>' +
          '</div></td>' +
          '<td>' + bounceRateBadge(r.email) + '</td>' +
          '<td>' + statusBadge(r.status) + '</td>' +
          '<td style="display:flex;gap:6px">' +
            '<select onchange="updateAccountStatus(' + r.id + ',this.value)" style="width:100px;padding:4px 6px;font-size:12px">' + statusOptions + '</select>' +
            '<button class="btn btn-ghost btn-sm" onclick="showBounceHistory(' + r.id + ',\'' + escHtml(r.email) + '\')" title="Bounce History">Bounces</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="checkAccountDNS(\'' + escHtml(r.email) + '\')" title="Check DNS">DNS</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteAccount(' + r.id + ')">✕</button>' +
          '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>'
    : '<div class="no-data">No sending accounts yet</div>';
}

function sortAccounts(key) {
  state.accounts = sortTable(state.accounts, key, 'accounts');
  renderAccounts(state.accounts);
}

async function addAccount() {
  const body = {
    email: el('acc-email').value.trim(),
    app_password: el('acc-pass').value.trim(),
    domain: el('acc-domain').value.trim(),
    daily_limit: parseInt(el('acc-limit').value) || 20,
  };
  if (!body.email || !body.app_password) { toast('Email and password required', 'error'); return; }
  try {
    await api('/accounts', { method: 'POST', body: JSON.stringify(body) });
    toast('Account added', 'success');
    el('acc-email').value = '';
    el('acc-pass').value = '';
    el('acc-domain').value = '';
    loadAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

async function updateAccountStatus(id, status) {
  try {
    await api('/accounts/' + id, { method: 'PUT', body: JSON.stringify({ status: status }) });
    toast('Status → ' + status, 'success');
    loadAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteAccount(id) {
  if (!confirm('Delete this account?')) return;
  try {
    await api('/accounts/' + id, { method: 'DELETE' });
    toast('Account deleted', 'success');
    loadAccounts();
  } catch(e) { toast(e.message, 'error'); }
}

function checkAccountDNS(email) {
  const domain = email.split('@')[1];
  if (!domain) return;
  navigate('dns-checker');
  // Give the section a tick to render before filling + running
  setTimeout(function() {
    el('dns-domain-input').value = domain;
    runDNSCheck();
  }, 50);
}

// ─── Bounce History Modal ─────────────────────────────────────────────────────
async function showBounceHistory(accountId, email) {
  var modal = el('bounce-history-modal');
  if (!modal) return;
  el('bounce-history-email').textContent = email;
  el('bounce-history-body').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  modal.style.display = 'flex';

  try {
    var [history, statusHistory] = await Promise.all([
      api('/accounts/' + accountId + '/bounce-history'),
      api('/accounts/' + accountId + '/status-history'),
    ]);

    var s = _bounceStats[email];
    var statsHtml = '';
    if (s) {
      var r7 = s.bounce_rate_7d === -1 ? 'N/A' : s.bounce_rate_7d.toFixed(1) + '%';
      var r30 = s.bounce_rate_30d === -1 ? 'N/A' : s.bounce_rate_30d.toFixed(1) + '%';
      statsHtml = '<div style="display:flex;gap:16px;margin-bottom:16px">' +
        '<div class="stat-card" style="flex:1;padding:12px">' +
          '<div class="label">7-Day Bounce Rate</div>' +
          '<div class="value ' + (s.bounce_rate_7d > 10 ? 'red' : s.bounce_rate_7d > 5 ? '' : 'green') + '">' + r7 + '</div>' +
          '<div style="font-size:11px;color:#6b7280">' + s.bounced_7d + ' of ' + s.total_7d + ' sent</div>' +
        '</div>' +
        '<div class="stat-card" style="flex:1;padding:12px">' +
          '<div class="label">30-Day Bounce Rate</div>' +
          '<div class="value ' + (s.bounce_rate_30d > 10 ? 'red' : s.bounce_rate_30d > 5 ? '' : 'green') + '">' + r30 + '</div>' +
          '<div style="font-size:11px;color:#6b7280">' + s.bounced_30d + ' of ' + s.total_30d + ' sent</div>' +
        '</div>' +
      '</div>';
    }

    var statusHtml = '';
    if (statusHistory.length) {
      statusHtml = '<h3 style="font-size:13px;font-weight:700;color:#e5e7eb;margin:16px 0 8px">Status History</h3>' +
        '<table><thead><tr><th>From</th><th>To</th><th>Reason</th><th>When</th></tr></thead><tbody>' +
        statusHistory.map(function(h) {
          return '<tr>' +
            '<td>' + statusBadge(h.previous_status) + '</td>' +
            '<td>' + statusBadge(h.new_status) + '</td>' +
            '<td style="font-size:11px;color:#9ca3af;max-width:220px">' + escHtml(h.reason || '—') + '</td>' +
            '<td style="white-space:nowrap;font-size:11px">' + formatTime(h.changed_at) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    var bouncedHtml = history.length
      ? '<h3 style="font-size:13px;font-weight:700;color:#e5e7eb;margin:16px 0 8px">Recent Bounced Emails (last 50)</h3>' +
        '<table><thead><tr><th>Step</th><th>Subject</th><th>Campaign</th><th>Sent</th></tr></thead><tbody>' +
        history.map(function(h) {
          return '<tr>' +
            '<td style="text-align:center">' + h.step_number + '</td>' +
            '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">' + escHtml(h.subject || '—') + '</td>' +
            '<td style="font-size:11px;color:#9ca3af">#' + h.campaign_id + '</td>' +
            '<td style="white-space:nowrap;font-size:11px">' + formatTime(h.sent_at) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>'
      : '<div class="no-data" style="margin-top:16px">No bounced emails recorded for this account</div>';

    el('bounce-history-body').innerHTML = statsHtml + statusHtml + bouncedHtml;
  } catch(e) {
    el('bounce-history-body').innerHTML = '<div class="loading" style="color:#ef4444">' + e.message + '</div>';
  }
}

function closeBounceHistory() {
  var modal = el('bounce-history-modal');
  if (modal) modal.style.display = 'none';
}

async function runBounceCheck() {
  var btn = el('bounce-check-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    var r = await api('/dashboard/bounce-check', { method: 'POST' });
    toast('Bounce check done — ' + r.checked + ' accounts checked, ' + r.warned + ' warned, ' + r.paused + ' paused', r.paused > 0 ? 'error' : 'success');
    loadAccounts();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Run Bounce Check'; }
  }
}
