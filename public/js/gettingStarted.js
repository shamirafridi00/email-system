// ─── Getting Started ──────────────────────────────────────────────────────────

async function loadGettingStarted() {
  // Show client name in welcome card
  var nameEl = document.getElementById('gs-client-name');
  if (nameEl && clientsState && clientsState.currentClient) {
    nameEl.textContent = clientsState.currentClient.name;
  } else if (nameEl) {
    try {
      var client = await api('/clients/current');
      nameEl.textContent = client.name || 'Default Client';
    } catch {
      nameEl.textContent = 'Default Client';
    }
  }

  // Load checklist data in parallel
  try {
    var [accounts, warmupAccounts, campaigns, leads] = await Promise.all([
      api('/accounts').catch(function() { return []; }),
      api('/warmup/accounts').catch(function() { return []; }),
      api('/campaigns').catch(function() { return []; }),
      api('/leads').catch(function() { return []; }),
    ]);

    var warmupCount = Array.isArray(warmupAccounts) ? warmupAccounts.length : 0;
    var sendingCount = Array.isArray(accounts) ? accounts.length : 0;
    var campaignCount = Array.isArray(campaigns) ? campaigns.length : 0;
    var activeCampaigns = Array.isArray(campaigns) ? campaigns.filter(function(c) { return c.status === 'active'; }).length : 0;
    var leadCount = Array.isArray(leads) ? leads.length : 0;

    var items = [
      {
        done: warmupCount > 0,
        title: 'Add a warmup account',
        desc: warmupCount > 0 ? warmupCount + ' account' + (warmupCount !== 1 ? 's' : '') + ' connected' : 'Connect Gmail accounts to warm up their sender reputation',
        action: 'warmup-accounts',
        icon: 'users',
        color: '#22c55e',
      },
      {
        done: sendingCount > 0,
        title: 'Add a sending account',
        desc: sendingCount > 0 ? sendingCount + ' sending account' + (sendingCount !== 1 ? 's' : '') + ' configured' : 'Add the Gmail accounts that will send your campaigns',
        action: 'sending-accounts',
        icon: 'send',
        color: '#6366f1',
      },
      {
        done: campaignCount > 0,
        title: 'Create your first campaign',
        desc: campaignCount > 0 ? campaignCount + ' campaign' + (campaignCount !== 1 ? 's' : '') + ' created' : 'Set up a multi-step email outreach campaign',
        action: 'campaigns',
        icon: 'megaphone',
        color: '#6366f1',
      },
      {
        done: leadCount > 0,
        title: 'Import leads',
        desc: leadCount > 0 ? leadCount + ' lead' + (leadCount !== 1 ? 's' : '') + ' in your pipeline' : 'Upload a CSV of prospects to your campaign',
        action: 'leads',
        icon: 'user-check',
        color: '#6366f1',
      },
      {
        done: activeCampaigns > 0,
        title: 'Launch a campaign',
        desc: activeCampaigns > 0 ? activeCampaigns + ' active campaign' + (activeCampaigns !== 1 ? 's' : '') + ' running' : 'Activate a campaign to start sending emails',
        action: 'campaigns',
        icon: 'zap',
        color: '#f59e0b',
      },
    ];

    var completedCount = items.filter(function(i) { return i.done; }).length;
    var progress = Math.round(completedCount / items.length * 100);

    var html = '<div style="padding:16px 20px;border-bottom:1px solid #222">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<span style="font-size:13px;font-weight:600;color:#f0f0f0">' + completedCount + ' of ' + items.length + ' steps complete</span>' +
        '<span style="font-size:12px;color:#666">' + progress + '%</span>' +
      '</div>' +
      '<div style="background:#2a2a2a;border-radius:99px;height:5px;overflow:hidden">' +
        '<div style="height:100%;border-radius:99px;background:' + (progress === 100 ? '#22c55e' : '#6366f1') + ';width:' + progress + '%;transition:width 0.5s"></div>' +
      '</div>' +
    '</div>';

    items.forEach(function(item, idx) {
      var isLast = idx === items.length - 1;
      html += '<div onclick="navigate(\'' + item.action + '\')" style="display:flex;align-items:center;gap:14px;padding:14px 20px;cursor:pointer;transition:background 0.15s;' + (isLast ? '' : 'border-bottom:1px solid #1e1e1e') + '" onmouseover="this.style.background=\'#1e1e1e\'" onmouseout="this.style.background=\'\'">' +
        '<div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;' + (item.done ? 'background:#052e16;border:1px solid #22c55e' : 'background:#1a1a1a;border:1px solid #2a2a2a') + '">' +
          (item.done
            ? '<i data-lucide="check" style="width:15px;height:15px;color:#22c55e"></i>'
            : '<i data-lucide="' + item.icon + '" style="width:15px;height:15px;color:#666"></i>') +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;color:' + (item.done ? '#a0a0a0' : '#f0f0f0') + ';' + (item.done ? 'text-decoration:line-through' : '') + '">' + item.title + '</div>' +
          '<div style="font-size:12px;color:#666;margin-top:2px">' + item.desc + '</div>' +
        '</div>' +
        (item.done ? '' : '<i data-lucide="chevron-right" style="width:14px;height:14px;color:#444;flex-shrink:0"></i>') +
      '</div>';
    });

    document.getElementById('gs-checklist').innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    document.getElementById('gs-checklist').innerHTML = '<div style="padding:20px;color:#666;text-align:center">Could not load checklist</div>';
  }
}
