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
    'warmup-dashboard': loadWarmupDashboard,
    'warmup-progress': loadWarmupProgress,
    'warmup-schedule': loadWarmupSchedule,
    'warmup-readiness': loadWarmupReadiness,
    'warmup-accounts': loadWarmupAccounts,
    'conversations': function() { loadConversations(); loadConversationTopics(); loadAutoGenerateSetting(); },
    'warmup-log': loadWarmupLog,
    'campaign-dashboard': loadCampaignDashboard,
    'campaigns': loadCampaigns,
    'leads': loadLeads,
    'sending-accounts': loadAccounts,
    'settings': function() { loadSettings(); loadNotificationSettings(); },
  };
  if (loaders[section]) loaders[section]();
}

// ─── Boot ────────────────────────────────────────────────────────────────────
['wa-pass', 'acc-pass'].forEach(function(id) {
  el(id).addEventListener('input', function(e) {
    e.target.value = e.target.value.replace(/\s/g, '');
  });
});

restoreHubspotToken();
navigate('campaign-dashboard');
