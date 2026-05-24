// ─── Exports ─────────────────────────────────────────────────────────────────
var exportsState = {
  exportHistory: [],
  campaignsList: [],
};

async function loadExports() {
  try {
    var [campaigns, stats] = await Promise.all([
      api('/campaigns'),
      api('/leads/stats'),
    ]);
    exportsState.campaignsList = campaigns;
    populateCampaignDropdowns(campaigns);

    // Show lead count hints
    var total = Object.values(stats).reduce(function(a, b) { return a + b; }, 0);
    var hint = el('exp-leads-hint');
    if (hint) {
      hint.textContent = total + ' total leads (' +
        (stats.active || 0) + ' active, ' +
        (stats.replied || 0) + ' replied, ' +
        (stats.finished || 0) + ' finished)';
    }

    // Populate warmup conversation_id dropdown
    loadConversationIds();
  } catch(e) { toast(e.message, 'error'); }
}

function populateCampaignDropdowns(campaigns) {
  ['exp-leads-campaign', 'exp-sent-campaign'].forEach(function(id) {
    var el2 = el(id);
    if (!el2) return;
    el2.innerHTML = '<option value="">All Campaigns</option>' +
      campaigns.map(function(c) {
        return '<option value="' + c.id + '">' + escHtml(c.name) + '</option>';
      }).join('');
  });
}

async function loadConversationIds() {
  try {
    // Get distinct conversation_ids from the warmup log via a quick fetch
    var resp = await fetch('/dashboard/export/warmup-log?limit=5000', { headers: { 'Authorization': 'Bearer ' + (state.token || '') } });
    // We can't easily query distinct IDs without a dedicated endpoint,
    // so we'll just leave the dropdown as a free-text field — already handled in HTML
  } catch(e) { /* non-critical */ }
}

async function downloadExport(exportType, params, btnId) {
  var btn = btnId ? el(btnId) : null;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing…'; }

  var url = '/dashboard/export/' + exportType;
  var qs = Object.entries(params || {})
    .filter(function(e) { return e[1] !== '' && e[1] !== null && e[1] !== undefined; })
    .map(function(e) { return encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]); })
    .join('&');
  if (qs) url += '?' + qs;

  var rowCount = null;
  try {
    var headers = {};
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    var resp = await fetch(url, { headers: headers });
    if (!resp.ok) {
      var errText = await resp.text();
      throw new Error(errText || 'Export failed (' + resp.status + ')');
    }
    var text = await resp.text();
    // Count rows (lines minus header)
    rowCount = Math.max(0, text.trim().split('\n').length - 1);

    var blob = new Blob([text], { type: 'text/csv' });
    var blobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    // Extract filename from Content-Disposition if present
    var cd = resp.headers.get('Content-Disposition') || '';
    var fnMatch = cd.match(/filename="([^"]+)"/);
    a.download = fnMatch ? fnMatch[1] : exportType + '_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    toast('✓ File downloaded successfully (' + rowCount + ' rows)', 'success');

    // Record in history
    exportsState.exportHistory.unshift({
      type: exportType,
      filters: Object.entries(params || {}).filter(function(e) { return e[1]; }).map(function(e) { return e[0] + '=' + e[1]; }).join(', ') || '—',
      downloadedAt: new Date().toLocaleTimeString(),
      rowCount: rowCount,
    });
    if (exportsState.exportHistory.length > 10) exportsState.exportHistory.pop();
    renderExportHistory();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⬇ Download CSV';
    }
  }
}

function downloadLeads() {
  downloadExport('leads', {
    campaign_id: el('exp-leads-campaign') ? el('exp-leads-campaign').value : '',
    status: el('exp-leads-status') ? el('exp-leads-status').value : '',
  }, 'exp-leads-btn');
}

function downloadSentLog() {
  downloadExport('sent-log', {
    campaign_id: el('exp-sent-campaign') ? el('exp-sent-campaign').value : '',
    date_from: el('exp-sent-from') ? el('exp-sent-from').value : '',
    date_to: el('exp-sent-to') ? el('exp-sent-to').value : '',
    limit: el('exp-sent-limit') ? el('exp-sent-limit').value : '1000',
  }, 'exp-sent-btn');
}

function downloadWarmupLog() {
  downloadExport('warmup-log', {
    date_from: el('exp-warmup-from') ? el('exp-warmup-from').value : '',
    date_to: el('exp-warmup-to') ? el('exp-warmup-to').value : '',
    conversation_id: el('exp-warmup-conv') ? el('exp-warmup-conv').value : '',
    limit: '1000',
  }, 'exp-warmup-btn');
}

function downloadReplies() {
  downloadExport('replies', {}, 'exp-replies-btn');
}

function downloadAnalytics() {
  downloadExport('analytics', {
    days: el('exp-analytics-days') ? el('exp-analytics-days').value : '30',
  }, 'exp-analytics-btn');
}

// Quick export shortcuts
function quickExportAllLeads()      { downloadExport('leads', {}, 'qe-all-leads'); }
function quickExportActiveLeads()   { downloadExport('leads', { status: 'active' }, 'qe-active-leads'); }
function quickExportRepliedLeads()  { downloadExport('leads', { status: 'replied' }, 'qe-replied-leads'); }
function quickExportRecentSentLog() {
  var from = new Date();
  from.setDate(from.getDate() - 30);
  downloadExport('sent-log', { date_from: from.toISOString().split('T')[0], limit: '1000' }, 'qe-recent-sent');
}

function renderExportHistory() {
  var wrap = el('exp-history-table');
  if (!wrap) return;
  var history = exportsState.exportHistory;
  if (!history.length) {
    wrap.innerHTML = '<div style="color:#6b7280;text-align:center;padding:16px;font-size:13px">No exports yet this session</div>';
    return;
  }
  wrap.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr style="border-bottom:1px solid #333">' +
    '<th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600">Export Type</th>' +
    '<th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600">Filters</th>' +
    '<th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600">Downloaded At</th>' +
    '<th style="text-align:right;padding:8px 10px;color:#6b7280;font-weight:600">Rows</th>' +
    '</tr></thead><tbody>' +
    history.map(function(h) {
      return '<tr style="border-bottom:1px solid #1f2937">' +
        '<td style="padding:8px 10px;color:#e5e7eb;font-weight:600">' + escHtml(h.type) + '</td>' +
        '<td style="padding:8px 10px;color:#9ca3af;font-size:12px">' + escHtml(h.filters) + '</td>' +
        '<td style="padding:8px 10px;color:#9ca3af">' + escHtml(h.downloadedAt) + '</td>' +
        '<td style="padding:8px 10px;text-align:right;color:#6366f1;font-weight:600">' + (h.rowCount !== null ? h.rowCount : '—') + '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
}
