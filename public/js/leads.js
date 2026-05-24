// ─── Leads ───────────────────────────────────────────────────────────────────
var _lastValidationResults = null; // holds validate-csv response for import actions

async function loadLeads() {
  try {
    const campaigns = await api('/campaigns');
    state.campaigns = campaigns;
    const filter = el('leads-campaign-filter');
    const current = filter.value;
    filter.innerHTML = '<option value="">All Campaigns</option>' +
      campaigns.map(function(c) {
        return '<option value="' + c.id + '"' + (c.id == current ? ' selected' : '') + '>' + escHtml(c.name) + '</option>';
      }).join('');

    el('import-campaign').innerHTML = campaigns.map(function(c) {
      return '<option value="' + c.id + '">' + escHtml(c.name) + '</option>';
    }).join('');

    const campaignId = filter.value;
    const url = campaignId ? '/leads?campaign_id=' + campaignId : '/leads';
    state.leads = await api(url);

    const stats = await api('/leads/stats');
    renderLeadStats(stats);
    renderValidationStats(state.leads);
    renderLeads(state.leads);
  } catch(e) { toast(e.message, 'error'); }
}

function renderLeadStats(stats) {
  const statuses = ['active', 'replied', 'finished', 'bounced', 'unsubscribed'];
  var statCards = statuses.map(function(s) {
    return '<div class="stat-card" style="padding:10px 14px;min-width:90px">' +
      '<div class="label" style="font-size:10px">' + s + '</div>' +
      '<div class="value" style="font-size:20px">' + (stats[s] || 0) + '</div>' +
      '</div>';
  }).join('');

  // Opened stats — query separately via leads list if available
  var openedCount = (state.leads || []).filter(function(l) { return l.opened; }).length;
  var total = (state.leads || []).length;
  var openRate = total > 0 ? ((openedCount / total) * 100).toFixed(1) : '0.0';
  statCards += '<div class="stat-card" style="padding:10px 14px;min-width:90px;border-color:#1a3d2e">' +
    '<div class="label" style="font-size:10px;color:#22c55e">👁 opened</div>' +
    '<div class="value" style="font-size:20px;color:#22c55e">' + openedCount + '</div>' +
    '</div>';
  statCards += '<div class="stat-card" style="padding:10px 14px;min-width:90px;border-color:#1a3d2e">' +
    '<div class="label" style="font-size:10px;color:#22c55e">open rate</div>' +
    '<div class="value" style="font-size:20px;color:#22c55e">' + openRate + '%</div>' +
    '</div>';

  el('lead-stats').innerHTML = statCards;
}

function renderValidationStats(leads) {
  var statsEl = el('lead-validation-stats');
  if (!leads || !leads.length) { statsEl.style.display = 'none'; return; }
  var total = leads.length;
  // valid=1 means validated OK, valid=0 means invalid, valid=1 with no validation_reason = legacy
  var invalidCount = leads.filter(function(l) { return l.valid === 0; }).length;
  var validatedCount = leads.filter(function(l) { return l.valid === 1 && l.validation_reason === null; }).length;
  var legacyCount = leads.filter(function(l) { return l.valid === 1 && l.validation_reason === null; }).length;
  var invalidPct = total > 0 ? ((invalidCount / total) * 100).toFixed(1) : '0.0';
  var warn = parseFloat(invalidPct) > 5;
  statsEl.style.display = 'flex';
  statsEl.innerHTML =
    '<span>Total: <strong style="color:#e5e7eb">' + total + '</strong></span>' +
    '<span style="color:#22c55e">✓ Valid: <strong>' + (total - invalidCount) + '</strong></span>' +
    (invalidCount > 0
      ? '<span style="color:' + (warn ? '#ef4444' : '#f59e0b') + '">' + (warn ? '⚠️ ' : '') + 'Invalid: <strong>' + invalidCount + '</strong> (' + invalidPct + '%)</span>'
      : '');
}

function validationDot(lead) {
  // valid column: 1=ok, 0=invalid, undefined/null=legacy (no validation data)
  if (lead.valid === 0) {
    return '<span title="' + escHtml(lead.validation_reason || 'Invalid') + '" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;margin-right:5px;vertical-align:middle"></span>';
  }
  if (lead.valid === 1) {
    return '<span title="Validated" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:5px;vertical-align:middle"></span>';
  }
  // legacy — no column data
  return '<span title="No validation data" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#6b7280;margin-right:5px;vertical-align:middle"></span>';
}

function openedIcon(r) {
  if (!r.opened) {
    return '<span style="color:#374151;font-size:14px" title="Not opened">👁</span>';
  }
  var tooltip = r.opened_at ? 'First opened: ' + r.opened_at.slice(0,16).replace('T',' ') : 'Opened';
  var badge = (r.open_count > 1)
    ? ' <span style="background:#1a3d2e;color:#22c55e;border-radius:8px;font-size:10px;padding:1px 5px">×' + r.open_count + '</span>'
    : '';
  return '<span style="color:#22c55e;font-size:14px" title="' + escHtml(tooltip) + '">👁</span>' + badge;
}

function timezoneBadge(r) {
  if (!r.timezone_label) return '<span style="color:#4b5563;font-size:11px">—</span>';
  var color = r.timezone_detected ? '#6366f1' : '#4b5563';
  var title = r.timezone_detected ? escHtml(r.timezone_label) : 'Default (not detected): ' + escHtml(r.timezone_label);
  var shortLabel = escHtml((r.timezone_label || '').split('(')[0].trim());
  return '<span ' +
    'title="' + title + '" ' +
    'data-lead-id="' + r.id + '" ' +
    'data-tz-offset="' + (r.timezone_offset !== null ? r.timezone_offset : 0) + '" ' +
    'data-tz-label="' + escHtml(r.timezone_label || '') + '" ' +
    'data-tz-hour="' + (r.optimal_send_hour || 9) + '" ' +
    'style="font-size:10px;color:' + color + ';cursor:pointer;white-space:nowrap" ' +
    'onclick="event.stopPropagation();var s=this.dataset;showTimezoneEdit(+s.leadId,+s.tzOffset,s.tzLabel,+s.tzHour)">' +
    '🕐 ' + shortLabel + '</span>';
}

function renderLeads(rows) {
  if (!rows.length) { el('leads-table').innerHTML = '<div class="no-data">No leads</div>'; return; }
  el('leads-table').innerHTML = '<table><thead><tr>' +
    '<th onclick="sortLeads(\'first_name\')">Name' + sortIcon('leads', 'first_name') + '</th>' +
    '<th onclick="sortLeads(\'email\')">Email' + sortIcon('leads', 'email') + '</th>' +
    '<th onclick="sortLeads(\'company\')">Company' + sortIcon('leads', 'company') + '</th>' +
    '<th onclick="sortLeads(\'status\')">Status' + sortIcon('leads', 'status') + '</th>' +
    '<th onclick="sortLeads(\'current_step\')">Step' + sortIcon('leads', 'current_step') + '</th>' +
    '<th onclick="sortLeads(\'next_send_date\')">Next Send' + sortIcon('leads', 'next_send_date') + '</th>' +
    '<th>Timezone</th>' +
    '<th>Opened</th>' +
    '<th>Actions</th>' +
    '</tr></thead><tbody>' +
    rows.map(function(r) {
      var isUnsub = r.status === 'unsubscribed';
      return '<tr>' +
        '<td>' + escHtml((r.first_name || '') + ' ' + (r.last_name || '')) + '</td>' +
        '<td>' + validationDot(r) + escHtml(r.email) + (isUnsub ? ' <span title="Unsubscribed" style="font-size:11px">🛡</span>' : '') + '</td>' +
        '<td>' + escHtml(r.company || '—') + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td>' + r.current_step + '</td>' +
        '<td>' + (r.next_send_date || '—') + '</td>' +
        '<td>' + timezoneBadge(r) + '</td>' +
        '<td>' + openedIcon(r) + '</td>' +
        '<td style="display:flex;gap:6px">' +
          (isUnsub ? '' : '<button class="btn btn-ghost btn-sm" onclick="resetLead(' + r.id + ')">Reset</button>') +
          '<button class="btn btn-danger btn-sm" onclick="deleteLead(' + r.id + ')">✕</button>' +
        '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
}

async function detectAllTimezones() {
  var btn = el('detect-tz-btn');
  btn.textContent = 'Detecting…';
  btn.disabled = true;
  try {
    var r = await api('/leads/detect-timezones', { method: 'POST' });
    toast('Timezone detected for ' + r.updated + ' of ' + r.total_checked + ' leads', 'success');
    loadLeads();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    btn.textContent = '🌍 Detect Timezones';
    btn.disabled = false;
  }
}

function showTimezoneEdit(id, currentOffset, currentLabel, currentOptimalHour) {
  el('tz-lead-id').value = id;
  el('tz-offset').value = currentOffset;
  el('tz-label').value = currentLabel;
  el('tz-optimal-hour').value = currentOptimalHour || 9;
  el('timezone-edit-modal').style.display = 'flex';
}

function closeTimezoneEdit() {
  el('timezone-edit-modal').style.display = 'none';
}

async function saveTimezoneEdit() {
  var id = el('tz-lead-id').value;
  var body = {
    timezone_offset: parseFloat(el('tz-offset').value),
    timezone_label: el('tz-label').value.trim(),
    optimal_send_hour: parseInt(el('tz-optimal-hour').value),
  };
  try {
    await api('/leads/' + id + '/timezone', { method: 'PUT', body: JSON.stringify(body) });
    toast('Timezone saved', 'success');
    closeTimezoneEdit();
    loadLeads();
  } catch(e) { toast(e.message, 'error'); }
}

function filterLeads() {
  const q = el('lead-search').value.toLowerCase();
  const statusFilter = el('lead-status-filter').value;
  var filtered = state.leads;
  if (q) {
    filtered = filtered.filter(function(r) {
      return (r.first_name + ' ' + r.last_name).toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.company || '').toLowerCase().includes(q);
    });
  }
  if (statusFilter) {
    filtered = filtered.filter(function(r) { return r.status === statusFilter; });
  }
  renderLeads(filtered);
}

function sortLeads(key) {
  state.leads = sortTable(state.leads, key, 'leads');
  renderLeads(state.leads);
}

async function resetLead(id) {
  try {
    await api('/leads/' + id + '/reset', { method: 'POST' });
    toast('Lead reset to step 1', 'success');
    loadLeads();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteLead(id) {
  if (!confirm('Delete this lead?')) return;
  try {
    await api('/leads/' + id, { method: 'DELETE' });
    toast('Lead deleted', 'success');
    loadLeads();
  } catch(e) { toast(e.message, 'error'); }
}

function openImportPanel() {
  el('import-panel').classList.add('open');
  el('overlay').classList.add('open');
  el('import-result').innerHTML = '';
  showImportForm();
}

function closeImportPanel() {
  el('import-panel').classList.remove('open');
  el('overlay').classList.remove('open');
  _lastValidationResults = null;
}

function showImportForm() {
  el('import-form-view').style.display = '';
  el('import-validation-view').style.display = 'none';
  el('bypass-confirm').style.display = 'none';
}

function closeValidationResults() {
  showImportForm();
}

// ─── Validation ───────────────────────────────────────────────────────────────

async function validateCSV() {
  const campaignId = parseInt(el('import-campaign').value);
  const csv = el('import-csv').value.trim();
  if (!csv) { toast('Paste CSV content first', 'error'); return; }

  el('import-result').innerHTML = '<div style="color:#6b7280;font-size:13px">🔍 Validating emails… (DNS lookups may take a few seconds)</div>';

  try {
    const r = await api('/leads/validate-csv', {
      method: 'POST',
      body: JSON.stringify({ campaign_id: campaignId, csv }),
    });
    _lastValidationResults = { campaignId, csv, result: r };
    el('import-result').innerHTML = '<div style="color:#6b7280;font-size:13px">🔍 Checking blacklist…</div>';
    await renderValidationResults(r);
    el('import-result').innerHTML = '';
  } catch(e) {
    el('import-result').innerHTML = '<div style="color:#ef4444;font-size:13px">' + escHtml(e.message) + '</div>';
  }
}

async function checkBlacklistForImport(validDetails) {
  var results = [];
  for (var i = 0; i < validDetails.length; i++) {
    try {
      var r = await api('/dashboard/blacklist/check?email=' + encodeURIComponent(validDetails[i].email));
      results.push({ detail: validDetails[i], blacklisted: r.blacklisted, reason: r.reason });
    } catch(e) {
      results.push({ detail: validDetails[i], blacklisted: false, reason: '' });
    }
  }
  return results;
}

async function renderValidationResults(r) {
  var details = r.details || [];
  var valid = details.filter(function(d) { return d.valid && !d.is_duplicate; });
  var invalid = details.filter(function(d) { return !d.valid; });
  var dupes = details.filter(function(d) { return d.valid && d.is_duplicate; });

  // Blacklist check on valid emails
  var blChecked = await checkBlacklistForImport(valid);
  var blacklisted = blChecked.filter(function(x) { return x.blacklisted; });
  var passedValid = blChecked.filter(function(x) { return !x.blacklisted; });

  // Store clean valid list back for import
  _lastValidationResults.result._cleanValid = passedValid.map(function(x) { return x.detail; });

  var html = '<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#e5e7eb">Validation Results — ' + r.total_processed + ' emails checked</div>';

  // Valid section (excluding blacklisted)
  html += '<div style="background:#052e16;border:1px solid #166534;border-radius:8px;padding:12px 14px;margin-bottom:10px">';
  html += '<div style="color:#22c55e;font-weight:700;margin-bottom:6px">✓ Valid: ' + passedValid.length + '</div>';
  if (passedValid.length > 0) {
    var shownValid = passedValid.slice(0, 5);
    html += '<div style="font-size:12px;color:#86efac">' + shownValid.map(function(x) { return escHtml(x.detail.email); }).join(', ');
    if (passedValid.length > 5) html += ' <span style="color:#4ade80">+' + (passedValid.length - 5) + ' more</span>';
    html += '</div>';
  }
  html += '</div>';

  // Blacklisted section
  if (blacklisted.length > 0) {
    html += '<div style="background:#1a0a1a;border:1px solid #6b21a8;border-radius:8px;padding:12px 14px;margin-bottom:10px">';
    html += '<div style="color:#c084fc;font-weight:700;margin-bottom:8px">🚫 Blacklisted: ' + blacklisted.length + '</div>';
    html += '<div style="max-height:120px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
    html += '<thead><tr><th style="text-align:left;padding:4px 8px;color:#6b7280;border-bottom:1px solid #374151">Email</th><th style="text-align:left;padding:4px 8px;color:#6b7280;border-bottom:1px solid #374151">Reason</th></tr></thead><tbody>';
    html += blacklisted.map(function(x) {
      return '<tr><td style="padding:4px 8px;color:#d8b4fe">' + escHtml(x.detail.email) + '</td><td style="padding:4px 8px;color:#9ca3af">' + escHtml(x.reason) + '</td></tr>';
    }).join('');
    html += '</tbody></table></div></div>';
  }

  // Invalid section
  if (invalid.length > 0) {
    html += '<div style="background:#1c0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 14px;margin-bottom:10px">';
    html += '<div style="color:#ef4444;font-weight:700;margin-bottom:8px">✕ Invalid: ' + invalid.length + '</div>';
    html += '<div style="max-height:160px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
    html += '<thead><tr><th style="text-align:left;padding:4px 8px;color:#6b7280;border-bottom:1px solid #374151">Email</th><th style="text-align:left;padding:4px 8px;color:#6b7280;border-bottom:1px solid #374151">Reason</th></tr></thead><tbody>';
    html += invalid.map(function(d) {
      return '<tr><td style="padding:4px 8px;color:#fca5a5">' + escHtml(d.email) + '</td><td style="padding:4px 8px;color:#9ca3af">' + escHtml(d.reason) + '</td></tr>';
    }).join('');
    html += '</tbody></table></div></div>';
  }

  // Duplicates section
  if (dupes.length > 0) {
    html += '<div style="background:#1c1200;border:1px solid #78350f;border-radius:8px;padding:12px 14px;margin-bottom:10px">';
    html += '<div style="color:#f59e0b;font-weight:700;margin-bottom:4px">⚠ Already in campaign: ' + dupes.length + '</div>';
    html += '<div style="font-size:12px;color:#fcd34d">' + dupes.map(function(d) { return escHtml(d.email); }).slice(0, 5).join(', ');
    if (dupes.length > 5) html += ' +' + (dupes.length - 5) + ' more';
    html += '</div></div>';
  }

  el('import-form-view').style.display = 'none';
  el('validation-results-panel').innerHTML = html;

  // Action buttons
  var btns = '';
  if (passedValid.length > 0) {
    btns += '<button class="btn btn-primary btn-sm" onclick="importValidOnly()">✓ Import Valid Only (' + passedValid.length + ')</button>';
  }
  if (invalid.length > 0) {
    btns += '<button class="btn btn-ghost btn-sm" onclick="importAllAnyway()">Import All Anyway</button>';
  }
  btns += '<button class="btn btn-ghost btn-sm" onclick="closeValidationResults()">← Back</button>';
  el('import-action-buttons').innerHTML = btns;

  el('import-validation-view').style.display = '';
}

async function importValidOnly() {
  if (!_lastValidationResults) return;
  // Use pre-filtered clean valid list (passed validation + not blacklisted)
  var valid = _lastValidationResults.result._cleanValid;
  if (!valid || !valid.length) {
    // Fallback to original valid if blacklist check wasn't run
    var details = _lastValidationResults.result.details || [];
    valid = details.filter(function(d) { return d.valid && !d.is_duplicate; });
  }
  if (!valid.length) { toast('No valid emails to import', 'error'); return; }

  // Reconstruct CSV from valid rows only
  var headerLine = 'first_name,last_name,email,company,website,personalized_line';
  var dataLines = valid.map(function(d) {
    var row = d.row;
    return [row.first_name, row.last_name, row.email, row.company, row.website, row.personalized_line].join(',');
  });
  var csv = [headerLine].concat(dataLines).join('\n');

  try {
    var r = await api('/leads/import', {
      method: 'POST',
      body: JSON.stringify({ campaign_id: _lastValidationResults.campaignId, csv }),
    });
    toast('✓ ' + r.imported + ' leads imported', 'success');
    closeImportPanel();
    loadLeads();
  } catch(e) { toast(e.message, 'error'); }
}

function importAllAnyway() {
  el('bypass-confirm').style.display = '';
}

function cancelBypassConfirm() {
  el('bypass-confirm').style.display = 'none';
}

async function confirmImportAllAnyway() {
  if (!_lastValidationResults) return;
  el('bypass-confirm').style.display = 'none';
  try {
    var r = await api('/leads/import', {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: _lastValidationResults.campaignId,
        csv: _lastValidationResults.csv,
        bypass_validation: true,
      }),
    });
    toast('✓ ' + r.imported + ' imported, ' + r.invalid + ' skipped (invalid format), ' + r.skipped + ' duplicates', 'success');
    closeImportPanel();
    loadLeads();
  } catch(e) { toast(e.message, 'error'); }
}

async function importCSV() {
  const campaignId = parseInt(el('import-campaign').value);
  const csv = el('import-csv').value.trim();
  if (!csv) { toast('Paste CSV content first', 'error'); return; }

  // Run validation first; if all valid, import silently
  el('import-result').innerHTML = '<div style="color:#6b7280;font-size:13px">🔍 Validating…</div>';

  try {
    const vr = await api('/leads/validate-csv', {
      method: 'POST',
      body: JSON.stringify({ campaign_id: campaignId, csv }),
    });

    var details = vr.details || [];
    var invalid = details.filter(function(d) { return !d.valid; });
    var dupes = details.filter(function(d) { return d.valid && d.is_duplicate; });
    var valid = details.filter(function(d) { return d.valid && !d.is_duplicate; });

    // All valid — import directly without showing results panel
    if (invalid.length === 0) {
      const r = await api('/leads/import', {
        method: 'POST',
        body: JSON.stringify({ campaign_id: campaignId, csv }),
      });
      el('import-result').innerHTML = '<div style="color:#22c55e;font-size:13px">✓ ' + r.imported + ' imported' + (r.skipped > 0 ? ', ' + r.skipped + ' skipped as duplicates' : '') + '</div>';
      toast(r.imported + ' leads imported', 'success');
      loadLeads();
      return;
    }

    // Some invalid — show validation results panel
    _lastValidationResults = { campaignId, csv, result: vr };
    el('import-result').innerHTML = '<div style="color:#6b7280;font-size:13px">🔍 Checking blacklist…</div>';
    await renderValidationResults(vr);
    el('import-result').innerHTML = '';
  } catch(e) {
    el('import-result').innerHTML = '<div style="color:#ef4444;font-size:13px">' + escHtml(e.message) + '</div>';
    toast(e.message, 'error');
  }
}

// ─── Unsubscribe Log ──────────────────────────────────────────────────────────

async function showUnsubscribeLog() {
  var modal = el('unsub-log-modal');
  modal.style.display = 'flex';
  el('unsub-log-body').innerHTML = '<div style="color:#6b7280;text-align:center;padding:20px">Loading…</div>';
  try {
    var rows = await api('/leads/unsubscribe-log');
    if (!rows.length) {
      el('unsub-log-body').innerHTML = '<div style="color:#6b7280;text-align:center;padding:20px">No unsubscribes yet.</div>';
      return;
    }
    el('unsub-log-body').innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<thead><tr style="border-bottom:1px solid #333">' +
      '<th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600">Email</th>' +
      '<th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600">Campaign</th>' +
      '<th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600">Date</th>' +
      '<th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600">IP</th>' +
      '</tr></thead><tbody>' +
      rows.map(function(r) {
        return '<tr style="border-bottom:1px solid #222">' +
          '<td style="padding:8px 10px">' + escHtml(r.lead_email) + '</td>' +
          '<td style="padding:8px 10px;color:#9ca3af">' + escHtml(r.campaign_name || '—') + '</td>' +
          '<td style="padding:8px 10px;color:#9ca3af">' + (r.unsubscribed_at ? r.unsubscribed_at.slice(0,16).replace('T',' ') : '—') + '</td>' +
          '<td style="padding:8px 10px;color:#9ca3af;font-size:11px">' + escHtml(r.ip_address || '—') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  } catch(e) {
    el('unsub-log-body').innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px">' + escHtml(e.message) + '</div>';
  }
}

function closeUnsubscribeLog() {
  el('unsub-log-modal').style.display = 'none';
}
