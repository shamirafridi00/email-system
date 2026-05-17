// ─── Campaigns ───────────────────────────────────────────────────────────────
async function loadCampaigns() {
  try {
    state.campaigns = await api('/campaigns');
    state.accounts = await api('/accounts');
    renderCampaigns();
    populateAccountDropdown('cf-account', state.accounts);
  } catch(e) { toast(e.message, 'error'); }
}

function renderCampaigns() {
  const rows = state.campaigns;
  el('campaigns-table').innerHTML = rows.length
    ? '<table><thead><tr><th>Name</th><th>Account</th><th>Status</th><th>Daily Limit</th><th>Actions</th></tr></thead>' +
      '<tbody id="campaigns-tbody">' + rows.map(function(r) { return campaignRow(r); }).join('') + '</tbody></table>'
    : '<div class="no-data">No campaigns yet</div>';
}

function campaignRow(r) {
  const days = (r.send_days || 'mon,tue,wed,thu,fri').split(',');
  const allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const accountOptions = state.accounts.map(function(a) {
    return '<option value="' + a.id + '"' + (a.id === r.account_id ? ' selected' : '') + '>' + a.email + '</option>';
  }).join('');
  const statusOptions = ['draft', 'active', 'paused', 'completed'].map(function(s) {
    return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
  }).join('');
  const dayCheckboxes = allDays.map(function(d) {
    return '<label><input type="checkbox" class="ef-day-' + r.id + '" value="' + d + '"' + (days.includes(d) ? ' checked' : '') + '> ' + d.charAt(0).toUpperCase() + d.slice(1) + '</label>';
  }).join('');

  return '<tr class="clickable-row" onclick="toggleSteps(' + r.id + ')" id="cr-' + r.id + '">' +
    '<td><strong>' + r.name + '</strong></td>' +
    '<td>' + (r.account_email || '—') + '</td>' +
    '<td>' + statusBadge(r.status) + '</td>' +
    '<td>' + r.daily_limit + '/day</td>' +
    '<td onclick="event.stopPropagation()" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
      '<select onchange="updateCampaignStatus(' + r.id + ', this.value)" style="width:110px;padding:4px 6px;font-size:12px">' + statusOptions + '</select>' +
      '<button class="btn btn-ghost btn-sm" onclick="toggleEditCampaign(' + r.id + ')">Edit</button>' +
      '<button class="btn btn-danger btn-sm" onclick="deleteCampaign(' + r.id + ')">Delete</button>' +
    '</td>' +
  '</tr>' +
  '<tr id="edit-row-' + r.id + '" style="display:none">' +
    '<td colspan="5" style="padding:0;background:#1a1a1a;border-bottom:1px solid #333">' +
      '<div style="padding:16px">' +
        '<div style="font-weight:600;font-size:13px;margin-bottom:12px;color:#aaa">Edit Campaign</div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label>Name</label><input id="ef-name-' + r.id + '" value="' + r.name + '"></div>' +
          '<div class="form-group"><label>Sending Account</label><select id="ef-account-' + r.id + '">' + accountOptions + '</select></div>' +
          '<div class="form-group" style="max-width:120px"><label>Daily Limit</label><input id="ef-limit-' + r.id + '" type="number" value="' + r.daily_limit + '"></div>' +
        '</div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label>Send Days</label><div class="checkboxes">' + dayCheckboxes + '</div></div>' +
          '<div class="form-group" style="max-width:110px"><label>Start Hour</label><input id="ef-start-' + r.id + '" type="number" value="' + r.send_start_hour + '" min="0" max="23"></div>' +
          '<div class="form-group" style="max-width:110px"><label>End Hour</label><input id="ef-end-' + r.id + '" type="number" value="' + r.send_end_hour + '" min="0" max="23"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-primary btn-sm" onclick="saveEditCampaign(' + r.id + ')">Save Changes</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="toggleEditCampaign(' + r.id + ')">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</td>' +
  '</tr>' +
  '<tr id="steps-row-' + r.id + '" style="display:none">' +
    '<td colspan="5" class="steps-row"><div class="steps-inner" id="steps-inner-' + r.id + '"></div></td>' +
  '</tr>';
}

function toggleEditCampaign(id) {
  const row = el('edit-row-' + id);
  const stepsRow = el('steps-row-' + id);
  if (stepsRow) stepsRow.style.display = 'none';
  row.style.display = row.style.display === 'none' ? '' : 'none';
}

async function saveEditCampaign(id) {
  const selectedDays = Array.from(document.querySelectorAll('.ef-day-' + id + ':checked')).map(function(c) { return c.value; }).join(',');
  const body = {
    name: el('ef-name-' + id).value.trim(),
    account_id: parseInt(el('ef-account-' + id).value),
    daily_limit: parseInt(el('ef-limit-' + id).value),
    send_days: selectedDays || 'mon,tue,wed,thu,fri',
    send_start_hour: parseInt(el('ef-start-' + id).value),
    send_end_hour: parseInt(el('ef-end-' + id).value),
  };
  if (!body.name) { toast('Name is required', 'error'); return; }
  try {
    await api('/campaigns/' + id, { method: 'PUT', body: JSON.stringify(body) });
    toast('Campaign updated', 'success');
    el('edit-row-' + id).style.display = 'none';
    loadCampaigns();
  } catch(e) { toast(e.message, 'error'); }
}

async function toggleSteps(id) {
  const editRow = el('edit-row-' + id);
  if (editRow) editRow.style.display = 'none';
  const row = el('steps-row-' + id);
  if (row.style.display === 'none') {
    row.style.display = '';
    state.expandedCampaign = id;
    await loadSteps(id);
  } else {
    row.style.display = 'none';
    state.expandedCampaign = null;
  }
}

async function loadSteps(campaignId) {
  const inner = el('steps-inner-' + campaignId);
  inner.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    const steps = await api('/campaigns/' + campaignId + '/steps');
    const nextStep = steps.length ? Math.max.apply(null, steps.map(function(s) { return s.step_number; })) + 1 : 1;

    const timelineHtml = steps.length
      ? '<div class="step-timeline">' +
        steps.map(function(s) {
          const preview = s.body.slice(0, 100).replace(/\n/g, ' ') + (s.body.length > 100 ? '…' : '');
          const dayLabel = s.delay_days === 0 ? 'Send on day 0 (immediately)' : 'Send on day ' + s.delay_days;
          const stepDataJson = JSON.stringify({ subject: s.subject, body: s.body, campaignId: campaignId, stepId: s.id });
          return '<div class="step-item">' +
            '<div class="step-circle">' + s.step_number + '</div>' +
            '<div class="step-card">' +
              '<div class="step-card-top">' +
                '<div class="step-subject">' + s.subject + '</div>' +
                '<span class="step-badge">' + dayLabel + '</span>' +
              '</div>' +
              '<div class="step-preview">' + preview + '</div>' +
              '<div class="step-actions">' +
                '<button class="btn btn-ghost btn-sm" onclick="previewStep(this)">Preview</button>' +
                '<button class="btn btn-ghost btn-sm" onclick="editStep(' + campaignId + ',' + s.id + ',' + s.step_number + ',' + s.delay_days + ',this)">Edit</button>' +
                '<button class="btn btn-danger btn-sm" onclick="deleteStep(' + campaignId + ',' + s.id + ')">Delete</button>' +
              '</div>' +
              '<script type="application/json" class="step-data">' + stepDataJson + '<\/script>' +
            '</div>' +
          '</div>';
        }).join('') +
        '</div>'
      : '<div class="text-muted" style="margin-bottom:20px;font-size:13px">No steps yet — add your first step below.</div>';

    inner.innerHTML =
      '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:16px">Sequence</div>' +
      timelineHtml +
      '<div class="add-step-form">' +
        '<h4>Add Step</h4>' +
        '<div class="form-row">' +
          '<div class="form-group" style="max-width:90px"><label>Step #</label><input id="sf-num-' + campaignId + '" type="number" value="0" min="1"></div>' +
          '<div class="form-group" style="max-width:120px"><label>Delay (days)</label><input id="sf-delay-' + campaignId + '" type="number" value="0" min="0"></div>' +
          '<div class="form-group"><label>Subject Line</label><input id="sf-subj-' + campaignId + '" placeholder="{{first_name}}, quick question about {{company}}"></div>' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:4px">' +
          '<label>Email Body</label>' +
          '<textarea id="sf-body-' + campaignId + '" rows="7" placeholder="Hi {{first_name}},&#10;&#10;{{personalized_line}}&#10;&#10;Would love to connect — are you free for a quick call this week?&#10;&#10;Best,"></textarea>' +
        '</div>' +
        '<div class="helper-text">You can use variables: {{first_name}} {{company}} {{personalized_line}}</div>' +
        '<div style="margin-top:14px"><button class="btn btn-primary" onclick="saveStep(' + campaignId + ')">Save Step</button></div>' +
      '</div>';

    document.getElementById('sf-num-' + campaignId).value = nextStep;
    document.getElementById('sf-delay-' + campaignId).value = steps.length === 0 ? 0 : 3;
  } catch(e) {
    inner.innerHTML = '<div style="color:#ef4444">' + e.message + '</div>';
  }
}

async function saveStep(campaignId) {
  const payload = {
    step_number: parseInt(el('sf-num-' + campaignId).value),
    delay_days: parseInt(el('sf-delay-' + campaignId).value) || 0,
    subject: el('sf-subj-' + campaignId).value.trim(),
    body: el('sf-body-' + campaignId).value.trim(),
  };
  if (!payload.subject) { toast('Subject is required', 'error'); return; }
  if (!payload.body) { toast('Body is required', 'error'); return; }
  try {
    await api('/campaigns/' + campaignId + '/steps', { method: 'POST', body: JSON.stringify(payload) });
    toast('Step #' + payload.step_number + ' saved', 'success');
    loadSteps(campaignId);
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteStep(campaignId, stepId) {
  if (!confirm('Delete this step?')) return;
  try {
    await api('/campaigns/' + campaignId + '/steps/' + stepId, { method: 'DELETE' });
    toast('Step deleted', 'success');
    loadSteps(campaignId);
  } catch(e) { toast(e.message, 'error'); }
}

function editStep(campaignId, stepId, stepNumber, delayDays, btn) {
  const card = btn.closest('.step-card');
  const dataEl = card.querySelector('.step-data');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent);

  const escapedSubject = data.subject.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/"/g, '&quot;');

  card.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">' +
      '<div style="display:flex;gap:10px">' +
        '<div class="form-group" style="max-width:90px;margin:0"><label style="font-size:11px">Step #</label>' +
          '<input id="es-num-' + stepId + '" type="number" min="1" value="' + stepNumber + '" style="padding:5px 8px;font-size:13px"></div>' +
        '<div class="form-group" style="max-width:120px;margin:0"><label style="font-size:11px">Delay (days)</label>' +
          '<input id="es-delay-' + stepId + '" type="number" min="0" value="' + delayDays + '" style="padding:5px 8px;font-size:13px"></div>' +
        '<div class="form-group" style="flex:1;margin:0"><label style="font-size:11px">Subject</label>' +
          '<input id="es-subj-' + stepId + '" value="" style="padding:5px 8px;font-size:13px"></div>' +
      '</div>' +
      '<div class="form-group" style="margin:0"><label style="font-size:11px">Body</label>' +
        '<textarea id="es-body-' + stepId + '" rows="7" style="font-size:13px;resize:vertical"></textarea></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary btn-sm" onclick="saveEditStep(' + campaignId + ',' + stepId + ')">Save</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="loadSteps(' + campaignId + ')">Cancel</button>' +
      '</div>' +
    '</div>';

  document.getElementById('es-subj-' + stepId).value = data.subject;
  document.getElementById('es-body-' + stepId).value = data.body;
}

async function saveEditStep(campaignId, stepId) {
  const payload = {
    step_number: parseInt(document.getElementById('es-num-' + stepId).value),
    delay_days: parseInt(document.getElementById('es-delay-' + stepId).value) || 0,
    subject: document.getElementById('es-subj-' + stepId).value.trim(),
    body: document.getElementById('es-body-' + stepId).value.trim(),
  };
  if (!payload.subject) { toast('Subject is required', 'error'); return; }
  if (!payload.body) { toast('Body is required', 'error'); return; }
  try {
    await api('/campaigns/' + campaignId + '/steps/' + stepId, { method: 'PUT', body: JSON.stringify(payload) });
    toast('Step updated', 'success');
    loadSteps(campaignId);
  } catch(e) { toast(e.message, 'error'); }
}

function toggleCreateCampaign() {
  el('campaign-form').classList.toggle('open');
}

async function saveCampaign() {
  const days = Array.from(document.querySelectorAll('.send-day:checked')).map(function(c) { return c.value; }).join(',');
  const body = {
    name: el('cf-name').value.trim(),
    account_id: parseInt(el('cf-account').value),
    daily_limit: parseInt(el('cf-limit').value),
    send_days: days || 'mon,tue,wed,thu,fri',
    send_start_hour: parseInt(el('cf-start').value),
    send_end_hour: parseInt(el('cf-end').value),
  };
  if (!body.name || !body.account_id) { toast('Name and account required', 'error'); return; }
  try {
    await api('/campaigns', { method: 'POST', body: JSON.stringify(body) });
    toast('Campaign created', 'success');
    el('campaign-form').classList.remove('open');
    el('cf-name').value = '';
    loadCampaigns();
  } catch(e) { toast(e.message, 'error'); }
}

async function updateCampaignStatus(id, status) {
  try {
    await api('/campaigns/' + id + '/status', { method: 'PUT', body: JSON.stringify({ status: status }) });
    toast('Status → ' + status, 'success');
    loadCampaigns();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteCampaign(id) {
  if (!confirm('Delete this campaign and its steps?')) return;
  try {
    await api('/campaigns/' + id, { method: 'DELETE' });
    toast('Campaign deleted', 'success');
    loadCampaigns();
  } catch(e) { toast(e.message, 'error'); }
}

function populateAccountDropdown(id, accounts) {
  el(id).innerHTML = accounts.map(function(a) {
    return '<option value="' + a.id + '">' + a.email + '</option>';
  }).join('');
}

// ─── Email Preview Modal ──────────────────────────────────────────────────────
const PREVIEW_VARS = {
  first_name: 'Alex',
  last_name: 'Johnson',
  company: 'Acme Studio',
  personalized_line: 'noticed your recent rebrand looks sharp',
};

function interpolatePreview(text) {
  return text.replace(/\{\{(\w+)\}\}/g, function(_, key) {
    return PREVIEW_VARS[key] !== undefined ? PREVIEW_VARS[key] : '{{' + key + '}}';
  });
}

function capitalizeSentencesPreview(text) {
  return text.replace(/(^\s*|[.!?]\s+)([a-z])/g, function(_, pre, letter) { return pre + letter.toUpperCase(); });
}

function buildPreviewHtml(text) {
  const processed = capitalizeSentencesPreview(interpolatePreview(text));
  return processed
    .split(/\n\s*\n/)
    .map(function(b) { return b.trim(); })
    .filter(Boolean)
    .map(function(block) {
      const lines = block.split('\n').map(function(l) { return l.trim(); }).join('<br>');
      return '<p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222">' + lines + '</p>';
    })
    .join('');
}

let previewStepId = null;
let previewCampaignId = null;

function previewStep(btn) {
  const card = btn.closest('.step-card');
  const dataEl = card.querySelector('.step-data');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent);
  const subject = data.subject;
  const body = data.body;
  const campaignId = data.campaignId;
  const stepId = data.stepId;

  previewStepId = stepId;
  previewCampaignId = campaignId;

  const campaign = state.campaigns.find(function(c) { return c.id === campaignId; });
  const fromEmail = (campaign && campaign.account_email) || 'your@domain.com';

  el('preview-from').textContent = fromEmail;
  el('preview-subject').textContent = interpolatePreview(subject);
  el('preview-body').innerHTML =
    '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222222;max-width:600px">' +
    buildPreviewHtml(body) +
    '</div>';

  el('test-email-input').value = '';
  el('preview-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function() { el('test-email-input').focus(); }, 100);
}

function closePreviewModal(e) {
  if (e && e.target !== el('preview-modal')) return;
  el('preview-modal').classList.remove('open');
  document.body.style.overflow = '';
}

async function sendTestEmail() {
  const testEmail = el('test-email-input').value.trim();
  if (!testEmail) { toast('Enter an email address first', 'error'); return; }
  if (!previewCampaignId || !previewStepId) { toast('No step selected', 'error'); return; }

  const btn = el('test-email-input').nextElementSibling;
  const origText = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled = true;

  try {
    await api('/campaigns/' + previewCampaignId + '/steps/' + previewStepId + '/test', {
      method: 'POST',
      body: JSON.stringify({ test_email: testEmail }),
    });
    toast('Test email sent to ' + testEmail, 'success');
    el('test-email-input').value = '';
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}
