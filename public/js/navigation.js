// ─── Navigation ──────────────────────────────────────────────────────────────
document.querySelectorAll('#sidebar nav a').forEach(function(a) {
  a.addEventListener('click', function() { navigate(a.dataset.section); });
});

function navigate(section) {
  state.section = section;
  document.querySelectorAll('#sidebar nav a').forEach(function(a) {
    a.classList.toggle('active', a.dataset.section === section);
  });
  document.querySelectorAll('.section').forEach(function(s) {
    s.classList.toggle('active', s.id === 'section-' + section);
  });
  const loaders = {
    'warmup-dashboard': function() { loadCurrentClient(); loadWarmupDashboard(); },
    'warmup-progress': function() { loadCurrentClient(); loadWarmupProgress(); },
    'warmup-schedule': function() { loadCurrentClient(); loadWarmupSchedule(); },
    'warmup-readiness': function() { loadCurrentClient(); loadWarmupReadiness(); },
    'warmup-groups': function() { loadCurrentClient(); loadAccountGroups(); },
    'warmup-accounts': function() { loadCurrentClient(); loadWarmupAccounts(); },
    'conversations': function() { loadConversations(); loadConversationTopics(); loadAutoGenerateSetting(); },
    'warmup-history': loadAccountHistory,
    'warmup-analytics': loadWarmupAnalytics,
    'warmup-calendar': loadWarmupCalendar,
    'warmup-library': loadTopicsLibrary,
    'warmup-log': loadWarmupLog,
    'warmup-placement': loadPlacementTest,
    'campaign-dashboard': function() { loadCurrentClient(); loadCampaignDashboard(); },
    'analytics': function() { loadCurrentClient(); loadAnalytics(); },
    'campaigns': function() { loadCurrentClient(); loadCampaigns(); },
    'templates': loadTemplates,
    'abtests': loadABTests,
    'leads': function() { loadCurrentClient(); loadLeads(); },
    'sending-accounts': function() { loadCurrentClient(); loadAccounts(); },
    'settings': function() { loadSettings(); loadNotificationSettings(); },
    'health': loadHealthCheck,
    'dns-checker': function() { loadDNSHistory(); loadSendingAccountDomains(); },
    'client-reports': loadClientReports,
    'exports': loadExports,
    'error-log': function() { loadErrorLog(); startErrorAutoRefresh(); },
    'backup': loadBackups,
    'blacklist': loadBlacklist,
    'clients': loadClients,
  };
  // Stop auto refresh jobs when leaving their sections
  if (section !== 'error-log') stopErrorAutoRefresh();
  if (section !== 'abtests') stopABAutoRefresh();

  if (loaders[section]) loaders[section]();
}

// ─── Boot ────────────────────────────────────────────────────────────────────
['wa-pass', 'acc-pass'].forEach(function(id) {
  el(id).addEventListener('input', function(e) {
    e.target.value = e.target.value.replace(/\s/g, '');
  });
});

restoreHubspotToken();
loadCurrentClient();
navigate('campaign-dashboard');

// Sidebar error badge — load immediately and refresh every 5 minutes
updateErrorBadge();
setInterval(updateErrorBadge, 5 * 60 * 1000);
