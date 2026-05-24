// ─── Error Log ────────────────────────────────────────────────────────────────

var errorLogState = {
  currentPage: 1,
  pageSize: 20,
  totalCount: 0,
  errors: [],
  filters: { severity: '', error_type: '', resolved: '0' },
  expandedIds: new Set(),
};

var errorAutoRefreshInterval = null;

var SEVERITY_BADGE = {
  critical: '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#7f1d1d;color:#fff">CRITICAL</span>',
  error:    '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#9a3412;color:#fff">ERROR</span>',
  warning:  '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#92400e;color:#1c1400">WARNING</span>',
  info:     '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#1f2937;color:#d1d5db">INFO</span>',
};

var TYPE_BADGE_COLOR = {
  smtp:      '#4338ca',
  imap:      '#7c3aed',
  hubspot:   '#b45309',
  scheduler: '#dc2626',
  warmup:    '#16a34a',
  campaign:  '#2563eb',
  system:    '#4b5563',
};

function errorTypeBadge(type) {
  var color = TYPE_BADGE_COLOR[type] || '#4b5563';
  return '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:' + color + ';color:#fff">' + (type || '?').toUpperCase() + '</span>';
}

function relativeTime(ts) {
  if (!ts) return '—';
  var diff = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.round(diff / 60) + 'm ago';
  if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
  return Math.round(diff / 86400) + 'd ago';
}

function parseContext(contextStr) {
  if (!contextStr) return null;
  try { return JSON.parse(contextStr); } catch { return null; }
}

function contextSummary(contextStr) {
  var ctx = parseContext(contextStr);
  if (!ctx) return '—';
  var parts = [];
  if (ctx.account_email) parts.push(ctx.account_email);
  else if (ctx.from_email) parts.push(ctx.from_email);
  else if (ctx.email) parts.push(ctx.email);
  if (ctx.lead_id) parts.push('lead:' + ctx.lead_id);
  return parts.length ? escHtml(parts.join(' · ')) : '—';
}

function renderErrorRow(err) {
  var shortMsg = err.message && err.message.length > 80
    ? err.message.slice(0, 80) + '…'
    : (err.message || '');
  var expanded = errorLogState.expandedIds.has(err.id);

  var row = '<tr id="err-row-' + err.id + '" style="border-bottom:1px solid #1f2937">' +
    '<td style="padding:8px 10px;vertical-align:top">' + (SEVERITY_BADGE[err.severity] || SEVERITY_BADGE.info) + '</td>' +
    '<td style="padding:8px 10px;vertical-align:top">' + errorTypeBadge(err.error_type) + '</td>' +
    '<td style="padding:8px 10px;vertical-align:top;font-size:12px;color:#e5e7eb;max-width:320px" title="' + escHtml(err.message || '') + '">' + escHtml(shortMsg) + '</td>' +
    '<td style="padding:8px 10px;vertical-align:top;font-size:11px;color:#6b7280;white-space:nowrap">' + relativeTime(err.created_at) + '</td>' +
    '<td style="padding:8px 10px;vertical-align:top;font-size:11px;color:#9ca3af">' + contextSummary(err.context) + '</td>' +
    '<td style="padding:8px 10px;vertical-align:top;white-space:nowrap">' +
      '<button onclick="toggleErrorExpand(' + err.id + ')" style="background:#1a2332;color:#9ca3af;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;margin-right:4px">' + (expanded ? '▲' : '▼') + '</button>' +
      (err.resolved ? '<span style="font-size:11px;color:#4ade80">✓ Resolved</span>' : '<button onclick="resolveError(' + err.id + ')" style="background:#052e16;color:#4ade80;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px">✓ Resolve</button>') +
    '</td>' +
  '</tr>';

  if (expanded) {
    var ctx = parseContext(err.context);
    row += '<tr id="err-expand-' + err.id + '" style="background:#0a1520;border-bottom:1px solid #1f2937"><td colspan="6" style="padding:12px 16px">' +
      '<div style="font-size:12px;color:#e5e7eb;margin-bottom:8px;font-weight:600">Full Message</div>' +
      '<div style="font-size:12px;color:#9ca3af;margin-bottom:12px;line-height:1.6">' + escHtml(err.message || '') + '</div>' +
      (err.stack_trace
        ? '<div style="font-size:12px;color:#e5e7eb;margin-bottom:6px;font-weight:600">Stack Trace</div><pre style="font-size:10px;color:#6ee7b7;background:#0f1a27;padding:10px;border-radius:6px;overflow:auto;max-height:200px;margin:0 0 12px;white-space:pre-wrap">' + escHtml(err.stack_trace) + '</pre>'
        : '') +
      (ctx
        ? '<div style="font-size:12px;color:#e5e7eb;margin-bottom:6px;font-weight:600">Context</div><pre style="font-size:10px;color:#93c5fd;background:#0f1a27;padding:10px;border-radius:6px;overflow:auto;max-height:150px;margin:0 0 12px;white-space:pre-wrap">' + escHtml(JSON.stringify(ctx, null, 2)) + '</pre>'
        : '') +
      '<div style="font-size:11px;color:#6b7280">Recorded: ' + (err.created_at || '').replace('T', ' ').slice(0, 19) + ' · Status: ' + (err.resolved ? 'Resolved' : 'Unresolved') + '</div>' +
    '</td></tr>';
  }

  return row;
}

function renderErrorTable() {
  var tbody = document.getElementById('error-log-table');
  if (!tbody) return;

  if (!errorLogState.errors.length) {
    var filtersActive = errorLogState.filters.severity || errorLogState.filters.error_type || errorLogState.filters.resolved === '1';
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px">' +
      '<div style="font-size:28px;margin-bottom:8px">✅</div>' +
      '<div style="font-size:15px;font-weight:700;color:#4ade80;margin-bottom:4px">' + (filtersActive ? 'No errors matching current filters' : 'No errors found') + '</div>' +
      '<div style="font-size:12px;color:#6b7280">' + (filtersActive ? '' : 'All systems running smoothly') + '</div>' +
      (filtersActive ? '<button class="btn btn-ghost btn-sm" onclick="clearErrorFilters()" style="margin-top:12px">Clear Filters</button>' : '') +
    '</td></tr>';
    return;
  }

  tbody.innerHTML = errorLogState.errors.map(renderErrorRow).join('');
}

function renderErrorPagination() {
  var el2 = document.getElementById('error-log-pagination');
  if (!el2) return;
  var totalPages = Math.max(1, Math.ceil(errorLogState.totalCount / errorLogState.pageSize));
  var page = errorLogState.currentPage;
  el2.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
      '<div style="font-size:12px;color:#6b7280">Showing ' + ((page - 1) * errorLogState.pageSize + 1) + '–' + Math.min(page * errorLogState.pageSize, errorLogState.totalCount) + ' of ' + errorLogState.totalCount + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<button class="btn btn-ghost btn-sm" onclick="paginateErrors(-1)"' + (page <= 1 ? ' disabled' : '') + '>← Prev</button>' +
        '<span style="font-size:12px;color:#9ca3af">Page ' + page + ' of ' + totalPages + '</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="paginateErrors(1)"' + (page >= totalPages ? ' disabled' : '') + '>Next →</button>' +
      '</div>' +
    '</div>';
}

function updateErrorStats(stats) {
  var map = { critical: 'err-stat-critical', error: 'err-stat-error', warning: 'err-stat-warning', info: 'err-stat-info' };
  Object.keys(map).forEach(function(sev) {
    var el2 = document.getElementById(map[sev]);
    if (el2) el2.textContent = stats[sev + '_count'] ?? 0;
  });
  var totalEl = document.getElementById('err-stat-total');
  if (totalEl) totalEl.textContent = stats.total_unresolved ?? 0;
}

function updateLastCheckedTime() {
  var el2 = document.getElementById('error-log-last-updated');
  if (el2) el2.textContent = new Date().toLocaleTimeString();
}

async function loadErrorLog() {
  var offset = (errorLogState.currentPage - 1) * errorLogState.pageSize;
  var params = new URLSearchParams({
    limit: String(errorLogState.pageSize),
    offset: String(offset),
    resolved: errorLogState.filters.resolved,
  });
  if (errorLogState.filters.severity) params.set('severity', errorLogState.filters.severity);
  if (errorLogState.filters.error_type) params.set('error_type', errorLogState.filters.error_type);

  try {
    var [statsData, errData] = await Promise.all([
      api('/dashboard/errors/stats'),
      api('/dashboard/errors?' + params.toString()),
    ]);
    updateErrorStats(statsData);
    errorLogState.errors = errData.errors || [];
    errorLogState.totalCount = errData.total || 0;
    renderErrorTable();
    renderErrorPagination();
    updateLastCheckedTime();
  } catch(e) {
    var tbody = document.getElementById('error-log-table');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="color:#f87171;padding:20px;text-align:center">Failed to load errors: ' + escHtml(e.message) + '</td></tr>';
  }
}

function toggleErrorExpand(id) {
  if (errorLogState.expandedIds.has(id)) {
    errorLogState.expandedIds.delete(id);
  } else {
    errorLogState.expandedIds.add(id);
  }
  renderErrorTable();
}

async function resolveError(id) {
  try {
    await api('/dashboard/errors/' + id + '/resolve', { method: 'PUT' });
    errorLogState.errors = errorLogState.errors.filter(function(e) { return e.id !== id; });
    errorLogState.totalCount = Math.max(0, errorLogState.totalCount - 1);
    renderErrorTable();
    renderErrorPagination();
    updateErrorBadge();
    // Refresh stats
    var stats = await api('/dashboard/errors/stats');
    updateErrorStats(stats);
    toast('Error marked as resolved', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function resolveAllErrors() {
  var params = new URLSearchParams();
  if (errorLogState.filters.severity) params.set('severity', errorLogState.filters.severity);
  if (errorLogState.filters.error_type) params.set('error_type', errorLogState.filters.error_type);
  try {
    var r = await api('/dashboard/errors/resolve-all?' + params.toString(), { method: 'PUT' });
    toast('Resolved ' + r.resolved + ' error(s)', 'success');
    errorLogState.currentPage = 1;
    await loadErrorLog();
    updateErrorBadge();
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function clearResolvedErrorsUI() {
  if (!confirm('Delete all resolved errors? This cannot be undone.')) return;
  try {
    var r = await api('/dashboard/errors/clear-resolved', { method: 'DELETE' });
    toast('Cleared ' + r.deleted + ' resolved error(s)', 'success');
    await loadErrorLog();
  } catch(e) {
    toast(e.message, 'error');
  }
}

function filterErrors() {
  var sevEl = document.getElementById('err-filter-severity');
  var typeEl = document.getElementById('err-filter-type');
  var resolvedEl = document.getElementById('err-filter-resolved');
  errorLogState.filters.severity = sevEl ? sevEl.value : '';
  errorLogState.filters.error_type = typeEl ? typeEl.value : '';
  errorLogState.filters.resolved = (resolvedEl && resolvedEl.checked) ? '1' : '0';
  errorLogState.currentPage = 1;
  loadErrorLog();
}

function filterBySeverity(sev) {
  var el2 = document.getElementById('err-filter-severity');
  if (el2) { el2.value = sev; filterErrors(); }
}

function clearErrorFilters() {
  var sevEl = document.getElementById('err-filter-severity');
  var typeEl = document.getElementById('err-filter-type');
  var resolvedEl = document.getElementById('err-filter-resolved');
  if (sevEl) sevEl.value = '';
  if (typeEl) typeEl.value = '';
  if (resolvedEl) resolvedEl.checked = false;
  errorLogState.filters = { severity: '', error_type: '', resolved: '0' };
  errorLogState.currentPage = 1;
  loadErrorLog();
}

function paginateErrors(dir) {
  var totalPages = Math.ceil(errorLogState.totalCount / errorLogState.pageSize);
  errorLogState.currentPage = Math.max(1, Math.min(totalPages, errorLogState.currentPage + dir));
  loadErrorLog();
}

async function updateErrorBadge() {
  var badge = document.getElementById('error-log-badge');
  if (!badge) return;
  try {
    var stats = await api('/dashboard/errors/stats');
    var count = (stats.critical_count || 0) + (stats.error_count || 0);
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch {
    badge.style.display = 'none';
  }
}

function startErrorAutoRefresh() {
  if (errorAutoRefreshInterval) return;
  errorAutoRefreshInterval = setInterval(loadErrorLog, 2 * 60 * 1000);
}

function stopErrorAutoRefresh() {
  if (errorAutoRefreshInterval) { clearInterval(errorAutoRefreshInterval); errorAutoRefreshInterval = null; }
}
