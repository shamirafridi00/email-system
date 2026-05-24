// ─── Campaign Templates ───────────────────────────────────────────────────────

var templatesState = {
  templates: [],
  currentCategory: '',
  steps: [],       // steps being built in the add form
  editSteps: {},   // steps being built in edit forms keyed by template id
};

var CATEGORY_META = {
  agency:          { color: '#818cf8', bg: '#1e1b4b', label: 'Agency' },
  saas:            { color: '#c084fc', bg: '#1a0930', label: 'SaaS' },
  ecommerce:       { color: '#fb923c', bg: '#1c0a00', label: 'E-commerce' },
  'personal-brand':{ color: '#4ade80', bg: '#052e16', label: 'Personal Brand' },
  general:         { color: '#9ca3af', bg: '#1f2937', label: 'General' },
};

function categoryBadge(cat) {
  var m = CATEGORY_META[cat] || CATEGORY_META.general;
  return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:' + m.bg + ';color:' + m.color + ';border:1px solid ' + m.color + '44">' + m.label + '</span>';
}

function fmtSendDays(days) {
  if (!days) return 'Mon–Fri';
  var parts = days.split(',').map(function(d) { return d.charAt(0).toUpperCase() + d.slice(1, 3); });
  return parts.join(', ');
}

function fmtHour(h) {
  if (h === 0) return '12am';
  if (h < 12) return h + 'am';
  if (h === 12) return '12pm';
  return (h - 12) + 'pm';
}

// ─── Load & Render ────────────────────────────────────────────────────────────

async function loadTemplates() {
  var grid = document.getElementById('templates-grid');
  if (grid) grid.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    var url = '/templates';
    if (templatesState.currentCategory) url += '?category=' + encodeURIComponent(templatesState.currentCategory);
    templatesState.templates = await api(url);
    renderTemplateGrid();
  } catch (e) {
    toast(e.message || 'Failed to load templates', 'error');
  }
}

function filterTemplatesByCategory() {
  var sel = document.getElementById('template-category-filter');
  templatesState.currentCategory = sel ? sel.value : '';
  loadTemplates();
}

function renderTemplateGrid() {
  var grid = document.getElementById('templates-grid');
  if (!grid) return;
  var templates = templatesState.templates;
  if (!templates.length) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:40px;color:#6b7280">No templates found.</div>';
    return;
  }
  grid.innerHTML = templates.map(function(t) { return templateCard(t); }).join('');
}

function templateCard(t) {
  var isSystem = t.id <= 3 && t.created_from_campaign_id === null;
  var lockBadge = isSystem ? '<span title="System template" style="font-size:12px;color:#f59e0b;margin-left:6px">🔒</span>' : '';
  var cat = CATEGORY_META[t.category] || CATEGORY_META.general;

  var editFormId = 'tpl-edit-form-' + t.id;

  return '<div class="card" style="display:flex;flex-direction:column;gap:0;padding:0;overflow:hidden">' +
    '<div style="height:3px;background:' + cat.color + '"></div>' +
    '<div style="padding:16px 20px;flex:1">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">' +
        '<div style="font-size:16px;font-weight:700;color:#e5e7eb">' + escHtml(t.name) + lockBadge + '</div>' +
        categoryBadge(t.category) +
      '</div>' +
      (t.description ? '<div style="font-size:12px;color:#6b7280;margin-bottom:10px">' + escHtml(t.description) + '</div>' : '') +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#9ca3af;margin-bottom:10px">' +
        '<span>📧 ' + (t.step_count || 0) + ' steps</span>' +
        '<span>📊 ' + (t.daily_limit || 20) + '/day</span>' +
        '<span>📅 ' + fmtSendDays(t.send_days) + ' ' + fmtHour(t.send_start_hour || 9) + '–' + fmtHour(t.send_end_hour || 17) + '</span>' +
        '<span style="color:#4b5563">Used ' + (t.usage_count || 0) + ' time' + (t.usage_count === 1 ? '' : 's') + '</span>' +
        (t.created_from_campaign_id ? '<span style="color:#818cf8">Saved from campaign</span>' : '') +
      '</div>' +
      '<div id="' + editFormId + '" style="display:none"></div>' +
    '</div>' +
    '<div style="padding:12px 20px;border-top:1px solid #1f2937;display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="btn btn-primary btn-sm" onclick="openUseTemplateModal(' + t.id + ',\'' + escHtml(t.name) + '\')">Use This Template</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="previewTemplate(' + t.id + ')">Preview Steps</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="editTemplate(' + t.id + ')">Edit</button>' +
      (!isSystem ? '<button class="btn btn-ghost btn-sm" style="color:#ef4444;border-color:#ef444444" onclick="deleteTemplate(' + t.id + ',\'' + escHtml(t.name) + '\')">Delete</button>' : '') +
    '</div>' +
  '</div>';
}

// ─── Preview Steps ────────────────────────────────────────────────────────────

async function previewTemplate(templateId) {
  var modal = document.getElementById('template-preview-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('tpl-preview-steps').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    var tpl = await api('/templates/' + templateId);
    document.getElementById('tpl-preview-name').textContent = tpl.name;
    document.getElementById('tpl-preview-desc').textContent = tpl.description || '';
    document.getElementById('tpl-preview-steps').innerHTML = tpl.steps.map(function(s, i) {
      return '<div style="display:flex;gap:14px;margin-bottom:16px">' +
        '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">' +
          '<div style="width:28px;height:28px;border-radius:50%;background:#6366f1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">' + s.step_number + '</div>' +
          (i < tpl.steps.length - 1 ? '<div style="width:2px;flex:1;background:#1f2937;margin-top:6px"></div>' : '') +
        '</div>' +
        '<div style="flex:1;background:#0f1923;border:1px solid #1f2937;border-radius:8px;padding:14px;margin-bottom:' + (i < tpl.steps.length - 1 ? '0' : '0') + '">' +
          '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
            '<span style="font-size:11px;font-weight:700;color:#818cf8;text-transform:uppercase">Step ' + s.step_number + '</span>' +
            (s.delay_days > 0 ? '<span style="font-size:11px;color:#6b7280">· Wait ' + s.delay_days + ' day' + (s.delay_days === 1 ? '' : 's') + '</span>' : '<span style="font-size:11px;color:#6b7280">· Send immediately</span>') +
          '</div>' +
          '<div style="font-size:13px;font-weight:600;color:#e5e7eb;margin-bottom:6px">' + escHtml(s.subject) + '</div>' +
          '<pre style="font-size:12px;color:#9ca3af;white-space:pre-wrap;margin:0;font-family:inherit">' + escHtml(s.body) + '</pre>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    document.getElementById('tpl-preview-steps').innerHTML = '<div style="color:#ef4444">Failed to load steps</div>';
  }
}

function closeTemplatePreviewModal(event) {
  var modal = document.getElementById('template-preview-modal');
  if (!modal) return;
  if (!event || event.target === modal) modal.style.display = 'none';
}

// ─── Use Template ─────────────────────────────────────────────────────────────

async function openUseTemplateModal(templateId, name) {
  var modal = document.getElementById('use-template-modal');
  if (!modal) return;
  document.getElementById('use-tpl-id').value = templateId;
  document.getElementById('use-tpl-name').textContent = name;
  document.getElementById('use-tpl-campaign-name').value = '';

  // Client label
  var clientEl = document.getElementById('use-tpl-client-name');
  if (clientEl && clientsState && clientsState.currentClient) {
    clientEl.textContent = clientsState.currentClient.name;
  }

  // Populate account dropdown
  var accEl = document.getElementById('use-tpl-account');
  try {
    var accounts = state && state.accounts && state.accounts.length ? state.accounts : await api('/accounts');
    accEl.innerHTML = accounts.map(function(a) {
      return '<option value="' + a.id + '">' + a.email + '</option>';
    }).join('');
  } catch (e) {
    accEl.innerHTML = '<option>— no accounts —</option>';
  }

  modal.style.display = 'flex';
}

function closeUseTemplateModal(event) {
  var modal = document.getElementById('use-template-modal');
  if (!modal) return;
  if (!event || event.target === modal) modal.style.display = 'none';
}

async function submitUseTemplate() {
  var templateId = document.getElementById('use-tpl-id').value;
  var name = document.getElementById('use-tpl-campaign-name').value.trim();
  var accountId = parseInt(document.getElementById('use-tpl-account').value);
  if (!name) { toast('Campaign name is required', 'error'); return; }
  if (!accountId) { toast('Select a sending account', 'error'); return; }
  try {
    var result = await api('/templates/' + templateId + '/use', {
      method: 'POST',
      body: JSON.stringify({ name: name, account_id: accountId }),
    });
    document.getElementById('use-template-modal').style.display = 'none';
    toast('Campaign "' + name + '" created from template (' + result.steps_created + ' steps)', 'success');
    // Navigate to campaigns and highlight new campaign
    navigate('campaigns');
    setTimeout(function() {
      var row = document.getElementById('cr-' + result.campaign_id);
      if (row) { row.style.outline = '2px solid #6366f1'; setTimeout(function() { row.style.outline = ''; }, 3000); }
    }, 800);
  } catch (e) {
    toast(e.message || 'Failed to create campaign', 'error');
  }
}

// ─── Add Template Form ────────────────────────────────────────────────────────

function showAddTemplateForm() {
  var card = document.getElementById('add-template-form-card');
  if (card) { card.style.display = 'block'; card.scrollIntoView({ behavior: 'smooth' }); }
  templatesState.steps = [];
  renderTemplateStepsList();
}

function hideAddTemplateForm() {
  var card = document.getElementById('add-template-form-card');
  if (card) card.style.display = 'none';
  templatesState.steps = [];
}

function renderTemplateStepsList() {
  var list = document.getElementById('tpl-steps-list');
  if (!list) return;
  if (!templatesState.steps.length) {
    list.innerHTML = '<div style="font-size:12px;color:#6b7280;margin-bottom:10px">No steps yet. Add a step below.</div>';
    return;
  }
  list.innerHTML = templatesState.steps.map(function(s, i) {
    return '<div style="background:#0f1923;border:1px solid #1f2937;border-radius:8px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px">' +
      '<div style="width:24px;height:24px;border-radius:50%;background:#6366f1;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">' + (i + 1) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        (s.delay_days > 0 ? '<div style="font-size:11px;color:#6b7280;margin-bottom:3px">Wait ' + s.delay_days + ' day' + (s.delay_days === 1 ? '' : 's') + '</div>' : '<div style="font-size:11px;color:#6b7280;margin-bottom:3px">Send immediately</div>') +
        '<div style="font-size:13px;font-weight:600;color:#e5e7eb">' + escHtml(s.subject) + '</div>' +
        '<div style="font-size:12px;color:#6b7280;margin-top:2px;white-space:pre-wrap;max-height:60px;overflow:hidden">' + escHtml(s.body.slice(0, 120)) + (s.body.length > 120 ? '…' : '') + '</div>' +
      '</div>' +
      '<button onclick="removeTemplateStep(' + i + ')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;flex-shrink:0">✕</button>' +
    '</div>';
  }).join('');
}

function addTemplateStep() {
  var subject = document.getElementById('tpl-step-subject').value.trim();
  var body = document.getElementById('tpl-step-body').value.trim();
  var delay = parseInt(document.getElementById('tpl-step-delay').value) || 0;
  if (!subject || !body) { toast('Subject and body are required', 'error'); return; }
  templatesState.steps.push({ step_number: templatesState.steps.length + 1, subject: subject, body: body, delay_days: delay });
  document.getElementById('tpl-step-subject').value = '';
  document.getElementById('tpl-step-body').value = '';
  document.getElementById('tpl-step-delay').value = '0';
  renderTemplateStepsList();
}

function removeTemplateStep(index) {
  templatesState.steps.splice(index, 1);
  templatesState.steps.forEach(function(s, i) { s.step_number = i + 1; });
  renderTemplateStepsList();
}

async function saveTemplate() {
  var name = document.getElementById('tpl-name').value.trim();
  if (!name) { toast('Template name is required', 'error'); return; }
  if (!templatesState.steps.length) { toast('Add at least one step', 'error'); return; }

  var days = Array.from(document.querySelectorAll('.tpl-day:checked')).map(function(c) { return c.value; }).join(',');
  var body = {
    name: name,
    description: document.getElementById('tpl-description').value.trim() || null,
    category: document.getElementById('tpl-category').value,
    daily_limit: parseInt(document.getElementById('tpl-limit').value) || 20,
    send_days: days || 'mon,tue,wed,thu,fri',
    send_start_hour: parseInt(document.getElementById('tpl-start').value) || 9,
    send_end_hour: parseInt(document.getElementById('tpl-end').value) || 17,
    timezone_aware: document.getElementById('tpl-timezone-aware').checked ? 1 : 0,
    steps: templatesState.steps,
  };
  try {
    await api('/templates', { method: 'POST', body: JSON.stringify(body) });
    toast('Template "' + name + '" saved', 'success');
    hideAddTemplateForm();
    await loadTemplates();
  } catch (e) {
    toast(e.message || 'Failed to save template', 'error');
  }
}

// ─── Edit Template ────────────────────────────────────────────────────────────

async function editTemplate(templateId) {
  var formDiv = document.getElementById('tpl-edit-form-' + templateId);
  if (!formDiv) return;
  if (formDiv.style.display !== 'none') { formDiv.style.display = 'none'; return; }

  try {
    var tpl = await api('/templates/' + templateId);
    templatesState.editSteps[templateId] = tpl.steps.map(function(s) { return Object.assign({}, s); });

    var days = (tpl.send_days || 'mon,tue,wed,thu,fri').split(',');
    var allDays = ['mon','tue','wed','thu','fri','sat','sun'];
    var dayCheckboxes = allDays.map(function(d) {
      return '<label><input type="checkbox" class="tpl-edit-day-' + templateId + '" value="' + d + '"' + (days.includes(d) ? ' checked' : '') + '> ' + d.charAt(0).toUpperCase() + d.slice(1, 3) + '</label>';
    }).join(' ');

    formDiv.innerHTML =
      '<div style="border-top:1px solid #1f2937;margin-top:12px;padding-top:12px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div class="form-group" style="margin-bottom:0"><label style="font-size:12px">Name</label><input id="tpl-edit-name-' + templateId + '" value="' + escHtml(tpl.name) + '" style="font-size:13px"></div>' +
        '<div class="form-group" style="margin-bottom:0"><label style="font-size:12px">Category</label>' +
          '<select id="tpl-edit-cat-' + templateId + '" style="font-size:13px">' +
            ['general','agency','saas','ecommerce','personal-brand'].map(function(c) {
              return '<option value="' + c + '"' + (c === tpl.category ? ' selected' : '') + '>' + (CATEGORY_META[c] || {label:c}).label + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:10px"><label style="font-size:12px">Description</label><textarea id="tpl-edit-desc-' + templateId + '" rows="2" style="font-size:13px">' + escHtml(tpl.description || '') + '</textarea></div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">' +
        '<div class="form-group" style="margin-bottom:0"><label style="font-size:12px">Daily Limit</label><input id="tpl-edit-limit-' + templateId + '" type="number" value="' + tpl.daily_limit + '" style="font-size:13px"></div>' +
        '<div class="form-group" style="margin-bottom:0"><label style="font-size:12px">Start Hour</label><input id="tpl-edit-start-' + templateId + '" type="number" value="' + tpl.send_start_hour + '" style="font-size:13px"></div>' +
        '<div class="form-group" style="margin-bottom:0"><label style="font-size:12px">End Hour</label><input id="tpl-edit-end-' + templateId + '" type="number" value="' + tpl.send_end_hour + '" style="font-size:13px"></div>' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:10px"><label style="font-size:12px">Send Days</label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' + dayCheckboxes + '</div></div>' +
      '<div style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Steps</div>' +
      '<div id="tpl-edit-steps-' + templateId + '"></div>' +
      '<div class="card" style="background:#0d1117;margin-bottom:10px;padding:12px">' +
        '<div style="display:grid;grid-template-columns:80px 1fr;gap:8px;margin-bottom:8px">' +
          '<div class="form-group" style="margin-bottom:0"><label style="font-size:11px">Delay</label><input id="tpl-edit-step-delay-' + templateId + '" type="number" value="0" min="0" style="font-size:13px"></div>' +
          '<div class="form-group" style="margin-bottom:0"><label style="font-size:11px">Subject</label><input id="tpl-edit-step-subject-' + templateId + '" style="font-size:13px"></div>' +
        '</div>' +
        '<div class="form-group"><label style="font-size:11px">Body</label><textarea id="tpl-edit-step-body-' + templateId + '" rows="4" style="font-size:13px"></textarea></div>' +
        '<button class="btn btn-ghost btn-sm" onclick="addEditTemplateStep(' + templateId + ')">+ Add Step</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary btn-sm" onclick="saveEditTemplate(' + templateId + ')">Save Changes</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="cancelEditTemplate(' + templateId + ')">Cancel</button>' +
      '</div>' +
      '</div>';

    formDiv.style.display = 'block';
    renderEditStepsList(templateId);
  } catch (e) {
    toast(e.message || 'Failed to load template', 'error');
  }
}

function renderEditStepsList(templateId) {
  var list = document.getElementById('tpl-edit-steps-' + templateId);
  if (!list) return;
  var steps = templatesState.editSteps[templateId] || [];
  if (!steps.length) { list.innerHTML = '<div style="font-size:12px;color:#6b7280;margin-bottom:8px">No steps.</div>'; return; }
  list.innerHTML = steps.map(function(s, i) {
    return '<div style="background:#0f1923;border:1px solid #1f2937;border-radius:6px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:10px">' +
      '<span style="width:20px;height:20px;border-radius:50%;background:#6366f1;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">' + (i + 1) + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;color:#e5e7eb;font-weight:600">' + escHtml(s.subject) + '</div>' +
        '<div style="font-size:11px;color:#6b7280">' + (s.delay_days > 0 ? 'Wait ' + s.delay_days + 'd' : 'Immediate') + '</div>' +
      '</div>' +
      '<button onclick="removeEditTemplateStep(' + templateId + ',' + i + ')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:13px">✕</button>' +
    '</div>';
  }).join('');
}

function addEditTemplateStep(templateId) {
  var subject = document.getElementById('tpl-edit-step-subject-' + templateId).value.trim();
  var body = document.getElementById('tpl-edit-step-body-' + templateId).value.trim();
  var delay = parseInt(document.getElementById('tpl-edit-step-delay-' + templateId).value) || 0;
  if (!subject || !body) { toast('Subject and body required', 'error'); return; }
  if (!templatesState.editSteps[templateId]) templatesState.editSteps[templateId] = [];
  var steps = templatesState.editSteps[templateId];
  steps.push({ step_number: steps.length + 1, subject: subject, body: body, delay_days: delay });
  document.getElementById('tpl-edit-step-subject-' + templateId).value = '';
  document.getElementById('tpl-edit-step-body-' + templateId).value = '';
  document.getElementById('tpl-edit-step-delay-' + templateId).value = '0';
  renderEditStepsList(templateId);
}

function removeEditTemplateStep(templateId, index) {
  var steps = templatesState.editSteps[templateId] || [];
  steps.splice(index, 1);
  steps.forEach(function(s, i) { s.step_number = i + 1; });
  renderEditStepsList(templateId);
}

function cancelEditTemplate(templateId) {
  var formDiv = document.getElementById('tpl-edit-form-' + templateId);
  if (formDiv) formDiv.style.display = 'none';
  delete templatesState.editSteps[templateId];
}

async function saveEditTemplate(templateId) {
  var name = document.getElementById('tpl-edit-name-' + templateId).value.trim();
  if (!name) { toast('Template name is required', 'error'); return; }
  var steps = templatesState.editSteps[templateId] || [];
  if (!steps.length) { toast('Add at least one step', 'error'); return; }

  var checkedDays = Array.from(document.querySelectorAll('.tpl-edit-day-' + templateId + ':checked')).map(function(c) { return c.value; });
  var body = {
    name: name,
    description: document.getElementById('tpl-edit-desc-' + templateId).value.trim() || null,
    category: document.getElementById('tpl-edit-cat-' + templateId).value,
    daily_limit: parseInt(document.getElementById('tpl-edit-limit-' + templateId).value) || 20,
    send_days: checkedDays.join(',') || 'mon,tue,wed,thu,fri',
    send_start_hour: parseInt(document.getElementById('tpl-edit-start-' + templateId).value) || 9,
    send_end_hour: parseInt(document.getElementById('tpl-edit-end-' + templateId).value) || 17,
    steps: steps,
  };
  try {
    await api('/templates/' + templateId, { method: 'PUT', body: JSON.stringify(body) });
    toast('Template updated', 'success');
    delete templatesState.editSteps[templateId];
    await loadTemplates();
  } catch (e) {
    toast(e.message || 'Failed to update template', 'error');
  }
}

// ─── Delete Template ──────────────────────────────────────────────────────────

async function deleteTemplate(templateId, name) {
  if (!confirm('Delete template "' + name + '"? This cannot be undone.')) return;
  try {
    var res = await fetch('/templates/' + templateId, { method: 'DELETE' });
    if (!res.ok) {
      var err = await res.json();
      toast(err.error || 'Cannot delete template', 'error');
      return;
    }
    toast('Template "' + name + '" deleted', 'success');
    await loadTemplates();
  } catch (e) {
    toast(e.message || 'Error deleting template', 'error');
  }
}

// ─── Save from Existing Campaign ──────────────────────────────────────────────

async function showSaveFromCampaignModal() {
  var modal = document.getElementById('save-from-campaign-modal');
  if (!modal) return;
  // Populate campaign dropdown
  var sel = document.getElementById('sfc-campaign');
  try {
    var camps = state && state.campaigns && state.campaigns.length ? state.campaigns : await api('/campaigns');
    sel.innerHTML = camps.map(function(c) {
      return '<option value="' + c.id + '">' + escHtml(c.name) + '</option>';
    }).join('');
    // Pre-fill template name with selected campaign name
    if (camps.length) {
      document.getElementById('sfc-name').value = camps[0].name;
      sel.addEventListener('change', function() {
        var chosen = camps.find(function(c) { return c.id === parseInt(sel.value); });
        if (chosen) document.getElementById('sfc-name').value = chosen.name;
      });
    }
  } catch (e) {
    sel.innerHTML = '<option>— no campaigns —</option>';
  }
  modal.style.display = 'flex';
}

function closeSaveFromCampaignModal(event) {
  var modal = document.getElementById('save-from-campaign-modal');
  if (!modal) return;
  if (!event || event.target === modal) modal.style.display = 'none';
}

async function saveFromCampaign() {
  var campaignId = parseInt(document.getElementById('sfc-campaign').value);
  var name = document.getElementById('sfc-name').value.trim();
  if (!campaignId) { toast('Select a campaign', 'error'); return; }
  if (!name) { toast('Template name is required', 'error'); return; }
  var body = {
    campaign_id: campaignId,
    name: name,
    description: document.getElementById('sfc-description').value.trim() || null,
    category: document.getElementById('sfc-category').value,
  };
  try {
    await api('/templates/save-from-campaign', { method: 'POST', body: JSON.stringify(body) });
    toast('Template "' + name + '" saved', 'success');
    document.getElementById('save-from-campaign-modal').style.display = 'none';
    await loadTemplates();
  } catch (e) {
    toast(e.message || 'Failed to save template', 'error');
  }
}

// ─── Start from Template Modal (launched from Campaigns section) ──────────────

async function showStartFromTemplateModal() {
  var modal = document.getElementById('start-from-template-modal');
  if (!modal) return;
  var grid = document.getElementById('start-from-template-grid');
  grid.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  modal.style.display = 'flex';
  try {
    var templates = await api('/templates');
    if (!templates.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#6b7280;padding:40px">No templates yet.</div>';
      return;
    }
    grid.innerHTML = templates.map(function(t) {
      var cat = CATEGORY_META[t.category] || CATEGORY_META.general;
      return '<div onclick="applyTemplateToForm(' + t.id + ')" style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:14px 16px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor=\'' + cat.color + '\'" onmouseout="this.style.borderColor=\'#1f2937\'">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<div style="font-size:14px;font-weight:700;color:#e5e7eb">' + escHtml(t.name) + '</div>' +
          categoryBadge(t.category) +
        '</div>' +
        (t.description ? '<div style="font-size:12px;color:#6b7280;margin-bottom:6px">' + escHtml(t.description) + '</div>' : '') +
        '<div style="font-size:12px;color:#4b5563">📧 ' + (t.step_count || 0) + ' steps · 📊 ' + (t.daily_limit || 20) + '/day</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div style="grid-column:1/-1;color:#ef4444;text-align:center">Failed to load templates</div>';
  }
}

function closeStartFromTemplateModal(event) {
  var modal = document.getElementById('start-from-template-modal');
  if (!modal) return;
  if (!event || event.target === modal) modal.style.display = 'none';
}

async function applyTemplateToForm(templateId) {
  try {
    var tpl = await api('/templates/' + templateId);
    // Pre-fill campaign create form fields
    var nameEl = document.getElementById('cf-name');
    if (nameEl && !nameEl.value) nameEl.value = tpl.name;

    var limitEl = document.getElementById('cf-limit');
    if (limitEl) limitEl.value = tpl.daily_limit;

    var startEl = document.getElementById('cf-start');
    if (startEl) startEl.value = tpl.send_start_hour;

    var endEl = document.getElementById('cf-end');
    if (endEl) endEl.value = tpl.send_end_hour;

    var tzEl = document.getElementById('cf-timezone-aware');
    if (tzEl) tzEl.checked = !!tpl.timezone_aware;

    // Set send day checkboxes
    var selectedDays = (tpl.send_days || 'mon,tue,wed,thu,fri').split(',');
    document.querySelectorAll('.send-day').forEach(function(cb) {
      cb.checked = selectedDays.includes(cb.value);
    });

    document.getElementById('start-from-template-modal').style.display = 'none';

    // Make sure campaign form is open
    var form = document.getElementById('campaign-form');
    if (form && !form.classList.contains('open')) form.classList.add('open');

    toast('Template "' + tpl.name + '" applied — fill in the account and save', 'success');
  } catch (e) {
    toast(e.message || 'Failed to apply template', 'error');
  }
}
