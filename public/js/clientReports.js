// ─── Client Progress Reports ──────────────────────────────────────────────────
var _clientReportCampaigns = [];

async function loadClientReports() {
  var tableEl = el('cr-table');
  var formEl  = el('cr-campaign-select');
  if (tableEl) tableEl.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  try {
    var [reports, campaigns] = await Promise.all([
      api('/dashboard/client-reports'),
      api('/campaigns'),
    ]);
    _clientReportCampaigns = campaigns;

    // Populate campaign dropdown
    if (formEl) {
      formEl.innerHTML = '<option value="">— Select Campaign —</option>' +
        campaigns.map(function(c) {
          return '<option value="' + c.id + '">' + escHtml(c.name) + '</option>';
        }).join('');
    }

    renderClientReportsTable(reports);
  } catch(e) {
    if (tableEl) tableEl.innerHTML = '<div class="loading" style="color:#ef4444">' + e.message + '</div>';
    toast(e.message, 'error');
  }
}

function renderClientReportsTable(reports) {
  var tableEl = el('cr-table');
  if (!tableEl) return;

  if (!reports.length) {
    tableEl.innerHTML = '<div class="no-data">No client report configurations yet. Add one below.</div>';
    return;
  }

  tableEl.innerHTML = '<table><thead><tr>' +
    '<th>Campaign</th><th>Client Email</th><th>Client Name</th>' +
    '<th>Daily</th><th>Weekly</th><th>Send Time</th><th>Last Sent</th><th></th>' +
    '</tr></thead><tbody>' +
    reports.map(function(r) {
      var dailyBadge  = r.send_daily  ? '<span class="badge badge-replied">Daily</span>'  : '<span class="badge" style="background:#1f2937;color:#6b7280">Off</span>';
      var weeklyBadge = r.send_weekly ? '<span class="badge badge-replied">Weekly</span>' : '<span class="badge" style="background:#1f2937;color:#6b7280">Off</span>';
      var lastSent    = r.last_sent_at ? formatTime(r.last_sent_at) : '<span style="color:#6b7280">Never</span>';
      var sendTime    = r.send_time_hour + ':00 PKT';
      return '<tr>' +
        '<td style="font-weight:600">' + escHtml(r.campaign_name) + '</td>' +
        '<td style="font-family:monospace;font-size:12px">' + escHtml(r.client_email) + '</td>' +
        '<td>' + escHtml(r.client_name || '—') + '</td>' +
        '<td>' + dailyBadge + '</td>' +
        '<td>' + weeklyBadge + '</td>' +
        '<td style="font-size:12px;color:#9ca3af">' + sendTime + '</td>' +
        '<td style="font-size:12px">' + lastSent + '</td>' +
        '<td style="display:flex;gap:6px">' +
          '<button class="btn btn-ghost btn-sm" onclick="previewReport(' + r.id + ')">Preview</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="sendReportNow(' + r.id + ',\'' + escHtml(r.client_email) + '\')">Send Now</button>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteClientReport(' + r.id + ')">✕</button>' +
        '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
}

async function saveClientReport() {
  var campaignId   = el('cr-campaign-select') ? parseInt(el('cr-campaign-select').value) : 0;
  var clientEmail  = el('cr-client-email')  ? el('cr-client-email').value.trim()  : '';
  var clientName   = el('cr-client-name')   ? el('cr-client-name').value.trim()   : '';
  var sendDaily    = el('cr-daily-toggle')  ? el('cr-daily-toggle').dataset.enabled !== '0'  : true;
  var sendWeekly   = el('cr-weekly-toggle') ? el('cr-weekly-toggle').dataset.enabled !== '0' : true;
  var sendTimeHour = el('cr-send-hour')     ? parseInt(el('cr-send-hour').value) : 8;

  if (!campaignId) { toast('Please select a campaign', 'error'); return; }
  if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    toast('Please enter a valid client email address', 'error'); return;
  }

  try {
    await api('/dashboard/client-reports', {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: campaignId,
        client_email: clientEmail,
        client_name: clientName || null,
        send_daily: sendDaily,
        send_weekly: sendWeekly,
        send_time_hour: sendTimeHour,
      }),
    });
    toast('Client report configuration saved', 'success');
    // Reset form
    if (el('cr-campaign-select')) el('cr-campaign-select').value = '';
    if (el('cr-client-email'))  el('cr-client-email').value  = '';
    if (el('cr-client-name'))   el('cr-client-name').value   = '';
    setCRToggle('cr-daily-toggle',  'cr-daily-knob',  true);
    setCRToggle('cr-weekly-toggle', 'cr-weekly-knob', true);
    loadClientReports();
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function deleteClientReport(id) {
  if (!confirm('Delete this client report configuration?')) return;
  try {
    await api('/dashboard/client-reports/' + id, { method: 'DELETE' });
    toast('Configuration deleted', 'success');
    loadClientReports();
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function sendReportNow(id, clientEmail) {
  if (!confirm('Send the daily progress report to ' + clientEmail + ' now?')) return;
  try {
    var r = await api('/dashboard/client-reports/' + id + '/send-now', { method: 'POST' });
    toast('Report sent to ' + clientEmail, 'success');
    loadClientReports();
  } catch(e) {
    toast(e.message || 'Failed to send report', 'error');
  }
}

async function previewReport(id) {
  var modal  = el('cr-preview-modal');
  var frame  = el('cr-preview-frame');
  if (!modal || !frame) return;
  frame.innerHTML = '<div style="text-align:center;padding:48px;color:#6b7280"><span class="spinner"></span><div style="margin-top:12px">Loading preview…</div></div>';
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  try {
    var r = await api('/dashboard/client-reports/' + id + '/preview', { method: 'POST' });
    frame.innerHTML = r.html;
  } catch(e) {
    frame.innerHTML = '<div style="color:#ef4444;padding:20px">' + e.message + '</div>';
  }
}

function closePreviewModal() {
  var modal = el('cr-preview-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

// ─── Toggle helpers ────────────────────────────────────────────────────────────
function setCRToggle(btnId, knobId, enabled) {
  var btn  = el(btnId);
  var knob = el(knobId);
  if (!btn) return;
  btn.dataset.enabled = enabled ? '1' : '0';
  btn.style.background = enabled ? '#22c55e' : '#374151';
  if (knob) knob.style.left = enabled ? '23px' : '3px';
}

function toggleCRDaily() {
  var btn = el('cr-daily-toggle');
  var cur = btn && btn.dataset.enabled !== '0';
  setCRToggle('cr-daily-toggle', 'cr-daily-knob', !cur);
}

function toggleCRWeekly() {
  var btn = el('cr-weekly-toggle');
  var cur = btn && btn.dataset.enabled !== '0';
  setCRToggle('cr-weekly-toggle', 'cr-weekly-knob', !cur);
}
