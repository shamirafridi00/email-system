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

  // warmup_log migrations
  try { db.exec("ALTER TABLE warmup_log ADD COLUMN conversation_id TEXT DEFAULT 'auto'"); } catch {}
  try { db.exec("ALTER TABLE warmup_log ADD COLUMN pair_id TEXT DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE warmup_log ADD COLUMN topic TEXT DEFAULT NULL"); } catch {}

  // conversation_files migrations
  try { db.exec("ALTER TABLE conversation_files ADD COLUMN topic TEXT DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE conversation_files ADD COLUMN source TEXT DEFAULT 'manual'"); } catch {}

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Purge any sessions that expired before this boot
  db.exec("DELETE FROM sessions WHERE expires_at < unixepoch() * 1000;");

  console.log("Database initialized at", DB_PATH);
}

// Reset daily sent counts — called by scheduler at midnight
export function resetDailyCounts() {
  db.exec("UPDATE accounts SET emails_sent_today = 0;");
}
