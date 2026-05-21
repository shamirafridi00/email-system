// ─── US Eastern business hours helper (client-side) ─────────────────────────
function getUSEasternHour() {
  // Determine DST: second Sunday of March through first Sunday of November
  var now = new Date();
  var year = now.getUTCFullYear();
  function nthSun(month, n) {
    var d = new Date(Date.UTC(year, month, 1));
    var daysToSun = d.getUTCDay() === 0 ? 0 : 7 - d.getUTCDay();
    return new Date(Date.UTC(year, month, 1 + daysToSun + (n - 1) * 7));
  }
  var dstStart = nthSun(2, 2); dstStart.setUTCHours(7);  // 2nd Sun Mar 7am UTC
  var dstEnd   = nthSun(10, 1); dstEnd.setUTCHours(6);   // 1st Sun Nov 6am UTC
  var offsetH  = (now >= dstStart && now < dstEnd) ? -4 : -5;
  var eastern  = new Date(now.getTime() + offsetH * 3600000);
  return { hour: eastern.getUTCHours(), dow: eastern.getUTCDay(), eastern: eastern, offsetH: offsetH };
}

function isUSBusinessHoursNow() {
  var e = getUSEasternHour();
  return e.dow >= 1 && e.dow <= 5 && e.hour >= 8 && e.hour < 18;
}

function formatUSEastern() {
  var e = getUSEasternHour();
  var h = e.hour, m = e.eastern.getUTCMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  var mm = m < 10 ? '0' + m : m;
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[e.dow] + ' ' + h12 + ':' + mm + ' ' + ampm + ' ET';
}

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

// ─── Account Groups ───────────────────────────────────────────────────────────
var GROUP_COLORS = [
  { bg: '#1e1b4b', color: '#a5b4fc' },
  { bg: '#052e16', color: '#4ade80' },
  { bg: '#1c0a00', color: '#fb923c' },
  { bg: '#0c0a00', color: '#fbbf24' },
  { bg: '#0c0a1a', color: '#818cf8' },
  { bg: '#071e20', color: '#2dd4bf' },
  { bg: '#1a0a1a', color: '#e879f9' },
  { bg: '#0a0a1a', color: '#60a5fa' },
];

function groupColor(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) { hash = (hash * 31 + name.charCodeAt(i)) >>> 0; }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

var groupsData = [];
var groupsAccounts = [];
var groupLastRun = {};
var groupCollapseState = {};

async function loadAccountGroups() {
  try {
    var results = await Promise.all([
      api('/warmup/accounts/groups'),
      api('/warmup/accounts'),
      api('/warmup/accounts/progress'),
    ]);
    groupsData = results[0] || [];
    var rawAccounts = results[1] || [];
    var progMap = {};
    if (Array.isArray(results[2])) results[2].forEach(function(p) { progMap[p.id] = p; });
    groupsAccounts = rawAccounts.map(function(a) {
      return Object.assign({}, a, progMap[a.id] || {});
    });
    renderGroupCards();
    renderGroupsAssignTable();
    renderGroupControls();
  } catch(e) {
    toast(e.message || 'Failed to load groups', 'error');
  }
}

function renderGroupCards() {
  var grid = el('groups-cards-grid');
  if (!grid) return;
  if (!groupsData.length) {
    grid.innerHTML = '<div class="no-data" style="grid-column:1/-1">No groups yet. Add warmup accounts to see groups here.</div>';
    return;
  }
  grid.innerHTML = groupsData.map(function(g) {
    var gc = groupColor(g.group_name);
    var hsColor = g.avg_health_score >= 70 ? '#4ade80' : g.avg_health_score >= 50 ? '#f59e0b' : '#f87171';
    var hsBg    = g.avg_health_score >= 70 ? '#052e16' : g.avg_health_score >= 50 ? '#1c1200' : '#1c0000';
    var collapsed = groupCollapseState[g.group_name] === true;
    var enc = encodeURIComponent(g.group_name);
    var arrow = collapsed ? '▶' : '▼';
    var bodyStyle = collapsed ? 'display:none' : 'display:block';
    return '<div class="card" style="margin:0">' +
      // Header row — always visible
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px' + (collapsed ? '' : ';margin-bottom:12px') + '">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">' +
          '<div style="font-size:15px;font-weight:700;color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + g.group_name + '</div>' +
          '<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;flex-shrink:0;background:' + gc.bg + ';color:' + gc.color + '">' + g.account_count + ' acct' + (g.account_count !== 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<button onclick="toggleGroupCard(\'' + enc + '\')" style="background:none;border:none;color:#6b7280;font-size:12px;cursor:pointer;padding:2px 6px;flex-shrink:0" title="' + (collapsed ? 'Expand' : 'Collapse') + '">' + arrow + '</button>' +
      '</div>' +
      // Collapsible body
      '<div style="' + bodyStyle + '">' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px">' +
          '<div style="background:#0d0d0d;border:1px solid #1f2937;border-radius:6px;padding:8px;text-align:center">' +
            '<div style="font-size:16px;font-weight:800;color:#e5e7eb">' + g.active_count + '</div>' +
            '<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Active</div>' +
          '</div>' +
          '<div style="background:#0d0d0d;border:1px solid #1f2937;border-radius:6px;padding:8px;text-align:center">' +
            '<div style="font-size:16px;font-weight:800;color:#e5e7eb">' + g.sent_today + '</div>' +
            '<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Sent Today</div>' +
          '</div>' +
          '<div style="background:' + hsBg + ';border:1px solid #1f2937;border-radius:6px;padding:8px;text-align:center">' +
            '<div style="font-size:16px;font-weight:800;color:' + hsColor + '">' + g.avg_health_score + '</div>' +
            '<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Avg Health</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-ghost btn-sm" style="border-color:#6366f1;color:#6366f1;font-size:11px" onclick="renameGroup(\'' + enc + '\')">Rename</button>' +
          (g.group_name !== 'default'
            ? '<button class="btn btn-ghost btn-sm" style="border-color:#ef4444;color:#ef4444;font-size:11px" onclick="deleteGroup(\'' + enc + '\')">Delete</button>'
            : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleGroupCard(encodedName) {
  var name = decodeURIComponent(encodedName);
  groupCollapseState[name] = !groupCollapseState[name];
  renderGroupCards();
}

function collapseAllGroups() {
  groupsData.forEach(function(g) { groupCollapseState[g.group_name] = true; });
  renderGroupCards();
}

function expandAllGroups() {
  groupsData.forEach(function(g) { groupCollapseState[g.group_name] = false; });
  renderGroupCards();
}

function renderGroupsAssignTable() {
  var wrap = el('groups-assign-table');
  if (!wrap) return;
  if (!groupsAccounts.length) { wrap.innerHTML = '<div class="no-data">No warmup accounts found.</div>'; return; }

  var allGroups = groupsData.map(function(g) { return g.group_name; });
  if (!allGroups.includes('default')) allGroups.unshift('default');

  wrap.innerHTML = '<table><thead><tr><th>Email</th><th>Current Group</th><th style="text-align:center">Health</th><th>Change Group</th></tr></thead><tbody>' +
    groupsAccounts.map(function(a) {
      var gName = a.group_name || 'default';
      var gc = groupColor(gName);
      var grade = a.health_grade || 'Critical';
      var gm = GRADE_META[grade] || GRADE_META.Critical;
      var opts = allGroups.map(function(g) {
        return '<option value="' + g + '"' + (g === gName ? ' selected' : '') + '>' + g + '</option>';
      }).join('') + '<option value="__new__">+ New group…</option>';
      return '<tr>' +
        '<td style="font-family:monospace;font-size:12px">' + a.email + '</td>' +
        '<td><span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;background:' + gc.bg + ';color:' + gc.color + '">' + gName + '</span></td>' +
        '<td style="text-align:center"><span style="font-size:12px;font-weight:700;color:' + gm.color + '">' + (a.health_score || 0) + '</span></td>' +
        '<td><select style="background:#111;border:1px solid #374151;border-radius:4px;color:#e5e7eb;font-size:12px;padding:3px 6px" onchange="assignAccountToGroup(' + a.id + ', this)">' + opts + '</select></td>' +
      '</tr>';
    }).join('') +
  '</tbody></table>';
}

function renderGroupControls() {
  var cont = el('groups-controls');
  if (!cont) return;
  if (!groupsData.length) { cont.innerHTML = '<div class="no-data">No groups found.</div>'; return; }
  cont.innerHTML = groupsData.map(function(g) {
    var gc = groupColor(g.group_name);
    var lastRun = groupLastRun[g.group_name] ? 'Last run: ' + groupLastRun[g.group_name] : 'Not run this session';
    return '<div class="card" style="margin:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px">' +
      '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
        '<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;flex-shrink:0;background:' + gc.bg + ';color:' + gc.color + '">' + g.group_name + '</span>' +
        '<span style="font-size:12px;color:#4b5563">' + g.active_count + ' active · ' + g.sent_today + ' sent today</span>' +
        '<span id="group-lastrun-' + encodeURIComponent(g.group_name) + '" style="font-size:11px;color:#374151">' + lastRun + '</span>' +
      '</div>' +
      '<button id="group-run-btn-' + encodeURIComponent(g.group_name) + '" class="btn btn-ghost btn-sm" style="border-color:#6366f1;color:#6366f1;flex-shrink:0" onclick="runGroupWarmup(\'' + encodeURIComponent(g.group_name) + '\')">▶ Run Warmup</button>' +
    '</div>';
  }).join('');
}

async function createGroup() {
  var inp = el('new-group-name');
  var name = inp ? inp.value.trim() : '';
  if (!name) { toast('Enter a group name', 'error'); return; }
  if (groupsData.some(function(g) { return g.group_name.toLowerCase() === name.toLowerCase(); })) {
    toast('A group with that name already exists', 'error'); return;
  }
  toast('Group "' + name + '" ready — assign accounts to it using the table below', 'success');
  if (inp) inp.value = '';
  // Optimistically add to local data so dropdown shows it immediately
  groupsData.push({ group_name: name, account_count: 0, active_count: 0, sent_today: 0, avg_health_score: 0 });
  renderGroupCards();
  renderGroupsAssignTable();
  renderGroupControls();
}

async function renameGroup(encodedName) {
  var oldName = decodeURIComponent(encodedName);
  var newName = window.prompt('Rename group "' + oldName + '" to:', oldName);
  if (!newName || !newName.trim()) return;
  newName = newName.trim();
  if (newName === oldName) return;
  // Frontend duplicate check (case-insensitive)
  if (groupsData.some(function(g) { return g.group_name.toLowerCase() === newName.toLowerCase() && g.group_name !== oldName; })) {
    toast('A group with that name already exists', 'error'); return;
  }
  try {
    await api('/warmup/accounts/groups/rename', { method: 'POST', body: JSON.stringify({ old_name: oldName, new_name: newName }) });
    toast('Group renamed to "' + newName + '"', 'success');
    loadAccountGroups();
  } catch(e) {
    toast(e.message || 'Rename failed', 'error');
  }
}

async function deleteGroup(encodedName) {
  var name = decodeURIComponent(encodedName);
  var confirmed = window.confirm('Delete group "' + name + '"?\n\nAll accounts in this group will be moved to the "default" group.');
  if (!confirmed) return;
  try {
    await api('/warmup/accounts/groups/' + encodedName + '?move_to=default', { method: 'DELETE' });
    toast('Group "' + name + '" deleted — accounts moved to default', 'success');
    loadAccountGroups();
  } catch(e) {
    toast(e.message || 'Delete failed', 'error');
  }
}

async function assignAccountToGroup(id, selectEl) {
  var prev = selectEl.dataset.prev || selectEl.value;
  var value = selectEl.value;
  if (value === '__new__') {
    var name = window.prompt('New group name:');
    if (!name || !name.trim()) { selectEl.value = prev; return; }
    name = name.trim();
    if (!name) { selectEl.value = prev; return; }
    value = name;
  }
  selectEl.dataset.prev = value;
  try {
    await api('/warmup/accounts/' + id + '/group', { method: 'PUT', body: JSON.stringify({ group_name: value }) });
    toast('Account moved to "' + value + '"', 'success');
    loadAccountGroups();
  } catch(e) {
    toast(e.message || 'Failed to update group', 'error');
    selectEl.value = prev;
  }
}

async function runGroupWarmup(encodedName) {
  var name = decodeURIComponent(encodedName);
  var btnId = 'group-run-btn-' + encodedName;
  var btn = el(btnId);
  if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  try {
    var r = await api('/warmup/accounts/groups/run', { method: 'POST', body: JSON.stringify({ group_name: name }) });
    toast(r.message || 'Warmup triggered for ' + name, 'success');
    var now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    groupLastRun[name] = now;
    var lastRunEl = el('group-lastrun-' + encodedName);
    if (lastRunEl) lastRunEl.textContent = 'Last run: ' + now;
    loadAccountGroups();
  } catch(e) {
    toast(e.message || 'Warmup failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Run Warmup'; }
  }
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
              '<button id="readiness-btn-' + r.id + '" class="btn btn-ghost btn-sm" onclick="runReadinessCheck(' + r.id + ',\'' + r.email + '\')">⚑ Check</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="showAccountHistory(' + r.id + ',\'' + r.email + '\')" title="View status history">🕐</button>' +
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

async function downloadImportTemplate() {
  try {
    var res = await fetch('/warmup/accounts/import-template', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to download template');
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'warmup-accounts-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) {
    toast(e.message || 'Download failed', 'error');
  }
}

async function bulkImportAccounts() {
  var csv = el('bulk-import-csv') ? el('bulk-import-csv').value.trim() : '';
  if (!csv) { toast('Paste CSV content before importing', 'error'); return; }

  try {
    var r = await api('/warmup/accounts/bulk-import', { method: 'POST', body: JSON.stringify({ csv: csv }) });

    // Show results card
    var resultsEl = el('bulk-import-results');
    if (resultsEl) resultsEl.style.display = 'block';

    var importedCount = el('bulk-imported-count');
    if (importedCount) importedCount.textContent = r.imported || 0;

    var skippedStat = el('bulk-skipped-stat');
    var skippedCount = el('bulk-skipped-count');
    if (r.skipped > 0) {
      if (skippedStat) skippedStat.style.display = 'block';
      if (skippedCount) skippedCount.textContent = r.skipped;
    } else {
      if (skippedStat) skippedStat.style.display = 'none';
    }

    // Show imported emails list
    var importedList = el('bulk-imported-list');
    if (importedList) {
      if (r.imported_emails && r.imported_emails.length > 0) {
        importedList.style.display = 'block';
        importedList.textContent = r.imported_emails.join(', ');
      } else {
        importedList.style.display = 'none';
      }
    }

    // Show skipped table
    var skippedTable = el('bulk-skipped-table');
    if (skippedTable) {
      if (r.skipped_details && r.skipped_details.length > 0) {
        skippedTable.style.display = 'block';
        skippedTable.innerHTML =
          '<div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Skipped Accounts</div>' +
          '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          '<thead><tr style="background:#1f2937"><th style="padding:6px 10px;text-align:left;color:#9ca3af;font-weight:600">Email</th><th style="padding:6px 10px;text-align:left;color:#9ca3af;font-weight:600">Reason</th></tr></thead>' +
          '<tbody>' +
          r.skipped_details.map(function(s) {
            return '<tr style="border-bottom:1px solid #1f2937"><td style="padding:7px 10px;font-family:monospace;color:#e5e7eb">' + s.email + '</td><td style="padding:7px 10px;color:#f59e0b">' + s.reason + '</td></tr>';
          }).join('') +
          '</tbody></table>';
      } else {
        skippedTable.style.display = 'none';
        skippedTable.innerHTML = '';
      }
    }

    if (r.imported > 0) {
      toast(r.imported + ' account' + (r.imported !== 1 ? 's' : '') + ' imported successfully', 'success');
    }
    if (r.skipped > 0) {
      toast(r.skipped + ' account' + (r.skipped !== 1 ? 's' : '') + ' skipped', 'error');
    }
    if (r.imported > 0 && r.skipped === 0) {
      var csvEl = el('bulk-import-csv');
      if (csvEl) csvEl.value = '';
    }

    loadWarmupAccountsTable();
  } catch(e) {
    toast(e.message || 'Import failed', 'error');
  }
}

function clearBulkImport() {
  var csvEl = el('bulk-import-csv');
  if (csvEl) csvEl.value = '';
  var resultsEl = el('bulk-import-results');
  if (resultsEl) resultsEl.style.display = 'none';
  var importedList = el('bulk-imported-list');
  if (importedList) { importedList.style.display = 'none'; importedList.textContent = ''; }
  var skippedTable = el('bulk-skipped-table');
  if (skippedTable) { skippedTable.style.display = 'none'; skippedTable.innerHTML = ''; }
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

async function loadConversationTopics() {
  try {
    var topics = await api('/warmup/conversations/topics');
    var sel = el('conv-topic-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">Random topic</option>' +
      topics.map(function(t) {
        return '<option value="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
      }).join('');
  } catch(e) {}
}

async function loadAutoGenerateSetting() {
  try {
    var s = await api('/warmup/settings/auto-generate');
    updateAutoGenToggle(s.enabled);
  } catch(e) {}
}

function updateAutoGenToggle(enabled) {
  var btn = el('auto-gen-toggle');
  var knob = el('auto-gen-knob');
  var label = el('auto-gen-label');
  if (!btn) return;
  if (enabled) {
    btn.style.background = '#22c55e';
    knob.style.left = '23px';
    if (label) { label.textContent = 'On'; label.style.color = '#22c55e'; }
  } else {
    btn.style.background = '#374151';
    knob.style.left = '3px';
    if (label) { label.textContent = 'Off'; label.style.color = '#6b7280'; }
  }
  btn.dataset.enabled = enabled ? '1' : '0';
}

async function toggleAutoGenerate() {
  var btn = el('auto-gen-toggle');
  var currentlyEnabled = btn && btn.dataset.enabled === '1';
  var newEnabled = !currentlyEnabled;
  try {
    await api('/warmup/settings/auto-generate', { method: 'POST', body: JSON.stringify({ enabled: newEnabled }) });
    updateAutoGenToggle(newEnabled);
    toast('Daily auto-generate ' + (newEnabled ? 'enabled' : 'disabled'), 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function generateConversation() {
  var topic = el('conv-topic-select') ? el('conv-topic-select').value : '';
  var spinner = el('gen-spinner');
  var resultEl = el('conv-gen-result');
  if (spinner) spinner.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:2px"></span> ';
  if (resultEl) resultEl.innerHTML = '';

  try {
    var payload = {};
    if (topic) payload.topic = topic;
    var r = await api('/warmup/conversations/generate', { method: 'POST', body: JSON.stringify(payload) });
    if (resultEl) {
      var dc = r.duplicate_check || {};
      var simLabel = dc.is_duplicate
        ? '<span style="color:#ef4444;font-weight:700">⚠ Duplicate (' + dc.highest_similarity_score + '% similar)</span>'
        : (dc.highest_similarity_score >= 40
            ? '<span style="color:#f59e0b">〜 Similar (' + dc.highest_similarity_score + '% — acceptable)</span>'
            : '<span style="color:#4ade80">✓ Unique</span>');

      resultEl.innerHTML =
        '<div style="background:#052e16;border:1px solid #166534;border-radius:8px;padding:14px 16px">' +
          '<div style="font-size:12px;font-weight:700;color:#4ade80;margin-bottom:8px">✓ Conversation Generated & Scheduled</div>' +
          (r.warning ? '<div style="font-size:11px;color:#f59e0b;margin-bottom:8px;padding:6px 10px;background:#1a1200;border:1px solid #78350f;border-radius:6px">⚠ ' + r.warning + '</div>' : '') +
          '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">' +
            convResultField('Topic', r.topic) +
            convResultField('Emails', r.email_count + ' emails') +
            convResultField('From', r.sender) +
            convResultField('To', r.receiver) +
            '<div style="grid-column:1/-1">' + convResultField('Conversation ID', r.conversation_id) + '</div>' +
          '</div>' +
          '<div style="margin-top:8px;font-size:12px;color:#6b7280">Similarity: ' + simLabel + '</div>' +
        '</div>';
    }
    toast('Conversation generated and scheduled', 'success');
    loadConversations();
  } catch(e) {
    if (resultEl) resultEl.innerHTML = '<div style="color:#ef4444;font-size:13px">' + e.message + '</div>';
    toast(e.message, 'error');
  } finally {
    if (spinner) spinner.innerHTML = '';
  }
}

async function generateBulkConversations() {
  var topic = el('conv-topic-select') ? el('conv-topic-select').value : '';
  var count = el('conv-bulk-count') ? parseInt(el('conv-bulk-count').value) : 2;
  var spinner = el('gen-bulk-spinner');
  var resultEl = el('conv-gen-result');
  if (spinner) spinner.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:2px"></span> ';
  if (resultEl) resultEl.innerHTML = '';

  try {
    var payload = { count: count };
    if (topic) payload.topic = topic;
    var r = await api('/warmup/conversations/generate-bulk', { method: 'POST', body: JSON.stringify(payload) });
    if (resultEl) {
      resultEl.innerHTML =
        '<div style="background:#052e16;border:1px solid #166534;border-radius:8px;padding:14px 16px">' +
          '<div style="font-size:12px;font-weight:700;color:#4ade80;margin-bottom:10px">✓ ' + r.generated + ' Conversations Generated & Scheduled</div>' +
          r.conversations.map(function(c, i) {
            return '<div style="' + (i > 0 ? 'border-top:1px solid #166534;padding-top:8px;margin-top:8px;' : '') + 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px">' +
              convResultField('Topic', c.topic) +
              convResultField('From', c.sender) +
              convResultField('Emails', c.email_count + '') +
            '</div>';
          }).join('') +
        '</div>';
    }
    toast(r.generated + ' conversations generated', 'success');
    loadConversations();
  } catch(e) {
    if (resultEl) resultEl.innerHTML = '<div style="color:#ef4444;font-size:13px">' + e.message + '</div>';
    toast(e.message, 'error');
  } finally {
    if (spinner) spinner.innerHTML = '';
  }
}

function convResultField(label, value) {
  return '<div style="background:#071a0f;border-radius:6px;padding:8px 10px">' +
    '<div style="font-size:10px;font-weight:700;color:#4b5563;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">' + label + '</div>' +
    '<div style="font-size:12px;font-weight:600;color:#d1d5db;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + value + '</div>' +
  '</div>';
}

async function loadConversations() {
  try {
    const rows = await api('/warmup/conversations');
    el('conv-history-table').innerHTML = rows.length
      ? '<table><thead><tr><th>Filename</th><th>Topic</th><th>Source</th><th>Emails</th><th>Scheduled At</th><th>Status</th><th>Similarity</th></tr></thead><tbody>' +
        rows.map(function(r) {
          var sourceBadge = r.source === 'auto'
            ? '<span style="font-size:11px;font-weight:600;color:#818cf8;background:#1e1b4b;border:1px solid #3730a3;border-radius:4px;padding:2px 7px">Auto</span>'
            : '<span style="font-size:11px;font-weight:600;color:#6b7280;background:#1f2937;border:1px solid #374151;border-radius:4px;padding:2px 7px">Manual</span>';

          var simCell = '—';
          if (r.is_duplicate) {
            var tip = 'Similarity: ' + (r.similarity_score || '?') + '%' + (r.duplicate_of ? ' — similar to ' + r.duplicate_of : '');
            simCell = '<span title="' + tip + '" style="cursor:help;font-size:14px">⚠️</span>';
          } else if (r.similarity_score != null && r.similarity_score >= 40) {
            var tip2 = 'Similarity: ' + r.similarity_score + '%' + (r.duplicate_of ? ' — similar to ' + r.duplicate_of : '');
            simCell = '<span title="' + tip2 + '" style="cursor:help;font-size:14px;color:#f59e0b">〜</span>';
          } else if (r.similarity_score != null) {
            simCell = '<span style="font-size:14px;color:#4ade80" title="Unique">✓</span>';
          }

          return '<tr>' +
            '<td style="font-family:monospace;font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.filename + '</td>' +
            '<td style="color:#9ca3af;font-size:12px">' + (r.topic ? r.topic.charAt(0).toUpperCase() + r.topic.slice(1) : '—') + '</td>' +
            '<td>' + sourceBadge + '</td>' +
            '<td>' + r.email_count + '</td>' +
            '<td style="white-space:nowrap">' + formatTime(r.uploaded_at) + '</td>' +
            '<td><span class="badge badge-active">' + r.status + '</span></td>' +
            '<td style="text-align:center">' + simCell + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>'
      : '<div class="no-data">No conversation files yet</div>';
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
    // Fetch readiness data in parallel; merge into readinessCache for badge rendering
    api('/warmup/accounts/readiness-all').then(function(rAll) {
      if (Array.isArray(rAll)) {
        rAll.forEach(function(r) { readinessCache[r.id] = r; });
        renderWarmupProgress();
      }
    }).catch(function() {});
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
    var inBizHours = isUSBusinessHoursNow();
    var bd     = a.score_breakdown || { consistency:{score:0,max:40}, volume:{score:0,max:30}, reply_rate:{score:0,max:20}, reliability:{score:0,max:10} };
    var cardId = 'breakdown-' + a.id;

    var readyBanner = a.readiness_status === 'ready'
      ? '<div style="margin-top:12px;background:#052e16;border:2px solid #4ade80;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px">' +
          '<div style="font-size:24px;flex-shrink:0">✅</div>' +
          '<div>' +
            '<div style="font-size:13px;font-weight:800;color:#4ade80;letter-spacing:.01em">Warmup Complete — Ready to Launch</div>' +
            '<div style="font-size:11px;color:#86efac;margin-top:2px">This account has completed its warmup journey. Start sending real campaigns.</div>' +
          '</div>' +
        '</div>'
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
            ? '<span style="font-size:11px;font-weight:600;color:#4ade80;background:#052e16;border:1px solid #166534;border-radius:999px;padding:2px 8px">✓ On track</span>'
            : !inBizHours
              ? '<span style="font-size:11px;font-weight:600;color:#9ca3af;background:#1f2937;border:1px solid #374151;border-radius:999px;padding:2px 8px">Outside sending window</span>'
              : '<span style="font-size:11px;font-weight:600;color:#f59e0b;background:#292010;border:1px solid #78350f;border-radius:999px;padding:2px 8px">⚠ Behind target</span>') +
        '</div>' +
      '</div>' +

      readyBanner +
      failureBanner +

      // Readiness score badge (shown when cache is populated)
      (function() {
        var rd = readinessCache[a.id];
        if (!rd) return '';
        var ss = overallScoreStyle(rd.overall_status);
        return '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding:8px 12px;border:1px solid ' + ss.border + ';border-radius:6px;background:' + ss.bg + ';cursor:pointer" onclick="renderReadinessModal(readinessCache[' + a.id + '])">' +
          '<span style="font-size:11px;font-weight:700;color:' + ss.color + ';text-transform:uppercase;letter-spacing:.04em">Readiness Score</span>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:13px;font-weight:800;color:' + ss.color + '">' + rd.overall_score + '/100</span>' +
            '<span style="font-size:11px;font-weight:600;color:' + ss.color + '">' + rd.overall_status + '</span>' +
          '</div>' +
        '</div>';
      })() +

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

async function checkConversationDuplicate() {
  var content = (el('conv-content') || {}).value || '';
  var resultEl = el('conv-dup-result');
  if (!content.trim()) { toast('Paste JSON content first', 'error'); return; }

  var parsed;
  try { parsed = JSON.parse(content); } catch(e) { toast('Invalid JSON: ' + e.message, 'error'); return; }

  try {
    var r = await api('/warmup/conversations/check-duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_json: parsed }),
    });
    if (resultEl) resultEl.innerHTML = parseDuplicateResult(r);
  } catch(e) {
    if (resultEl) resultEl.innerHTML = '<div style="color:#ef4444;font-size:12px">' + e.message + '</div>';
  }
}

function parseDuplicateResult(r) {
  if (!r) return '';
  var score = r.highest_similarity_score || 0;

  if (r.is_duplicate) {
    var dup = r.duplicates && r.duplicates[0];
    var dupInfo = dup ? ' Similar to <strong>' + dup.conversation_id + '</strong> (' + new Date(dup.uploaded_at).toLocaleDateString() + '). Score: ' + score + '%.' : '';
    return '<div style="background:#1c0000;border:1px solid #7f1d1d;border-radius:6px;padding:10px 14px;font-size:12px;color:#fca5a5">' +
      '⚠ High similarity detected.' + dupInfo + '<br>' +
      '<div style="margin-top:8px;display:flex;gap:8px">' +
        '<button class="btn btn-ghost btn-sm" onclick="uploadConversation(true)" style="border-color:#ef4444;color:#ef4444">Use Anyway</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="el(\'conv-content\').value=\'\';el(\'conv-dup-result\').innerHTML=\'\'">Discard & Try Again</button>' +
      '</div>' +
    '</div>';
  }

  if (score >= 40) {
    var sim = r.duplicates && r.duplicates[0];
    var simInfo = sim ? ' Similar to <strong>' + sim.conversation_id + '</strong> (' + score + '%).' : '';
    return '<div style="background:#1a1200;border:1px solid #78350f;border-radius:6px;padding:10px 14px;font-size:12px;color:#fcd34d">' +
      '〜 Similar to recent conversations but acceptable.' + simInfo +
    '</div>';
  }

  return '<div style="background:#052e16;border:1px solid #166534;border-radius:6px;padding:10px 14px;font-size:12px;color:#4ade80">' +
    '✓ No duplicates found. This conversation looks unique.' +
  '</div>';
}

async function uploadConversation(confirmed) {
  const filename = (el('conv-filename') || {}).value.trim();
  const content  = (el('conv-content')  || {}).value.trim();
  if (!filename || !content) { toast('Filename and content required', 'error'); return; }

  // Parse for duplicate check
  var parsed;
  try { parsed = JSON.parse(content); } catch(e) { toast('Invalid JSON: ' + e.message, 'error'); return; }

  // If not already confirmed by user, run duplicate check first
  if (!confirmed) {
    try {
      var dc = await api('/warmup/conversations/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_json: parsed }),
      });
      var dupEl = el('conv-dup-result');
      if (dc.is_duplicate && dc.highest_similarity_score > 70) {
        if (dupEl) dupEl.innerHTML = parseDuplicateResult(dc);
        return; // Wait for user to click "Use Anyway"
      }
    } catch(e) { /* non-blocking — proceed */ }
  }

  try {
    const r = await api('/warmup/upload', { method: 'POST', body: JSON.stringify({ filename: filename, content: content }) });
    toast('Scheduled ' + r.scheduled_emails + ' emails from ' + r.filename, 'success');
    el('conv-result').innerHTML = '<div style="color:#22c55e;font-size:13px">✓ Scheduled ' + r.scheduled_emails + ' emails from <strong>' + r.filename + '</strong></div>';
    el('conv-filename').value = '';
    el('conv-content').value  = '';
    if (el('conv-dup-result')) el('conv-dup-result').innerHTML = '';
    loadConversations();
  } catch(e) {
    el('conv-result').innerHTML = '<div style="color:#ef4444;font-size:13px">' + e.message + '</div>';
    toast(e.message, 'error');
  }
}

// ─── Warmup Schedule Planner ──────────────────────────────────────────────────
var scheduleData = [];

var WEEK_LABELS = {
  1: 'Foundation',
  2: 'Building',
  3: 'Full Volume',
  4: 'Maintenance',
};
var WEEK_DEFAULTS = { 1: 5, 2: 10, 3: 20, 4: 20 };
var WEEK_COLORS = {
  1: { color: '#f59e0b', bg: '#1c1917', border: '#78350f' },
  2: { color: '#818cf8', bg: '#1e1b4b', border: '#3730a3' },
  3: { color: '#22c55e', bg: '#052e16', border: '#166534' },
  4: { color: '#4ade80', bg: '#071a0f', border: '#166534' },
};

async function loadWarmupSchedule() {
  var weekCardsEl = el('ws-week-cards');
  var tableEl = el('ws-accounts-table');
  var editRowsEl = el('ws-edit-rows');
  if (weekCardsEl) weekCardsEl.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  if (tableEl) tableEl.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  try {
    var data = await api('/warmup/schedule');
    var summary = await api('/warmup/schedule/summary');
    scheduleData = data;

    // ── Week overview cards ───────────────────────────────────────────────────
    if (weekCardsEl) {
      weekCardsEl.innerHTML = [1, 2, 3, 4].map(function(wk) {
        var wc = WEEK_COLORS[wk];
        var count = summary.week_counts[wk] || 0;
        var defaultTarget = WEEK_DEFAULTS[wk];
        // Find the most common custom target for this week across accounts
        var targets = data.map(function(a) {
          var plan = a.week_plans && a.week_plans.find(function(p) { return p.week_number === wk; });
          return plan ? plan.emails_per_day : defaultTarget;
        });
        var customTarget = targets.length ? targets[0] : defaultTarget;
        var isActive = data.some(function(a) { return a.current_week === wk; });
        return '<div class="stat-card" style="' + (isActive ? 'border:2px solid #6366f1;background:#1e1b4b' : '') + '">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
            '<span style="font-size:11px;font-weight:700;color:' + wc.color + ';text-transform:uppercase;letter-spacing:.06em">Week ' + wk + '</span>' +
            (count > 0
              ? '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:' + wc.bg + ';color:' + wc.color + ';border:1px solid ' + wc.border + '">' + count + ' account' + (count === 1 ? '' : 's') + '</span>'
              : '<span style="font-size:11px;color:#4b5563">—</span>') +
          '</div>' +
          '<div style="font-size:28px;font-weight:800;color:#e5e7eb;line-height:1">' + customTarget + '</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:4px">emails / day</div>' +
          '<div style="font-size:11px;color:#4b5563;margin-top:6px">' + WEEK_LABELS[wk] + ' · default ' + defaultTarget + '</div>' +
        '</div>';
      }).join('');
    }

    // ── Account schedule table ────────────────────────────────────────────────
    if (tableEl) {
      tableEl.innerHTML = data.length
        ? '<table><thead><tr>' +
            '<th>Account</th>' +
            '<th style="text-align:center">Current Week</th>' +
            '<th style="text-align:center">Target / Day</th>' +
            '<th style="text-align:center">Sent Today</th>' +
            '<th style="text-align:center">Sent This Week</th>' +
            '<th style="text-align:center">On Track</th>' +
            '<th>Projected Ready</th>' +
          '</tr></thead><tbody>' +
          data.map(function(a) {
            var wk = a.current_week || 0;
            var wc = wk > 0 ? WEEK_COLORS[wk] : { color: '#6b7280', bg: '#1f2937', border: '#374151' };
            var weekBadge = wk > 0
              ? '<span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:' + wc.bg + ';color:' + wc.color + ';border:1px solid ' + wc.border + '">Week ' + wk + '</span>'
              : '<span style="font-size:11px;color:#6b7280">Not started</span>';
            var onTrackBadge = a.on_track
              ? '<span style="color:#22c55e;font-size:16px" title="On track">✓</span>'
              : '<span style="color:#ef4444;font-size:14px" title="Behind target">✗</span>';
            var readyDate = a.projected_ready_date
              ? new Date(a.projected_ready_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : '—';
            return '<tr>' +
              '<td style="font-family:monospace;font-size:12px">' + a.email + '</td>' +
              '<td style="text-align:center">' + weekBadge + '</td>' +
              '<td style="text-align:center;font-weight:700;color:#e5e7eb">' + a.daily_target + '</td>' +
              '<td style="text-align:center;color:' + (a.sent_today >= a.daily_target ? '#22c55e' : '#e5e7eb') + ';font-weight:600">' + a.sent_today + '</td>' +
              '<td style="text-align:center;color:#9ca3af">' + a.sent_this_week + '</td>' +
              '<td style="text-align:center">' + onTrackBadge + '</td>' +
              '<td style="font-size:12px;color:#9ca3af;white-space:nowrap">' + readyDate + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table>'
        : '<div class="no-data">No warmup accounts found</div>';
    }

    // ── Edit schedule grid ────────────────────────────────────────────────────
    if (editRowsEl) {
      editRowsEl.innerHTML = [1, 2, 3, 4].map(function(wk) {
        // Use first account's plan for this week as the representative target
        var repPlan = data.length && data[0].week_plans
          ? data[0].week_plans.find(function(p) { return p.week_number === wk; })
          : null;
        var currentVal = repPlan ? repPlan.emails_per_day : WEEK_DEFAULTS[wk];
        return '<tr>' +
          '<td style="padding:10px 12px;font-weight:700;color:#e5e7eb">Week ' + wk + '</td>' +
          '<td style="padding:10px 12px;color:#9ca3af">' + WEEK_LABELS[wk] + '</td>' +
          '<td style="padding:10px 12px;text-align:center;color:#6b7280">' + WEEK_DEFAULTS[wk] + '</td>' +
          '<td style="padding:10px 12px;text-align:center">' +
            '<input id="ws-week-' + wk + '-input" type="number" min="1" max="50" value="' + currentVal + '" ' +
              'style="width:70px;text-align:center;padding:6px 8px;background:#1a1a1a;border:1px solid #333;border-radius:6px;color:#e5e7eb;font-size:14px;font-weight:700">' +
          '</td>' +
        '</tr>';
      }).join('');
    }

  } catch(e) {
    if (weekCardsEl) weekCardsEl.innerHTML = '<div class="no-data" style="color:#ef4444">' + e.message + '</div>';
    if (tableEl) tableEl.innerHTML = '<div class="no-data" style="color:#ef4444">' + e.message + '</div>';
  }
}

async function saveSchedule() {
  var resultEl = el('ws-save-result');
  if (resultEl) resultEl.innerHTML = '';

  var entries = [];
  for (var wk = 1; wk <= 4; wk++) {
    var inp = el('ws-week-' + wk + '-input');
    if (!inp) continue;
    var val = parseInt(inp.value);
    if (isNaN(val) || val < 1) { toast('Week ' + wk + ' target must be at least 1', 'error'); return; }
    // Apply to all accounts
    for (var i = 0; i < scheduleData.length; i++) {
      entries.push({ account_id: scheduleData[i].id, week_number: wk, emails_per_day: val });
    }
  }

  if (entries.length === 0) { toast('No accounts to save for', 'error'); return; }

  try {
    await api('/warmup/schedule', { method: 'POST', body: JSON.stringify({ entries: entries }) });
    toast('Schedule saved for all accounts', 'success');
    if (resultEl) resultEl.innerHTML = '<div style="color:#22c55e;font-size:13px">✓ Schedule saved</div>';
    loadWarmupSchedule();
  } catch(e) {
    toast(e.message, 'error');
    if (resultEl) resultEl.innerHTML = '<div style="color:#ef4444;font-size:13px">' + e.message + '</div>';
  }
}

async function resetScheduleDefaults() {
  [1, 2, 3, 4].forEach(function(wk) {
    var inp = el('ws-week-' + wk + '-input');
    if (inp) inp.value = WEEK_DEFAULTS[wk];
  });

  var entries = [];
  for (var wk = 1; wk <= 4; wk++) {
    for (var i = 0; i < scheduleData.length; i++) {
      entries.push({ account_id: scheduleData[i].id, week_number: wk, emails_per_day: WEEK_DEFAULTS[wk] });
    }
  }

  if (entries.length === 0) {
    toast('Inputs reset to defaults (no accounts to save)', 'success');
    return;
  }

  try {
    await api('/warmup/schedule', { method: 'POST', body: JSON.stringify({ entries: entries }) });
    toast('Schedule reset to defaults', 'success');
    loadWarmupSchedule();
  } catch(e) {
    toast(e.message, 'error');
  }
}

// ─── Dashboard: Schedule Status card ─────────────────────────────────────────
async function loadDashboardScheduleStatus() {
  var container = el('wd-schedule-status');
  if (!container) return;
  try {
    var data = await api('/warmup/schedule');
    if (!data.length) {
      container.innerHTML = '<div class="no-data" style="font-size:13px">No warmup accounts yet</div>';
      return;
    }
    container.innerHTML = '<table style="width:100%"><thead><tr>' +
      '<th>Account</th>' +
      '<th style="text-align:center">Week</th>' +
      '<th style="text-align:center">Target/Day</th>' +
      '<th style="text-align:center">Sent Today</th>' +
      '<th style="text-align:center">Status</th>' +
    '</tr></thead><tbody>' +
    data.map(function(a) {
      var wk = a.current_week || 0;
      var wc = wk > 0 ? WEEK_COLORS[wk] : { color: '#6b7280', bg: '#1f2937', border: '#374151' };
      var weekBadge = wk > 0
        ? '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:' + wc.bg + ';color:' + wc.color + ';border:1px solid ' + wc.border + '">Wk ' + wk + '</span>'
        : '<span style="font-size:11px;color:#6b7280">—</span>';
      var statusBadge = a.on_track
        ? '<span style="font-size:11px;font-weight:600;color:#4ade80;background:#052e16;border:1px solid #166534;border-radius:999px;padding:2px 8px">✓ On track</span>'
        : '<span style="font-size:11px;font-weight:600;color:#f59e0b;background:#292010;border:1px solid #78350f;border-radius:999px;padding:2px 8px">Behind</span>';
      return '<tr>' +
        '<td style="font-family:monospace;font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + a.email + '</td>' +
        '<td style="text-align:center">' + weekBadge + '</td>' +
        '<td style="text-align:center;font-weight:700;color:#e5e7eb">' + a.daily_target + '</td>' +
        '<td style="text-align:center;color:' + (a.sent_today >= a.daily_target ? '#22c55e' : '#9ca3af') + ';font-weight:600">' + a.sent_today + '</td>' +
        '<td style="text-align:center">' + statusBadge + '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
  } catch(e) {
    if (container) container.innerHTML = '<div class="no-data" style="color:#ef4444;font-size:13px">' + e.message + '</div>';
  }
}

// ─── Warmup Readiness Check ───────────────────────────────────────────────────
var readinessCache = {};

var CHECK_WEIGHTS = {
  'DNS Records': 25,
  'Warmup Duration': 25,
  'Volume Sufficiency': 20,
  'Reply Rate': 15,
  'Authentication Health': 10,
  'Recent Activity': 5,
};

function readinessStatusStyle(status) {
  if (status === 'pass')    return { icon: '✓', color: '#22c55e', bg: '#052e16', border: '#166534' };
  if (status === 'warning') return { icon: '!', color: '#f59e0b', bg: '#1c1917', border: '#78350f' };
  return                           { icon: '✗', color: '#ef4444', bg: '#1c0000', border: '#7f1d1d' };
}

function overallScoreStyle(status) {
  if (status === 'Ready to Launch') return { bg: '#052e16', color: '#22c55e', border: '#166534' };
  if (status === 'Almost Ready')    return { bg: '#1c1917', color: '#f59e0b', border: '#78350f' };
  if (status === 'Needs Work')      return { bg: '#1c0a00', color: '#f97316', border: '#9a3412' };
  return                                   { bg: '#1c0000', color: '#ef4444', border: '#7f1d1d' };
}

function renderReadinessCard(r) {
  var ss = overallScoreStyle(r.overall_status);
  var statusIcon = r.overall_status === 'Ready to Launch' ? '✓' :
                   r.overall_status === 'Almost Ready'    ? '◑' :
                   r.overall_status === 'Needs Work'      ? '⚠' : '✗';

  var checksHtml = r.checks.map(function(c) {
    var cs = readinessStatusStyle(c.status);
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #1a1a1a">' +
      '<div style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:' + cs.bg + ';border:1px solid ' + cs.border + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:' + cs.color + ';margin-top:1px">' + cs.icon + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<span style="font-size:12px;font-weight:700;color:#d1d5db">' + c.name + '</span>' +
          '<span style="font-size:11px;color:#4b5563;flex-shrink:0">' + c.points_earned + '/' + c.points_max + ' pts</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#6b7280;margin-top:2px">' + c.message + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  var actionHtml = r.overall_status === 'Ready to Launch'
    ? '<button class="btn btn-success btn-sm" onclick="navigate(\'campaigns\')" style="margin-top:14px;width:100%">Launch Campaign →</button>'
    : '';

  var worstFail = r.checks.find(function(c) { return c.status === 'fail'; });
  var criticalHtml = worstFail && r.overall_status !== 'Ready to Launch'
    ? '<div style="margin-top:12px;background:#1c0000;border:1px solid #7f1d1d;border-radius:6px;padding:10px 12px;font-size:12px;color:#f87171"><strong>Critical:</strong> ' + worstFail.message + '</div>'
    : '';

  return '<div class="card" style="padding:20px">' +
    // Top row
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px">' +
      '<div style="min-width:0;flex:1">' +
        '<div style="font-size:13px;font-weight:600;color:#e5e7eb;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px">' + r.email + '</div>' +
        '<div style="background:' + ss.bg + ';border:1px solid ' + ss.border + ';border-radius:6px;padding:8px 12px;display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:15px;color:' + ss.color + '">' + statusIcon + '</span>' +
          '<span style="font-size:13px;font-weight:700;color:' + ss.color + '">' + r.overall_status + '</span>' +
        '</div>' +
      '</div>' +
      // Score circle
      '<div style="flex-shrink:0;width:64px;height:64px;border-radius:50%;background:' + ss.bg + ';border:2px solid ' + ss.border + ';display:flex;flex-direction:column;align-items:center;justify-content:center">' +
        '<div style="font-size:22px;font-weight:800;color:' + ss.color + ';line-height:1">' + r.overall_score + '</div>' +
        '<div style="font-size:9px;color:' + ss.color + ';opacity:.7;text-transform:uppercase;letter-spacing:.04em">/ 100</div>' +
      '</div>' +
    '</div>' +
    // Checks list
    '<div style="margin-bottom:4px">' + checksHtml + '</div>' +
    // Recommendation
    '<div style="margin-top:12px;font-size:12px;font-style:italic;color:#6b7280;line-height:1.5">' + r.recommendation + '</div>' +
    criticalHtml +
    actionHtml +
  '</div>';
}

function renderReadinessModal(r) {
  var overlay = el('readiness-modal-overlay');
  var content = el('readiness-modal-content');
  if (!overlay || !content) return;
  content.innerHTML = renderReadinessCard(r);
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeReadinessModal(e) {
  if (e && e.target !== el('readiness-modal-overlay') && e.type !== 'click') return;
  var overlay = el('readiness-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function runReadinessCheck(id, email) {
  var btn = el('readiness-btn-' + id);
  if (btn) { btn.innerHTML = '<span class="spinner" style="width:9px;height:9px;border-width:2px"></span>'; btn.disabled = true; }
  try {
    var r = await api('/warmup/accounts/' + id + '/readiness-check', { method: 'POST' });
    readinessCache[id] = r;
    renderReadinessModal(r);
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.innerHTML = '⚑ Check'; btn.disabled = false; }
  }
}

async function runReadinessAll() {
  var grid = el('readiness-cards-grid');
  var spinner = el('readiness-all-spinner');
  var lastChecked = el('readiness-last-checked');
  if (spinner) spinner.innerHTML = '<span class="spinner" style="width:11px;height:11px;border-width:2px"></span> ';
  if (grid) grid.innerHTML = '<div class="card" style="padding:32px;text-align:center;color:#6b7280"><span class="spinner"></span> Running checks…</div>';

  try {
    var results = await api('/warmup/accounts/readiness-all');
    results.forEach(function(r) { readinessCache[r.id] = r; });

    if (lastChecked) lastChecked.textContent = 'Last checked: ' + new Date().toLocaleTimeString();

    if (!results.length) {
      grid.innerHTML = '<div class="card" style="padding:32px;text-align:center;color:#6b7280">No active warmup accounts found.</div>';
      return;
    }

    grid.innerHTML = results.map(renderReadinessCard).join('');
  } catch(e) {
    if (grid) grid.innerHTML = '<div class="card" style="padding:32px;color:#ef4444">' + e.message + '</div>';
    toast(e.message, 'error');
  } finally {
    if (spinner) spinner.innerHTML = '';
  }
}

async function loadWarmupReadiness() {
  await runReadinessAll();
}

// ─── Account Status History ───────────────────────────────────────────────────
var historyData     = [];
var historyFiltered = [];
var historyPage     = 0;
var HISTORY_PAGE_SIZE = 20;

var STATUS_LABELS = {
  active:  { label: 'Active',  color: '#4ade80' },
  paused:  { label: 'Paused',  color: '#f59e0b' },
  flagged: { label: 'Flagged', color: '#f87171' },
};

function historyStatusBadge(status) {
  var m = STATUS_LABELS[status] || { label: status, color: '#9ca3af' };
  return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:' +
         m.color + '22;color:' + m.color + ';border:1px solid ' + m.color + '44">' + m.label + '</span>';
}

function renderHistoryTable() {
  var wrap = el('history-table-wrap');
  if (!wrap) return;

  var start = historyPage * HISTORY_PAGE_SIZE;
  var page  = historyFiltered.slice(start, start + HISTORY_PAGE_SIZE);
  var total = historyFiltered.length;
  var totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  var indicator = el('hist-page-indicator');
  var prevBtn   = el('hist-prev-btn');
  var nextBtn   = el('hist-next-btn');
  if (indicator) indicator.textContent = 'Page ' + (historyPage + 1) + ' of ' + totalPages + ' (' + total + ' records)';
  if (prevBtn)   prevBtn.disabled  = historyPage === 0;
  if (nextBtn)   nextBtn.disabled  = historyPage >= totalPages - 1;

  if (!page.length) {
    wrap.innerHTML = '<div style="padding:32px;text-align:center;color:#6b7280">No history records match the current filters.</div>';
    return;
  }

  wrap.innerHTML = '<table class="data-table"><thead><tr>' +
    '<th>Account</th><th>Status</th><th>Reason</th><th>Changed At</th>' +
    '</tr></thead><tbody>' +
    page.map(function(h) {
      var date = h.changed_at ? new Date(h.changed_at).toLocaleString() : '—';
      return '<tr>' +
        '<td style="font-family:monospace;font-size:12px">' + (h.account_email || '—') + '</td>' +
        '<td>' + historyStatusBadge(h.status) + '</td>' +
        '<td style="color:#d1d5db;font-size:12px;max-width:320px">' + (h.reason || '—') + '</td>' +
        '<td style="color:#9ca3af;font-size:12px;white-space:nowrap">' + date + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

function applyHistoryFilters() {
  var accountVal = (el('hist-filter-account') || {}).value || '';
  var statusVal  = (el('hist-filter-status')  || {}).value || '';
  var fromVal    = (el('hist-filter-from')    || {}).value || '';
  var toVal      = (el('hist-filter-to')      || {}).value || '';

  historyFiltered = historyData.filter(function(h) {
    if (accountVal && String(h.account_id) !== accountVal) return false;
    if (statusVal  && h.status !== statusVal)               return false;
    if (fromVal) {
      var from = new Date(fromVal);
      if (new Date(h.changed_at) < from) return false;
    }
    if (toVal) {
      var to = new Date(toVal);
      to.setHours(23, 59, 59, 999);
      if (new Date(h.changed_at) > to) return false;
    }
    return true;
  });

  historyPage = 0;
  updateHistoryStats();
  renderHistoryTable();
}

function updateHistoryStats() {
  var total      = historyFiltered.length;
  var flagged    = historyFiltered.filter(function(h) { return h.status === 'flagged'; }).length;
  var pauses     = historyFiltered.filter(function(h) { return h.status === 'paused';  }).length;
  var recoveries = historyFiltered.filter(function(h) {
    return h.status === 'active' && h.reason && h.reason.toLowerCase().includes('verified');
  }).length;

  if (el('hist-stat-total'))      el('hist-stat-total').textContent      = total;
  if (el('hist-stat-flagged'))    el('hist-stat-flagged').textContent    = flagged;
  if (el('hist-stat-pauses'))     el('hist-stat-pauses').textContent     = pauses;
  if (el('hist-stat-recoveries')) el('hist-stat-recoveries').textContent = recoveries;
}

function filterHistory() {
  applyHistoryFilters();
}

function clearHistoryFilters() {
  ['hist-filter-account','hist-filter-status','hist-filter-from','hist-filter-to'].forEach(function(id) {
    var el2 = el(id);
    if (el2) el2.value = '';
  });
  applyHistoryFilters();
}

function historyPrevPage() {
  if (historyPage > 0) { historyPage--; renderHistoryTable(); }
}

function historyNextPage() {
  var totalPages = Math.ceil(historyFiltered.length / HISTORY_PAGE_SIZE);
  if (historyPage < totalPages - 1) { historyPage++; renderHistoryTable(); }
}

async function loadAccountHistory() {
  var wrap = el('history-table-wrap');
  if (wrap) wrap.innerHTML = '<div style="padding:32px;text-align:center;color:#6b7280"><span class="spinner"></span> Loading history…</div>';

  try {
    var data = await api('/warmup/accounts/history/all');
    historyData = data;

    // Populate account filter dropdown
    var accountSel = el('hist-filter-account');
    if (accountSel) {
      var seen = {};
      var opts = '<option value="">All Accounts</option>';
      data.forEach(function(h) {
        if (h.account_id && !seen[h.account_id]) {
          seen[h.account_id] = true;
          opts += '<option value="' + h.account_id + '">' + (h.account_email || h.account_id) + '</option>';
        }
      });
      accountSel.innerHTML = opts;
    }

    applyHistoryFilters();
  } catch(e) {
    if (wrap) wrap.innerHTML = '<div style="padding:32px;color:#ef4444">' + e.message + '</div>';
    toast(e.message, 'error');
  }
}

function exportHistoryCSV() {
  if (!historyFiltered.length) { toast('No records to export', 'error'); return; }

  var header = ['Account', 'Status', 'Reason', 'Changed At'];
  var rows = [header].concat(historyFiltered.map(function(h) {
    return [
      h.account_email || '',
      h.status        || '',
      (h.reason || '').replace(/"/g, '""'),
      h.changed_at ? new Date(h.changed_at).toLocaleString() : '',
    ].map(function(v) { return '"' + v + '"'; });
  }));

  var csv  = rows.map(function(r) { return r.join(','); }).join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'account-history.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function clearAccountHistory(id, email) {
  if (!confirm('Clear ALL status history for ' + email + '? This cannot be undone.')) return;
  try {
    var r = await api('/warmup/accounts/' + id + '/history', { method: 'DELETE' });
    toast('Cleared ' + (r.deleted || 0) + ' history record(s) for ' + email, 'success');
    // Remove from local cache and re-render
    historyData     = historyData.filter(function(h) { return h.account_id !== id; });
    applyHistoryFilters();
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function showAccountHistory(id, email) {
  var modal   = el('account-history-modal');
  var content = el('acct-hist-content');
  var emailEl = el('acct-hist-email');
  var clearBtn = el('acct-hist-clear-btn');

  if (emailEl) emailEl.textContent = email;
  if (content) content.innerHTML = '<div style="padding:24px;text-align:center;color:#6b7280"><span class="spinner"></span> Loading…</div>';
  if (clearBtn) { clearBtn.onclick = function() { clearAccountHistory(id, email); closeAccountHistoryModal(); }; }
  if (modal) modal.style.display = 'flex';

  try {
    var data = await api('/warmup/accounts/' + id + '/history');
    var history = data.history || [];

    if (!history.length) {
      if (content) content.innerHTML = '<div style="padding:24px;color:#6b7280">No history records for this account.</div>';
      return;
    }

    if (content) {
      content.innerHTML = '<table class="data-table"><thead><tr>' +
        '<th>Status</th><th>Reason</th><th>Changed At</th>' +
        '</tr></thead><tbody>' +
        history.map(function(h) {
          var date = h.changed_at ? new Date(h.changed_at).toLocaleString() : '—';
          return '<tr>' +
            '<td>' + historyStatusBadge(h.status) + '</td>' +
            '<td style="color:#d1d5db;font-size:12px;max-width:280px">' + (h.reason || '—') + '</td>' +
            '<td style="color:#9ca3af;font-size:12px;white-space:nowrap">' + date + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }
  } catch(e) {
    if (content) content.innerHTML = '<div style="padding:24px;color:#ef4444">' + e.message + '</div>';
  }
}

function closeAccountHistoryModal(event) {
  if (!event || event.target === el('account-history-modal')) {
    var modal = el('account-history-modal');
    if (modal) modal.style.display = 'none';
  }
}

// ─── Conversation Topics Library ──────────────────────────────────────────────
var topicsLibraryData = [];

async function loadTopicsLibrary() {
  var grid = el('topics-library-grid');
  if (grid) grid.innerHTML = '<div class="card" style="padding:32px;text-align:center;color:#6b7280"><span class="spinner"></span> Loading topics…</div>';
  try {
    topicsLibraryData = await api('/warmup/library/topics');
    renderTopicsGrid(topicsLibraryData);
  } catch(e) {
    if (grid) grid.innerHTML = '<div class="card" style="padding:32px;color:#ef4444">' + e.message + '</div>';
  }
}

function renderTopicsGrid(topics) {
  var grid = el('topics-library-grid');
  var badge = el('lib-count-badge');
  if (badge) badge.textContent = topics.length + ' topic' + (topics.length !== 1 ? 's' : '') + ' in library';
  if (!grid) return;

  if (!topics.length) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1;padding:32px;text-align:center;color:#6b7280">No topics found. Add your first topic above.</div>';
    return;
  }

  grid.innerHTML = topics.map(function(t) { return renderTopicCard(t); }).join('');
}

function renderTopicCard(t) {
  var usageColor  = t.usage_count > 0 ? '#6b7280' : '#374151';
  var usageText   = 'Used ' + t.usage_count + ' time' + (t.usage_count !== 1 ? 's' : '');
  var senderPrev  = (t.body_sender  || '').substring(0, 120) + ((t.body_sender  || '').length > 120 ? '…' : '');
  var receiverPrev = (t.body_receiver || '').substring(0, 120) + ((t.body_receiver || '').length > 120 ? '…' : '');

  return '<div class="card" id="topic-card-' + t.id + '" style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">' +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">' +
      '<div style="font-size:15px;font-weight:800;color:#e5e7eb;line-height:1.3">' + escHtml(t.topic) + '</div>' +
      '<span style="font-size:11px;color:' + usageColor + ';background:#1f2937;border:1px solid #374151;padding:2px 8px;border-radius:999px;white-space:nowrap;flex-shrink:0">' + usageText + '</span>' +
    '</div>' +
    '<div style="font-size:12px;color:#9ca3af"><span style="color:#6b7280">Subject: </span>' + escHtml(t.subject) + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div style="background:#0f1923;border:1px solid #1f2937;border-radius:6px;padding:10px">' +
        '<div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Sender</div>' +
        '<div style="font-size:12px;color:#d1d5db;line-height:1.5">' + escHtml(senderPrev) + '</div>' +
      '</div>' +
      '<div style="background:#0f1923;border:1px solid #1f2937;border-radius:6px;padding:10px">' +
        '<div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Receiver</div>' +
        '<div style="font-size:12px;color:#d1d5db;line-height:1.5">' + escHtml(receiverPrev) + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-ghost btn-sm" onclick="editTopic(' + t.id + ')" style="border-color:#4338ca;color:#a5b4fc">Edit</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="previewTopic(' + t.id + ')">Preview Conversation</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="confirmDeleteTopic(' + t.id + ',' + t.usage_count + ')" style="border-color:#ef4444;color:#ef4444">Delete</button>' +
    '</div>' +
  '</div>';
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function filterTopicsBySearch() {
  var q = (el('lib-search') || {}).value || '';
  q = q.toLowerCase().trim();
  if (!q) { renderTopicsGrid(topicsLibraryData); return; }
  var filtered = topicsLibraryData.filter(function(t) {
    return t.topic.toLowerCase().includes(q);
  });
  renderTopicsGrid(filtered);
}

function searchTopics() { filterTopicsBySearch(); }

function showAddTopicForm() {
  var card = el('add-topic-form-card');
  if (card) { card.style.display = 'block'; card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  ['new-topic-name','new-topic-subject','new-topic-sender','new-topic-receiver'].forEach(function(id) {
    var e = el(id); if (e) e.value = '';
  });
  var res = el('add-topic-result'); if (res) res.textContent = '';
}

function hideAddTopicForm() {
  var card = el('add-topic-form-card');
  if (card) card.style.display = 'none';
}

function toggleLibTips() {
  var body = el('lib-tips-body');
  var btn  = el('lib-tips-toggle');
  if (!body) return;
  var visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : 'block';
  if (btn) btn.textContent = (visible ? '▶' : '▼') + ' Writing Tips';
}

async function saveTopic() {
  var topic       = ((el('new-topic-name')     || {}).value || '').trim();
  var subject     = ((el('new-topic-subject')  || {}).value || '').trim();
  var body_sender = ((el('new-topic-sender')   || {}).value || '').trim();
  var body_receiver = ((el('new-topic-receiver') || {}).value || '').trim();
  var res = el('add-topic-result');

  if (!topic || !subject || !body_sender || !body_receiver) {
    if (res) { res.style.color = '#ef4444'; res.textContent = 'All four fields are required.'; }
    return;
  }

  try {
    var created = await api('/warmup/library/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, subject, body_sender, body_receiver }),
    });
    topicsLibraryData.unshift(created);
    hideAddTopicForm();
    renderTopicsGrid(topicsLibraryData);
    toast('Topic "' + created.topic + '" added successfully', 'success');
  } catch(e) {
    if (res) { res.style.color = '#ef4444'; res.textContent = e.message; }
  }
}

function editTopic(id) {
  var t = topicsLibraryData.find(function(x) { return x.id === id; });
  if (!t) return;
  var card = el('topic-card-' + id);
  if (!card) return;

  card.innerHTML =
    '<div style="font-size:13px;font-weight:700;color:#a5b4fc;margin-bottom:12px">Edit Topic</div>' +
    '<div class="form-group" style="margin-bottom:10px"><label style="font-size:11px">Topic Name</label>' +
      '<input id="edit-topic-name-' + id + '" value="' + escHtml(t.topic) + '"></div>' +
    '<div class="form-group" style="margin-bottom:10px"><label style="font-size:11px">Subject Line</label>' +
      '<input id="edit-topic-subject-' + id + '" value="' + escHtml(t.subject) + '"></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
      '<div class="form-group" style="margin:0"><label style="font-size:11px">Sender Message</label>' +
        '<textarea id="edit-topic-sender-' + id + '" rows="5">' + escHtml(t.body_sender) + '</textarea></div>' +
      '<div class="form-group" style="margin:0"><label style="font-size:11px">Receiver Reply</label>' +
        '<textarea id="edit-topic-receiver-' + id + '" rows="5">' + escHtml(t.body_receiver) + '</textarea></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-primary" onclick="saveEditTopic(' + id + ')" style="background:#4338ca;border-color:#4338ca">Save Changes</button>' +
      '<button class="btn btn-ghost" onclick="cancelEditTopic(' + id + ')">Cancel</button>' +
    '</div>' +
    '<div id="edit-topic-result-' + id + '" style="margin-top:8px;font-size:12px"></div>';
}

function cancelEditTopic(id) {
  var t = topicsLibraryData.find(function(x) { return x.id === id; });
  if (!t) return;
  var card = el('topic-card-' + id);
  if (card) card.outerHTML = renderTopicCard(t);
}

async function saveEditTopic(id) {
  var topic       = ((el('edit-topic-name-'     + id) || {}).value || '').trim();
  var subject     = ((el('edit-topic-subject-'  + id) || {}).value || '').trim();
  var body_sender = ((el('edit-topic-sender-'   + id) || {}).value || '').trim();
  var body_receiver = ((el('edit-topic-receiver-' + id) || {}).value || '').trim();
  var res = el('edit-topic-result-' + id);

  if (!topic || !subject || !body_sender || !body_receiver) {
    if (res) { res.style.color = '#ef4444'; res.textContent = 'All four fields are required.'; }
    return;
  }

  try {
    var updated = await api('/warmup/library/topics/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, subject, body_sender, body_receiver }),
    });
    var idx = topicsLibraryData.findIndex(function(x) { return x.id === id; });
    if (idx !== -1) topicsLibraryData[idx] = updated;
    var card = el('topic-card-' + id);
    if (card) card.outerHTML = renderTopicCard(updated);
    toast('Topic updated', 'success');
  } catch(e) {
    if (res) { res.style.color = '#ef4444'; res.textContent = e.message; }
  }
}

async function previewTopic(id) {
  var t = topicsLibraryData.find(function(x) { return x.id === id; });
  var modal   = el('topic-preview-modal');
  var content = el('preview-modal-content');
  var topicEl = el('preview-modal-topic');

  if (topicEl) topicEl.textContent = t ? t.topic : '';
  if (content) content.innerHTML = '<div style="padding:24px;text-align:center;color:#6b7280"><span class="spinner"></span> Generating preview…</div>';
  if (modal) modal.style.display = 'flex';

  try {
    var conv = await api('/warmup/library/topics/' + id + '/preview');
    var emails = conv.emails || [];

    if (content) {
      content.innerHTML = '<div style="display:flex;flex-direction:column;gap:14px">' +
        emails.map(function(email, i) {
          var isSender = i % 2 === 0;
          var align  = isSender ? 'flex-start' : 'flex-end';
          var bg     = isSender ? '#1e1b4b' : '#052e16';
          var border = isSender ? '#3730a3' : '#166534';
          var nameColor = isSender ? '#a5b4fc' : '#4ade80';
          var label  = isSender ? 'Sender' : 'Receiver';
          var time   = email.scheduled_time_offset_minutes != null
            ? 'T+' + email.scheduled_time_offset_minutes + ' min'
            : '';

          return '<div style="display:flex;justify-content:' + align + '">' +
            '<div style="max-width:85%;background:' + bg + ';border:1px solid ' + border + ';border-radius:8px;padding:12px 14px">' +
              '<div style="font-size:10px;font-weight:700;color:' + nameColor + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">' + label + '</div>' +
              '<div style="font-size:11px;color:#6b7280;margin-bottom:6px">Subject: ' + escHtml(email.subject || '') + '</div>' +
              '<div style="font-size:13px;color:#e5e7eb;line-height:1.6">' + escHtml(email.body || '') + '</div>' +
              (time ? '<div style="font-size:10px;color:#4b5563;margin-top:8px">' + time + '</div>' : '') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }
  } catch(e) {
    if (content) content.innerHTML = '<div style="padding:24px;color:#ef4444">' + e.message + '</div>';
  }
}

function closeTopicPreviewModal(event) {
  if (!event || event.target === el('topic-preview-modal')) {
    var modal = el('topic-preview-modal');
    if (modal) modal.style.display = 'none';
  }
}

function confirmDeleteTopic(id, usageCount) {
  var card = el('topic-card-' + id);
  if (!card) return;
  var t = topicsLibraryData.find(function(x) { return x.id === id; });
  var name = t ? t.topic : 'this topic';

  // Remove any existing confirmation row
  var existing = card.querySelector('.delete-confirm-row');
  if (existing) { existing.remove(); return; }

  var warn = usageCount > 0
    ? 'This topic has been used ' + usageCount + ' time(s). Deletion will not affect already-scheduled conversations.'
    : 'This action cannot be undone.';

  var row = document.createElement('div');
  row.className = 'delete-confirm-row';
  row.style.cssText = 'margin-top:8px;padding:10px 12px;background:#1c0000;border:1px solid #7f1d1d;border-radius:6px;font-size:12px';
  row.innerHTML =
    '<div style="color:#fca5a5;margin-bottom:8px">Are you sure? ' + escHtml(warn) + '</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-ghost btn-sm" onclick="doDeleteTopic(' + id + ')" style="border-color:#ef4444;color:#ef4444">Yes, Delete</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="this.closest(\'.delete-confirm-row\').remove()">Cancel</button>' +
    '</div>';
  card.appendChild(row);
}

async function doDeleteTopic(id) {
  try {
    var r = await api('/warmup/library/topics/' + id, { method: 'DELETE' });
    topicsLibraryData = topicsLibraryData.filter(function(x) { return x.id !== id; });
    var card = el('topic-card-' + id);
    if (card) {
      card.style.transition = 'opacity .3s';
      card.style.opacity = '0';
      setTimeout(function() {
        card.remove();
        renderTopicsGrid(topicsLibraryData);
      }, 300);
    }
    toast('Deleted topic "' + (r.deleted_topic || '') + '"', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

// ─── Warmup Calendar ──────────────────────────────────────────────────────────
var calendarState = {
  currentMonth: new Date().getMonth() + 1,
  currentYear:  new Date().getFullYear(),
  calendarData: null,
  selectedDay:  null,
  dayPanelOpen: false,
};

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function loadWarmupCalendar() {
  var grid = el('cal-grid');
  if (grid) grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:#6b7280"><span class="spinner"></span> Loading calendar…</div>';

  var label = el('cal-month-label');
  if (label) label.textContent = MONTH_NAMES[calendarState.currentMonth - 1] + ' ' + calendarState.currentYear;

  try {
    var data = await api('/warmup/calendar?month=' + calendarState.currentMonth + '&year=' + calendarState.currentYear);
    calendarState.calendarData = data;
    updateCalendarStats(data.monthly_summary);
    renderCalendar(data);
  } catch(e) {
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;color:#ef4444">' + e.message + '</div>';
  }
}

function updateCalendarStats(s) {
  if (!s) return;
  if (el('cal-stat-convs'))  el('cal-stat-convs').textContent  = s.total_conversations;
  if (el('cal-stat-sent'))   el('cal-stat-sent').textContent   = s.total_emails_sent;
  if (el('cal-stat-active')) el('cal-stat-active').textContent = s.days_with_activity;
  if (el('cal-stat-avg'))    el('cal-stat-avg').textContent    = s.average_daily_sends;
}

function renderCalendar(data) {
  var grid = el('cal-grid');
  if (!grid) return;

  var label = el('cal-month-label');
  if (label) label.textContent = MONTH_NAMES[data.month - 1] + ' ' + data.year;

  // First day of month DOW offset
  var firstDOW = data.days[0].day_of_week;
  var cells = '';

  // Empty leading cells
  for (var i = 0; i < firstDOW; i++) {
    cells += '<div style="min-height:90px;background:#0a0f14;border-right:1px solid #1f2937;border-bottom:1px solid #1f2937"></div>';
  }

  // Day cells
  data.days.forEach(function(day) {
    var isSelected = calendarState.selectedDay === day.date;
    var isGap = day.is_us_business_day && day.conversations.length === 0 && day.emails_sent === 0;

    var bg = day.is_weekend ? '#0d1117' : (isGap ? '#1a1500' : '#0f1923');
    var border = isSelected ? '2px solid #818cf8' : (day.is_today ? '2px solid #4338ca' : '1px solid #1f2937');

    // Conversation dots
    var dots = '';
    var dotCount = Math.min(3, day.conversations.length);
    for (var d = 0; d < dotCount; d++) {
      dots += '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#4ade80;margin-right:2px"></span>';
    }
    if (day.conversations.length > 3) {
      dots += '<span style="font-size:9px;color:#6b7280">+' + (day.conversations.length - 3) + '</span>';
    }

    // Gap indicator
    var gapIcon = isGap ? '<span style="font-size:13px;color:#d97706;position:absolute;bottom:6px;left:6px" title="No warmup activity">⊕</span>' : '';

    // Sent badge
    var sentBadge = day.emails_sent > 0
      ? '<span style="position:absolute;bottom:5px;right:5px;font-size:9px;font-weight:700;color:#4ade80;background:#052e16;border:1px solid #166534;padding:1px 5px;border-radius:999px">' + day.emails_sent + '</span>'
      : '';

    cells +=
      '<div data-date="' + day.date + '" ' +
           'data-sent="' + day.emails_sent + '" ' +
           'data-received="' + day.emails_received + '" ' +
           'data-convs="' + day.conversations.length + '" ' +
           'onclick="selectDay(\'' + day.date + '\')" ' +
           'onmouseover="showCalTooltip(event,this)" ' +
           'onmouseout="hideCalTooltip()" ' +
           'style="position:relative;min-height:90px;background:' + bg + ';border:' + border + ';padding:7px;cursor:pointer;transition:background .15s">' +
        '<div style="font-size:13px;font-weight:700;color:' + (day.is_today ? '#818cf8' : (day.is_weekend ? '#4b5563' : '#9ca3af')) + '">' + parseInt(day.date.split('-')[2]) + '</div>' +
        '<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:1px;align-items:center">' + dots + '</div>' +
        gapIcon +
        sentBadge +
      '</div>';
  });

  // Trailing empty cells to complete the last row
  var totalCells = firstDOW + data.days.length;
  var remainder  = totalCells % 7;
  if (remainder > 0) {
    for (var j = remainder; j < 7; j++) {
      cells += '<div style="min-height:90px;background:#0a0f14;border-right:1px solid #1f2937;border-bottom:1px solid #1f2937"></div>';
    }
  }

  grid.innerHTML = cells;
}

function navigateCalendar(direction) {
  calendarState.currentMonth += direction;
  if (calendarState.currentMonth > 12) { calendarState.currentMonth = 1;  calendarState.currentYear++; }
  if (calendarState.currentMonth < 1)  { calendarState.currentMonth = 12; calendarState.currentYear--; }
  calendarState.selectedDay  = null;
  calendarState.dayPanelOpen = false;
  var panel = el('cal-day-panel');
  if (panel) panel.style.display = 'none';
  loadWarmupCalendar();
}

function navigateCalendarToday() {
  var now = new Date();
  calendarState.currentMonth = now.getMonth() + 1;
  calendarState.currentYear  = now.getFullYear();
  calendarState.selectedDay  = null;
  calendarState.dayPanelOpen = false;
  var panel = el('cal-day-panel');
  if (panel) panel.style.display = 'none';
  loadWarmupCalendar();
}

async function selectDay(dateStr) {
  calendarState.selectedDay  = dateStr;
  calendarState.dayPanelOpen = true;

  // Update panel header immediately
  var panel    = el('cal-day-panel');
  var dateEl   = el('cal-panel-date');
  var content  = el('cal-panel-content');
  if (panel) panel.style.display = 'block';
  if (dateEl) {
    var d = new Date(dateStr + 'T00:00:00');
    dateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  if (content) content.innerHTML = '<div style="text-align:center;color:#6b7280;padding:20px"><span class="spinner"></span></div>';

  // Re-render grid to reflect selection border
  if (calendarState.calendarData) renderCalendar(calendarState.calendarData);

  try {
    var data = await api('/warmup/calendar/day/' + dateStr);
    renderDayPanel(data, dateStr);
  } catch(e) {
    if (content) content.innerHTML = '<div style="color:#ef4444">' + e.message + '</div>';
  }
}

function renderDayPanel(data, dateStr) {
  var content = el('cal-panel-content');
  if (!content) return;

  var html = '';

  // Conversations section
  html += '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Conversations (' + data.conversations.length + ')</div>';

  if (data.conversations.length) {
    html += data.conversations.map(function(f) {
      var statusColor = f.status === 'scheduled' ? '#4ade80' : (f.status === 'sent' ? '#818cf8' : '#6b7280');
      return '<div style="background:#0f1923;border:1px solid #1f2937;border-radius:6px;padding:10px;margin-bottom:8px">' +
        (f.topic ? '<span style="font-size:10px;font-weight:700;color:#a5b4fc;background:#1e1b4b;border:1px solid #3730a3;padding:2px 7px;border-radius:999px;display:inline-block;margin-bottom:5px">' + escHtml(f.topic) + '</span>' : '') +
        '<div style="font-size:11px;color:#9ca3af">' + escHtml(f.filename) + '</div>' +
        '<div style="display:flex;gap:10px;margin-top:5px;font-size:11px">' +
          '<span style="color:#6b7280">' + f.email_count + ' emails</span>' +
          '<span style="color:' + statusColor + '">' + f.status + '</span>' +
          (f.source ? '<span style="color:#374151">' + f.source + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  } else {
    html += '<div style="color:#6b7280;font-size:12px;margin-bottom:12px">No conversations scheduled.</div>';
  }

  // Activity section
  html += '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin:12px 0 8px">Activity</div>';

  if (data.per_account && data.per_account.length) {
    html += '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<div style="flex:1;background:#052e16;border:1px solid #166534;border-radius:6px;padding:8px;text-align:center">' +
        '<div style="font-size:18px;font-weight:800;color:#4ade80">' + data.total_sent + '</div>' +
        '<div style="font-size:10px;color:#6b7280">Sent</div>' +
      '</div>' +
      '<div style="flex:1;background:#1e1b4b;border:1px solid #3730a3;border-radius:6px;padding:8px;text-align:center">' +
        '<div style="font-size:18px;font-weight:800;color:#a5b4fc">' + data.total_received + '</div>' +
        '<div style="font-size:10px;color:#6b7280">Received</div>' +
      '</div>' +
    '</div>';

    html += data.per_account.map(function(a) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1f2937;font-size:11px">' +
        '<span style="color:#9ca3af;font-family:monospace">' + escHtml(a.email) + '</span>' +
        '<span style="color:#4ade80">' + a.sent + '↑ <span style="color:#818cf8">' + a.received + '↓</span></span>' +
      '</div>';
    }).join('');
  } else {
    // Empty state — offer generate button
    html += '<div style="text-align:center;padding:16px;color:#6b7280;font-size:12px">' +
      'No warmup activity on this day.<br>' +
      '<button class="btn btn-ghost btn-sm" onclick="navigate(\'conversations\')" style="margin-top:10px;border-color:#4338ca;color:#a5b4fc">Generate a Conversation</button>' +
    '</div>';
  }

  content.innerHTML = html;
}

function closeDayPanel() {
  calendarState.selectedDay  = null;
  calendarState.dayPanelOpen = false;
  var panel = el('cal-day-panel');
  if (panel) panel.style.display = 'none';
  if (calendarState.calendarData) renderCalendar(calendarState.calendarData);
}

function showCalTooltip(event, cell) {
  var tip = el('cal-tooltip');
  if (!tip) return;
  var date     = cell.dataset.date     || '';
  var sent     = cell.dataset.sent     || '0';
  var received = cell.dataset.received || '0';
  var convs    = cell.dataset.convs    || '0';

  var d = new Date(date + 'T00:00:00');
  var label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  tip.innerHTML =
    '<div style="font-weight:700;margin-bottom:4px">' + label + '</div>' +
    '<div style="color:#9ca3af">📅 ' + convs + ' conversation' + (convs !== '1' ? 's' : '') + '</div>' +
    '<div style="color:#4ade80">↑ ' + sent + ' sent</div>' +
    '<div style="color:#818cf8">↓ ' + received + ' received</div>';

  tip.style.display = 'block';
  tip.style.left = (event.clientX + 12) + 'px';
  tip.style.top  = (event.clientY + 12) + 'px';
}

function hideCalTooltip() {
  var tip = el('cal-tooltip');
  if (tip) tip.style.display = 'none';
}

// ─── Warmup Analytics ────────────────────────────────────────────────────────
var analyticsCharts = {};

var CHART_PALETTE = [
  '#818cf8','#4ade80','#f59e0b','#f87171','#38bdf8',
  '#a78bfa','#34d399','#fb923c','#e879f9','#2dd4bf',
];

function destroyChart(key) {
  if (analyticsCharts[key]) {
    analyticsCharts[key].destroy();
    delete analyticsCharts[key];
  }
}

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
      tooltip: { backgroundColor: '#0f1923', titleColor: '#e5e7eb', bodyColor: '#9ca3af', borderColor: '#374151', borderWidth: 1 },
    },
    scales: {
      x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: '#1f2937' } },
      y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: '#1f2937' } },
    },
  };
}

async function loadWarmupAnalytics() {
  var days = (el('analytics-days') || {}).value || '14';
  // Show spinners in canvases while loading
  ['chart-daily-activity','chart-per-account','chart-topics','chart-hourly','chart-weekly'].forEach(function(id) {
    destroyChart(id);
  });
  var pairsEl = el('analytics-pairs-table');
  if (pairsEl) pairsEl.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  try {
    var data = await api('/warmup/analytics?days=' + days);
    renderAllCharts(data);
  } catch(e) {
    if (pairsEl) pairsEl.innerHTML = '<div style="color:#ef4444">' + e.message + '</div>';
    toast(e.message, 'error');
  }
}

function renderAllCharts(data) {
  renderDailyActivityChart(data.daily_sends);
  renderPerAccountChart(data.per_account_stats);
  renderTopicChart(data.topic_distribution);
  renderHourlyChart(data.hourly_distribution);
  renderWeeklyChart(data.weekly_trend);
  renderPairsTable(data.pair_activity);
}

function renderDailyActivityChart(dailySends) {
  destroyChart('chart-daily-activity');
  var canvas = el('chart-daily-activity');
  if (!canvas) return;

  var labels  = dailySends.map(function(d) {
    var parts = d.date.split('-');
    return parts[1] + '/' + parts[2];
  });
  var sent     = dailySends.map(function(d) { return d.sent; });
  var received = dailySends.map(function(d) { return d.received; });

  var cfg = chartDefaults();
  analyticsCharts['chart-daily-activity'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Sent',
          data: sent,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(129,140,248,0.12)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#818cf8',
        },
        {
          label: 'Received',
          data: received,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74,222,128,0.06)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#4ade80',
        },
      ],
    },
    options: cfg,
  });
}

function renderPerAccountChart(accounts) {
  destroyChart('chart-per-account');
  var canvas = el('chart-per-account');
  if (!canvas) return;

  var sorted = accounts.slice().sort(function(a, b) { return b.total_sent - a.total_sent; });
  var labels = sorted.map(function(a) {
    return a.email.length > 22 ? a.email.slice(0, 22) + '…' : a.email;
  });
  var values = sorted.map(function(a) { return a.total_sent; });
  var colors = sorted.map(function(_, i) {
    var hue = (i * (360 / Math.max(sorted.length, 1))) % 360;
    return 'hsl(' + hue + ',65%,55%)';
  });

  var cfg = chartDefaults();
  cfg.indexAxis = 'y';
  cfg.plugins.legend = { display: false };
  cfg.scales.x.title = { display: false };

  analyticsCharts['chart-per-account'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ label: 'Emails Sent', data: values, backgroundColor: colors, borderRadius: 4 }],
    },
    options: cfg,
  });
}

function renderTopicChart(topics) {
  destroyChart('chart-topics');
  var canvas = el('chart-topics');
  if (!canvas) return;

  if (!topics || !topics.length) {
    var ctx = canvas.getContext('2d');
    if (ctx) { ctx.fillStyle = '#6b7280'; ctx.font = '13px sans-serif'; ctx.fillText('No topic data yet', 40, 120); }
    return;
  }

  var labels = topics.map(function(t) {
    var name = t.topic || 'Unknown';
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
  var values = topics.map(function(t) { return t.count; });
  var colors = topics.map(function(_, i) { return CHART_PALETTE[i % CHART_PALETTE.length]; });

  analyticsCharts['chart-topics'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ data: values, backgroundColor: colors, borderColor: '#0f1923', borderWidth: 2, hoverOffset: 6 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10 }, padding: 10, boxWidth: 12 } },
        tooltip: {
          backgroundColor: '#0f1923', titleColor: '#e5e7eb', bodyColor: '#9ca3af', borderColor: '#374151', borderWidth: 1,
          callbacks: {
            label: function(ctx) {
              var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
              var pct   = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
              return ' ' + ctx.label + ': ' + ctx.parsed + ' (' + pct + '%)';
            },
          },
        },
      },
    },
  });
}

function renderHourlyChart(hourly) {
  destroyChart('chart-hourly');
  var canvas = el('chart-hourly');
  if (!canvas) return;

  var labels = hourly.map(function(h) {
    if (h.hour === 0)  return '12am';
    if (h.hour === 12) return '12pm';
    return h.hour < 12 ? h.hour + 'am' : (h.hour - 12) + 'pm';
  });
  var values = hourly.map(function(h) { return h.count; });
  var colors = hourly.map(function(h) {
    return (h.hour >= 8 && h.hour < 18) ? '#818cf8' : '#374151';
  });

  var cfg = chartDefaults();
  cfg.plugins.legend = { display: false };

  analyticsCharts['chart-hourly'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ label: 'Emails', data: values, backgroundColor: colors, borderRadius: 3 }],
    },
    options: cfg,
  });
}

function renderWeeklyChart(weekly) {
  destroyChart('chart-weekly');
  var canvas = el('chart-weekly');
  if (!canvas) return;

  // Trend arrow
  var arrowEl = el('weekly-trend-arrow');
  if (arrowEl && weekly.length >= 2) {
    var last = weekly[weekly.length - 1].total_sent;
    var prev = weekly[weekly.length - 2].total_sent;
    if (last > prev)      { arrowEl.textContent = '↑'; arrowEl.style.color = '#4ade80'; }
    else if (last < prev) { arrowEl.textContent = '↓'; arrowEl.style.color = '#f87171'; }
    else                  { arrowEl.textContent = '→'; arrowEl.style.color = '#6b7280'; }
  }

  var labels = weekly.map(function(w) {
    if (!w.week_start) return '—';
    var d = new Date(w.week_start + 'T00:00:00');
    return 'Wk of ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  var values = weekly.map(function(w) { return w.total_sent; });

  var cfg = chartDefaults();
  cfg.plugins.legend = { display: false };

  analyticsCharts['chart-weekly'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ label: 'Emails Sent', data: values, backgroundColor: '#818cf8', borderRadius: 5 }],
    },
    options: cfg,
  });
}

function renderPairsTable(pairs) {
  var el2 = el('analytics-pairs-table');
  if (!el2) return;

  if (!pairs || !pairs.length) {
    el2.innerHTML = '<div style="color:#6b7280;font-size:13px">No pair activity recorded yet.</div>';
    return;
  }

  function relTime(dateStr) {
    if (!dateStr) return '—';
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins  = Math.floor(diff / 60000);
    var hours = Math.floor(mins / 60);
    var days  = Math.floor(hours / 24);
    if (days > 0)  return days  + ' day'  + (days  !== 1 ? 's' : '') + ' ago';
    if (hours > 0) return hours + ' hour' + (hours !== 1 ? 's' : '') + ' ago';
    if (mins  > 0) return mins  + ' min'  + (mins  !== 1 ? 's' : '') + ' ago';
    return 'Just now';
  }

  function trunc(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || '—'); }

  el2.innerHTML = '<table class="data-table"><thead><tr>' +
    '<th>#</th><th>Sender</th><th>Receiver</th><th>Times Paired</th><th>Last Active</th>' +
    '</tr></thead><tbody>' +
    pairs.map(function(p, i) {
      return '<tr>' +
        '<td style="color:#6b7280;font-size:12px">' + (i + 1) + '</td>' +
        '<td style="font-family:monospace;font-size:12px">' + trunc(p.sender_email, 28) + '</td>' +
        '<td style="font-family:monospace;font-size:12px">' + trunc(p.receiver_email, 28) + '</td>' +
        '<td style="font-weight:700;color:#818cf8">' + p.pair_count + '</td>' +
        '<td style="color:#6b7280;font-size:12px">' + relTime(p.last_paired_at) + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

function changeDays() {
  loadWarmupAnalytics();
}

// ─── Reply Queue ──────────────────────────────────────────────────────────────
var replyQueueData = [];

function showWarmupLogTab() {
  el('tab-content-log').style.display   = 'block';
  el('tab-content-queue').style.display = 'none';
  el('tab-warmup-log').style.color      = '#818cf8';
  el('tab-warmup-log').style.borderBottomColor = '#818cf8';
  el('tab-reply-queue').style.color     = '#6b7280';
  el('tab-reply-queue').style.borderBottomColor = 'transparent';
}

function showReplyQueueTab() {
  el('tab-content-log').style.display   = 'none';
  el('tab-content-queue').style.display = 'block';
  el('tab-reply-queue').style.color     = '#818cf8';
  el('tab-reply-queue').style.borderBottomColor = '#818cf8';
  el('tab-warmup-log').style.color      = '#6b7280';
  el('tab-warmup-log').style.borderBottomColor  = 'transparent';
  loadReplyQueue();
}

function replyQueueStatusBadge(status) {
  var map = {
    pending: { label: 'Pending', color: '#f59e0b', bg: '#1a1200' },
    sent:    { label: 'Sent',    color: '#4ade80', bg: '#052e16' },
    failed:  { label: 'Failed',  color: '#f87171', bg: '#1c0000' },
    skipped: { label: 'Skipped', color: '#6b7280', bg: '#1f2937' },
  };
  var m = map[status] || { label: status, color: '#9ca3af', bg: '#1f2937' };
  return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:' + m.bg + ';color:' + m.color + ';border:1px solid ' + m.color + '44">' + m.label + '</span>';
}

function threadLevelBadge(level) {
  var colors = ['#818cf8','#4ade80','#f59e0b','#f87171'];
  var c = colors[(level - 1) % colors.length];
  return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44">L' + level + '</span>';
}

function toEasternTime(isoStr) {
  if (!isoStr) return '—';
  try {
    var d = new Date(isoStr);
    return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch(e) { return isoStr; }
}

async function loadReplyQueue() {
  var tableEl = el('reply-queue-table');
  if (tableEl) tableEl.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  var status = (el('rq-status-filter') || {}).value || '';
  try {
    var data = await api('/warmup/reply-queue' + (status ? '?status=' + status : ''));
    replyQueueData = data;

    // Stats
    var pending = data.filter(function(r) { return r.status === 'pending'; }).length;
    var failed  = data.filter(function(r) { return r.status === 'failed';  }).length;
    var today   = new Date().toISOString().slice(0, 10);
    var sentToday = data.filter(function(r) { return r.status === 'sent' && r.created_at && r.created_at.slice(0, 10) === today; }).length;

    if (el('rq-stat-pending')) el('rq-stat-pending').textContent = pending;
    if (el('rq-stat-sent'))    el('rq-stat-sent').textContent    = sentToday;
    if (el('rq-stat-failed'))  el('rq-stat-failed').textContent  = failed;

    if (!data.length) {
      if (tableEl) tableEl.innerHTML = '<div style="padding:24px;text-align:center;color:#6b7280">No reply queue entries found.</div>';
      return;
    }

    if (tableEl) {
      tableEl.innerHTML = '<table class="data-table"><thead><tr>' +
        '<th>Level</th><th>From</th><th>To</th><th>Subject</th><th>Scheduled (ET)</th><th>Status</th>' +
        '</tr></thead><tbody>' +
        data.map(function(r) {
          var subj = (r.subject || '').length > 36 ? r.subject.slice(0, 36) + '…' : (r.subject || '');
          return '<tr>' +
            '<td>' + threadLevelBadge(r.thread_level) + '</td>' +
            '<td style="font-family:monospace;font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.from_email || '') + '</td>' +
            '<td style="font-family:monospace;font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.to_email   || '') + '</td>' +
            '<td style="font-size:12px;color:#9ca3af">' + escHtml(subj) + '</td>' +
            '<td style="font-size:12px;white-space:nowrap;color:#6b7280">' + toEasternTime(r.scheduled_at) + '</td>' +
            '<td>' + replyQueueStatusBadge(r.status) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }
  } catch(e) {
    if (tableEl) tableEl.innerHTML = '<div style="padding:24px;color:#ef4444">' + e.message + '</div>';
  }
}

async function processQueueNow() {
  var btn = el('rq-process-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing…'; }
  try {
    var r = await api('/warmup/reply-queue/process', { method: 'POST' });
    toast('Processed ' + r.processed + ' reply(ies)', 'success');
    loadReplyQueue();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Process Queue Now'; }
  }
}

async function clearSentQueue() {
  if (!confirm('Delete all sent reply queue entries? This cannot be undone.')) return;
  try {
    var r = await api('/warmup/reply-queue/clear', { method: 'DELETE' });
    toast('Cleared ' + r.deleted + ' sent entry(ies)', 'success');
    loadReplyQueue();
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function loadReplyQueueDashboardCard() {
  var el2 = el('wd-reply-queue-status');
  if (!el2) return;
  try {
    var data = await api('/warmup/reply-queue?status=pending');
    var pending = data.length;
    var next = pending > 0 ? data[0] : null;

    if (pending === 0) {
      el2.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="font-size:20px">✅</span>' +
          '<div>' +
            '<div style="font-size:14px;font-weight:700;color:#4ade80">All caught up</div>' +
            '<div style="font-size:12px;color:#6b7280">No pending replies in queue</div>' +
          '</div>' +
        '</div>';
    } else {
      el2.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:24px;font-weight:800;color:#f59e0b">' + pending + '</span>' +
            '<div>' +
              '<div style="font-size:13px;font-weight:700;color:#e5e7eb">Pending replies</div>' +
              (next ? '<div style="font-size:11px;color:#6b7280">Next: ' + toEasternTime(next.scheduled_at) + ' ET</div>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
    }
  } catch(e) {
    if (el2) el2.innerHTML = '<div style="color:#6b7280;font-size:12px">Could not load queue status</div>';
  }
}

// ─── Inbox Placement Test ─────────────────────────────────────────────────────

var currentTestIds = [];

function placementBadge(placement) {
  var map = {
    inbox:      { color: '#4ade80', bg: '#052e16', label: 'Inbox' },
    spam:       { color: '#f87171', bg: '#2d0a0a', label: 'Spam' },
    promotions: { color: '#fbbf24', bg: '#2d1a00', label: 'Promotions' },
    unknown:    { color: '#9ca3af', bg: '#1f2937', label: 'Unknown' },
  };
  var s = map[placement] || map.unknown;
  return '<span style="padding:2px 9px;border-radius:12px;font-size:11px;font-weight:700;background:' + s.bg + ';color:' + s.color + '">' + s.label + '</span>';
}

function togglePlacementGuide() {
  var body = el('placement-guide-body');
  var arrow = el('placement-guide-arrow');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▶' : '▼';
}

async function loadPlacementAccounts() {
  var tbody = el('placement-accounts-table');
  if (!tbody) return;
  try {
    var rows = await api('/warmup/placement/accounts');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:20px">No test inboxes added yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(r) {
      return '<tr>' +
        '<td style="padding:8px 12px">' + escHtml(r.email) + '</td>' +
        '<td style="padding:8px 12px">' + escHtml(r.provider || 'gmail') + '</td>' +
        '<td style="padding:8px 12px">' + escHtml(r.label || '—') + '</td>' +
        '<td style="padding:8px 12px">' +
          '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:' +
          (r.active ? '#052e16' : '#1f2937') + ';color:' + (r.active ? '#4ade80' : '#9ca3af') + '">' +
          (r.active ? 'Active' : 'Inactive') + '</span>' +
        '</td>' +
        '<td style="padding:8px 12px">' +
          '<button onclick="deletePlacementAccount(' + r.id + ')" style="background:#7f1d1d;color:#fca5a5;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">Remove</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#f87171;padding:12px">Error loading accounts: ' + escHtml(e.message) + '</td></tr>';
  }
}

async function addPlacementAccount() {
  var emailVal = (el('pt-email') || {}).value || '';
  var password = (el('pt-password') || {}).value || '';
  var provider = (el('pt-provider') || {}).value || 'gmail';
  var label = (el('pt-label') || {}).value || '';
  var resultEl = el('pt-add-result');

  if (!emailVal || !password) {
    if (resultEl) resultEl.innerHTML = '<span style="color:#f87171">Email and password are required.</span>';
    return;
  }

  if (resultEl) resultEl.innerHTML = '<span style="color:#9ca3af">Adding…</span>';
  try {
    await api('/warmup/placement/accounts', {
      method: 'POST',
      body: JSON.stringify({ email: emailVal, app_password: password, provider: provider, label: label })
    });
    ['pt-email','pt-password','pt-label'].forEach(function(id) { if (el(id)) el(id).value = ''; });
    if (resultEl) resultEl.innerHTML = '<span style="color:#4ade80">Test inbox added.</span>';
    await loadPlacementAccounts();
  } catch(e) {
    if (resultEl) resultEl.innerHTML = '<span style="color:#f87171">' + escHtml(e.message) + '</span>';
  }
}

async function deletePlacementAccount(id) {
  if (!confirm('Remove this test inbox?')) return;
  try {
    await api('/warmup/placement/accounts/' + id, { method: 'DELETE' });
    toast('Test inbox removed', 'success');
    await loadPlacementAccounts();
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function runPlacementTest() {
  var sendingAccountEl = el('pt-sending-account');
  var testNameEl = el('pt-test-name');
  var btn = el('pt-run-btn');
  var resultEl = el('pt-run-result');

  var accountId = sendingAccountEl ? sendingAccountEl.value : '';
  var testName = testNameEl ? testNameEl.value.trim() : '';

  if (!accountId) {
    toast('Please select a sending account', 'error');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending test emails…'; }
  if (resultEl) resultEl.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center">Sending…</div>';

  try {
    var result = await api('/warmup/placement/run', {
      method: 'POST',
      body: JSON.stringify({ sending_account_id: parseInt(accountId), test_name: testName || 'Placement Test' })
    });

    currentTestIds = result.test_ids || [];

    var rows = (result.test_emails || []).map(function(email, i) {
      var testId = currentTestIds[i] || null;
      return '<tr id="pt-row-' + testId + '">' +
        '<td style="padding:8px 12px">' + escHtml(email) + '</td>' +
        '<td style="padding:8px 12px" id="pt-status-' + testId + '">' +
          '<span style="color:#fbbf24">Awaiting report…</span>' +
        '</td>' +
        '<td style="padding:8px 12px" id="pt-actions-' + testId + '">' +
          '<button onclick="reportPlacement(' + testId + ',\'inbox\')" style="background:#052e16;color:#4ade80;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;margin-right:4px">Inbox</button>' +
          '<button onclick="reportPlacement(' + testId + ',\'spam\')" style="background:#2d0a0a;color:#f87171;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;margin-right:4px">Spam</button>' +
          '<button onclick="reportPlacement(' + testId + ',\'promotions\')" style="background:#2d1a00;color:#fbbf24;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;margin-right:4px">Promotions</button>' +
          '<button onclick="reportPlacement(' + testId + ',\'unknown\')" style="background:#1f2937;color:#9ca3af;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px">Unknown</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    resultEl.innerHTML =
      '<div style="background:#1a2332;border-radius:10px;padding:16px;margin-top:8px">' +
        '<div style="font-size:14px;font-weight:700;color:#e5e7eb;margin-bottom:12px">📨 Sent from ' + escHtml(result.sending_account) + ' — mark where each landed:</div>' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr>' +
            '<th style="padding:8px 12px;text-align:left;color:#9ca3af;font-size:12px">Test Inbox</th>' +
            '<th style="padding:8px 12px;text-align:left;color:#9ca3af;font-size:12px">Placement</th>' +
            '<th style="padding:8px 12px;text-align:left;color:#9ca3af;font-size:12px">Report</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';

  } catch(e) {
    if (resultEl) resultEl.innerHTML = '<div style="color:#f87171;padding:12px">Error: ' + escHtml(e.message) + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Run Placement Test'; }
  }
}

async function reportPlacement(testId, placement) {
  var statusEl = el('pt-status-' + testId);
  var actionsEl = el('pt-actions-' + testId);
  if (actionsEl) actionsEl.innerHTML = '<span style="color:#6b7280;font-size:12px">Saving…</span>';

  try {
    await api('/warmup/placement/report', {
      method: 'POST',
      body: JSON.stringify({ test_id: testId, placement: placement })
    });

    if (statusEl) statusEl.innerHTML = placementBadge(placement);
    if (actionsEl) actionsEl.innerHTML = '<span style="color:#6b7280;font-size:12px">Reported ✓</span>';

    var allDone = currentTestIds.every(function(id) {
      var act = el('pt-actions-' + id);
      return act && act.textContent.includes('Reported');
    });

    if (allDone) {
      var counts = { inbox: 0, spam: 0, promotions: 0, unknown: 0 };
      currentTestIds.forEach(function(id) {
        var st = el('pt-status-' + id);
        if (!st) return;
        var txt = (st.textContent || '').toLowerCase();
        if (txt.includes('inbox')) counts.inbox++;
        else if (txt.includes('spam')) counts.spam++;
        else if (txt.includes('promo')) counts.promotions++;
        else counts.unknown++;
      });
      var total = currentTestIds.length;
      var inboxRate = total ? Math.round(counts.inbox / total * 100) : 0;
      var rateColor = inboxRate >= 80 ? '#4ade80' : inboxRate >= 50 ? '#fbbf24' : '#f87171';
      var summaryDiv = document.createElement('div');
      summaryDiv.style.cssText = 'background:#0f1f30;border-radius:8px;padding:14px;margin-top:12px;display:flex;gap:20px;align-items:center;flex-wrap:wrap';
      summaryDiv.innerHTML =
        '<div style="font-size:13px;font-weight:700;color:#e5e7eb">Test Complete</div>' +
        '<div style="font-size:22px;font-weight:800;color:' + rateColor + '">' + inboxRate + '% Inbox</div>' +
        '<div style="font-size:12px;color:#9ca3af">' +
          counts.inbox + ' inbox &nbsp;·&nbsp; ' + counts.spam + ' spam &nbsp;·&nbsp; ' +
          counts.promotions + ' promotions &nbsp;·&nbsp; ' + counts.unknown + ' unknown' +
        '</div>';
      var resultElFinal = el('pt-run-result');
      if (resultElFinal) resultElFinal.appendChild(summaryDiv);
      loadPlacementResults();
    }
  } catch(e) {
    if (actionsEl) actionsEl.innerHTML = '<span style="color:#f87171;font-size:12px">' + escHtml(e.message) + '</span>';
  }
}

async function loadPlacementResults() {
  var summaryEl = el('placement-results-summary');
  var tableEl = el('placement-results-table');

  try {
    var data = await api('/warmup/placement/results?days=30');

    if (summaryEl) {
      if (!data.per_account || !data.per_account.length) {
        summaryEl.innerHTML = '<div style="color:#6b7280;font-size:13px">No results yet. Run a placement test to see data here.</div>';
      } else {
        summaryEl.innerHTML = data.per_account.map(function(a) {
          var rate = a.inbox_rate || 0;
          var rateColor = rate >= 80 ? '#4ade80' : rate >= 50 ? '#fbbf24' : '#f87171';
          return '<div style="background:#1a2332;border-radius:10px;padding:14px;min-width:200px;flex:1">' +
            '<div style="font-size:12px;color:#9ca3af;margin-bottom:4px">' + escHtml(a.sending_account_email) + '</div>' +
            '<div style="font-size:26px;font-weight:800;color:' + rateColor + '">' + rate + '%</div>' +
            '<div style="font-size:11px;color:#6b7280">Inbox rate (' + a.total_tests + ' tests)</div>' +
            '<div style="font-size:11px;color:#9ca3af;margin-top:6px">' +
              '<span style="color:#4ade80">' + a.inbox_count + ' inbox</span> · ' +
              '<span style="color:#f87171">' + a.spam_count + ' spam</span> · ' +
              '<span style="color:#fbbf24">' + a.promotions_count + ' promo</span>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    }

    if (tableEl) {
      if (!data.recent_tests || !data.recent_tests.length) {
        tableEl.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:20px">No tests recorded yet.</td></tr>';
        return;
      }
      tableEl.innerHTML = data.recent_tests.map(function(t) {
        return '<tr>' +
          '<td style="padding:8px 12px">' + escHtml(t.test_name || 'Placement Test') + '</td>' +
          '<td style="padding:8px 12px;font-size:12px;color:#9ca3af">' + escHtml(t.sending_account_email) + '</td>' +
          '<td style="padding:8px 12px;font-size:12px;color:#9ca3af">' + escHtml(t.test_email) + '</td>' +
          '<td style="padding:8px 12px">' + placementBadge(t.placement) + '</td>' +
          '<td style="padding:8px 12px;font-size:12px;color:#6b7280">' + (t.sent_at ? t.sent_at.replace('T', ' ').slice(0, 16) : '—') + '</td>' +
          '<td style="padding:8px 12px;font-size:12px;color:#9ca3af">' + escHtml(t.notes || '—') + '</td>' +
        '</tr>';
      }).join('');
    }
  } catch(e) {
    if (summaryEl) summaryEl.innerHTML = '<div style="color:#f87171;font-size:12px">Error loading results: ' + escHtml(e.message) + '</div>';
  }
}

async function loadPlacementSendingAccounts() {
  var sel = el('pt-sending-account');
  if (!sel) return;
  try {
    var accounts = await api('/accounts');
    sel.innerHTML = '<option value="">— Select sending account —</option>';
    (accounts || []).forEach(function(a) {
      var opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.email + (a.domain ? ' (' + a.domain + ')' : '');
      sel.appendChild(opt);
    });
  } catch(e) {
    sel.innerHTML = '<option value="">Error loading accounts</option>';
  }
}

async function loadPlacementTest() {
  await Promise.all([
    loadPlacementAccounts(),
    loadPlacementResults(),
    loadPlacementSendingAccounts(),
  ]);
}
