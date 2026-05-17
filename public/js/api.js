// ─── Shared state ────────────────────────────────────────────────────────────
const state = {
  section: 'campaign-dashboard',
  leads: [],
  campaigns: [],
  accounts: [],
  expandedCampaign: null,
};

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('hs_token');
  if (token) headers['X-HubSpot-Token'] = token;
  const r = await fetch(path, { headers, credentials: 'include', ...opts });
  if (r.status === 401) { window.location.href = '/login'; return; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = 'toast ' + type;
  div.textContent = msg;
  document.getElementById('toast-container').appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
  return '<span class="badge badge-' + (status ? status.toLowerCase() : 'finished') + '">' + (status || '—') + '</span>';
}

function el(id) { return document.getElementById(id); }

// ─── Sorting ─────────────────────────────────────────────────────────────────
let sortState = {};

function sortTable(arr, key, tableId) {
  const s = sortState[tableId] || { key: null, dir: 1 };
  const dir = s.key === key ? -s.dir : 1;
  sortState[tableId] = { key, dir };
  return [...arr].sort((a, b) => {
    const av = a[key] ?? '', bv = b[key] ?? '';
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

function sortIcon(tableId, key) {
  const s = sortState[tableId];
  if (!s || s.key !== key) return '<span class="sort-icon">↕</span>';
  return '<span class="sort-icon">' + (s.dir === 1 ? '↑' : '↓') + '</span>';
}
