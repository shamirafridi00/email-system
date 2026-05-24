// ─── Analytics ───────────────────────────────────────────────────────────────
var analyticsState = {
  currentDays: 14,
  chartInstances: {},
  lastData: null,
};

function fmtDate(dateStr) {
  // "2025-05-20" → "May 20"
  var d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtHour(h) {
  if (h === 0) return '12am';
  if (h < 12) return h + 'am';
  if (h === 12) return '12pm';
  return (h - 12) + 'pm';
}

function rateColor(rate, thresholds) {
  // thresholds: [goodMin, warnMin] — above goodMin = green, above warnMin = amber, else red
  if (rate >= thresholds[0]) return '#22c55e';
  if (rate >= thresholds[1]) return '#f59e0b';
  return '#ef4444';
}

function destroyChart(key) {
  if (analyticsState.chartInstances[key]) {
    analyticsState.chartInstances[key].destroy();
    analyticsState.chartInstances[key] = null;
  }
}

async function loadAnalytics() {
  var days = el('analytics-days') ? parseInt(el('analytics-days').value) : 14;
  analyticsState.currentDays = days;

  // Show spinners
  ['an-daily-wrap', 'an-comparison-wrap', 'an-step-wrap', 'an-hourly-wrap', 'an-pipeline-wrap'].forEach(function(id) {
    var e = el(id);
    if (e) e.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  });

  try {
    var data = await api('/dashboard/analytics?days=' + days);
    analyticsState.lastData = data;
    renderSummaryStats(data.summary);
    renderAllCharts(data);
    renderTopSubjects(data.top_subjects);
  } catch(e) {
    toast(e.message, 'error');
  }
}

function renderSummaryStats(s) {
  if (!s) return;
  var openColor = rateColor(s.overall_open_rate, [40, 20]);
  var replyColor = rateColor(s.overall_reply_rate, [5, 2]);
  var bounceColor = s.overall_bounce_rate <= 3 ? '#22c55e' : s.overall_bounce_rate <= 5 ? '#f59e0b' : '#ef4444';

  function statBox(label, value, color) {
    return '<div class="stat-card" style="padding:12px 18px;min-width:110px;flex:1">' +
      '<div class="label" style="font-size:11px">' + label + '</div>' +
      '<div class="value" style="font-size:22px;color:' + (color || '#e5e7eb') + '">' + value + '</div>' +
      '</div>';
  }

  el('an-summary-stats').innerHTML =
    statBox('Total Sent', s.total_emails_sent.toLocaleString()) +
    statBox('Open Rate', s.overall_open_rate + '%', openColor) +
    statBox('Reply Rate', s.overall_reply_rate + '%', replyColor) +
    statBox('Bounce Rate', s.overall_bounce_rate + '%', bounceColor) +
    statBox('Active Campaigns', s.active_campaigns) +
    statBox('Total Leads', s.total_leads.toLocaleString());
}

function renderAllCharts(data) {
  renderDailyActivityChart(data.daily_sends);
  renderCampaignComparisonChart(data.campaign_comparison);
  renderStepPerformanceChart(data.step_performance);
  renderHourlyChart(data.hourly_distribution);
  renderPipelineChart(data);
}

function renderDailyActivityChart(daily) {
  destroyChart('daily');
  var wrap = el('an-daily-wrap');
  wrap.innerHTML = '<canvas id="campaign-daily-chart"></canvas>';
  var ctx = document.getElementById('campaign-daily-chart').getContext('2d');

  analyticsState.chartInstances.daily = new Chart(ctx, {
    type: 'line',
    data: {
      labels: daily.map(function(d) { return fmtDate(d.date); }),
      datasets: [
        {
          label: 'Sent',
          data: daily.map(function(d) { return d.sent; }),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
        {
          label: 'Opened',
          data: daily.map(function(d) { return d.opened; }),
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.08)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
        {
          label: 'Replied',
          data: daily.map(function(d) { return d.replied; }),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { color: '#9ca3af', boxWidth: 12 } },
      },
      scales: {
        x: { ticks: { color: '#6b7280', maxRotation: 45 }, grid: { color: '#1f2937' } },
        y: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' }, beginAtZero: true },
      },
    },
  });
}

function renderCampaignComparisonChart(campaigns) {
  destroyChart('comparison');
  var wrap = el('an-comparison-wrap');
  wrap.innerHTML = '<canvas id="campaign-comparison-chart"></canvas>';
  var ctx = document.getElementById('campaign-comparison-chart').getContext('2d');

  var labels = campaigns.map(function(c) {
    var n = c.campaign_name || '';
    return n.length > 25 ? n.slice(0, 25) + '…' : n;
  });
  var values = campaigns.map(function(c) { return c.reply_rate; });
  var colors = values.map(function(v) {
    return v >= 5 ? '#22c55e' : v >= 2 ? '#f59e0b' : '#ef4444';
  });

  analyticsState.chartInstances.comparison = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Reply Rate %',
        data: values,
        backgroundColor: colors,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: '#6b7280', callback: function(v) { return v + '%'; } },
          grid: { color: '#1f2937' },
          beginAtZero: true,
        },
        y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
      },
    },
  });
}

function renderStepPerformanceChart(steps) {
  destroyChart('step');
  var wrap = el('an-step-wrap');
  wrap.innerHTML = '<canvas id="step-performance-chart"></canvas>';
  var ctx = document.getElementById('step-performance-chart').getContext('2d');

  analyticsState.chartInstances.step = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: steps.map(function(s) { return 'Step ' + s.step_number; }),
      datasets: [
        {
          label: 'Open Rate %',
          data: steps.map(function(s) { return s.open_rate; }),
          backgroundColor: '#3b82f6',
          borderRadius: 3,
        },
        {
          label: 'Reply Rate %',
          data: steps.map(function(s) { return s.reply_rate; }),
          backgroundColor: '#6366f1',
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { color: '#9ca3af', boxWidth: 12 } },
      },
      scales: {
        x: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
        y: {
          ticks: { color: '#6b7280', callback: function(v) { return v + '%'; } },
          grid: { color: '#1f2937' },
          beginAtZero: true,
        },
      },
    },
  });
}

function renderHourlyChart(hourly) {
  destroyChart('hourly');
  var wrap = el('an-hourly-wrap');
  wrap.innerHTML = '<canvas id="hourly-chart"></canvas>';
  var ctx = document.getElementById('hourly-chart').getContext('2d');

  analyticsState.chartInstances.hourly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: hourly.map(function(h) { return fmtHour(h.hour); }),
      datasets: [{
        label: 'Emails Sent',
        data: hourly.map(function(h) { return h.count; }),
        backgroundColor: hourly.map(function(h) {
          return (h.hour >= 9 && h.hour < 17) ? '#6366f1' : '#374151';
        }),
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', maxRotation: 45 }, grid: { color: '#1f2937' } },
        y: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' }, beginAtZero: true },
      },
    },
  });
}

function renderPipelineChart(data) {
  destroyChart('pipeline');
  var wrap = el('an-pipeline-wrap');
  wrap.innerHTML = '<canvas id="pipeline-chart"></canvas>';
  var ctx = document.getElementById('pipeline-chart').getContext('2d');

  // Use summary totals from lead stats endpoint if available; fall back to summing lead_status_over_time
  var stats = data.summary;
  var leadStats = {
    active: 0, replied: 0, finished: 0, bounced: 0, unsubscribed: 0,
  };
  // Try to read from a leads stats call already cached, otherwise accumulate from daily data
  if (data.lead_status_over_time && data.lead_status_over_time.length) {
    data.lead_status_over_time.forEach(function(d) {
      leadStats.active += d.active;
      leadStats.replied += d.replied;
      leadStats.finished += d.finished;
      leadStats.bounced += d.bounced;
      leadStats.unsubscribed += d.unsubscribed;
    });
  }

  // Also fetch current snapshot from /leads/stats if already in state
  if (state && state.leads && state.leads.length) {
    var statuses = ['active', 'replied', 'finished', 'bounced', 'unsubscribed'];
    statuses.forEach(function(s) { leadStats[s] = 0; });
    state.leads.forEach(function(l) {
      if (leadStats[l.status] !== undefined) leadStats[l.status]++;
    });
  }

  analyticsState.chartInstances.pipeline = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Active', 'Replied', 'Finished', 'Bounced', 'Unsubscribed'],
      datasets: [{
        data: [leadStats.active, leadStats.replied, leadStats.finished, leadStats.bounced, leadStats.unsubscribed],
        backgroundColor: ['#6366f1', '#22c55e', '#4b5563', '#ef4444', '#f59e0b'],
        borderWidth: 2,
        borderColor: '#111827',
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#9ca3af', boxWidth: 12, padding: 16 },
        },
      },
      cutout: '60%',
    },
  });
}

function renderTopSubjects(subjects) {
  var wrap = el('an-top-subjects');
  if (!subjects || !subjects.length) {
    wrap.innerHTML = '<div style="color:#6b7280;text-align:center;padding:20px">No data yet</div>';
    return;
  }

  wrap.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr style="border-bottom:1px solid #333">' +
    '<th style="text-align:left;padding:8px 10px;color:#6b7280;font-weight:600">Subject Line</th>' +
    '<th style="text-align:right;padding:8px 10px;color:#6b7280;font-weight:600">Sent</th>' +
    '<th style="text-align:right;padding:8px 10px;color:#6b7280;font-weight:600">Opened</th>' +
    '<th style="text-align:right;padding:8px 10px;color:#6b7280;font-weight:600">Open Rate</th>' +
    '</tr></thead><tbody>' +
    subjects.map(function(s) {
      var subj = (s.subject || '').length > 60 ? s.subject.slice(0, 60) + '…' : (s.subject || '—');
      var rate = s.open_rate || 0;
      var badgeColor = rate >= 40 ? '#22c55e' : rate >= 20 ? '#f59e0b' : '#ef4444';
      var badgeBg = rate >= 40 ? '#052e16' : rate >= 20 ? '#1c1200' : '#1c0a0a';
      return '<tr style="border-bottom:1px solid #1f2937">' +
        '<td style="padding:8px 10px;color:#e5e7eb">' + escHtml(subj) + '</td>' +
        '<td style="padding:8px 10px;text-align:right;color:#9ca3af">' + s.sent_count + '</td>' +
        '<td style="padding:8px 10px;text-align:right;color:#22c55e">' + s.open_count + '</td>' +
        '<td style="padding:8px 10px;text-align:right">' +
          '<span style="background:' + badgeBg + ';color:' + badgeColor + ';border:1px solid ' + badgeColor + ';border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700">' + rate + '%</span>' +
        '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
}

function changeDays() {
  analyticsState.currentDays = parseInt(el('analytics-days').value);
  loadAnalytics();
}

function exportAnalyticsCSV() {
  if (!analyticsState.lastData || !analyticsState.lastData.daily_sends) {
    toast('No data to export — load analytics first', 'error');
    return;
  }
  var rows = analyticsState.lastData.daily_sends;
  var csv = 'Date,Sent,Opened,Replied,Bounced\n' +
    rows.map(function(r) {
      return [r.date, r.sent, r.opened, r.replied, r.bounced].join(',');
    }).join('\n');

  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'campaign-analytics.csv';
  a.click();
  URL.revokeObjectURL(url);
}
