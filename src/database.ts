import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "../data/system.db");

export const db = new Database(DB_PATH, { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      app_password TEXT NOT NULL,
      domain TEXT,
      daily_limit INTEGER DEFAULT 20,
      emails_sent_today INTEGER DEFAULT 0,
      status TEXT DEFAULT 'warming',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS warmup_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      app_password TEXT NOT NULL,
      daily_volume INTEGER DEFAULT 5,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS warmup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_email TEXT NOT NULL,
      to_email TEXT NOT NULL,
      subject TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      replied INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      daily_limit INTEGER DEFAULT 20,
      send_days TEXT DEFAULT 'mon,tue,wed,thu,fri',
      send_start_hour INTEGER DEFAULT 9,
      send_end_hour INTEGER DEFAULT 17,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS sequence_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      step_number INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      delay_days INTEGER DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      first_name TEXT,
      last_name TEXT,
      email TEXT NOT NULL,
      company TEXT,
      website TEXT,
      personalized_line TEXT,
      current_step INTEGER DEFAULT 1,
      next_send_date DATE,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS sent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      step_number INTEGER NOT NULL,
      subject TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      bounced INTEGER DEFAULT 0,
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      pushed_to_hubspot INTEGER DEFAULT 0,
      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // ─── Clients table ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      hubspot_token TEXT DEFAULT NULL,
      hubspot_portal_id TEXT DEFAULT NULL,
      status TEXT DEFAULT 'active',
      notes TEXT DEFAULT NULL,
      color TEXT DEFAULT '#6366f1',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default client if none exists
  const clientCount = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM clients").get();
  if (clientCount && clientCount.count === 0) {
    db.exec("INSERT INTO clients (name, contact_name, status) VALUES ('Default Client', 'System Owner', 'active')");
  }

  // Add client_id columns to campaigns, accounts, warmup_accounts
  try { db.exec("ALTER TABLE campaigns ADD COLUMN client_id INTEGER DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE accounts ADD COLUMN client_id INTEGER DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN client_id INTEGER DEFAULT NULL"); } catch {}

  // Backfill all existing rows to the default client
  const defaultClient = db.query<{ id: number }, []>("SELECT id FROM clients ORDER BY id ASC LIMIT 1").get();
  if (defaultClient) {
    const dcId = defaultClient.id;
    db.run("UPDATE campaigns SET client_id = ? WHERE client_id IS NULL", [dcId]);
    db.run("UPDATE accounts SET client_id = ? WHERE client_id IS NULL", [dcId]);
    db.run("UPDATE warmup_accounts SET client_id = ? WHERE client_id IS NULL", [dcId]);
    db.exec(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('current_client_id', '${dcId}');`);
  }

  // warmup_accounts migrations
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN warmup_started_at DATETIME DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN warmup_target_days INTEGER DEFAULT 14"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN health_score INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN last_verified_at DATETIME DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN status TEXT DEFAULT 'warming'"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN daily_target INTEGER DEFAULT 5"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN group_name TEXT DEFAULT 'default'"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN notes TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN last_failure_at DATETIME DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE warmup_accounts ADD COLUMN consecutive_failures INTEGER DEFAULT 0"); } catch {}

  // leads migrations
  try { db.exec("ALTER TABLE leads ADD COLUMN unsubscribe_token TEXT DEFAULT NULL"); } catch {}
  db.exec("UPDATE leads SET unsubscribe_token = lower(hex(randomblob(16))) WHERE unsubscribe_token IS NULL");
  try { db.exec("ALTER TABLE leads ADD COLUMN valid INTEGER DEFAULT 1"); } catch {}
  try { db.exec("ALTER TABLE leads ADD COLUMN validation_reason TEXT DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE leads ADD COLUMN opened INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE leads ADD COLUMN opened_at DATETIME DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE leads ADD COLUMN open_count INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE sent_log ADD COLUMN tracking_token TEXT DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE sent_log ADD COLUMN opened INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE sent_log ADD COLUMN opened_at DATETIME DEFAULT NULL"); } catch {}

  // leads timezone columns
  try { db.exec("ALTER TABLE leads ADD COLUMN timezone_offset REAL DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE leads ADD COLUMN timezone_label TEXT DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE leads ADD COLUMN optimal_send_hour INTEGER DEFAULT 9"); } catch {}
  try { db.exec("ALTER TABLE leads ADD COLUMN timezone_detected INTEGER DEFAULT 0"); } catch {}

  // campaigns timezone_aware column
  try { db.exec("ALTER TABLE campaigns ADD COLUMN timezone_aware INTEGER DEFAULT 0"); } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS email_opens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_token TEXT UNIQUE,
      lead_id INTEGER,
      campaign_id INTEGER,
      step_number INTEGER,
      email TEXT,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT DEFAULT NULL,
      user_agent TEXT DEFAULT NULL,
      open_count INTEGER DEFAULT 1
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dns_check_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      overall_score INTEGER,
      overall_status TEXT,
      spf_found INTEGER DEFAULT 0,
      dkim_found INTEGER DEFAULT 0,
      dmarc_found INTEGER DEFAULT 0,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS client_report_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER UNIQUE,
      client_email TEXT NOT NULL,
      client_name TEXT,
      send_daily INTEGER DEFAULT 1,
      send_weekly INTEGER DEFAULT 1,
      send_time_hour INTEGER DEFAULT 8,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // warmup_log migrations
  try { db.exec("ALTER TABLE warmup_log ADD COLUMN conversation_id TEXT DEFAULT 'auto'"); } catch {}
  try { db.exec("ALTER TABLE warmup_log ADD COLUMN pair_id TEXT DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE warmup_log ADD COLUMN topic TEXT DEFAULT NULL"); } catch {}

  // conversation_files migrations
  try { db.exec("ALTER TABLE conversation_files ADD COLUMN topic TEXT DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE conversation_files ADD COLUMN source TEXT DEFAULT 'manual'"); } catch {}
  try { db.exec("ALTER TABLE conversation_files ADD COLUMN is_duplicate INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE conversation_files ADD COLUMN similarity_score INTEGER DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE conversation_files ADD COLUMN duplicate_of TEXT DEFAULT NULL"); } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS warmup_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      scheduled_date DATE,
      target_emails INTEGER DEFAULT 5,
      sent_emails INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS warmup_conversations_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT,
      subject TEXT,
      body_sender TEXT,
      body_receiver TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS account_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      account_email TEXT,
      previous_status TEXT,
      new_status TEXT,
      reason TEXT,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS warmup_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_email TEXT,
      receiver_email TEXT,
      last_paired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      pair_count INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS inbox_placement_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_name TEXT DEFAULT 'Placement Test',
      sending_account_email TEXT,
      test_email TEXT,
      subject TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      placement TEXT DEFAULT 'unknown',
      reported_at DATETIME DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      status TEXT DEFAULT 'sent'
    );

    CREATE TABLE IF NOT EXISTS placement_test_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      app_password TEXT,
      provider TEXT DEFAULT 'gmail',
      label TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS warmup_reply_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      thread_level INTEGER DEFAULT 1,
      from_email TEXT NOT NULL,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      scheduled_at DATETIME NOT NULL,
      status TEXT DEFAULT 'pending',
      parent_log_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS warmup_schedule_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_name TEXT DEFAULT 'Default Plan',
      account_id INTEGER REFERENCES warmup_accounts(id),
      week_number INTEGER NOT NULL,
      emails_per_day INTEGER NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default plan for any warmup accounts that don't yet have plan rows
  const defaultTargets = [
    { week: 1, epd: 5 },
    { week: 2, epd: 10 },
    { week: 3, epd: 20 },
    { week: 4, epd: 20 },
  ];
  const allWarmupAccounts = db.query<{ id: number }, []>("SELECT id FROM warmup_accounts").all();
  const seedPlan = db.prepare(
    "INSERT OR IGNORE INTO warmup_schedule_plans (account_id, week_number, emails_per_day) VALUES (?, ?, ?)"
  );
  for (const acct of allWarmupAccounts) {
    for (const t of defaultTargets) {
      const exists = db
        .query<{ id: number }, [number, number]>(
          "SELECT id FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ?"
        )
        .get(acct.id, t.week);
      if (!exists) seedPlan.run(acct.id, t.week, t.epd);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      email_count INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'scheduled'
    );
  `);

  // Seed warmup_conversations_library with web design industry conversation pairs
  const seedConversations = db.prepare("SELECT COUNT(*) as count FROM warmup_conversations_library").get() as { count: number };
  if (seedConversations.count === 0) {
    db.exec(`
      INSERT INTO warmup_conversations_library (topic, subject, body_sender, body_receiver) VALUES
      (
        'project kickoff',
        'Kicking Off the Redesign Project',
        'Hi Sarah, excited to officially kick off the website redesign! I''ve reviewed the brief and I think we have a strong foundation. I''ll have the initial sitemap and wireframes ready by end of week. Can we schedule a quick call Thursday to align before I dive into the visuals?',
        'Hi Marcus, thrilled to get started! Thursday works great — how does 2pm EST sound? I''ll also send over a few competitor sites we like for reference. Looking forward to seeing your direction on this.'
      ),
      (
        'design feedback',
        'Re: Homepage Concepts — Your Thoughts?',
        'Hey Lisa, I''ve attached the three homepage concepts we discussed. Concept B leans into the bold typography direction you mentioned, while Concept A is a safer, more corporate feel. Would love to hear which direction resonates most before I build out the inner pages.',
        'Hi Daniel, I really love the energy of Concept B — the typography feels fresh without being too risky. The hero section especially stands out. Can we keep the color palette a bit closer to our brand guidelines though? Let''s go with that direction and refine from there.'
      ),
      (
        'revision request',
        'A Few Tweaks on the About Page',
        'Hi Priya, the about page is looking close but the client flagged a couple of things. They''d like the team photos to be larger and the bio text trimmed to two sentences each. Also, can we move the CTA button above the fold? Happy to jump on a call if easier.',
        'Got it, no problem at all. I''ll resize the photos, trim the bios, and shift the CTA up. I can have the revised version back to you by tomorrow afternoon — does that timeline work on your end?'
      ),
      (
        'invoice follow up',
        'Following Up: Invoice #1042',
        'Hi Jordan, I wanted to follow up on Invoice #1042 sent on the 3rd for the milestone two deliverables. Total is $2,400 and it''s now 10 days out. Please let me know if there are any issues with the invoice or if you need me to resend it.',
        'Hi Alex, so sorry for the delay — this slipped through during a busy week. I''ve submitted it for payment today and you should see it clear within 3–5 business days. Thanks for the nudge and for your patience.'
      ),
      (
        'meeting scheduling',
        'Scheduling Our Mid-Project Check-In',
        'Hi Tom, we''re about halfway through the project and I''d love to set up a 30-minute check-in to review progress and make sure we''re aligned before the final sprint. Are you free any time next Tuesday or Wednesday afternoon?',
        'Hi Rachel, Wednesday afternoon works well for me. How does 3pm CST sound? I''ll send over a calendar invite. Looking forward to seeing where things stand — the mockups you shared last week looked really solid.'
      ),
      (
        'project completion',
        'Website is Live — Congratulations!',
        'Hi Michelle, I''m thrilled to let you know that the new site is officially live! Everything has been tested across devices and browsers and is looking great. It''s been a pleasure working with your team on this. I''ll send over the final handoff doc with login credentials and instructions by end of day.',
        'Oh wow, this is so exciting! The site looks absolutely incredible — our whole team is blown away. Thank you so much for all the hard work and for being so patient with our feedback along the way. We''ll definitely be in touch for future projects.'
      ),
      (
        'referral thank you',
        'Thank You for the Referral!',
        'Hi James, I just got off a call with the team at Brightline Co. and they mentioned you sent them my way — that means a lot! I wanted to reach out personally to say thank you. Referrals like this are honestly the best part of doing good work. I hope we can collaborate again soon.',
        'Of course! I had such a great experience working with you that it was an easy recommendation. They''re great people and I think it''ll be a natural fit. Hope it turns into something solid for you!'
      ),
      (
        'scope change discussion',
        'Quick Note on Scope — E-Commerce Addition',
        'Hi Nina, the client has asked about adding a small e-commerce section to the project — essentially 5–10 product pages and a basic cart. I wanted to flag this before agreeing to anything on their end. It''s a meaningful addition and would likely require a revised timeline and budget. Can we chat about it?',
        'Totally agree — that''s not a small ask. I''d estimate it adds at least two weeks and I''d need to scope the payment integration separately. Let''s draft a change order before we commit. I can put together a rough estimate tonight and we can align tomorrow. Sound good?'
      ),
      (
        'timeline update',
        'Quick Update on Project Timeline',
        'Hi Carlos, I wanted to give you a heads up that we''re running about three days behind on the inner page designs. I had an unexpected family situation come up this week that impacted my schedule. I''m back on track now and confident I can still deliver before the launch deadline. I''ll send an updated schedule by tomorrow morning.',
        'Hi Emily, thanks for being upfront about it — I really appreciate the communication. As long as the launch date holds, we''re fine. Take care of what you need to and just keep us in the loop. Looking forward to the updated schedule.'
      ),
      (
        'portfolio review request',
        'Would Love Your Feedback on My Updated Portfolio',
        'Hi Kevin, I''ve just refreshed my portfolio with several new case studies including the Henderson rebrand we worked on together. I''d love to get your honest thoughts, especially on how I''ve presented the process work. No pressure at all — only if you have a few spare minutes.',
        'Happy to take a look! I''ve always admired how thoughtfully you document your process. I''ll check it out this weekend and send over some notes. The Henderson project was one of my favorites — I''m sure it reads really well as a case study.'
      );
    `);
  }

  // Seed warmup_running default if not already present
  db.exec("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('warmup_running', '1');");
  db.exec("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('auto_generate_conversations', '0');");
  db.exec("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('send_warmup_summary', '0');");
  db.exec("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('notification_email', '');");
  db.exec("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('dashboard_url', 'http://localhost:3000');");
  db.exec("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('system_name', 'GTM Warmup System');");

  // Backfill account_status_history for accounts that existed before history tracking
  const histCount = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM account_status_history").get();
  if (histCount && histCount.count === 0) {
    const existingAccounts = db.query<{
      id: number; email: string; status: string | null
    }, []>("SELECT id, email, status FROM warmup_accounts").all();

    const insertHistory = db.prepare(
      `INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason, changed_at)
       VALUES (?, ?, NULL, ?, 'Account existed before history tracking was added', ?)`
    );
    for (const acct of existingAccounts) {
      insertHistory.run(
        acct.id,
        acct.email,
        acct.status || 'warming',
        new Date().toISOString()
      );
    }
    if (existingAccounts.length > 0) {
      console.log(`Backfilled account_status_history for ${existingAccounts.length} existing account(s)`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS unsubscribe_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      lead_email TEXT,
      token TEXT,
      unsubscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT DEFAULT NULL,
      user_agent TEXT DEFAULT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      file_size_kb INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      note TEXT DEFAULT NULL
    );
  `);

  db.exec("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('auto_backup_enabled', '1');");

  db.exec(`
    CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      value TEXT UNIQUE NOT NULL,
      reason TEXT DEFAULT NULL,
      added_by TEXT DEFAULT 'manual',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed common personal email domains
  const personalDomains = ['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','aol.com','protonmail.com','mail.com','zoho.com','yandex.com'];
  const seedBlacklist = db.prepare("INSERT OR IGNORE INTO blacklist (type, value, reason, added_by) VALUES ('domain', ?, 'Personal email domain - not suitable for B2B outreach', 'system-seed')");
  for (const domain of personalDomains) seedBlacklist.run(domain);

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_type TEXT NOT NULL,
      severity TEXT DEFAULT 'error',
      message TEXT NOT NULL,
      stack_trace TEXT DEFAULT NULL,
      context TEXT DEFAULT NULL,
      resolved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Campaign Templates ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      category TEXT DEFAULT 'general',
      daily_limit INTEGER DEFAULT 20,
      send_days TEXT DEFAULT 'mon,tue,wed,thu,fri',
      send_start_hour INTEGER DEFAULT 9,
      send_end_hour INTEGER DEFAULT 17,
      timezone_aware INTEGER DEFAULT 0,
      created_from_campaign_id INTEGER DEFAULT NULL,
      usage_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS template_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES campaign_templates(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      delay_days INTEGER DEFAULT 0
    );
  `);

  // Seed default templates (only if none exist yet)
  const templateCount = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM campaign_templates").get();
  if (templateCount && templateCount.n === 0) {
    const insertTpl = db.prepare(
      "INSERT INTO campaign_templates (name, description, category, daily_limit) VALUES (?, ?, ?, ?)"
    );
    const insertStep = db.prepare(
      "INSERT INTO template_steps (template_id, step_number, subject, body, delay_days) VALUES (?, ?, ?, ?, ?)"
    );

    // Template 1 — Agency Outreach
    const t1 = insertTpl.run(
      "Agency Outreach",
      "Cold outreach for agencies offering overflow frontend development work",
      "agency", 20
    );
    const t1id = Number(t1.lastInsertRowid);
    insertStep.run(t1id, 1, "quick question {{first_name}}",
      "Hi {{first_name}},\n\n{{personalized_line}}\n\nI help agencies like {{company}} get premium frontend development for overflow projects without the overhead of hiring. Worth a quick 15-minute call?\n\nBest,", 0);
    insertStep.run(t1id, 2, "re: quick question {{first_name}}",
      "Hi {{first_name}},\n\nJust following up on my last email. Happy to share some examples of recent work if that helps.\n\nBest,", 3);
    insertStep.run(t1id, 3, "last note {{first_name}}",
      "Hi {{first_name}},\n\nDidn't want to keep reaching out if timing is off. If this isn't relevant just let me know and I'll leave you alone.\n\nBest,", 7);

    // Template 2 — SaaS Founder Outreach
    const t2 = insertTpl.run(
      "SaaS Founder Outreach",
      "Cold outreach for SaaS founders who need a premium website",
      "saas", 20
    );
    const t2id = Number(t2.lastInsertRowid);
    insertStep.run(t2id, 1, "your website {{first_name}}",
      "Hi {{first_name}},\n\n{{personalized_line}}\n\nI build premium animated websites for SaaS founders who want their site to match the quality of their product. Would love to show you some examples.\n\nBest,", 0);
    insertStep.run(t2id, 2, "following up {{first_name}}",
      "Hi {{first_name}},\n\nJust wanted to follow up. Curious if improving your website conversion rate is on your radar this quarter.\n\nBest,", 4);
    insertStep.run(t2id, 3, "one last thing {{first_name}}",
      "Hi {{first_name}},\n\nLast email from me. If a better website isn't a priority right now, no worries at all. If it is something you're thinking about, I'm happy to share how I approach it.\n\nBest,", 8);

    // Template 3 — Personal Brand Outreach
    const t3 = insertTpl.run(
      "Personal Brand Outreach",
      "Cold outreach for coaches and consultants needing a premium personal brand site",
      "personal-brand", 15
    );
    const t3id = Number(t3.lastInsertRowid);
    insertStep.run(t3id, 1, "{{first_name}} — your site",
      "Hi {{first_name}},\n\n{{personalized_line}}\n\nI specialize in building premium personal brand websites for coaches and consultants. Your work deserves a site that matches your reputation. Open to a quick chat?\n\nBest,", 0);
    insertStep.run(t3id, 2, "following up",
      "Hi {{first_name}},\n\nJust circling back on my last message. Do you have 15 minutes this week to explore what a premium site could do for your brand?\n\nBest,", 5);
    insertStep.run(t3id, 3, "last message",
      "Hi {{first_name}},\n\nThis is my last follow-up. If now isn't the right time, completely understood. Feel free to reach out whenever you're ready to level up your online presence.\n\nBest,", 10);
  }

  // ─── A/B Testing ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS ab_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      step_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      variant_a_subject TEXT NOT NULL,
      variant_b_subject TEXT NOT NULL,
      variant_a_sent INTEGER DEFAULT 0,
      variant_b_sent INTEGER DEFAULT 0,
      variant_a_opened INTEGER DEFAULT 0,
      variant_b_opened INTEGER DEFAULT 0,
      variant_a_replied INTEGER DEFAULT 0,
      variant_b_replied INTEGER DEFAULT 0,
      winner TEXT DEFAULT NULL,
      winner_declared_at DATETIME DEFAULT NULL,
      min_sample_size INTEGER DEFAULT 50,
      confidence_threshold REAL DEFAULT 0.1,
      auto_declare INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try { db.exec("ALTER TABLE sent_log ADD COLUMN ab_test_id INTEGER DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE sent_log ADD COLUMN ab_variant TEXT DEFAULT NULL"); } catch {}

  // Purge any sessions that expired before this boot
  db.exec("DELETE FROM sessions WHERE expires_at < unixepoch() * 1000;");

  console.log("Database initialized at", DB_PATH);
}

// Reset daily sent counts — called by scheduler at midnight
export function resetDailyCounts() {
  db.exec("UPDATE accounts SET emails_sent_today = 0;");
}
