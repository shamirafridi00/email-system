import { db } from "../database";
import { logError, logWarning } from "./logger";
import nodemailer from "nodemailer";
import { autoBlacklistBounced } from "./blacklistChecker";

export interface BounceCheckResult {
  email: string;
  total_sent: number;
  bounced_count: number;
  bounce_rate: number;
  action_taken: "none" | "warning" | "paused";
}

export interface BounceStats {
  account_id: number;
  email: string;
  total_7d: number;
  bounced_7d: number;
  bounce_rate_7d: number;
  total_30d: number;
  bounced_30d: number;
  bounce_rate_30d: number;
}

function sentInWindow(accountEmail: string, days: number): { total: number; bounced: number } {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  // sent_log doesn't store the from_email directly — join through leads+campaigns+accounts
  const row = db
    .query<{ total: number; bounced: number }, [string, string]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN sl.bounced = 1 THEN 1 ELSE 0 END) AS bounced
       FROM sent_log sl
       JOIN campaigns c ON c.id = sl.campaign_id
       JOIN accounts a ON a.id = c.account_id
       WHERE a.email = ? AND sl.sent_at >= ?`
    )
    .get(accountEmail, cutoff);

  return { total: row?.total ?? 0, bounced: row?.bounced ?? 0 };
}

export async function checkBounceRates(): Promise<BounceCheckResult[]> {
  const accounts = db
    .query<{ id: number; email: string; status: string }, []>(
      "SELECT id, email, status FROM accounts WHERE status != 'paused'"
    )
    .all();

  const results: BounceCheckResult[] = [];

  for (const account of accounts) {
    const { total, bounced } = sentInWindow(account.email, 7);

    if (total < 10) {
      results.push({ email: account.email, total_sent: total, bounced_count: bounced, bounce_rate: 0, action_taken: "none" });
      continue;
    }

    const bounce_rate = (bounced / total) * 100;

    if (bounce_rate > 10) {
      // Auto-blacklist all bounced emails for this account in the last 7 days
      const cutoff7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const bouncedEmails = db.query<{ email: string }, [string, string]>(
        `SELECT DISTINCT l.email FROM sent_log sl
         JOIN leads l ON l.id = sl.lead_id
         JOIN campaigns c ON c.id = sl.campaign_id
         JOIN accounts a ON a.id = c.account_id
         WHERE a.email = ? AND sl.bounced = 1 AND sl.sent_at >= ?`
      ).all(account.email, cutoff7d);
      for (const { email } of bouncedEmails) {
        autoBlacklistBounced(email).catch(() => {});
      }

      // Pause the account
      db.run("UPDATE accounts SET status = 'paused' WHERE id = ?", [account.id]);

      const reason = `Auto paused — bounce rate of ${bounce_rate.toFixed(1)}% exceeds 10% threshold`;
      db.run(
        `INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason)
         VALUES (?, ?, ?, 'paused', ?)`,
        [account.id, account.email, account.status, reason]
      );

      logError({
        error_type: "campaign",
        severity: "critical",
        message: `Account ${account.email} auto-paused due to high bounce rate: ${bounce_rate.toFixed(1)}% (${bounced}/${total})`,
        context: { account_email: account.email, bounce_rate, bounced, total },
      }).catch(() => {});

      await sendBounceRateAlertEmail(account.email, bounce_rate, bounced, total, "All Campaigns");

      results.push({ email: account.email, total_sent: total, bounced_count: bounced, bounce_rate, action_taken: "paused" });
    } else if (bounce_rate > 5) {
      logWarning(
        "campaign",
        `High bounce rate warning for ${account.email}: ${bounce_rate.toFixed(1)}% (${bounced}/${total})`,
        { account_email: account.email, bounce_rate, bounced, total }
      ).catch(() => {});

      await sendBounceRateAlertEmail(account.email, bounce_rate, bounced, total, "All Campaigns");

      results.push({ email: account.email, total_sent: total, bounced_count: bounced, bounce_rate, action_taken: "warning" });
    } else {
      results.push({ email: account.email, total_sent: total, bounced_count: bounced, bounce_rate, action_taken: "none" });
    }
  }

  return results;
}

export async function getBounceStats(): Promise<BounceStats[]> {
  const accounts = db
    .query<{ id: number; email: string }, []>(
      "SELECT id, email FROM accounts ORDER BY created_at DESC"
    )
    .all();

  return accounts.map((account) => {
    const w7 = sentInWindow(account.email, 7);
    const w30 = sentInWindow(account.email, 30);
    return {
      account_id: account.id,
      email: account.email,
      total_7d: w7.total,
      bounced_7d: w7.bounced,
      bounce_rate_7d: w7.total >= 10 ? +((w7.bounced / w7.total) * 100).toFixed(1) : -1,
      total_30d: w30.total,
      bounced_30d: w30.bounced,
      bounce_rate_30d: w30.total >= 10 ? +((w30.bounced / w30.total) * 100).toFixed(1) : -1,
    };
  });
}

export async function sendBounceRateAlertEmail(
  account_email: string,
  bounce_rate: number,
  bounced_count: number,
  total_sent: number,
  campaign_name: string
): Promise<void> {
  const notifRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'notification_email'")
    .get();
  const notifEmail = notifRow?.value?.trim() ?? "";
  if (!notifEmail) return;

  // Rate-limit: once per 24h per account
  const rlKey = `bounce_alert_sent_${account_email}`;
  const lastRow = db
    .query<{ value: string }, [string]>("SELECT value FROM system_settings WHERE key = ?")
    .get(rlKey);
  if (lastRow?.value) {
    const lastMs = parseInt(lastRow.value, 10);
    if (!isNaN(lastMs) && Date.now() - lastMs < 24 * 60 * 60 * 1000) return;
  }

  const sender = db
    .query<{ email: string; app_password: string }, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
    )
    .get();
  if (!sender) return;

  const systemNameRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'")
    .get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";

  const dashRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'dashboard_url'")
    .get();
  const dashUrl = dashRow?.value?.trim() || "http://localhost:3000";

  const isCritical = bounce_rate > 10;
  const headerColor = isCritical ? "#7f1d1d" : "#78350f";
  const rateColor = isCritical ? "#dc2626" : "#d97706";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="background:${headerColor};padding:28px 32px">
      <div style="font-size:10px;font-weight:700;color:#fca5a5;text-transform:uppercase;letter-spacing:.14em;margin-bottom:6px">${isCritical ? "CRITICAL ALERT" : "WARNING"}</div>
      <div style="font-size:20px;font-weight:800;color:#fff">High Bounce Rate Detected</div>
    </div>
    <div style="padding:24px 32px">
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:20px 24px;margin-bottom:24px">
        <div style="font-size:17px;font-weight:800;color:#991b1b;font-family:monospace;margin-bottom:12px">${account_email}</div>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:4px 0;font-size:12px;font-weight:700;color:#9ca3af;width:160px">Bounce Rate (7d)</td>
              <td style="padding:4px 0;font-size:22px;font-weight:800;color:${rateColor}">${bounce_rate.toFixed(1)}%</td></tr>
          <tr><td style="padding:4px 0;font-size:12px;font-weight:700;color:#9ca3af">Bounced / Sent</td>
              <td style="padding:4px 0;font-size:13px;color:#374151">${bounced_count} / ${total_sent}</td></tr>
          <tr><td style="padding:4px 0;font-size:12px;font-weight:700;color:#9ca3af">Campaign</td>
              <td style="padding:4px 0;font-size:13px;color:#374151">${campaign_name}</td></tr>
          <tr><td style="padding:4px 0;font-size:12px;font-weight:700;color:#9ca3af">Action Taken</td>
              <td style="padding:4px 0;font-size:13px;font-weight:700;color:${isCritical ? '#dc2626' : '#d97706'}">${isCritical ? "Account automatically paused" : "Warning only — account still active"}</td></tr>
        </table>
      </div>
      <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111">Recommended Actions</h2>
      <ol style="margin:0 0 24px;padding-left:20px;font-size:13px;color:#374151;line-height:2.1">
        <li>Clean your lead list — remove invalid and catch-all addresses</li>
        <li>Use email validation before importing new leads</li>
        <li>Check for catch-all domains that accept any email address</li>
        <li>Reduce your daily sending volume while you investigate</li>
        <li>Review and remove leads from domains with high bounce rates</li>
      </ol>
      <div style="text-align:center;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:20px">
        <a href="${dashUrl}" style="display:inline-block;background:#dc2626;color:#fff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none">View Sending Accounts</a>
      </div>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;text-align:center">
      <div style="font-size:11px;color:#9ca3af">${systemName} · ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
    </div>
  </div>
</body>
</html>`;

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: sender.email, pass: sender.app_password },
    });
    await transport.sendMail({
      from: `"${systemName}" <${sender.email}>`,
      to: notifEmail,
      subject: `BOUNCE ALERT — High Bounce Rate Detected — ${account_email}`,
      html,
    });
    db.run(
      "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [rlKey, String(Date.now())]
    );
    console.log(`[bounceMonitor] alert sent to ${notifEmail} for ${account_email}`);
  } catch (err) {
    console.error("[bounceMonitor] sendBounceRateAlertEmail failed:", err instanceof Error ? err.message : err);
  }
}
