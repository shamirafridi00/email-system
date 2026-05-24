// ─── A/B Tests ───────────────────────────────────────────────────────────────

var abtestsState = {
  tests: [],
  campaigns: [],
  refreshInterval: null,
};

var abCompletedVisible = false;

// ─── Load ────────────────────────────────────────────────────────────────────

async function loadABTests() {
  try {
    var [tests, campaigns] = await Promise.all([
      api('/abtests'),
      api('/campaigns'),
    ]);
    abtestsState.tests = tests;
    abtestsState.campaigns = campaigns;
    renderActiveTests();
    renderCompletedTests();
    populateCampaignDropdown();
    startABAutoRefresh();
  } catch (err) {
    document.getElementById('ab-active-tests').innerHTML =
      '<div style="color:#ef4444;padding:16px">Failed to load A/B tests</div>';
  }
}

// ─── Render Active Tests ─────────────────────────────────────────────────────

function renderActiveTests() {
  var active = abtestsState.tests.filter(function(t) { return t.status === 'running'; });
  var el = document.getElementById('ab-active-tests');
  if (!el) return;

  if (active.length === 0) {
    el.innerHTML = '<div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:32px;text-align:center;color:#4b5563">No active tests. Create one to start optimizing your subject lines.</div>';
    return;
  }

  el.innerHTML = active.map(function(t) { return renderTestCard(t); }).join('');
}

function renderTestCard(t) {
  var rateA = t.variant_a_sent > 0 ? (t.variant_a_opened / t.variant_a_sent * 100).toFixed(1) : '0.0';
  var rateB = t.variant_b_sent > 0 ? (t.variant_b_opened / t.variant_b_sent * 100).toFixed(1) : '0.0';
  var replyRateA = t.variant_a_sent > 0 ? (t.variant_a_replied / t.variant_a_sent * 100).toFixed(1) : '0.0';
  var replyRateB = t.variant_b_sent > 0 ? (t.variant_b_replied / t.variant_b_sent * 100).toFixed(1) : '0.0';

  var aLeading = parseFloat(rateA) > parseFloat(rateB);
  var bLeading = parseFloat(rateB) > parseFloat(rateA);

  var sampleA = Math.min(t.variant_a_sent / t.min_sample_size * 100, 100).toFixed(0);
  var sampleB = Math.min(t.variant_b_sent / t.min_sample_size * 100, 100).toFixed(0);
  var bothReached = t.variant_a_sent >= t.min_sample_size && t.variant_b_sent >= t.min_sample_size;

  var statusBadge = '';
  if (t.status === 'running') {
    statusBadge = '<span style="background:#312e81;color:#a5b4fc;font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600">Running</span>';
  } else if (t.status === 'winner_declared') {
    statusBadge = '<span style="background:#064e3b;color:#6ee7b7;font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600">Winner Declared</span>';
  } else {
    statusBadge = '<span style="background:#1f2937;color:#6b7280;font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600">Stopped</span>';
  }

  var winnerBanner = '';
  if (t.status === 'winner_declared' && t.winner) {
    var winnerLabel = t.winner === 'b' ? 'Version B' : 'Version A';
    var winnerSubject = t.winner === 'b' ? escHtml(t.variant_b_subject) : escHtml(t.variant_a_subject);
    var winnerRate = t.winner === 'b' ? rateB : rateA;
    winnerBanner = '<div style="background:#064e3b;border:1px solid #065f46;border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:10px">' +
      '<span style="font-size:18px">🏆</span>' +
      '<div><div style="font-size:13px;font-weight:700;color:#6ee7b7">Winner: ' + winnerLabel + ' — ' + winnerRate + '% open rate</div>' +
      '<div style="font-size:12px;color:#a7f3d0;margin-top:2px">' + winnerSubject + '</div></div></div>';
  }

  return '<div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:20px;margin-bottom:16px">' +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">' +
      '<div>' +
        '<div style="font-size:15px;font-weight:700;color:#e5e7eb">' + escHtml(t.name) + '</div>' +
        '<div style="font-size:12px;color:#6b7280;margin-top:3px">' + escHtml(t.campaign_name || 'Campaign #' + t.campaign_id) + ' — Step ' + t.step_number + '</div>' +
      '</div>' +
      statusBadge +
    '</div>' +

    winnerBanner +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">' +
      renderVariantRow('A', t.variant_a_subject, t.variant_a_sent, rateA, replyRateA, aLeading, t.winner === 'a') +
      renderVariantRow('B', t.variant_b_subject, t.variant_b_sent, rateB, replyRateB, bLeading, t.winner === 'b') +
    '</div>' +

    '<div style="margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-bottom:5px">' +
        '<span>Sample progress</span>' +
        '<span>' + t.variant_a_sent + ' / ' + t.min_sample_size + ' per variant' + (bothReached ? ' ✓' : '') + '</span>' +
      '</div>' +
      '<div style="background:#1f2937;border-radius:99px;height:6px;overflow:hidden">' +
        '<div style="height:100%;border-radius:99px;background:' + (bothReached ? '#10b981' : '#4f46e5') + ';width:' + sampleA + '%"></div>' +
      '</div>' +
    '</div>' +

    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (t.status === 'running'
        ? '<button class="btn" onclick="declareWinner(' + t.id + ',\'a\')" style="background:#1f2937;border-color:#374151;color:#9ca3af;font-size:12px">Declare A Winner</button>' +
          '<button class="btn" onclick="declareWinner(' + t.id + ',\'b\')" style="background:#1f2937;border-color:#374151;color:#9ca3af;font-size:12px">Declare B Winner</button>' +
          '<button class="btn" onclick="stopABTest(' + t.id + ')" style="background:#1f2937;border-color:#374151;color:#ef4444;font-size:12px">Stop Test</button>'
        : '') +
      '<button class="btn" onclick="viewTestDetails(' + t.id + ')" style="background:#1f2937;border-color:#374151;color:#6b7280;font-size:12px">View Details</button>' +
    '</div>' +
  '</div>';
}

function renderVariantRow(label, subject, sent, openRate, replyRate, leading, isWinner) {
  var bg = leading ? 'background:#052e16;border:1px solid #065f46' : 'background:#0f172a;border:1px solid #1e293b';
  var subjectColor = leading ? '#6ee7b7' : '#d1d5db';
  return '<div style="' + bg + ';border-radius:8px;padding:12px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
      '<span style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase">Version ' + label + '</span>' +
      (isWinner ? '<span style="background:#065f46;color:#6ee7b7;font-size:10px;padding:1px 6px;border-radius:99px;font-weight:700">Winner</span>' :
       leading ? '<span style="background:#1e3a5f;color:#60a5fa;font-size:10px;padding:1px 6px;border-radius:99px">Leading</span>' : '') +
    '</div>' +
    '<div style="font-size:12px;color:' + subjectColor + ';margin-bottom:8px;word-break:break-word" title="' + escHtml(subject) + '">' +
      escHtml(subject.length > 55 ? subject.slice(0, 55) + '…' : subject) +
    '</div>' +
    '<div style="display:flex;gap:14px">' +
      '<div><div style="font-size:10px;color:#6b7280">Sent</div><div style="font-size:14px;font-weight:700;color:#e5e7eb">' + sent + '</div></div>' +
      '<div><div style="font-size:10px;color:#6b7280">Open Rate</div><div style="font-size:14px;font-weight:700;color:' + (leading ? '#10b981' : '#e5e7eb') + '">' + openRate + '%</div></div>' +
      '<div><div style="font-size:10px;color:#6b7280">Reply Rate</div><div style="font-size:14px;font-weight:700;color:#e5e7eb">' + replyRate + '%</div></div>' +
    '</div>' +
  '</div>';
}

// ─── Render Completed Tests ───────────────────────────────────────────────────

function renderCompletedTests() {
  var completed = abtestsState.tests.filter(function(t) {
    return t.status === 'winner_declared' || t.status === 'stopped';
  });
  var el = document.getElementById('ab-completed-tests');
  if (!el) return;

  if (completed.length === 0) {
    el.innerHTML = '<div style="color:#4b5563;padding:16px">No completed tests yet.</div>';
    return;
  }

  var rows = completed.map(function(t) {
    var rateA = t.variant_a_sent > 0 ? (t.variant_a_opened / t.variant_a_sent * 100).toFixed(1) : '0.0';
    var rateB = t.variant_b_sent > 0 ? (t.variant_b_opened / t.variant_b_sent * 100).toFixed(1) : '0.0';
    var diff = Math.abs(parseFloat(rateA) - parseFloat(rateB)).toFixed(1);
    var winnerLabel = t.winner === 'b' ? 'Version B' : (t.winner === 'a' ? 'Version A' : '—');
    var winnerSubject = t.winner === 'b' ? t.variant_b_subject : (t.winner === 'a' ? t.variant_a_subject : '—');
    var date = t.winner_declared_at ? t.winner_declared_at.split('T')[0] : (t.created_at ? t.created_at.split('T')[0] : '—');
    return '<tr>' +
      '<td style="padding:10px 12px;color:#e5e7eb;font-size:13px">' + escHtml(t.name) + '</td>' +
      '<td style="padding:10px 12px;color:#9ca3af;font-size:12px">' + escHtml(t.campaign_name || 'Campaign #' + t.campaign_id) + '</td>' +
      '<td style="padding:10px 12px;color:#9ca3af;font-size:12px;text-align:center">Step ' + t.step_number + '</td>' +
      '<td style="padding:10px 12px;font-size:12px;text-align:center">' +
        (t.winner ? '<span style="color:#6ee7b7;font-weight:600">' + escHtml(winnerLabel) + '</span>' : '<span style="color:#6b7280">No winner</span>') +
      '</td>' +
      '<td style="padding:10px 12px;color:#d1d5db;font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(winnerSubject) + '">' + escHtml(winnerSubject.length > 40 ? winnerSubject.slice(0, 40) + '…' : winnerSubject) + '</td>' +
      '<td style="padding:10px 12px;color:#9ca3af;font-size:12px;text-align:center">' + diff + '%</td>' +
      '<td style="padding:10px 12px;color:#6b7280;font-size:12px">' + date + '</td>' +
      '<td style="padding:10px 12px">' +
        '<button onclick="deleteABTest(' + t.id + ')" style="background:none;border:none;color:#ef4444;font-size:11px;cursor:pointer;padding:3px 8px;border-radius:4px;border:1px solid #374151">Delete</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML = '<table style="width:100%;border-collapse:collapse">' +
    '<thead><tr style="border-bottom:1px solid #1f2937">' +
      '<th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;text-transform:uppercase">Test Name</th>' +
      '<th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;text-transform:uppercase">Campaign</th>' +
      '<th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;text-transform:uppercase">Step</th>' +
      '<th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;text-transform:uppercase">Winner</th>' +
      '<th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;text-transform:uppercase">Winning Subject</th>' +
      '<th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;text-transform:uppercase">Open Rate Diff</th>' +
      '<th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;text-transform:uppercase">Date</th>' +
      '<th></th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
  '</table>';
}

function toggleCompletedTests() {
  abCompletedVisible = !abCompletedVisible;
  var el = document.getElementById('ab-completed-tests');
  var chevron = document.getElementById('ab-completed-chevron');
  if (el) el.style.display = abCompletedVisible ? 'block' : 'none';
  if (chevron) chevron.textContent = abCompletedVisible ? '▲' : '▼';
}

// ─── Create Test Form ────────────────────────────────────────────────────────

function showCreateTestForm() {
  document.getElementById('ab-create-form').style.display = 'block';
  populateCampaignDropdown();
}

function hideCreateTestForm() {
  document.getElementById('ab-create-form').style.display = 'none';
  document.getElementById('ab-name').value = '';
  document.getElementById('ab-subject-a').value = '';
  document.getElementById('ab-subject-b').value = '';
  document.getElementById('ab-sample-size').value = '50';
  document.getElementById('ab-auto-declare').checked = true;
  document.getElementById('ab-campaign').value = '';
  document.getElementById('ab-step').innerHTML = '<option value="">— select campaign first —</option>';
}

function populateCampaignDropdown() {
  var sel = document.getElementById('ab-campaign');
  if (!sel) return;
  var current = sel.value;
  var campaigns = abtestsState.campaigns.filter(function(c) { return c.status === 'active' || c.status === 'draft'; });
  sel.innerHTML = '<option value="">— select campaign —</option>' +
    campaigns.map(function(c) {
      return '<option value="' + c.id + '"' + (String(c.id) === current ? ' selected' : '') + '>' + escHtml(c.name) + '</option>';
    }).join('');
}

async function abPopulateSteps() {
  var campaignId = document.getElementById('ab-campaign').value;
  var stepSel = document.getElementById('ab-step');
  if (!campaignId) {
    stepSel.innerHTML = '<option value="">— select campaign first —</option>';
    return;
  }
  try {
    var steps = await api('/campaigns/' + campaignId + '/steps');
    if (!steps || steps.length === 0) {
      stepSel.innerHTML = '<option value="">No steps found</option>';
      return;
    }
    stepSel.innerHTML = steps.map(function(s) {
      return '<option value="' + s.step_number + '">Step ' + s.step_number + (s.subject ? ' — ' + escHtml(s.subject.slice(0, 40)) : '') + '</option>';
    }).join('');
  } catch {
    stepSel.innerHTML = '<option value="">Failed to load steps</option>';
  }
}

async function saveABTest() {
  var name = document.getElementById('ab-name').value.trim();
  var campaignId = parseInt(document.getElementById('ab-campaign').value, 10);
  var stepNumber = parseInt(document.getElementById('ab-step').value, 10);
  var subjectA = document.getElementById('ab-subject-a').value.trim();
  var subjectB = document.getElementById('ab-subject-b').value.trim();
  var sampleSize = parseInt(document.getElementById('ab-sample-size').value, 10) || 50;
  var autoDeclare = document.getElementById('ab-auto-declare').checked;

  if (!name) { toast('Test name is required', 'error'); return; }
  if (!campaignId) { toast('Please select a campaign', 'error'); return; }
  if (!stepNumber) { toast('Please select a sequence step', 'error'); return; }
  if (!subjectA) { toast('Version A subject is required', 'error'); return; }
  if (!subjectB) { toast('Version B subject is required', 'error'); return; }
  if (subjectA === subjectB) { toast('Version A and B subjects must be different', 'error'); return; }

  try {
    await api('/abtests', {
      method: 'POST',
      body: JSON.stringify({
        name: name,
        campaign_id: campaignId,
        step_number: stepNumber,
        variant_a_subject: subjectA,
        variant_b_subject: subjectB,
        min_sample_size: sampleSize,
        auto_declare: autoDeclare,
      }),
    });
    toast('A/B test created successfully', 'success');
    hideCreateTestForm();
    loadABTests();
  } catch (err) {
    toast(err.message || 'Failed to create test', 'error');
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function declareWinner(testId, variant) {
  var label = variant === 'b' ? 'Version B' : 'Version A';
  if (!confirm('Declare ' + label + ' as winner? This will update the sequence step subject line for all future sends.')) return;
  try {
    var res = await api('/abtests/' + testId + '/declare-winner', {
      method: 'POST',
      body: JSON.stringify({ winner: variant }),
    });
    toast('Winner declared! Winning subject: ' + (res.winning_subject || label), 'success');
    loadABTests();
  } catch (err) {
    toast(err.message || 'Failed to declare winner', 'error');
  }
}

async function stopABTest(testId) {
  if (!confirm('Stop this test? No winner will be applied.')) return;
  try {
    await api('/abtests/' + testId + '/stop', { method: 'POST' });
    toast('Test stopped', 'success');
    loadABTests();
  } catch (err) {
    toast(err.message || 'Failed to stop test', 'error');
  }
}

async function deleteABTest(testId) {
  if (!confirm('Delete this test? This cannot be undone.')) return;
  try {
    await api('/abtests/' + testId, { method: 'DELETE' });
    toast('Test deleted', 'success');
    loadABTests();
  } catch (err) {
    toast(err.message || 'Failed to delete test', 'error');
  }
}

// ─── Details Modal ────────────────────────────────────────────────────────────

async function viewTestDetails(testId) {
  var modal = document.getElementById('ab-details-modal');
  var body = document.getElementById('ab-modal-body');
  var title = document.getElementById('ab-modal-title');
  body.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  modal.style.display = 'flex';

  try {
    var t = await api('/abtests/' + testId);
    title.textContent = t.name;

    var rateA = (t.variant_a.open_rate * 100).toFixed(1);
    var rateB = (t.variant_b.open_rate * 100).toFixed(1);
    var replyA = (t.variant_a.reply_rate * 100).toFixed(1);
    var replyB = (t.variant_b.reply_rate * 100).toFixed(1);
    var diff = Math.abs(parseFloat(rateA) - parseFloat(rateB)).toFixed(1);

    body.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">' +
        detailVariantCard('A', t.variant_a_subject, t.variant_a, rateA, replyA, t.winner === 'a') +
        detailVariantCard('B', t.variant_b_subject, t.variant_b, rateB, replyB, t.winner === 'b') +
      '</div>' +

      '<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:14px;margin-bottom:14px">' +
        '<div style="font-size:12px;font-weight:600;color:#9ca3af;margin-bottom:6px">Test Parameters</div>' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
          '<div><span style="color:#6b7280;font-size:12px">Min Sample Size: </span><span style="color:#d1d5db;font-size:12px">' + t.min_sample_size + ' per variant</span></div>' +
          '<div><span style="color:#6b7280;font-size:12px">Confidence Threshold: </span><span style="color:#d1d5db;font-size:12px">' + (t.confidence_threshold * 100).toFixed(0) + '%</span></div>' +
          '<div><span style="color:#6b7280;font-size:12px">Open Rate Difference: </span><span style="color:#d1d5db;font-size:12px">' + diff + '%</span></div>' +
          '<div><span style="color:#6b7280;font-size:12px">Auto Declare: </span><span style="color:#d1d5db;font-size:12px">' + (t.auto_declare ? 'Yes' : 'No') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div style="background:#1a1f35;border:1px solid #312e81;border-radius:8px;padding:14px">' +
        '<div style="font-size:12px;font-weight:600;color:#a5b4fc;margin-bottom:5px">Recommendation</div>' +
        '<div style="font-size:13px;color:#c7d2fe">' + escHtml(t.recommendation) + '</div>' +
      '</div>';
  } catch {
    body.innerHTML = '<div style="color:#ef4444">Failed to load test details</div>';
  }
}

function detailVariantCard(label, subject, stats, openRate, replyRate, isWinner) {
  var bg = isWinner ? 'background:#052e16;border:1px solid #065f46' : 'background:#0f172a;border:1px solid #1e293b';
  return '<div style="' + bg + ';border-radius:8px;padding:14px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<span style="font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase">Version ' + label + '</span>' +
      (isWinner ? '<span style="background:#065f46;color:#6ee7b7;font-size:10px;padding:2px 8px;border-radius:99px;font-weight:700">Winner</span>' : '') +
    '</div>' +
    '<div style="font-size:13px;color:#d1d5db;margin-bottom:12px;word-break:break-word">' + escHtml(subject) + '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
      '<div style="text-align:center"><div style="font-size:10px;color:#6b7280;margin-bottom:2px">Sent</div><div style="font-size:18px;font-weight:700;color:#e5e7eb">' + stats.sent + '</div></div>' +
      '<div style="text-align:center"><div style="font-size:10px;color:#6b7280;margin-bottom:2px">Open Rate</div><div style="font-size:18px;font-weight:700;color:' + (isWinner ? '#10b981' : '#e5e7eb') + '">' + openRate + '%</div></div>' +
      '<div style="text-align:center"><div style="font-size:10px;color:#6b7280;margin-bottom:2px">Reply Rate</div><div style="font-size:18px;font-weight:700;color:#e5e7eb">' + replyRate + '%</div></div>' +
    '</div>' +
  '</div>';
}

function closeABDetailsModal(e) {
  if (e && e.target !== document.getElementById('ab-details-modal')) return;
  document.getElementById('ab-details-modal').style.display = 'none';
}

// ─── Auto Refresh ─────────────────────────────────────────────────────────────

function startABAutoRefresh() {
  stopABAutoRefresh();
  var hasRunning = abtestsState.tests.some(function(t) { return t.status === 'running'; });
  if (!hasRunning) return;
  abtestsState.refreshInterval = setInterval(async function() {
    if (state.section !== 'abtests') { stopABAutoRefresh(); return; }
    try {
      var tests = await api('/abtests');
      abtestsState.tests = tests;
      renderActiveTests();
      renderCompletedTests();
    } catch {}
  }, 2 * 60 * 1000);
}

function stopABAutoRefresh() {
  if (abtestsState.refreshInterval) {
    clearInterval(abtestsState.refreshInterval);
    abtestsState.refreshInterval = null;
  }
}
