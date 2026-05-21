// ─── Warmup Dashboard ────────────────────────────────────────────────────────
async function loadWarmupDashboard() {
  el('wd-stat-grid').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    const ws = await api('/dashboard/warmup-stats');
    const wlog = await api('/warmup/log');

    el('wd-status-badge').innerHTML = ws.warmup_running
      ? '<span class="badge badge-replied" style="font-size:12px;padding:4px 10px">● Running</span>'
      : '<span class="badge badge-bounced" style="font-size:12px;padding:4px 10px">■ Paused</span>';

    const sinceHtml = ws.start_date
      ? '<div style="font-size:11px;font-weight:400;color:#666;margin-top:2px">since ' + ws.start_date + '</div>'
      : '';

    el('wd-stat-grid').innerHTML =
      '<div class="stat-card"><div class="label">Sent Today</div><div class="value green">' + ws.sent_today + '</div></div>' +
      '<div class="stat-card"><div class="label">Sent All Time</div><div class="value">' + ws.sent_total + '</div></div>' +
      '<div class="stat-card"><div class="label">Warmup Accounts</div><div class="value indigo">' + ws.account_count + '</div></div>' +
      '<div class="stat-card"><div class="label">Days Running</div><div class="value">' + ws.days_running + sinceHtml + '</div></div>';

    const days7 = ws.last_7_days;
    if (days7.length) {
      const max = Math.max.apply(null, days7.map(function(d) { return d.count; }).concat([1]));
      el('wd-7day-table').innerHTML = '<table><thead><tr><th>Date</th><th>Emails Sent</th><th></th></tr></thead><tbody>' +
        days7.map(function(d) {
          const barW = Math.max(20, Math.round((d.count / max) * 140));
          return '<tr>' +
            '<td style="color:#888;font-size:12px">' + d.day + '</td>' +
            '<td><strong>' + d.count + '</strong></td>' +
            '<td style="width:140px"><div class="progress" style="width:' + barW + 'px"><div class="progress-fill" style="width:100%;background:#22c55e"></div></div></td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    } else {
      el('wd-7day-table').innerHTML = '<div class="no-data">No warmup emails in last 7 days</div>';
    }

    const recent = wlog.slice(0, 10);
    el('wd-recent-log').innerHTML = recent.length
      ? '<table><thead><tr><th>From</th><th>To</th><th>Replied</th><th>Time</th></tr></thead><tbody>' +
        recent.map(function(r) {
          return '<tr>' +
            '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.from_email + '</td>' +
            '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.to_email + '</td>' +
            '<td>' + (r.replied ? '<span class="badge badge-replied">Yes</span>' : '—') + '</td>' +
            '<td style="white-space:nowrap">' + formatTime(r.sent_at) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>'
      : '<div class="no-data">No warmup emails yet</div>';

    // Business hours status card
    var inWindow = isUSBusinessHoursNow();
    var bhCard = '<div class="card" style="margin-top:4px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">' +
      '<div style="display:flex;align-items:center;gap:14px">' +
        '<div>' +
          '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">US Eastern Time</div>' +
          '<div style="font-size:15px;font-weight:700;color:#e5e7eb">' + formatUSEastern() + '</div>' +
        '</div>' +
        '<div style="width:1px;height:32px;background:#1f2937"></div>' +
        '<div>' +
          '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Sending Window</div>' +
          (inWindow
            ? '<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#4ade80"><span style="width:7px;height:7px;border-radius:50%;background:#4ade80;animation:pulse 1.5s infinite"></span>Active Window</span>'
            : '<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#6b7280"><span style="width:7px;height:7px;border-radius:50%;background:#6b7280"></span>Outside Window</span>') +
        '</div>' +
      '</div>' +
      '<div style="font-size:11px;color:#6b7280">Mon–Fri · 8am–6pm ET · randomized sends</div>' +
    '</div>';
    var bhContainer = document.getElementById('wd-biz-hours');
    if (bhContainer) bhContainer.innerHTML = bhCard;

    el('wd-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString();
    loadDashboardScheduleStatus();
    loadReplyQueueDashboardCard();
  } catch(e) {
    el('wd-stat-grid').innerHTML = '<div class="loading" style="color:#ef4444">' + e.message + '</div>';
  }
}

// ─── Campaign Dashboard ───────────────────────────────────────────────────────
async function loadCampaignDashboard() {
  el('cd-stat-grid').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  el('cd-sent-log').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    const stats = await api('/dashboard/stats');
    const leadStats = await api('/leads/stats');
    const activity = await api('/dashboard/activity');

    const totalLeads = Object.values(leadStats).reduce(function(a, b) { return a + b; }, 0);
    const repliedLeads = leadStats.replied || 0;
    const replyRate = totalLeads > 0 ? ((repliedLeads / totalLeads) * 100).toFixed(1) : '0.0';

    el('cd-stat-grid').innerHTML =
      '<div class="stat-card"><div class="label">Active Campaigns</div><div class="value indigo">' + (stats.active_campaigns || 0) + '</div></div>' +
      '<div class="stat-card"><div class="label">Total Leads</div><div class="value">' + totalLeads + '</div></div>' +
      '<div class="stat-card"><div class="label">Emails Sent Today</div><div class="value">' + (stats.emails_sent_today || 0) + '</div></div>' +
      '<div class="stat-card"><div class="label">Reply Rate</div><div class="value green">' + replyRate + '%</div></div>' +
      '<div class="stat-card"><div class="label">Unpushed Replies</div><div class="value ' + (stats.unpushed_replies > 0 ? 'indigo' : '') + '">' + (stats.unpushed_replies || 0) + '</div></div>' +
      '<div class="stat-card"><div class="label">HubSpot</div><div class="value ' + (stats.hubspot_connected ? 'green' : 'red') + '">' + (stats.hubspot_connected ? 'Connected' : 'Disconnected') + '</div></div>';

    const statuses = ['active', 'replied', 'finished', 'bounced', 'unsubscribed'];
    const badgeColors = { active: 'badge-active', replied: 'badge-replied', finished: 'badge-finished', bounced: 'badge-bounced', unsubscribed: 'badge-unsubscribed' };
    el('cd-lead-badges').innerHTML = statuses.map(function(s) {
      return '<div style="display:flex;align-items:center;gap:6px;background:#1e1e1e;border:1px solid #333;border-radius:6px;padding:8px 14px">' +
        '<span class="badge ' + badgeColors[s] + '">' + s + '</span>' +
        '<span style="font-size:20px;font-weight:700;color:#e0e0e0">' + (leadStats[s] || 0) + '</span>' +
        '</div>';
    }).join('');

    const sentRows = activity.filter(function(r) { return r.type === 'sent'; }).slice(0, 10);
    el('cd-sent-log').innerHTML = sentRows.length
      ? '<table><thead><tr><th>Time</th><th>Name</th><th>Company</th><th>Subject</th><th>Status</th></tr></thead><tbody>' +
        sentRows.map(function(r) {
          return '<tr>' +
            '<td style="white-space:nowrap">' + formatTime(r.timestamp) + '</td>' +
            '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.first_name || '—') + '</td>' +
            '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.company || '—') + '</td>' +
            '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.subject || '—') + '</td>' +
            '<td>' + (r.bounced ? statusBadge('bounced') : statusBadge('sent')) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>'
      : '<div class="no-data">No emails sent yet</div>';

    el('cd-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch(e) {
    el('cd-stat-grid').innerHTML = '<div class="loading" style="color:#ef4444">' + e.message + '</div>';
  }
}

// ─── Run All Now ─────────────────────────────────────────────────────────────
let runCooldownInterval = null;

function startRunCooldown(fromTimestamp) {
  const COOLDOWN = 5 * 60 * 1000;
  const btn = el('run-now-btn');
  const label = el('run-last-time');
  label.textContent = 'Last run: ' + formatTime(new Date(fromTimestamp).toISOString());
  if (runCooldownInterval) clearInterval(runCooldownInterval);

  function tick() {
    const elapsed = Date.now() - fromTimestamp;
    const remaining = COOLDOWN - elapsed;
    if (remaining <= 0) {
      clearInterval(runCooldownInterval);
      runCooldownInterval = null;
      btn.disabled = false;
      btn.innerHTML = '<span id="run-spinner"></span> Run Campaign Now';
      return;
    }
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    btn.disabled = true;
    btn.innerHTML = '<span id="run-spinner"></span> Wait ' + m + ':' + String(s).padStart(2, '0');
  }

  tick();
  runCooldownInterval = setInterval(tick, 1000);
}

async function runAllNow() {
  const btn = el('run-now-btn');
  if (btn.disabled) return;
  el('run-spinner').innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  try {
    const r = await api('/dashboard/run-now', { method: 'POST' });
    toast('Done — sent: ' + (r.sequences && r.sequences.sent || 0) + ', replies pushed: ' + (r.repliesPushed || 0), 'success');
    startRunCooldown(r.last_run_at || Date.now());
    if (state.section === 'campaign-dashboard') loadCampaignDashboard();
  } catch(e) {
    toast(e.message, 'error');
    btn.disabled = false;
    el('run-spinner').innerHTML = '';
  }
}

// Check cooldown on page load
(async function checkRunCooldown() {
  try {
    const probe = await fetch('/dashboard/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    });
    if (probe.status === 429) {
      const data = await probe.json().catch(function() { return {}; });
      const match = (data.error || '').match(/(\d+)/);
      const minutesLeft = match ? parseInt(match[1]) : 5;
      const fakeFrom = Date.now() - (5 - minutesLeft) * 60000;
      startRunCooldown(fakeFrom);
    } else if (probe.ok) {
      const data = await probe.json().catch(function() { return {}; });
      if (data.last_run_at) startRunCooldown(data.last_run_at);
    }
  } catch(e) { /* non-critical */ }
})();

setInterval(function() {
  if (state.section === 'campaign-dashboard') loadCampaignDashboard();
  else if (state.section === 'warmup-dashboard') loadWarmupDashboard();
}, 30000);
