// ─── Health Check ─────────────────────────────────────────────────────────────

var healthLastChecked = null;
var healthAutoRefreshInterval = null;
var healthTickInterval = null;
var healthAutoRefreshEnabled = false;

var CHECK_LABELS = {
  database:      'Database',
  hubspot:       'HubSpot',
  smtp:          'SMTP (Sending Accounts)',
  imap:          'IMAP',
  scheduler:     'Scheduler',
  warmup_system: 'Warmup System',
  reply_queue:   'Reply Queue',
  memory:        'Memory',
};

var CHECK_ICONS = {
  database:      '🗄️',
  hubspot:       '🔗',
  smtp:          '📤',
  imap:          '📥',
  scheduler:     '⏱️',
  warmup_system: '🔥',
  reply_queue:   '📬',
  memory:        '💾',
};

function healthStatusBadge(status) {
  if (status === 'ok')       return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#052e16;color:#4ade80">● OK</span>';
  if (status === 'warning')  return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#2d1a00;color:#fbbf24">▲ Warning</span>';
  if (status === 'error')    return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#2d0a0a;color:#f87171">✕ Error</span>';
  return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#1f2937;color:#9ca3af"><span class="spinner" style="width:10px;height:10px;border-width:2px"></span> Checking</span>';
}

function healthCardBorderColor(status) {
  if (status === 'ok')      return '#166534';
  if (status === 'warning') return '#92400e';
  if (status === 'error')   return '#7f1d1d';
  return '#374151';
}

function setAllCardsLoading() {
  var grid = document.getElementById('health-cards-grid');
  if (!grid) return;
  var keys = Object.keys(CHECK_LABELS);
  grid.innerHTML = keys.map(function(key) {
    return '<div class="card" style="border-left:3px solid #374151">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:16px">' + (CHECK_ICONS[key] || '🔧') + '</span>' +
          '<span style="font-weight:700;color:#e5e7eb;font-size:13px">' + CHECK_LABELS[key] + '</span>' +
        '</div>' +
        healthStatusBadge('checking') +
      '</div>' +
      '<div style="font-size:12px;color:#6b7280">Running check…</div>' +
    '</div>';
  }).join('');
}

function renderSmtpAccounts(accounts) {
  if (!accounts || !accounts.length) return '';
  return '<div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">' +
    accounts.map(function(a) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:#0f1a27;border-radius:6px">' +
        '<span style="font-size:11px;color:#9ca3af;font-family:monospace">' + escHtml(a.email) + '</span>' +
        healthStatusBadge(a.status) +
      '</div>';
    }).join('') +
  '</div>';
}

function renderWarmupExtra(check) {
  return '<div style="display:flex;gap:14px;margin-top:8px;flex-wrap:wrap">' +
    '<div style="font-size:11px;color:#9ca3af">Warmup: <strong style="color:' + (check.warmup_running ? '#4ade80' : '#f59e0b') + '">' + (check.warmup_running ? 'Running' : 'Paused') + '</strong></div>' +
    '<div style="font-size:11px;color:#9ca3af">Active accounts: <strong style="color:#e5e7eb">' + (check.active_accounts ?? '—') + '</strong></div>' +
    '<div style="font-size:11px;color:#9ca3af">Sent today: <strong style="color:#e5e7eb">' + (check.sent_today ?? '—') + '</strong></div>' +
  '</div>';
}

function renderQueueExtra(check) {
  return '<div style="display:flex;gap:14px;margin-top:8px">' +
    '<div style="font-size:11px;color:#9ca3af">Pending: <strong style="color:#e5e7eb">' + (check.pending_count ?? '—') + '</strong></div>' +
    '<div style="font-size:11px;color:#9ca3af">Failed: <strong style="color:' + ((check.failed_count || 0) > 0 ? '#f87171' : '#4ade80') + '">' + (check.failed_count ?? '—') + '</strong></div>' +
  '</div>';
}

function renderMemoryExtra(check) {
  return '<div style="display:flex;gap:14px;margin-top:8px;flex-wrap:wrap">' +
    '<div style="font-size:11px;color:#9ca3af">Free: <strong style="color:#e5e7eb">' + (check.free_mem_mb ?? '—') + ' MB</strong></div>' +
    '<div style="font-size:11px;color:#9ca3af">Total: <strong style="color:#e5e7eb">' + (check.total_mem_mb ?? '—') + ' MB</strong></div>' +
    '<div style="font-size:11px;color:#9ca3af">Process: <strong style="color:#e5e7eb">' + (check.process_rss_mb ?? '—') + ' MB</strong></div>' +
  '</div>';
}

function renderHealthCard(key, check) {
  var extra = '';
  if (key === 'smtp' && check.accounts) extra = renderSmtpAccounts(check.accounts);
  if (key === 'warmup_system')          extra = renderWarmupExtra(check);
  if (key === 'reply_queue')            extra = renderQueueExtra(check);
  if (key === 'memory')                 extra = renderMemoryExtra(check);

  return '<div class="card" style="border-left:3px solid ' + healthCardBorderColor(check.status) + '">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:16px">' + (CHECK_ICONS[key] || '🔧') + '</span>' +
        '<span style="font-weight:700;color:#e5e7eb;font-size:13px">' + (CHECK_LABELS[key] || key) + '</span>' +
      '</div>' +
      healthStatusBadge(check.status) +
    '</div>' +
    '<div style="font-size:12px;color:#9ca3af">' + escHtml(check.message || '') + '</div>' +
    extra +
  '</div>';
}

function renderHealthCheck(data) {
  // Overall status banner
  var banner = document.getElementById('health-overall-banner');
  if (banner) {
    if (data.overall_status === 'ok') {
      banner.style.cssText = 'padding:12px 18px;border-radius:8px;background:#052e16;border:1px solid #166534;color:#4ade80;font-weight:700;font-size:14px;margin-bottom:16px';
      banner.textContent = '✅ All Systems Operational';
    } else if (data.overall_status === 'warning') {
      banner.style.cssText = 'padding:12px 18px;border-radius:8px;background:#2d1a00;border:1px solid #92400e;color:#fbbf24;font-weight:700;font-size:14px;margin-bottom:16px';
      banner.textContent = '⚠️ Some Issues Detected';
    } else {
      banner.style.cssText = 'padding:12px 18px;border-radius:8px;background:#2d0a0a;border:1px solid #7f1d1d;color:#f87171;font-weight:700;font-size:14px;margin-bottom:16px';
      banner.textContent = '🚨 System Errors Detected';
    }
  }

  // Cards grid
  var grid = document.getElementById('health-cards-grid');
  if (grid && data.checks) {
    grid.innerHTML = Object.keys(data.checks).map(function(key) {
      return renderHealthCard(key, data.checks[key]);
    }).join('');
  }

  // Raw JSON collapsible
  var rawEl = document.getElementById('health-raw-json');
  if (rawEl) rawEl.textContent = JSON.stringify(data, null, 2);
}

function updateLastChecked() {
  var el2 = document.getElementById('health-last-checked');
  if (!el2 || !healthLastChecked) return;
  var secs = Math.round((Date.now() - healthLastChecked) / 1000);
  el2.textContent = secs < 5 ? 'just now' : secs + 's ago';
}

async function loadHealthCheck() {
  setAllCardsLoading();
  var banner = document.getElementById('health-overall-banner');
  if (banner) {
    banner.style.cssText = 'padding:12px 18px;border-radius:8px;background:#1f2937;border:1px solid #374151;color:#9ca3af;font-weight:700;font-size:14px;margin-bottom:16px';
    banner.textContent = '⏳ Running checks…';
  }

  try {
    var data = await api('/dashboard/health');
    healthLastChecked = Date.now();
    renderHealthCheck(data);
    updateLastChecked();
    if (!healthTickInterval) {
      healthTickInterval = setInterval(updateLastChecked, 1000);
    }
  } catch(e) {
    if (banner) {
      banner.style.cssText = 'padding:12px 18px;border-radius:8px;background:#2d0a0a;border:1px solid #7f1d1d;color:#f87171;font-weight:700;font-size:14px;margin-bottom:16px';
      banner.textContent = '🚨 Failed to fetch health status: ' + e.message;
    }
  }
}

function startAutoRefresh() {
  if (healthAutoRefreshInterval) return;
  healthAutoRefreshEnabled = true;
  healthAutoRefreshInterval = setInterval(loadHealthCheck, 60_000);
  var btn = document.getElementById('health-autorefresh-btn');
  if (btn) { btn.textContent = '⏹ Stop Auto Refresh'; btn.style.background = '#7f1d1d'; btn.style.borderColor = '#7f1d1d'; }
}

function stopAutoRefresh() {
  if (healthAutoRefreshInterval) { clearInterval(healthAutoRefreshInterval); healthAutoRefreshInterval = null; }
  healthAutoRefreshEnabled = false;
  var btn = document.getElementById('health-autorefresh-btn');
  if (btn) { btn.textContent = '▶ Auto Refresh (60s)'; btn.style.background = ''; btn.style.borderColor = ''; }
}

function toggleAutoRefresh() {
  if (healthAutoRefreshEnabled) stopAutoRefresh();
  else startAutoRefresh();
}

function toggleHealthRaw() {
  var body = document.getElementById('health-raw-body');
  var arrow = document.getElementById('health-raw-arrow');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▶ Show' : '▼ Hide';
}

async function loadQuickStatus() {
  var dot = document.getElementById('health-quick-dot');
  if (!dot) return;
  try {
    var data = await api('/dashboard/health/quick');
    var color = data.overall_status === 'ok' ? '#4ade80' : data.overall_status === 'warning' ? '#fbbf24' : '#f87171';
    var title = data.overall_status === 'ok' ? 'All systems OK' : data.overall_status === 'warning' ? 'Some warnings' : 'System errors detected';
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-left:8px;vertical-align:middle;cursor:pointer;flex-shrink:0';
    dot.title = title;
  } catch(e) {
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#6b7280;margin-left:8px;vertical-align:middle;flex-shrink:0';
    dot.title = 'Could not fetch status';
  }
}
