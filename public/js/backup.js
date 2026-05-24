// ─── Backup and Restore ───────────────────────────────────────────────────────

var backupConfirmFilename = null;
var deleteConfirmFilename = null;

function formatSize(kb) {
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
  return kb + ' KB';
}

function backupRelativeTime(ts) {
  if (!ts) return '—';
  var diff = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.round(diff / 60) + 'm ago';
  if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
  return Math.round(diff / 86400) + 'd ago';
}

function formatBackupDate(ts) {
  if (!ts) return '—';
  return ts.replace('T', ' ').slice(0, 19) + ' UTC';
}

function updateBackupStats(stats) {
  var totalEl = document.getElementById('bk-stat-total');
  var sizeEl  = document.getElementById('bk-stat-size');
  var newestEl = document.getElementById('bk-stat-newest');
  var autoEl  = document.getElementById('bk-stat-auto');

  if (totalEl) totalEl.textContent = stats.total_backups ?? 0;
  if (sizeEl) sizeEl.textContent = formatSize(stats.total_size_kb ?? 0);
  if (newestEl) newestEl.textContent = backupRelativeTime(stats.newest_backup);
  if (autoEl) {
    var enabled = stats.auto_backup_enabled;
    autoEl.innerHTML = enabled
      ? '<span style="color:#4ade80;font-weight:700">Enabled</span>'
      : '<span style="color:#f87171;font-weight:700">Disabled</span>';
  }
}

function renderBackupTable(backups) {
  var tbody = document.getElementById('backup-list-table');
  if (!tbody) return;

  if (!backups.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:#6b7280">No backups yet. Create one now.</td></tr>';
    return;
  }

  tbody.innerHTML = backups.map(function(b) {
    var actions;
    if (!b.file_exists) {
      actions = '<span style="color:#6b7280;font-size:11px">Missing from disk</span>';
    } else {
      actions =
        '<button onclick="downloadBackup(\'' + escHtml(b.filename) + '\')" style="background:none;border:1px solid #4338ca;color:#818cf8;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;margin-right:4px">⬇ Download</button>' +
        '<button onclick="showRestoreConfirm(\'' + escHtml(b.filename) + '\')" style="background:none;border:1px solid #92400e;color:#fbbf24;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;margin-right:4px">↩ Restore</button>' +
        '<button onclick="showDeleteConfirm(\'' + escHtml(b.filename) + '\')" style="background:none;border:1px solid #7f1d1d;color:#f87171;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px">🗑 Delete</button>';
    }

    var shortName = b.filename.length > 36 ? b.filename.slice(0, 33) + '…' : b.filename;

    return '<tr id="bk-row-' + escHtml(b.filename) + '" style="border-bottom:1px solid #1f2937">' +
      '<td style="padding:8px 10px;font-size:11px;font-family:monospace;color:#e5e7eb" title="' + escHtml(b.filename) + '">' + escHtml(shortName) + '</td>' +
      '<td style="padding:8px 10px;font-size:12px;color:#9ca3af">' + formatSize(b.file_size_kb) + '</td>' +
      '<td style="padding:8px 10px;font-size:11px;color:#9ca3af">' + formatBackupDate(b.created_at) + '</td>' +
      '<td style="padding:8px 10px;font-size:11px;color:#6b7280">' + escHtml(b.note || '—') + '</td>' +
      '<td style="padding:8px 10px" id="bk-actions-' + escHtml(b.filename) + '">' + actions + '</td>' +
    '</tr>';
  }).join('');
}

async function loadBackups() {
  try {
    var [stats, backups, autoSetting] = await Promise.all([
      api('/dashboard/backups/stats'),
      api('/dashboard/backups'),
      api('/dashboard/settings/auto-backup'),
    ]);
    updateBackupStats(stats);
    renderBackupTable(backups);

    var toggle = document.getElementById('bk-auto-toggle');
    if (toggle) toggle.checked = autoSetting.enabled;
    var badge = document.getElementById('bk-auto-badge');
    if (badge) {
      badge.textContent = autoSetting.enabled ? 'Enabled' : 'Disabled';
      badge.style.color = autoSetting.enabled ? '#4ade80' : '#f87171';
    }
  } catch(e) {
    toast('Failed to load backups: ' + e.message, 'error');
  }
}

async function createBackupNow() {
  var btn = document.getElementById('bk-create-btn');
  var resultEl = document.getElementById('bk-create-result');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px"></span>Creating backup…'; }
  if (resultEl) resultEl.innerHTML = '';

  try {
    var result = await api('/dashboard/backups/create', {
      method: 'POST',
      body: JSON.stringify({ note: 'Manual backup' }),
    });
    if (resultEl) {
      resultEl.innerHTML =
        '<div style="background:#052e16;border:1px solid #166534;border-radius:8px;padding:12px 14px;margin-top:10px">' +
          '<div style="font-size:13px;font-weight:700;color:#4ade80;margin-bottom:6px">✅ Backup created successfully</div>' +
          '<div style="font-size:11px;font-family:monospace;color:#9ca3af">' + escHtml(result.filename) + '</div>' +
          '<div style="font-size:11px;color:#6b7280;margin-top:4px">' + formatSize(result.file_size_kb) + ' · ' + formatBackupDate(result.created_at) + '</div>' +
        '</div>';
    }
    await loadBackups();
  } catch(e) {
    toast('Backup failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Create Backup Now'; }
  }
}

function showRestoreConfirm(filename) {
  backupConfirmFilename = filename;
  var modal = document.getElementById('bk-restore-modal');
  var nameEl = document.getElementById('bk-restore-modal-name');
  if (nameEl) nameEl.textContent = filename;
  if (modal) modal.style.display = 'flex';
}

function hideRestoreModal() {
  var modal = document.getElementById('bk-restore-modal');
  if (modal) modal.style.display = 'none';
  backupConfirmFilename = null;
}

async function confirmRestore() {
  if (!backupConfirmFilename) return;
  var filename = backupConfirmFilename;
  hideRestoreModal();

  var overlay = document.getElementById('bk-restore-overlay');
  if (overlay) overlay.style.display = 'flex';

  try {
    await api('/dashboard/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ filename: filename }),
    });
    toast('Database restored from ' + filename + '. Reloading…', 'success');
    setTimeout(function() { window.location.reload(); }, 2000);
  } catch(e) {
    if (overlay) overlay.style.display = 'none';
    toast('Restore failed: ' + e.message, 'error');
  }
}

function showDeleteConfirm(filename) {
  deleteConfirmFilename = filename;
  var actionsEl = document.getElementById('bk-actions-' + filename);
  if (!actionsEl) return;
  actionsEl.innerHTML =
    '<span style="font-size:11px;color:#f87171;margin-right:8px">Delete this backup?</span>' +
    '<button onclick="confirmDeleteBackup(\'' + escHtml(filename) + '\')" style="background:#7f1d1d;color:#fca5a5;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;margin-right:4px">Yes, Delete</button>' +
    '<button onclick="cancelDeleteBackup(\'' + escHtml(filename) + '\')" style="background:#1f2937;color:#9ca3af;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px">Cancel</button>';
}

function cancelDeleteBackup(filename) {
  loadBackups();
}

async function confirmDeleteBackup(filename) {
  try {
    await api('/dashboard/backups/' + encodeURIComponent(filename), { method: 'DELETE' });
    var row = document.getElementById('bk-row-' + filename);
    if (row) row.remove();
    toast('Backup deleted', 'success');
    await loadBackups();
  } catch(e) {
    toast('Delete failed: ' + e.message, 'error');
  }
}

function downloadBackup(filename) {
  var a = document.createElement('a');
  a.href = '/dashboard/backups/download/' + encodeURIComponent(filename);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function toggleAutoBackup() {
  var toggle = document.getElementById('bk-auto-toggle');
  var enabled = toggle ? toggle.checked : false;
  var badge = document.getElementById('bk-auto-badge');
  try {
    await api('/dashboard/settings/auto-backup', {
      method: 'POST',
      body: JSON.stringify({ enabled: enabled }),
    });
    if (badge) {
      badge.textContent = enabled ? 'Enabled' : 'Disabled';
      badge.style.color = enabled ? '#4ade80' : '#f87171';
    }
    toast('Auto backup ' + (enabled ? 'enabled' : 'disabled'), 'success');
    loadBackups();
  } catch(e) {
    if (toggle) toggle.checked = !enabled;
    toast(e.message, 'error');
  }
}
