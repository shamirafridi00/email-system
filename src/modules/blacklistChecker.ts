import { db } from "../database";

interface BlacklistRow {
  id: number;
  type: string;
  value: string;
  reason: string | null;
  added_by: string;
}

export interface BlacklistResult {
  blacklisted: boolean;
  reason: string;
  matched_value: string;
  type: string;
}

export function isBlacklisted(email: string): BlacklistResult {
  const lowerEmail = email.toLowerCase().trim();
  const domain = lowerEmail.split("@")[1] ?? "";

  const emailRow = db
    .query<BlacklistRow, [string]>(
      "SELECT id, type, value, reason, added_by FROM blacklist WHERE type = 'email' AND value = ? AND active = 1"
    )
    .get(lowerEmail);

  if (emailRow) {
    return {
      blacklisted: true,
      reason: emailRow.reason ?? "Email is blacklisted",
      matched_value: emailRow.value,
      type: "email",
    };
  }

  if (domain) {
    const domainRow = db
      .query<BlacklistRow, [string]>(
        "SELECT id, type, value, reason, added_by FROM blacklist WHERE type = 'domain' AND value = ? AND active = 1"
      )
      .get(domain);

    if (domainRow) {
      return {
        blacklisted: true,
        reason: "Domain is blacklisted",
        matched_value: domainRow.value,
        type: "domain",
      };
    }
  }

  return { blacklisted: false, reason: "", matched_value: "", type: "" };
}

export async function checkBatchBlacklist(emails: string[]): Promise<Array<{ email: string; result: BlacklistResult }>> {
  return emails.map((email) => ({ email, result: isBlacklisted(email) }));
}

export async function addToBlacklist(
  value: string,
  type: string,
  reason: string | null,
  added_by: string
): Promise<{ success: boolean; is_new: boolean; error?: string }> {
  if (type !== "email" && type !== "domain") {
    return { success: false, is_new: false, error: "type must be email or domain" };
  }

  const normalized = value.toLowerCase().trim();

  if (type === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return { success: false, is_new: false, error: "Invalid email format" };
    }
  } else {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$/.test(normalized)) {
      return { success: false, is_new: false, error: "Invalid domain format" };
    }
  }

  const existing = db
    .query<{ id: number }, [string]>("SELECT id FROM blacklist WHERE value = ?")
    .get(normalized);

  db.run(
    "INSERT OR IGNORE INTO blacklist (type, value, reason, added_by) VALUES (?, ?, ?, ?)",
    [type, normalized, reason ?? null, added_by]
  );

  return { success: true, is_new: !existing };
}

export async function autoBlacklistBounced(email: string): Promise<{ email_blacklisted: boolean; domain_blacklisted: boolean; domain?: string }> {
  const lowerEmail = email.toLowerCase().trim();
  const domain = lowerEmail.split("@")[1] ?? "";

  db.run(
    "INSERT OR IGNORE INTO blacklist (type, value, reason, added_by) VALUES ('email', ?, 'Auto-blacklisted - email bounced', 'auto-bounce')",
    [lowerEmail]
  );

  let domain_blacklisted = false;
  if (domain) {
    const bounceCount = db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) as count FROM sent_log sl
         JOIN leads l ON l.id = sl.lead_id
         WHERE l.email LIKE ? AND sl.bounced = 1`
      )
      .get(`%@${domain}`) ?? { count: 0 };

    if (bounceCount.count >= 3) {
      db.run(
        "INSERT OR IGNORE INTO blacklist (type, value, reason, added_by) VALUES ('domain', ?, 'Auto-blacklisted - multiple bounces from this domain', 'auto-bounce')",
        [domain]
      );
      domain_blacklisted = true;
    }
  }

  return { email_blacklisted: true, domain_blacklisted, domain: domain || undefined };
}

export async function getBlacklistStats(): Promise<{
  total: number;
  email_count: number;
  domain_count: number;
  auto_added: number;
  manually_added: number;
  most_recent: unknown;
}> {
  const total = (db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM blacklist WHERE active = 1").get()?.count ?? 0);
  const email_count = (db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM blacklist WHERE type = 'email' AND active = 1").get()?.count ?? 0);
  const domain_count = (db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM blacklist WHERE type = 'domain' AND active = 1").get()?.count ?? 0);
  const auto_added = (db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM blacklist WHERE added_by != 'manual' AND added_by != 'system-seed' AND active = 1").get()?.count ?? 0);
  const manually_added = (db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM blacklist WHERE added_by = 'manual' AND active = 1").get()?.count ?? 0);
  const most_recent = db.query("SELECT * FROM blacklist ORDER BY created_at DESC LIMIT 1").get() ?? null;

  return { total, email_count, domain_count, auto_added, manually_added, most_recent };
}
