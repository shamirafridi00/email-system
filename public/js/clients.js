// ─── Client Management ────────────────────────────────────────────────────────

const CLIENT_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#8b5cf6','#06b6d4'];

const clientsState = {
  clients: [],
  currentClient: null,
  showAddForm: false,
};

// ─── Color picker init ────────────────────────────────────────────────────────

function initColorPicker(containerId, inputId, selectedColor) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const current = selectedColor || '#6366f1';
  CLIENT_COLORS.forEach(function(color) {
    const swatch = document.createElement('div');
    swatch.style.cssText = `width:24px;height:24px;border-radius:50%;background:${color};cursor:pointer;border:2px solid ${color === current ? '#fff' : 'transparent'};transition:border-color .15s`;
    swatch.onclick = function() {
      container.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
      swatch.style.borderColor = '#fff';
      document.getElementById(inputId).value = color;
    };
    container.appendChild(swatch);
  });
  document.getElementById(inputId).value = current;
}

function toggleClientTokenVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ─── Load & Render ────────────────────────────────────────────────────────────

async function loadClients() {
  try {
    const [clientsRes, currentRes] = await Promise.all([
      fetch('/clients'),
      fetch('/clients/current'),
    ]);
    clientsState.clients = await clientsRes.json();
    if (currentRes.ok) {
      clientsState.currentClient = await currentRes.json();
    }
    renderClientGrid();
    renderClientSwitcher();
    updateClientContextUI();
  } catch (err) {
    console.error('loadClients error:', err);
  }
}

async function loadCurrentClient() {
  try {
    const res = await fetch('/clients/current');
    if (!res.ok) return;
    clientsState.currentClient = await res.json();
    // Also refresh clients list for switcher accuracy
    const allRes = await fetch('/clients');
    if (allRes.ok) clientsState.clients = await allRes.json();
    renderClientSwitcher();
    updateClientContextUI();
  } catch (err) {
    console.error('loadCurrentClient error:', err);
  }
}

function updateClientContextUI() {
  const client = clientsState.currentClient;
  if (!client) return;

  // Top bar switcher pill
  const nameEl = document.getElementById('client-switcher-name');
  const dotEl = document.getElementById('client-color-dot');
  if (nameEl) nameEl.textContent = client.name;
  if (dotEl) dotEl.style.background = client.color || '#6366f1';

  // Campaign section dot
  const campaignDot = document.getElementById('campaign-section-client-dot');
  if (campaignDot) campaignDot.style.background = client.color || '#6366f1';

  // Dashboard title
  const cdClientName = document.getElementById('cd-client-name');
  if (cdClientName) cdClientName.textContent = '— ' + client.name;

  // Breadcrumb
  const breadcrumb = document.getElementById('client-breadcrumb');
  const breadcrumbName = document.getElementById('client-breadcrumb-name');
  if (breadcrumb && breadcrumbName) {
    breadcrumb.style.display = 'block';
    breadcrumbName.textContent = client.name;
  }
}

function renderClientGrid() {
  const grid = document.getElementById('clients-grid');
  if (!grid) return;
  const clients = clientsState.clients;
  if (!clients.length) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:40px;color:#6b7280">No clients yet. Add your first client above.</div>';
    return;
  }
  const currentId = clientsState.currentClient?.id;
  grid.innerHTML = clients.map(function(cl) {
    const isActive = cl.id === currentId;
    const statusColor = cl.status === 'active' ? '#10b981' : cl.status === 'paused' ? '#f59e0b' : '#6b7280';
    return `
      <div id="client-card-${cl.id}" style="background:#111827;border:2px solid ${isActive ? cl.color : '#1f2937'};border-radius:10px;overflow:hidden;display:flex;flex-direction:column">
        <div style="height:4px;background:${cl.color}"></div>
        <div style="padding:16px 20px;flex:1">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">
            <div>
              <div style="font-size:17px;font-weight:700;color:#e5e7eb">${escHtml(cl.name)}</div>
              ${cl.contact_name ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px">${escHtml(cl.contact_name)}${cl.contact_email ? ' · ' + escHtml(cl.contact_email) : ''}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              ${isActive ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:#4f46e5;color:#fff">Active</span>` : ''}
              <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44">${cl.status}</span>
            </div>
          </div>
          <div style="display:flex;gap:20px;margin:12px 0;padding:10px 0;border-top:1px solid #1f2937;border-bottom:1px solid #1f2937">
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:700;color:#e5e7eb">${cl.campaign_count || 0}</div>
              <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Campaigns</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:700;color:#e5e7eb">${cl.account_count || 0}</div>
              <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Accounts</div>
            </div>
          </div>
          <div id="client-edit-form-${cl.id}" style="display:none;margin-top:12px">
            ${buildEditForm(cl)}
          </div>
        </div>
        <div style="padding:12px 20px;border-top:1px solid #1f2937;display:flex;gap:8px;flex-wrap:wrap">
          ${!isActive ? `<button class="btn btn-primary btn-sm" onclick="switchClient(${cl.id})" style="background:${cl.color};border-color:${cl.color}">Switch to Client</button>` : '<span style="font-size:12px;color:#6b7280;padding:4px 0;align-self:center">Currently Active</span>'}
          <button class="btn btn-ghost btn-sm" onclick="toggleEditClient(${cl.id})">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="showClientStats(${cl.id}, '${escHtml(cl.name)}')">View Stats</button>
          <button class="btn btn-ghost btn-sm" style="color:#ef4444;border-color:#ef444444" onclick="deleteClient(${cl.id}, '${escHtml(cl.name)}')">Delete</button>
        </div>
      </div>`;
  }).join('');

  // Init color pickers for edit forms
  clients.forEach(function(cl) {
    initColorPicker(`edit-client-color-picker-${cl.id}`, `edit-client-color-value-${cl.id}`, cl.color);
  });
}

function buildEditForm(cl) {
  return `
    <div class="form-group" style="margin-bottom:10px">
      <label style="font-size:12px">Client Name</label>
      <input id="edit-client-name-${cl.id}" type="text" value="${escHtml(cl.name)}" style="font-size:13px">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div class="form-group" style="margin-bottom:0">
        <label style="font-size:12px">Contact Name</label>
        <input id="edit-client-contact-name-${cl.id}" type="text" value="${escHtml(cl.contact_name || '')}" style="font-size:13px">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label style="font-size:12px">Contact Email</label>
        <input id="edit-client-contact-email-${cl.id}" type="email" value="${escHtml(cl.contact_email || '')}" style="font-size:13px">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;position:relative">
      <label style="font-size:12px">HubSpot Token</label>
      <input id="edit-client-hubspot-token-${cl.id}" type="password" value="${escHtml(cl.hubspot_token || '')}" style="font-size:13px">
      <button type="button" onclick="toggleClientTokenVisibility('edit-client-hubspot-token-${cl.id}')" style="position:absolute;right:10px;top:30px;background:none;border:none;color:#6b7280;cursor:pointer;font-size:12px">Show</button>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label style="font-size:12px">HubSpot Portal ID</label>
      <input id="edit-client-portal-id-${cl.id}" type="text" value="${escHtml(cl.hubspot_portal_id || '')}" style="font-size:13px">
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label style="font-size:12px">Status</label>
      <select id="edit-client-status-${cl.id}" style="font-size:13px">
        <option value="active" ${cl.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="paused" ${cl.status === 'paused' ? 'selected' : ''}>Paused</option>
        <option value="completed" ${cl.status === 'completed' ? 'selected' : ''}>Completed</option>
      </select>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label style="font-size:12px">Notes</label>
      <textarea id="edit-client-notes-${cl.id}" rows="2" style="font-size:13px">${escHtml(cl.notes || '')}</textarea>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label style="font-size:12px">Color</label>
      <div id="edit-client-color-picker-${cl.id}" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"></div>
      <input id="edit-client-color-value-${cl.id}" type="hidden" value="${escHtml(cl.color || '#6366f1')}">
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" onclick="saveEditClient(${cl.id})">Save</button>
      <button class="btn btn-ghost btn-sm" onclick="toggleEditClient(${cl.id})">Cancel</button>
    </div>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Client Switcher dropdown ─────────────────────────────────────────────────

function renderClientSwitcher() {
  const list = document.getElementById('client-dropdown-list');
  if (!list) return;
  const currentId = clientsState.currentClient?.id;
  list.innerHTML = clientsState.clients.map(function(cl) {
    const isActive = cl.id === currentId;
    return `<div onclick="switchClient(${cl.id})" style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;background:${isActive ? '#1f2937' : ''};transition:background .15s" onmouseover="this.style.background='#1f2937'" onmouseout="this.style.background='${isActive ? '#1f2937' : ''}'">
      <span style="width:8px;height:8px;border-radius:50%;background:${cl.color};flex-shrink:0"></span>
      <span style="flex:1;font-size:13px;color:#e5e7eb">${escHtml(cl.name)}</span>
      <span style="font-size:11px;color:#6b7280">${cl.campaign_count || 0} campaigns</span>
      ${isActive ? '<span style="font-size:10px;color:#818cf8">✓</span>' : ''}
    </div>`;
  }).join('');

  updateClientContextUI();
}

function toggleClientDropdown() {
  const dd = document.getElementById('client-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function closeClientDropdown() {
  const dd = document.getElementById('client-dropdown');
  if (dd) dd.style.display = 'none';
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const switcher = document.getElementById('client-switcher');
  if (switcher && !switcher.contains(e.target)) closeClientDropdown();
});

// ─── Switch Client ────────────────────────────────────────────────────────────

async function switchClient(clientId) {
  closeClientDropdown();
  try {
    const res = await fetch(`/clients/${clientId}/switch`, { method: 'POST' });
    if (!res.ok) throw new Error('Switch failed');
    window.location.reload();
  } catch (err) {
    toast('Failed to switch client', 'error');
  }
}

function refreshCurrentSection() {
  const section = state && state.section;
  if (!section) return;
  const loaderMap = {
    'campaign-dashboard': loadCampaignDashboard,
    'analytics': loadAnalytics,
    'campaigns': loadCampaigns,
    'leads': loadLeads,
    'sending-accounts': loadAccounts,
  };
  const loader = loaderMap[section];
  if (loader) loader();
}

// ─── Add Client Form ──────────────────────────────────────────────────────────

function showAddClientForm() {
  clientsState.showAddForm = true;
  const card = document.getElementById('add-client-form-card');
  if (card) card.style.display = 'block';
  initColorPicker('new-client-color-picker', 'new-client-color-value', '#6366f1');
}

function hideAddClientForm() {
  clientsState.showAddForm = false;
  const card = document.getElementById('add-client-form-card');
  if (card) card.style.display = 'none';
}

function showAddClientFromSwitcher() {
  navigate('clients');
  setTimeout(showAddClientForm, 100);
}

async function saveClient() {
  const name = document.getElementById('new-client-name')?.value.trim();
  console.log('[saveClient] name field value:', name);
  if (!name) { toast('Client name is required', 'error'); return; }
  const body = {
    name,
    contact_name: document.getElementById('new-client-contact-name')?.value.trim() || null,
    contact_email: document.getElementById('new-client-contact-email')?.value.trim() || null,
    hubspot_token: document.getElementById('new-client-hubspot-token')?.value.trim() || null,
    hubspot_portal_id: document.getElementById('new-client-portal-id')?.value.trim() || null,
    notes: document.getElementById('new-client-notes')?.value.trim() || null,
    color: document.getElementById('new-client-color-value')?.value || '#6366f1',
  };
  console.log('[saveClient] payload:', body);
  try {
    const res = await fetch('/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log('[saveClient] response status:', res.status);
    if (!res.ok) {
      const err = await res.json();
      console.error('[saveClient] error response:', err);
      toast(err.error || 'Failed to create client', 'error');
      return;
    }
    toast(`Client "${name}" created`, 'success');
    // Clear form
    ['new-client-name','new-client-contact-name','new-client-contact-email','new-client-hubspot-token','new-client-portal-id','new-client-notes'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    hideAddClientForm();
    await loadClients();
  } catch (err) {
    toast('Error creating client', 'error');
  }
}

// ─── Edit Client ──────────────────────────────────────────────────────────────

function toggleEditClient(clientId) {
  const form = document.getElementById(`client-edit-form-${clientId}`);
  if (!form) return;
  const isShowing = form.style.display !== 'none';
  form.style.display = isShowing ? 'none' : 'block';
  if (!isShowing) {
    const cl = clientsState.clients.find(function(c) { return c.id === clientId; });
    if (cl) initColorPicker(`edit-client-color-picker-${clientId}`, `edit-client-color-value-${clientId}`, cl.color);
  }
}

async function saveEditClient(clientId) {
  const body = {
    name: document.getElementById(`edit-client-name-${clientId}`)?.value.trim(),
    contact_name: document.getElementById(`edit-client-contact-name-${clientId}`)?.value.trim() || null,
    contact_email: document.getElementById(`edit-client-contact-email-${clientId}`)?.value.trim() || null,
    hubspot_token: document.getElementById(`edit-client-hubspot-token-${clientId}`)?.value.trim() || null,
    hubspot_portal_id: document.getElementById(`edit-client-portal-id-${clientId}`)?.value.trim() || null,
    status: document.getElementById(`edit-client-status-${clientId}`)?.value,
    notes: document.getElementById(`edit-client-notes-${clientId}`)?.value.trim() || null,
    color: document.getElementById(`edit-client-color-value-${clientId}`)?.value || '#6366f1',
  };
  if (!body.name) { toast('Client name is required', 'error'); return; }
  try {
    const res = await fetch(`/clients/${clientId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { toast('Failed to update client', 'error'); return; }
    toast('Client updated', 'success');
    await loadClients();
  } catch (err) {
    toast('Error updating client', 'error');
  }
}

// ─── Delete Client ────────────────────────────────────────────────────────────

async function deleteClient(clientId, name) {
  if (!confirm(`Delete client "${name}"? Their campaigns and accounts will be reassigned to Default Client.`)) return;
  try {
    const res = await fetch(`/clients/${clientId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      if (err.error === 'default_client') {
        toast(err.message || 'Default Client cannot be deleted.', 'error');
        return;
      }
      if (err.active_campaign_count > 0) {
        const forcedConfirmed = confirm(
          `This client has ${err.active_campaign_count} active campaign(s). Force delete will permanently remove this client and reassign all campaigns and accounts to Default Client. Are you sure?`
        );
        if (!forcedConfirmed) return;
        const forceRes = await fetch(`/clients/${clientId}?force=true`, { method: 'DELETE' });
        if (!forceRes.ok) {
          const forceErr = await forceRes.json();
          toast(forceErr.error || 'Force delete failed', 'error');
          return;
        }
        const forceData = await forceRes.json();
        toast(`Client deleted. ${forceData.campaigns_reassigned} campaigns reassigned to Default Client.`, 'success');
        await loadClients();
        return;
      }
      toast(err.error || 'Cannot delete client', 'error');
      return;
    }
    const data = await res.json();
    const msg = data.campaigns_reassigned > 0
      ? `Client "${name}" deleted. ${data.campaigns_reassigned} campaigns reassigned to Default Client.`
      : `Client "${name}" deleted.`;
    toast(msg, 'success');
    await loadClients();
  } catch (err) {
    toast('Error deleting client', 'error');
  }
}

// ─── Client Stats Modal ───────────────────────────────────────────────────────

async function showClientStats(clientId, name) {
  const modal = document.getElementById('client-stats-modal');
  const content = document.getElementById('client-stats-modal-content');
  const nameEl = document.getElementById('client-stats-modal-name');
  if (!modal || !content) return;
  if (nameEl) nameEl.textContent = name;
  content.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  modal.style.display = 'block';
  try {
    const res = await fetch(`/clients/${clientId}/stats`);
    const stats = await res.json();
    content.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
        <div style="background:#0f1923;border:1px solid #1f2937;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#e5e7eb">${stats.total_campaigns || 0}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">Total Campaigns</div>
        </div>
        <div style="background:#0f1923;border:1px solid #1f2937;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#e5e7eb">${stats.total_leads || 0}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">Total Leads</div>
        </div>
        <div style="background:#0f1923;border:1px solid #1f2937;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#e5e7eb">${stats.emails_sent || 0}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">Emails Sent</div>
        </div>
        <div style="background:#0f1923;border:1px solid #1f2937;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#10b981">${stats.open_rate || 0}%</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">Open Rate</div>
        </div>
        <div style="background:#0f1923;border:1px solid #1f2937;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#818cf8">${stats.reply_rate || 0}%</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">Reply Rate</div>
        </div>
        <div style="background:#0f1923;border:1px solid #1f2937;border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#f59e0b">${stats.replied_leads || 0}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">Replied Leads</div>
        </div>
      </div>
      <div style="font-size:12px;color:#6b7280;text-align:center">
        ${stats.last_activity ? 'Last activity: ' + new Date(stats.last_activity).toLocaleString() : 'No email activity yet'}
      </div>`;
  } catch (err) {
    content.innerHTML = '<div style="color:#ef4444;text-align:center">Failed to load stats</div>';
  }
}

function closeClientStatsModal(event) {
  if (event && event.target !== document.getElementById('client-stats-modal')) return;
  const modal = document.getElementById('client-stats-modal');
  if (modal) modal.style.display = 'none';
}
