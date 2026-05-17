// ─── Accounts ────────────────────────────────────────────────────────────────
async function loadAccounts() {
  try {
    state.accounts = await api('/accounts');
    renderAccounts(state.accounts);
  } catch(e) { toast(e.message, 'error'); }
}

function renderAccounts(rows) {
  el('accounts-table').innerHTML = rows.length
    ? '<table><thead><tr>' +
      '<th onclick="sortAccounts(\'email\')">Email' + sortIcon('accounts', 'email') + '</th>' +
      '<th>Domain</th>' +
      '<th onclick="sortAccounts(\'daily_limit\')">Daily Limit' + sortIcon('accounts', 'daily_limit') + '</th>' +
      '<th>Sent Today</th>' +
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
          '<td>' + statusBadge(r.status) + '</td>' +
          '<td style="display:flex;gap:6px">' +
            '<select onchange="updateAccountStatus(' + r.id + ',this.value)" style="width:100px;padding:4px 6px;font-size:12px">' + statusOptions + '</select>' +
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
