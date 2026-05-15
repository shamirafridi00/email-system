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

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      email_count INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'scheduled'
    );
  `);

  // Seed warmup_running default if not already present
  db.exec("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('warmup_running', '1');");

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
