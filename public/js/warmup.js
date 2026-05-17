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
    el('warmup-accounts-table').innerHTML = rows.length
      ? '<table><thead><tr><th>Email</th><th>Vol/Day</th><th>Active</th><th>Last Active</th><th></th></tr></thead><tbody>' +
        rows.map(function(r) {
          return '<tr>' +
            '<td>' + r.email + '</td>' +
            '<td>' + r.daily_volume + '</td>' +
            '<td>' +
              '<button class="btn btn-sm ' + (r.active ? 'btn-primary' : 'btn-ghost') + '" ' +
                'onclick="toggleWarmupAccount(' + r.id + ',' + r.active + ')" ' +
                'style="min-width:70px">' +
                (r.active ? '● Active' : '■ Paused') +
              '</button>' +
            '</td>' +
            '<td style="color:' + (r.last_active ? '#888' : '#555') + ';white-space:nowrap">' + (r.last_active ? formatTime(r.last_active) : 'Never') + '</td>' +
            '<td><button class="btn btn-danger btn-sm" onclick="deleteWarmupAccount(' + r.id + ')">Delete</button></td>' +
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
