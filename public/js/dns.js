// ─── DNS Record Checker ───────────────────────────────────────────────────────
var dnsCheckerState = { currentDomain: null, lastResult: null };

async function runDNSCheck() {
  var raw = el('dns-domain-input').value.trim();
  // Strip protocol/path if user pastes a URL
  var domain = raw.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  if (!domain) { toast('Enter a domain to check', 'error'); return; }

  el('dns-domain-input').value = domain;
  var btn = el('dns-check-btn');
  btn.disabled = true;
  el('dns-check-spinner').innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px"></span>';
  el('dns-results').style.display = 'none';

  try {
    var result = await api('/dashboard/dns-check', {
      method: 'POST',
      body: JSON.stringify({ domain: domain }),
    });
    dnsCheckerState.currentDomain = domain;
    dnsCheckerState.lastResult = result;
    renderDNSResults(result);
    loadDNSHistory();
  } catch(e) {
    toast(e.message || 'DNS check failed', 'error');
  } finally {
    btn.disabled = false;
    el('dns-check-spinner').innerHTML = '';
  }
}

function checkDomainQuick(domain) {
  el('dns-domain-input').value = domain;
  runDNSCheck();
}

function checkDomainFromHistory(domain) {
  el('dns-domain-input').value = domain;
  runDNSCheck();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 90) return '#22c55e';
  if (score >= 70) return '#4ade80';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function statusBadgeDNS(status) {
  var colors = { Excellent: '#22c55e', Good: '#4ade80', Fair: '#f59e0b', Poor: '#ef4444' };
  var bg = { Excellent: '#052e16', Good: '#052e16', Fair: '#1c1200', Poor: '#1c0a0a' };
  var c = colors[status] || '#6b7280';
  var b = bg[status] || '#111';
  return '<span style="background:' + b + ';color:' + c + ';border:1px solid ' + c + ';border-radius:12px;padding:2px 10px;font-size:12px;font-weight:700">' + status + '</span>';
}

function renderDNSResults(result) {
  var sc = result.overall_score;
  var col = scoreColor(sc);

  // Score banner
  el('dns-score-banner').innerHTML =
    '<div class="card" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">' +
    '<div style="text-align:center">' +
      '<svg width="90" height="90" viewBox="0 0 90 90">' +
        '<circle cx="45" cy="45" r="38" fill="none" stroke="#1f2937" stroke-width="9"/>' +
        '<circle cx="45" cy="45" r="38" fill="none" stroke="' + col + '" stroke-width="9"' +
          ' stroke-dasharray="' + Math.round(2 * Math.PI * 38) + '"' +
          ' stroke-dashoffset="' + Math.round(2 * Math.PI * 38 * (1 - sc / 100)) + '"' +
          ' stroke-linecap="round" transform="rotate(-90 45 45)"/>' +
        '<text x="45" y="50" text-anchor="middle" fill="' + col + '" font-size="22" font-weight="700">' + sc + '</text>' +
      '</svg>' +
      '<div style="font-size:11px;color:#6b7280;margin-top:2px">/ 100</div>' +
    '</div>' +
    '<div>' +
      '<div style="font-size:20px;font-weight:700;color:#e5e7eb;margin-bottom:6px">' + escHtml(result.domain) + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        statusBadgeDNS(result.overall_status) +
        '<span style="font-size:12px;color:#6b7280">Checked ' + (result.checked_at ? result.checked_at.slice(0,16).replace('T',' ') : '') + ' UTC</span>' +
      '</div>' +
    '</div>' +
    '</div>';

  // Four record cards
  el('dns-record-cards').innerHTML =
    renderRecordCard('SPF', result.spf) +
    renderRecordCard('DKIM', result.dkim) +
    renderRecordCard('DMARC', result.dmarc) +
    renderRecordCard('MX', result.mx);

  // Recommendations
  var recs = result.recommendations || [];
  if (recs.length > 0) {
    el('dns-recommendations').innerHTML =
      '<div class="card" style="border:1px solid #78350f">' +
      '<div style="font-weight:700;font-size:13px;color:#f59e0b;margin-bottom:10px">⚠ Recommendations</div>' +
      '<ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px">' +
      recs.map(function(r) { return '<li style="font-size:13px;color:#d1d5db">' + escHtml(r) + '</li>'; }).join('') +
      '</ol></div>';
  } else {
    el('dns-recommendations').innerHTML =
      '<div class="card" style="border:1px solid #166534;background:#052e16">' +
      '<div style="color:#22c55e;font-weight:700">✓ No issues found — your domain is properly configured!</div>' +
      '</div>';
  }

  el('dns-results').style.display = '';
}

function renderRecordCard(type, result) {
  var found = result.found;
  var valid = result.valid;
  var foundIcon = found ? '<span style="color:#22c55e;font-size:16px">✓</span>' : '<span style="color:#ef4444;font-size:16px">✕</span>';
  var points = type === 'SPF' ? 30 : type === 'DKIM' ? 35 : type === 'DMARC' ? 25 : 10;

  var inner = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<span style="font-weight:700;font-size:15px;color:#e5e7eb">' + type + '</span>' +
      '<span style="font-size:11px;color:#4b5563;background:#111;border:1px solid #222;border-radius:10px;padding:1px 7px">' + points + ' pts</span>' +
    '</div>' + foundIcon +
  '</div>';

  if (result.error) {
    inner += '<div style="font-size:12px;color:#ef4444">' + escHtml(result.error) + '</div>';
  }

  if (found && result.record) {
    inner += '<pre style="background:#0d1117;border:1px solid #1f2937;border-radius:6px;padding:8px 10px;font-size:11px;color:#86efac;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:8px 0 0 0">' + escHtml(result.record) + '</pre>';
  }

  // Type-specific extras
  if (type === 'SPF' && found) {
    if (result.record) {
      var allMatch = result.record.match(/([-~+?]all)/);
      if (allMatch) {
        var allMech = allMatch[1];
        var allColor = allMech === '-all' || allMech === '~all' ? '#22c55e' : '#f59e0b';
        inner += '<div style="margin-top:8px;font-size:12px;color:#9ca3af">Policy: <code style="color:' + allColor + '">' + escHtml(allMech) + '</code></div>';
      }
    }
  }

  if (type === 'DKIM') {
    if (found && result.selector) {
      inner += '<div style="margin-top:8px;font-size:12px;color:#9ca3af">Selector: <code style="color:#a78bfa">' + escHtml(result.selector) + '</code></div>';
    } else if (!found && result.selectors_tried) {
      inner += '<div style="margin-top:8px;font-size:12px;color:#6b7280">Tried: <span style="color:#4b5563">' + result.selectors_tried.map(function(s) { return escHtml(s); }).join(', ') + '</span></div>';
    }
  }

  if (type === 'DMARC' && found && result.policy) {
    var pColor = result.policy === 'none' ? '#f59e0b' : '#22c55e';
    var pBg = result.policy === 'none' ? '#1c1200' : '#052e16';
    inner += '<div style="margin-top:8px">' +
      '<span style="font-size:11px;color:#6b7280">Policy: </span>' +
      '<span style="background:' + pBg + ';color:' + pColor + ';border:1px solid ' + pColor + ';border-radius:10px;padding:1px 9px;font-size:12px;font-weight:700">' + escHtml(result.policy) + '</span>' +
    '</div>';
  }

  if (type === 'MX' && found && result.records && result.records.length) {
    inner += '<div style="margin-top:8px;display:flex;flex-direction:column;gap:3px">' +
      result.records.map(function(mx) {
        return '<div style="font-size:12px;color:#9ca3af"><span style="color:#6b7280;min-width:30px;display:inline-block">' + mx.priority + '</span> ' + escHtml(mx.exchange) + '</div>';
      }).join('') +
    '</div>';
  }

  if (result.recommendations && result.recommendations.length) {
    inner += '<ul style="margin:8px 0 0 0;padding-left:16px;display:flex;flex-direction:column;gap:4px">' +
      result.recommendations.map(function(r) {
        return '<li style="font-size:11px;color:#f59e0b">' + escHtml(r) + '</li>';
      }).join('') +
    '</ul>';
  }

  var borderColor = !found ? '#7f1d1d' : (valid ? '#166534' : '#78350f');
  return '<div class="card" style="border:1px solid ' + borderColor + '">' + inner + '</div>';
}

// ─── History ─────────────────────────────────────────────────────────────────

async function loadDNSHistory() {
  try {
    var rows = await api('/dashboard/dns-check/history');
    var tableEl = el('dns-history-table');
    if (!rows.length) {
      tableEl.innerHTML = '<div class="no-data">No checks yet</div>';
      return;
    }
    var shown = rows.slice(0, 10);
    tableEl.innerHTML = '<table><thead><tr>' +
      '<th>Domain</th><th>Score</th><th>Status</th><th>SPF</th><th>DKIM</th><th>DMARC</th><th>Checked</th>' +
      '</tr></thead><tbody>' +
      shown.map(function(r) {
        return '<tr style="cursor:pointer" onclick="checkDomainFromHistory(\'' + escHtml(r.domain) + '\')">' +
          '<td style="color:#a78bfa">' + escHtml(r.domain) + '</td>' +
          '<td><span style="color:' + scoreColor(r.overall_score) + ';font-weight:700">' + r.overall_score + '</span></td>' +
          '<td>' + statusBadgeDNS(r.overall_status) + '</td>' +
          '<td style="text-align:center">' + (r.spf_found ? '<span style="color:#22c55e">✓</span>' : '<span style="color:#ef4444">✕</span>') + '</td>' +
          '<td style="text-align:center">' + (r.dkim_found ? '<span style="color:#22c55e">✓</span>' : '<span style="color:#ef4444">✕</span>') + '</td>' +
          '<td style="text-align:center">' + (r.dmarc_found ? '<span style="color:#22c55e">✓</span>' : '<span style="color:#ef4444">✕</span>') + '</td>' +
          '<td style="font-size:11px;color:#6b7280">' + (r.checked_at ? r.checked_at.slice(0,16).replace('T',' ') : '—') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  } catch(e) {
    el('dns-history-table').innerHTML = '<div class="no-data" style="color:#ef4444">' + escHtml(e.message) + '</div>';
  }
}

async function loadSendingAccountDomains() {
  try {
    var accounts = await api('/accounts');
    var domains = [];
    accounts.forEach(function(a) {
      var d = a.email && a.email.split('@')[1];
      if (d && !domains.includes(d)) domains.push(d);
    });
    if (!domains.length) return;
    var btns = el('dns-quick-btns');
    // Append account domains (gmail/outlook already there as defaults)
    domains.forEach(function(d) {
      if (d === 'gmail.com' || d === 'outlook.com') return;
      var btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = d;
      btn.onclick = function() { checkDomainQuick(d); };
      btns.appendChild(btn);
    });
  } catch(e) { /* non-critical */ }
}
