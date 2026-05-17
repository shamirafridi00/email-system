// ─── Leads ───────────────────────────────────────────────────────────────────
async function loadLeads() {
  try {
    const campaigns = await api('/campaigns');
    state.campaigns = campaigns;
    const filter = el('leads-campaign-filter');
    const current = filter.value;
    filter.innerHTML = '<option value="">All Campaigns</option>' +
      campaigns.map(function(c) {
        return '<option value="' + c.id + '"' + (c.id == current ? ' selected' : '') + '>' + c.name + '</option>';
      }).join('');

    el('import-campaign').innerHTML = campaigns.map(function(c) {
      return '<option value="' + c.id + '">' + c.name + '</option>';
    }).join('');

    const campaignId = filter.value;
    const url = campaignId ? '/leads?campaign_id=' + campaignId : '/leads';
    state.leads = await api(url);

    const stats = await api('/leads/stats');
    renderLeadStats(stats);
    renderLeads(state.leads);
  } catch(e) { toast(e.message, 'error'); }
}

function renderLeadStats(stats) {
  const statuses = ['active', 'replied', 'finished', 'bounced', 'unsubscribed'];
  el('lead-stats').innerHTML = statuses.map(function(s) {
    return '<div class="stat-card" style="padding:10px 14px;min-width:90px">' +
      '<div class="label" style="font-size:10px">' + s + '</div>' +
      '<div class="value" style="font-size:20px">' + (stats[s] || 0) + '</div>' +
      '</div>';
  }).join('');
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
    '<th>Actions</th>' +
    '</tr></thead><tbody>' +
    rows.map(function(r) {
      return '<tr>' +
        '<td>' + (r.first_name || '') + ' ' + (r.last_name || '') + '</td>' +
        '<td>' + r.email + '</td>' +
        '<td>' + (r.company || '—') + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td>' + r.current_step + '</td>' +
        '<td>' + (r.next_send_date || '—') + '</td>' +
        '<td style="display:flex;gap:6px">' +
          '<button class="btn btn-ghost btn-sm" onclick="resetLead(' + r.id + ')">Reset</button>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteLead(' + r.id + ')">✕</button>' +
        '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
}

function filterLeads() {
  const q = el('lead-search').value.toLowerCase();
  const filtered = q ? state.leads.filter(function(r) {
    return (r.first_name + ' ' + r.last_name).toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      (r.company || '').toLowerCase().includes(q);
  }) : state.leads;
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
}

function closeImportPanel() {
  el('import-panel').classList.remove('open');
  el('overlay').classList.remove('open');
}

async function importCSV() {
  const campaignId = parseInt(el('import-campaign').value);
  const csv = el('import-csv').value.trim();
  if (!csv) { toast('Paste CSV content first', 'error'); return; }
  try {
    const r = await api('/leads/import', { method: 'POST', body: JSON.stringify({ campaign_id: campaignId, csv: csv }) });
    el('import-result').innerHTML = '<div style="color:#22c55e;font-size:13px">✓ ' + r.imported + ' imported, ' + r.skipped + ' skipped as duplicates</div>';
    toast(r.imported + ' leads imported', 'success');
    loadLeads();
  } catch(e) {
    el('import-result').innerHTML = '<div style="color:#ef4444;font-size:13px">' + e.message + '</div>';
    toast(e.message, 'error');
  }
}
