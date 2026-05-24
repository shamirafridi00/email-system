// ─── Blacklist Management ─────────────────────────────────────────────────────

var blacklistState = {
  currentPage: 1,
  pageSize: 50,
  totalCount: 0,
  entries: [],
  filters: { type: '', search: '', active: '1' },
};

async function loadBlacklist() {
  try {
    var [stats] = await Promise.all([api('/dashboard/blacklist/stats')]);
    el('bl-stat-total').textContent = stats.total;
    el('bl-stat-emails').textContent = stats.email_count;
    el('bl-stat-domains').textContent = stats.domain_count;
    el('bl-stat-auto').textContent = stats.auto_added;
    await fetchBlacklistPage();
  } catch(e) { toast(e.message, 'error'); }
}

async function fetchBlacklistPage() {
  var f = blacklistState.filters;
  var offset = (blacklistState.currentPage - 1) * blacklistState.pageSize;
  var params = new URLSearchParams({
    limit: blacklistState.pageSize,
    offset: offset,
    active: f.active,
  });
  if (f.type) params.set('type', f.type);
  if (f.search) params.set('search', f.search);

  try {
    var data = await api('/dashboard/blacklist?' + params.toString());
    blacklistState.entries = data.rows;
    blacklistState.totalCount = data.total;
    renderBlacklistTable(data.rows);
    renderBlacklistPagination();
  } catch(e) { toast(e.message, 'error'); }
}

function renderBlacklistTable(rows) {
  if (!rows || !rows.length) {
    el('bl-table').innerHTML = '<div class="no-data">No entries</div>';
    return;
  }

  var html = '<table><thead><tr>' +
    '<th>Type</th><th>Value</th><th>Reason</th><th>Added By</th><th>Added At</th><th>Actions</th>' +
    '</tr></thead><tbody>';

  html += rows.map(function(r) {
    var isSystemSeed = r.added_by === 'system-seed';
    var isDeactivated = r.active === 0;
    var rowStyle = isDeactivated ? 'opacity:0.45;' : '';

    var typeBadge = r.type === 'email'
      ? '<span style="background:#312e81;color:#a5b4fc;border-radius:4px;font-size:11px;padding:2px 7px;font-weight:600">Email</span>'
      : '<span style="background:#3b0764;color:#d8b4fe;border-radius:4px;font-size:11px;padding:2px 7px;font-weight:600">Domain</span>';

    var addedByBadge = addedByLabel(r.added_by);
    var valueCell = '<span style="font-family:monospace;font-size:12px">' + escHtml(r.value) + '</span>';
    if (isSystemSeed) valueCell = '🔒 ' + valueCell;

    var actions = '';
    if (!isDeactivated) {
      actions += '<button class="btn btn-ghost btn-sm" style="color:#f59e0b;border-color:#f59e0b" onclick="deactivateEntry(' + r.id + ')">Deactivate</button>';
    } else {
      actions += '<button class="btn btn-ghost btn-sm" style="color:#22c55e;border-color:#22c55e" onclick="restoreEntry(' + r.id + ')">Restore</button>';
    }
    if (!isSystemSeed) {
      actions += ' <button class="btn btn-danger btn-sm" onclick="permanentDeleteEntry(' + r.id + ')">Delete</button>';
    }

    return '<tr style="' + rowStyle + '">' +
      '<td>' + typeBadge + '</td>' +
      '<td>' + valueCell + '</td>' +
      '<td style="font-size:12px;color:#9ca3af">' + escHtml(r.reason || '—') + '</td>' +
      '<td>' + addedByBadge + '</td>' +
      '<td style="font-size:12px;color:#6b7280">' + (r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '—') + '</td>' +
      '<td style="display:flex;gap:6px">' + actions + '</td>' +
      '</tr>';
  }).join('');

  html += '</tbody></table>';
  el('bl-table').innerHTML = html;
}

function addedByLabel(addedBy) {
  switch (addedBy) {
    case 'manual': return '<span style="background:#1f2937;color:#9ca3af;border-radius:4px;font-size:11px;padding:2px 7px">Manual</span>';
    case 'auto-bounce': return '<span style="background:#431407;color:#fb923c;border-radius:4px;font-size:11px;padding:2px 7px">Auto-bounce</span>';
    case 'auto-unsubscribe': return '<span style="background:#422006;color:#fbbf24;border-radius:4px;font-size:11px;padding:2px 7px">Auto-unsub</span>';
    case 'system-seed': return '<span style="background:#1e3a5f;color:#60a5fa;border-radius:4px;font-size:11px;padding:2px 7px">System</span>';
    default: return '<span style="background:#1f2937;color:#9ca3af;border-radius:4px;font-size:11px;padding:2px 7px">' + escHtml(addedBy) + '</span>';
  }
}

function renderBlacklistPagination() {
  var total = blacklistState.totalCount;
  var page = blacklistState.currentPage;
  var pageSize = blacklistState.pageSize;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  el('bl-page-indicator').textContent = 'Page ' + page + ' of ' + totalPages + ' (' + total + ' entries)';
  el('bl-prev-btn').disabled = page <= 1;
  el('bl-next-btn').disabled = page >= totalPages;
}

async function checkBlacklistEmail() {
  var email = el('bl-check-input').value.trim();
  if (!email) return;
  try {
    var r = await api('/dashboard/blacklist/check?email=' + encodeURIComponent(email));
    var resultEl = el('bl-check-result');
    if (r.blacklisted) {
      resultEl.innerHTML = '<span style="color:#ef4444;font-weight:600">🚫 Blacklisted</span>' +
        ' — <span style="color:#9ca3af">' + escHtml(r.reason) + '</span>' +
        ' <span style="background:#3b0764;color:#d8b4fe;border-radius:4px;font-size:11px;padding:1px 6px">' + escHtml(r.matched_value) + '</span>';
    } else {
      resultEl.innerHTML = '<span style="color:#22c55e;font-weight:600">✓ Not Blacklisted</span>';
    }
  } catch(e) { toast(e.message, 'error'); }
}

async function addToBlacklistUI() {
  var type = el('bl-add-type').value;
  var value = el('bl-add-value').value.trim();
  var reason = el('bl-add-reason').value.trim();
  if (!value) { toast('Value is required', 'error'); return; }
  try {
    var r = await api('/dashboard/blacklist', {
      method: 'POST',
      body: JSON.stringify({ type, value, reason: reason || undefined }),
    });
    el('bl-add-value').value = '';
    el('bl-add-reason').value = '';
    toast(r.is_new ? '✓ Added to blacklist' : 'Already existed in blacklist', r.is_new ? 'success' : 'info');
    loadBlacklist();
  } catch(e) { toast(e.message, 'error'); }
}

async function bulkImportBlacklist() {
  var csv = el('bl-bulk-csv').value.trim();
  if (!csv) { toast('Paste CSV first', 'error'); return; }
  try {
    var r = await api('/dashboard/blacklist/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
    el('bl-bulk-result').innerHTML =
      '<div style="font-size:13px;padding:10px 12px;border-radius:6px;border:1px solid #333;background:#111">' +
      '<span style="color:#22c55e">✓ Added: ' + r.added + '</span>  ' +
      '<span style="color:#9ca3af">Skipped (already exists): ' + r.skipped + '</span>  ' +
      (r.errors > 0 ? '<span style="color:#ef4444">Errors: ' + r.errors + '</span>' : '') +
      '</div>';
    if (r.added > 0) loadBlacklist();
  } catch(e) { toast(e.message, 'error'); }
}

async function deactivateEntry(id) {
  try {
    await api('/dashboard/blacklist/' + id, { method: 'DELETE' });
    toast('Entry deactivated', 'success');
    loadBlacklist();
  } catch(e) { toast(e.message, 'error'); }
}

async function restoreEntry(id) {
  try {
    await api('/dashboard/blacklist/' + id + '/restore', { method: 'PUT' });
    toast('Entry restored', 'success');
    loadBlacklist();
  } catch(e) { toast(e.message, 'error'); }
}

async function permanentDeleteEntry(id) {
  if (!confirm('Permanently delete this blacklist entry? This cannot be undone.')) return;
  try {
    await api('/dashboard/blacklist/' + id + '/permanent', { method: 'DELETE' });
    toast('Entry permanently deleted', 'success');
    loadBlacklist();
  } catch(e) { toast(e.message, 'error'); }
}

function filterBlacklist() {
  blacklistState.filters.type = el('bl-filter-type').value;
  blacklistState.filters.search = el('bl-filter-search').value.trim();
  var showDeactivated = el('bl-show-deactivated').checked;
  blacklistState.filters.active = showDeactivated ? 'all' : '1';
  blacklistState.currentPage = 1;
  fetchBlacklistPage();
}

function paginateBlacklist(dir) {
  var totalPages = Math.max(1, Math.ceil(blacklistState.totalCount / blacklistState.pageSize));
  blacklistState.currentPage = Math.max(1, Math.min(totalPages, blacklistState.currentPage + dir));
  fetchBlacklistPage();
}

function exportBlacklistCSV() {
  var rows = blacklistState.entries;
  if (!rows.length) { toast('No data to export', 'error'); return; }
  var header = 'type,value,reason,added_by,active,created_at';
  var lines = rows.map(function(r) {
    return [r.type, r.value, r.reason || '', r.added_by, r.active, r.created_at || ''].join(',');
  });
  var csv = [header].concat(lines).join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'blacklist_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}
