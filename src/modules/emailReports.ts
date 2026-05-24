import nodemailer from "nodemailer";
import { db } from "../database";
import { logWarning } from "./logger";

interface AccountStatus {
  email: string;
  current_week: number;
  daily_target: number;
  sent_yesterday: number;
  health_score: number;
  consecutive_failures: number;
  on_track: boolean;
  below_target: boolean;
  no_activity: boolean;
}

interface ConversationActivity {
  filename: string;
  topic: string | null;
  source: string | null;
  email_count: number;
}

interface HealthAlert {
  type: "auth_failure" | "no_activity" | "low_health";
  email: string;
  detail: string;
}

interface SummaryData {
  date: string;
  total_sent: number;
  total_received: number;
  active_accounts: number;
  accounts_on_track: number;
  accounts: AccountStatus[];
  conversations: ConversationActivity[];
  alerts: HealthAlert[];
}

export function buildWarmupSummaryHTML(data: SummaryData): string {
  const statusRow = (acct: AccountStatus) => {
    const icon = acct.no_activity
      ? `<span style="color:#ef4444;font-weight:700">✗</span>`
      : acct.on_track
        ? `<span style="color:#22c55e;font-weight:700">✓</span>`
        : `<span style="color:#f59e0b;font-weight:700">!</span>`;
    const weekStyles: Record<number, { bg: string; color: string }> = {
      1: { bg: "#1e1b4b", color: "#a5b4fc" },
      2: { bg: "#052e16", color: "#4ade80" },
      3: { bg: "#1c0a00", color: "#fb923c" },
      4: { bg: "#0c0a00", color: "#fbbf24" },
    };
    const ws = weekStyles[acct.current_week];
    const weekBadge = ws
      ? `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:.5px;background:${ws.bg};color:${ws.color}">Wk ${acct.current_week}</span>`
      : `<span style="font-size:11px;color:#888">—</span>`;

    return `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-family:monospace;font-size:12px;color:#374151">${acct.email}</td>
        <td style="padding:10px 12px;text-align:center">${weekBadge}</td>
        <td style="padding:10px 12px;text-align:center;font-size:13px;font-weight:700;color:#111">${acct.sent_yesterday}</td>
        <td style="padding:10px 12px;text-align:center;font-size:13px;color:#6b7280">${acct.daily_target}</td>
        <td style="padding:10px 12px;text-align:center;font-size:16px">${icon}</td>
      </tr>`;
  };

  const convRow = (c: ConversationActivity) => `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:9px 12px;font-size:12px;font-family:monospace;color:#374151;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.filename}</td>
      <td style="padding:9px 12px;font-size:12px;color:#6b7280">${c.topic ? c.topic.charAt(0).toUpperCase() + c.topic.slice(1) : "—"}</td>
      <td style="padding:9px 12px;text-align:center;font-size:12px;font-weight:600;color:#111">${c.email_count}</td>
      <td style="padding:9px 12px;text-align:center"><span style="font-size:11px;padding:2px 7px;border-radius:10px;background:${c.source === "auto" ? "#ede9fe" : "#f3f4f6"};color:${c.source === "auto" ? "#6d28d9" : "#6b7280"}">${c.source ?? "manual"}</span></td>
    </tr>`;

  const alertRow = (a: HealthAlert) => {
    const colors: Record<string, string> = { auth_failure: "#ef4444", no_activity: "#f59e0b", low_health: "#f97316" };
    const color = colors[a.type] ?? "#6b7280";
    return `<div style="padding:8px 12px;margin-bottom:6px;border-left:3px solid ${color};background:#fafafa;font-size:13px;color:#374151">
      <strong style="color:${color}">${a.email}</strong> — ${a.detail}
    </div>`;
  };

  const statBox = (label: string, value: string | number, color: string = "#111") => `
    <td style="width:25%;padding:16px;text-align:center;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
      <div style="font-size:26px;font-weight:800;color:${color};line-height:1">${value}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:.04em">${label}</div>
    </td>`;

  const dateFormatted = new Date(data.date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const accountsSection = data.accounts.length
    ? `<table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Account</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Week</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Sent</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Target</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Status</th>
          </tr>
        </thead>
        <tbody>${data.accounts.map(statusRow).join("")}</tbody>
      </table>`
    : `<p style="color:#6b7280;font-size:13px">No active warmup accounts.</p>`;

  const convsSection = data.conversations.length
    ? `<table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">File</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Topic</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Emails</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Source</th>
          </tr>
        </thead>
        <tbody>${data.conversations.map(convRow).join("")}</tbody>
      </table>`
    : `<p style="color:#6b7280;font-size:13px">No conversations processed yesterday.</p>`;

  const alertsSection = data.alerts.length
    ? `<div style="margin-top:24px">
        <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#ef4444">⚠ Health Alerts</h2>
        ${data.alerts.map(alertRow).join("")}
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

    <!-- Header -->
    <div style="background:#0f0f0f;padding:28px 32px">
      <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px">Email Warmup System</div>
      <div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:4px">Daily Warmup Report</div>
      <div style="font-size:13px;color:#9ca3af">${dateFormatted}</div>
    </div>

    <div style="padding:24px 32px">

      <!-- Stats row -->
      <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:24px">
        <tr>
          ${statBox("Total Sent", data.total_sent, "#111")}
          ${statBox("Replies", data.total_received, "#22c55e")}
          ${statBox("Active Accounts", data.active_accounts, "#6366f1")}
          ${statBox("On Track", `${data.accounts_on_track}/${data.active_accounts}`, data.accounts_on_track === data.active_accounts ? "#22c55e" : "#f59e0b")}
        </tr>
      </table>

      <!-- Account status -->
      <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111">Account Status</h2>
      ${accountsSection}

      <!-- Conversations -->
      <h2 style="margin:24px 0 12px;font-size:15px;font-weight:700;color:#111">Conversation Activity</h2>
      ${convsSection}

      <!-- Alerts -->
      ${alertsSection}

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center">
      <div style="font-size:11px;color:#9ca3af">Email Warmup System · ${data.date}</div>
      <div style="font-size:11px;color:#d1d5db;margin-top:4px">This is an automated report from your Email Warmup System.</div>
    </div>

  </div>
</body>
</html>`;
}

export function buildSummaryData(): SummaryData {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split("T")[0];

  const sentRows = db
    .query<{ from_email: string; to_email: string; replied: number }, []>(
      `SELECT from_email, to_email, replied FROM warmup_log WHERE DATE(sent_at) = '${yStr}'`
    )
    .all();

  const totalSent = sentRows.length;
  const totalReceived = sentRows.filter((r) => r.replied === 1).length;

  const sentByEmail: Record<string, number> = {};
  for (const r of sentRows) {
    sentByEmail[r.from_email] = (sentByEmail[r.from_email] ?? 0) + 1;
  }

  const warmupAccounts = db
    .query<{
      id: number; email: string; warmup_started_at: string | null;
      health_score: number; consecutive_failures: number;
    }, []>(
      "SELECT id, email, warmup_started_at, health_score, consecutive_failures FROM warmup_accounts WHERE active = 1"
    )
    .all();

  const accounts: AccountStatus[] = warmupAccounts.map((acct) => {
    const weekNum = acct.warmup_started_at
      ? Math.min(4, Math.floor((Date.now() - new Date(acct.warmup_started_at).getTime()) / (7 * 86_400_000)) + 1)
      : 0;
    const plan = db
      .query<{ emails_per_day: number }, [number, number]>(
        "SELECT emails_per_day FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ? AND active = 1"
      )
      .get(acct.id, Math.max(1, weekNum));
    const target = plan?.emails_per_day ?? (weekNum <= 1 ? 5 : weekNum === 2 ? 10 : 20);
    const sent = sentByEmail[acct.email] ?? 0;

    return {
      email: acct.email,
      current_week: weekNum,
      daily_target: target,
      sent_yesterday: sent,
      health_score: acct.health_score ?? 0,
      consecutive_failures: acct.consecutive_failures ?? 0,
      on_track: sent >= target,
      below_target: sent > 0 && sent < target,
      no_activity: sent === 0,
    };
  });

  const conversations: ConversationActivity[] = db
    .query<{ filename: string; topic: string | null; source: string | null; email_count: number }, []>(
      `SELECT filename, topic, source, email_count FROM conversation_files WHERE DATE(uploaded_at) = '${yStr}'`
    )
    .all();

  const alerts: HealthAlert[] = [];
  for (const acct of accounts) {
    if (acct.consecutive_failures > 0) {
      alerts.push({ type: "auth_failure", email: acct.email, detail: `${acct.consecutive_failures} consecutive auth failure${acct.consecutive_failures > 1 ? "s" : ""}` });
    }
    if (acct.no_activity) {
      alerts.push({ type: "no_activity", email: acct.email, detail: "Sent 0 warmup emails yesterday" });
    }
    if (acct.health_score < 40) {
      alerts.push({ type: "low_health", email: acct.email, detail: `Health score is ${acct.health_score}/100` });
    }
  }

  return {
    date: yStr,
    total_sent: totalSent,
    total_received: totalReceived,
    active_accounts: warmupAccounts.length,
    accounts_on_track: accounts.filter((a) => a.on_track).length,
    accounts,
    conversations,
    alerts,
  };
}

export async function sendWarmupSummaryEmail(): Promise<{ success: boolean; message: string }> {
  const data = buildSummaryData();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const html = buildWarmupSummaryHTML(data);

  // Get notification email
  const notifRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'notification_email'")
    .get();
  const notifEmail = notifRow?.value?.trim() ?? "";
  if (!notifEmail) {
    console.warn("[emailReports] no notification_email set — skipping summary send");
    return { success: false, message: "No notification email configured. Set it in Settings." };
  }

  // Get first active sending account for SMTP
  const sender = db
    .query<{ email: string; app_password: string }, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
    )
    .get();
  if (!sender) {
    console.warn("[emailReports] no active sending account found");
    return { success: false, message: "No active sending account available for SMTP." };
  }

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: sender.email, pass: sender.app_password },
  });

  const systemNameRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'")
    .get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";

  const subject = `Warmup Report — ${yesterday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  try {
    await transport.sendMail({
      from: `"${systemName}" <${sender.email}>`,
      to: notifEmail,
      subject,
      html,
    });
    console.log(`[emailReports] summary sent to ${notifEmail}`);
    return { success: true, message: `Summary email sent to ${notifEmail}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[emailReports] failed to send summary:", msg);
    logWarning("system", `Failed to send warmup summary email: ${msg}`).catch(() => {});
    return { success: false, message: `Send failed: ${msg}` };
  }
}

export async function sendClientProgressEmail(_campaignId: number): Promise<{ success: boolean; message: string }> {
  return { success: false, message: "Not implemented" };
}

// ── Failure Alert ─────────────────────────────────────────────────────────────

interface FailureAlertData {
  account_email: string;
  failure_count: number;
  last_failure_at: string;
  error_message: string;
  suggested_fix?: string;
}

export function buildFailureAlertHTML(data: FailureAlertData): string {
  const dashRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'dashboard_url'")
    .get();
  const dashUrl = dashRow?.value?.trim() || "http://localhost:3000";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)">

    <!-- Header -->
    <div style="background:#7f1d1d;padding:28px 32px">
      <div style="font-size:10px;font-weight:700;color:#fca5a5;text-transform:uppercase;letter-spacing:.14em;margin-bottom:6px">Warmup Alert</div>
      <div style="font-size:20px;font-weight:800;color:#fff;line-height:1.2">Authentication Failure Detected</div>
    </div>

    <div style="padding:24px 32px">

      <!-- Alert box -->
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:20px 24px;margin-bottom:24px">
        <div style="font-size:17px;font-weight:800;color:#991b1b;font-family:monospace;margin-bottom:12px">${data.account_email}</div>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:4px 0;font-size:12px;font-weight:700;color:#9ca3af;width:160px">Consecutive Failures</td>
            <td style="padding:4px 0;font-size:13px;font-weight:700;color:#dc2626">${data.failure_count} consecutive failure${data.failure_count !== 1 ? "s" : ""}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:12px;font-weight:700;color:#9ca3af">Last Failed At</td>
            <td style="padding:4px 0;font-size:13px;color:#374151">${new Date(data.last_failure_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
          </tr>
        </table>
        <div style="margin-top:12px">
          <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Error</div>
          <div style="background:#fff1f2;border:1px solid #fecaca;border-radius:4px;padding:8px 12px;font-family:monospace;font-size:12px;color:#b91c1c;word-break:break-all">${data.error_message}</div>
        </div>
      </div>

      <!-- What this means -->
      <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111">What This Means</h2>
      <p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6">Warmup emails are <strong style="color:#374151">not being sent</strong> from this account. Every skipped day slows down domain reputation building and may leave gaps in your warmup schedule that Gmail can detect.</p>

      <!-- How to fix -->
      <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111">How To Fix</h2>
      <ol style="margin:0 0 24px;padding-left:20px;font-size:13px;color:#374151;line-height:2">
        <li>Go to <strong>myaccount.google.com</strong></li>
        <li>Click <strong>Security</strong> → <strong>App Passwords</strong></li>
        <li>Delete the existing <em>email-system</em> password</li>
        <li>Create a new one and copy the 16-character code</li>
        <li>Go to <strong>Warmup Accounts</strong> in your dashboard</li>
        <li>Delete and re-add this account with the new password</li>
      </ol>

      <!-- Quick action -->
      <div style="text-align:center;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
        <a href="${dashUrl}" style="display:inline-block;background:#dc2626;color:#fff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none">Fix This Account Now</a>
        <div style="margin-top:10px;font-size:11px;color:#9ca3af">${dashUrl}</div>
      </div>

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;text-align:center">
      <div style="font-size:11px;color:#9ca3af">Email Warmup System · ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
    </div>

  </div>
</body>
</html>`;
}

export async function sendFailureAlert(account: {
  email: string;
  consecutive_failures: number;
  last_failure_at?: string;
  error_message?: string;
}): Promise<void> {
  const notifRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'notification_email'")
    .get();
  const notifEmail = notifRow?.value?.trim() ?? "";
  if (!notifEmail) {
    console.warn("[emailReports] sendFailureAlert: no notification_email set — skipping");
    return;
  }

  // Rate limiting: max one alert per account per 6 hours
  const rateLimitKey = `alert_sent_${account.email}`;
  const lastSentRow = db
    .query<{ value: string }, []>(`SELECT value FROM system_settings WHERE key = '${rateLimitKey}'`)
    .get();
  if (lastSentRow?.value) {
    const lastSentMs = parseInt(lastSentRow.value, 10);
    if (!isNaN(lastSentMs) && Date.now() - lastSentMs < 6 * 60 * 60 * 1000) {
      console.log(`[emailReports] sendFailureAlert: rate-limited for ${account.email} (last sent <6h ago)`);
      return;
    }
  }

  const sender = db
    .query<{ email: string; app_password: string }, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
    )
    .get();
  if (!sender) {
    console.warn("[emailReports] sendFailureAlert: no active sending account");
    return;
  }

  const html = buildFailureAlertHTML({
    account_email: account.email,
    failure_count: account.consecutive_failures,
    last_failure_at: account.last_failure_at ?? new Date().toISOString(),
    error_message: account.error_message ?? "Authentication failed",
  });

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: sender.email, pass: sender.app_password },
  });

  const alertNameRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'")
    .get();
  const alertSenderName = alertNameRow?.value?.trim() || "GTM Alert System";

  try {
    await transport.sendMail({
      from: `"${alertSenderName}" <${sender.email}>`,
      to: notifEmail,
      subject: `WARMUP ALERT — Authentication Failure — ${account.email}`,
      html,
    });
    // Record send time for rate limiting
    db.run(
      `INSERT INTO system_settings (key, value) VALUES ('${rateLimitKey}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(Date.now())]
    );
    console.log(`[emailReports] failure alert sent to ${notifEmail} for ${account.email}`);
  } catch (err) {
    console.error("[emailReports] sendFailureAlert send failed:", err instanceof Error ? err.message : err);
  }
}

// ── Warmup Complete Notification ──────────────────────────────────────────────

interface WarmupCompleteData {
  account_email: string;
  days_active: number;
  emails_sent_total: number;
  emails_received_total: number;
  reply_rate: number;
  health_score: number;
  health_grade: string;
  readiness_score: number;
  completed_at: string;
}

export function buildWarmupCompleteHTML(data: WarmupCompleteData): string {
  const dashRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'dashboard_url'")
    .get();
  const dashUrl = dashRow?.value?.trim() || "http://localhost:3000";

  const systemNameRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'")
    .get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";

  const hsColor = data.health_score >= 70 ? "#16a34a" : data.health_score >= 50 ? "#d97706" : "#dc2626";
  const hsBg    = data.health_score >= 70 ? "#f0fdf4" : data.health_score >= 50 ? "#fffbeb" : "#fef2f2";
  const hsBorder = data.health_score >= 70 ? "#4ade80" : data.health_score >= 50 ? "#fbbf24" : "#fca5a5";

  const statBox = (label: string, value: string, color = "#111", bg = "#f9fafb", border = "#e5e7eb") =>
    `<td style="padding:14px 8px;text-align:center;background:${bg};border-radius:8px;border:1px solid ${border}">
      <div style="font-size:22px;font-weight:800;color:${color};line-height:1">${value}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:.04em">${label}</div>
    </td>`;

  const completedFormatted = new Date(data.completed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

    <!-- Header -->
    <div style="background:#052e16;padding:32px 32px 24px">
      <div style="font-size:36px;line-height:1;margin-bottom:10px">✅</div>
      <div style="font-size:10px;font-weight:700;color:#4ade80;text-transform:uppercase;letter-spacing:.14em;margin-bottom:6px">Warmup Complete</div>
      <div style="font-size:20px;font-weight:800;color:#fff;line-height:1.2">Account Ready for Campaigns</div>
    </div>

    <div style="padding:24px 32px">

      <!-- Congratulations banner -->
      <div style="background:#f0fdf4;border:1px solid #4ade80;border-radius:8px;padding:20px 24px;margin-bottom:24px;text-align:center">
        <div style="font-size:17px;font-weight:800;color:#15803d;font-family:monospace;margin-bottom:10px">${data.account_email}</div>
        <div style="font-size:13px;color:#166534;line-height:1.6">This account has completed the 14-day warmup journey and is ready to send real cold email campaigns.</div>
      </div>

      <!-- Stats grid -->
      <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111">Stats Summary</h2>
      <table style="width:100%;border-collapse:separate;border-spacing:6px;margin-bottom:24px">
        <tr>
          ${statBox("Days Active",    String(data.days_active))}
          ${statBox("Total Sent",     String(data.emails_sent_total))}
          ${statBox("Total Received", String(data.emails_received_total))}
        </tr>
        <tr>
          ${statBox("Reply Rate",      data.reply_rate.toFixed(1) + "%")}
          ${statBox("Health Score",    `${data.health_score} ${data.health_grade}`, hsColor, hsBg, hsBorder)}
          ${statBox("Readiness Score", `${data.readiness_score}/100`)}
        </tr>
      </table>

      <!-- What this means -->
      <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111">What This Means</h2>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:13px;color:#374151;line-height:2">
        <li>Your domain reputation is established with email providers</li>
        <li>Cold emails sent from this account are more likely to land in inbox</li>
        <li>You can now start sending 20–30 emails per day from this account</li>
      </ul>

      <!-- Recommended next steps -->
      <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111">Recommended Next Steps</h2>
      <ol style="margin:0 0 24px;padding-left:20px;font-size:13px;color:#374151;line-height:2.1">
        <li>Verify DNS records are set up correctly (SPF, DKIM, DMARC)</li>
        <li>Import your lead list from Apollo</li>
        <li>Create your email sequence in the Campaign section</li>
        <li>Set daily limit to <strong>20 emails per day</strong> to start</li>
        <li>Monitor bounce rate and reply rate closely for the first week</li>
      </ol>

      <!-- Quick action buttons -->
      <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:24px;text-align:center">
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:14px">
          <a href="${dashUrl}/campaigns" style="display:inline-block;background:#16a34a;color:#fff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none">Launch Campaign</a>
          <a href="${dashUrl}/warmup-readiness" style="display:inline-block;background:#4f46e5;color:#fff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none">View Readiness Report</a>
        </div>
        <div style="font-size:11px;color:#9ca3af">${dashUrl}/campaigns &nbsp;·&nbsp; ${dashUrl}/warmup-readiness</div>
      </div>

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;text-align:center">
      <div style="font-size:11px;color:#9ca3af">${systemName} · Completed ${completedFormatted}</div>
      <div style="font-size:11px;color:#d1d5db;margin-top:3px">This is an automated notification. Warmup continues in the background.</div>
    </div>

  </div>
</body>
</html>`;
}

export async function sendWarmupCompleteNotification(account: {
  email: string;
  days_active: number;
  emails_sent_total: number;
  health_score: number;
  health_grade: string;
}): Promise<{ success: boolean; message: string }> {
  const notifRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'notification_email'")
    .get();
  const notifEmail = notifRow?.value?.trim() ?? "";
  if (!notifEmail) {
    console.log(`[emailReports] sendWarmupCompleteNotification: no notification_email — skipping for ${account.email}`);
    return { success: false, message: "No notification email configured" };
  }

  // Dedup guard — only send once per account
  const sentKey = `warmup_complete_sent_${account.email}`;
  const alreadySent = db
    .query<{ value: string }, []>(`SELECT value FROM system_settings WHERE key = '${sentKey}'`)
    .get();
  if (alreadySent?.value) {
    console.log(`[emailReports] sendWarmupCompleteNotification: already sent for ${account.email}`);
    return { success: false, message: "Notification already sent for this account" };
  }

  const sender = db
    .query<{ email: string; app_password: string }, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
    )
    .get();
  if (!sender) {
    console.warn("[emailReports] sendWarmupCompleteNotification: no active sending account");
    return { success: false, message: "No active sending account available" };
  }

  // Calculate reply rate from warmup_log
  const totalSentRow = db
    .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ?")
    .get(account.email);
  const totalSent = totalSentRow?.count ?? 0;
  const repliedRow = db
    .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND replied = 1")
    .get(account.email);
  const repliedCount = repliedRow?.count ?? 0;
  const replyRate = totalSent > 0 ? (repliedCount / totalSent) * 100 : 0;

  const totalReceivedRow = db
    .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM warmup_log WHERE to_email = ?")
    .get(account.email);
  const totalReceived = totalReceivedRow?.count ?? 0;

  // Get readiness score from system_settings cache or default
  const acctRow = db
    .query<{ id: number }, [string]>("SELECT id FROM warmup_accounts WHERE email = ?")
    .get(account.email);
  let readinessScore = 0;
  if (acctRow) {
    // Use last known health score as proxy for readiness if no readiness cache available
    readinessScore = Math.min(100, account.health_score);
  }

  const systemNameRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'")
    .get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";

  const html = buildWarmupCompleteHTML({
    account_email: account.email,
    days_active: account.days_active,
    emails_sent_total: account.emails_sent_total,
    emails_received_total: totalReceived,
    reply_rate: replyRate,
    health_score: account.health_score,
    health_grade: account.health_grade,
    readiness_score: readinessScore,
    completed_at: new Date().toISOString(),
  });

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: sender.email, pass: sender.app_password },
  });

  try {
    await transport.sendMail({
      from: `"${systemName}" <${sender.email}>`,
      to: notifEmail,
      subject: `Warmup Complete — ${account.email} is Ready to Launch`,
      html,
    });
    db.run(
      `INSERT INTO system_settings (key, value) VALUES ('${sentKey}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [new Date().toISOString()]
    );
    console.log(`[emailReports] warmup complete notification sent to ${notifEmail} for ${account.email}`);
    return { success: true, message: `Warmup complete notification sent to ${notifEmail}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[emailReports] sendWarmupCompleteNotification failed:", msg);
    return { success: false, message: `Send failed: ${msg}` };
  }
}

export async function sendBounceRateAlert(
  campaign_name: string,
  account_email: string,
  bounce_rate: number,
  bounced_count: number,
  total_sent: number
): Promise<{ success: boolean; message: string }> {
  // Stub — will be wired into campaign system when bounce detection is built
  void campaign_name; void account_email; void bounce_rate; void bounced_count; void total_sent;
  return { success: false, message: "Not implemented" };
}

// ── Reply Notification ────────────────────────────────────────────────────────

interface ReplyNotificationData {
  lead_first_name: string;
  lead_last_name: string;
  lead_email: string;
  lead_company: string;
  campaign_name: string;
  step_number: number;
  reply_preview: string;
  replied_at: string;
  hubspot_url: string;
  dashboard_url: string;
  system_name: string;
}

export function buildReplyNotificationHTML(data: ReplyNotificationData): string {
  const preview = data.reply_preview.slice(0, 300);
  const isTruncated = data.reply_preview.length > 300;

  const repliedAtPKT = new Date(
    new Date(data.replied_at).getTime() + 5 * 60 * 60 * 1000
  ).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) + " PKT";

  const stepLabel = `Step ${data.step_number} — ${data.step_number === 1 ? "Initial Email" : data.step_number === 2 ? "First Follow-up" : data.step_number === 3 ? "Second Follow-up" : `Follow-up ${data.step_number - 1}`}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

    <!-- Header -->
    <div style="background:#1e1b4b;padding:28px 32px">
      <div style="font-size:32px;margin-bottom:8px">💬</div>
      <div style="font-size:10px;font-weight:700;color:#a5b4fc;text-transform:uppercase;letter-spacing:.14em;margin-bottom:6px">NEW REPLY</div>
      <div style="font-size:20px;font-weight:800;color:#fff;line-height:1.2">Someone responded to your campaign</div>
    </div>

    <div style="padding:24px 32px">

      <!-- Lead alert box -->
      <div style="background:#eef2ff;border:1px solid #818cf8;border-radius:8px;padding:20px 24px;margin-bottom:24px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:18px;font-weight:800;color:#1e1b4b;margin-bottom:4px">${data.lead_first_name} ${data.lead_last_name}</div>
          <div style="font-size:13px;color:#4338ca;font-weight:600">${data.lead_company || "—"}</div>
          <div style="font-size:12px;color:#6366f1;margin-top:2px;font-family:monospace">${data.lead_email}</div>
        </div>
        <span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:700;background:#052e16;color:#22c55e;white-space:nowrap;flex-shrink:0">Replied</span>
      </div>

      <!-- Reply Preview -->
      <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111">Their Reply</h2>
      <div style="border-left:4px solid #6366f1;background:#f5f3ff;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:${isTruncated ? "8px" : "24px"}">
        <div style="font-size:13px;color:#374151;font-style:italic;line-height:1.7">${preview.replace(/\n/g, "<br>")}${isTruncated ? "…" : ""}</div>
      </div>
      ${isTruncated ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:24px">Preview limited to 300 characters. View the full reply in HubSpot.</div>` : ""}

      <!-- Campaign Context -->
      <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111">Campaign Context</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:8px 0;font-size:12px;font-weight:700;color:#9ca3af;width:150px">Campaign Name</td>
          <td style="padding:8px 0;font-size:13px;color:#374151">${data.campaign_name}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:8px 0;font-size:12px;font-weight:700;color:#9ca3af">Sequence Step</td>
          <td style="padding:8px 0;font-size:13px;color:#374151">${stepLabel}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:12px;font-weight:700;color:#9ca3af">Time of Reply</td>
          <td style="padding:8px 0;font-size:13px;color:#374151">${repliedAtPKT}</td>
        </tr>
      </table>

      <!-- Action Buttons -->
      <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin-bottom:24px;text-align:center">
        <div style="margin-bottom:12px;font-size:13px;font-weight:600;color:#374151">Respond quickly for best results</div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a href="${data.hubspot_url}" style="display:inline-block;background:#f97316;color:#fff;font-size:13px;font-weight:700;padding:11px 22px;border-radius:6px;text-decoration:none">View in HubSpot</a>
          <a href="${data.dashboard_url}/leads" style="display:inline-block;background:#4f46e5;color:#fff;font-size:13px;font-weight:700;padding:11px 22px;border-radius:6px;text-decoration:none">View Lead Details</a>
        </div>
      </div>

      <!-- Quick Response Tips -->
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px">
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Quick Response Tips</div>
        <ul style="margin:0;padding-left:18px;font-size:12px;color:#6b7280;line-height:2">
          <li>Reply within 1 hour for best conversion rates</li>
          <li>Reference something specific from their message</li>
          <li>Suggest a specific time for a call rather than asking when they're free</li>
        </ul>
      </div>

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;text-align:center">
      <div style="font-size:11px;color:#9ca3af">${data.system_name} · ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
    </div>

  </div>
</body>
</html>`;
}

export async function sendReplyNotification(
  lead: { id: number; first_name: string; last_name: string; email: string; company: string; campaign_id: number | null },
  reply_preview: string
): Promise<void> {
  // Check if reply notifications are enabled
  const enabledRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'reply_notifications_enabled'")
    .get();
  if (enabledRow?.value === "0") return;

  const notifRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'notification_email'")
    .get();
  const notifEmail = notifRow?.value?.trim() ?? "";
  if (!notifEmail) {
    logWarning("system", `sendReplyNotification: no notification_email configured`).catch(() => {});
    return;
  }

  // Rate limit: once per hour per lead email
  const rlKey = `reply_notif_sent_${lead.email}`;
  const lastRow = db.query<{ value: string }, [string]>("SELECT value FROM system_settings WHERE key = ?").get(rlKey);
  if (lastRow?.value) {
    const lastMs = parseInt(lastRow.value, 10);
    if (!isNaN(lastMs) && Date.now() - lastMs < 60 * 60 * 1000) return;
  }

  // Get campaign name
  let campaignName = "Unknown Campaign";
  if (lead.campaign_id) {
    const campRow = db.query<{ name: string }, [number]>("SELECT name FROM campaigns WHERE id = ?").get(lead.campaign_id);
    if (campRow) campaignName = campRow.name;
  }

  // Get step number from sent_log (most recent step for this lead)
  const stepRow = db
    .query<{ step_number: number }, [number]>(
      "SELECT step_number FROM sent_log WHERE lead_id = ? ORDER BY sent_at DESC LIMIT 1"
    )
    .get(lead.id);
  const stepNumber = stepRow?.step_number ?? 1;

  // Get sending account for SMTP
  const sender = db
    .query<{ email: string; app_password: string }, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
    )
    .get();
  if (!sender) return;

  const systemNameRow = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'").get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";

  const dashRow = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'dashboard_url'").get();
  const dashUrl = dashRow?.value?.trim() || "http://localhost:3000";

  // Build HubSpot URL
  let hubspotUrl = "https://app.hubspot.com/contacts";
  const hubspotToken = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'hubspot_token'")
    .get()?.value || process.env.HUBSPOT_TOKEN;

  if (hubspotToken) {
    try {
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${hubspotToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: lead.email }] }],
          properties: ["email"],
          limit: 1,
        }),
      });
      if (searchRes.ok) {
        const data = await searchRes.json() as { results?: { id: string }[] };
        const contactId = data.results?.[0]?.id;
        if (contactId) {
          // Get portal ID
          const ownerRes = await fetch("https://api.hubapi.com/oauth/v1/access-tokens/x", {
            headers: { Authorization: `Bearer ${hubspotToken}` },
          }).catch(() => null);
          // Fallback: build URL with contact ID even without portal ID
          hubspotUrl = `https://app.hubspot.com/contacts/${contactId}`;
        }
      }
    } catch {
      // fallback stays as contacts page
    }
  }

  const html = buildReplyNotificationHTML({
    lead_first_name: lead.first_name,
    lead_last_name: lead.last_name,
    lead_email: lead.email,
    lead_company: lead.company,
    campaign_name: campaignName,
    step_number: stepNumber,
    reply_preview,
    replied_at: new Date().toISOString(),
    hubspot_url: hubspotUrl,
    dashboard_url: dashUrl,
    system_name: systemName,
  });

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
      subject: `New Reply from ${lead.first_name} at ${lead.company} — Campaign: ${campaignName}`,
      html,
    });
    db.run(
      "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [rlKey, String(Date.now())]
    );
    console.log(`[emailReports] reply notification sent to ${notifEmail} for lead ${lead.email}`);
  } catch (err) {
    console.error("[emailReports] sendReplyNotification failed:", err instanceof Error ? err.message : err);
  }
}

// ── Client Progress Report ────────────────────────────────────────────────────

interface ClientProgressData {
  client_name: string;
  campaign_name: string;
  report_date: string;
  emails_sent_yesterday: number;
  emails_sent_total: number;
  open_rate: number;
  reply_rate: number;
  new_replies_yesterday: Array<{ name: string; company: string }>;
  leads_remaining: number;
  leads_active: number;
  leads_finished: number;
  leads_replied: number;
  leads_bounced: number;
  top_performing_subject: { subject: string; open_rate: number } | null;
  days_running: number;
  next_steps: string[];
}

export function buildClientProgressHTML(data: ClientProgressData): string {
  const systemNameRow = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'").get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";

  const dateFormatted = new Date(data.report_date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const goodNewsSection = data.new_replies_yesterday.length > 0 ? `
    <div style="background:#052e16;border-radius:8px;padding:24px 28px;margin-bottom:24px">
      <div style="font-size:22px;margin-bottom:8px">✅</div>
      <div style="font-size:16px;font-weight:800;color:#4ade80;margin-bottom:12px">You got new replies today!</div>
      ${data.new_replies_yesterday.map(r => `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="color:#4ade80;font-size:14px">▸</span>
          <span style="font-size:14px;color:#d1fae5"><strong style="color:#fff">${r.name}</strong> from <strong style="color:#fff">${r.company || "Unknown Company"}</strong> replied to your email</span>
        </div>`).join("")}
    </div>` : "";

  const totalLeads = data.leads_active + data.leads_finished + data.leads_replied + data.leads_bounced;
  const activeWidth  = totalLeads > 0 ? Math.round((data.leads_active   / totalLeads) * 100) : 0;
  const repliedWidth = totalLeads > 0 ? Math.round((data.leads_replied  / totalLeads) * 100) : 0;
  const finishedWidth = totalLeads > 0 ? Math.round((data.leads_finished / totalLeads) * 100) : 0;
  const bouncedWidth = totalLeads > 0 ? Math.round((data.leads_bounced  / totalLeads) * 100) : 0;

  const progressBar = (pct: number, color: string, label: string, count: number, desc: string) => `
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-size:12px;font-weight:700;color:#374151">${label}</span>
        <span style="font-size:13px;font-weight:700;color:#111">${count} <span style="font-size:11px;font-weight:400;color:#9ca3af">${desc}</span></span>
      </div>
      <div style="background:#f3f4f6;border-radius:999px;height:10px;overflow:hidden">
        <div style="width:${Math.max(2, pct)}%;height:10px;background:${color};border-radius:999px"></div>
      </div>
    </div>`;

  let plainEnglish = "";
  if (data.reply_rate >= 5) {
    plainEnglish += "Your campaign is performing well. People are engaging with your emails. ";
  } else if (data.reply_rate < 2) {
    plainEnglish += "Your emails are being delivered but response rate is low. This is normal for cold outreach. ";
  }
  if (data.new_replies_yesterday.length > 0) {
    plainEnglish += `You received ${data.new_replies_yesterday.length} new ${data.new_replies_yesterday.length === 1 ? "reply" : "replies"} yesterday, which ${data.new_replies_yesterday.length === 1 ? "means a potential new client" : "means potential new clients"}. `;
  }
  if (data.days_running < 7) {
    plainEnglish += "Your campaign is still in the early stages. Results typically improve after the first week.";
  } else {
    plainEnglish += `After ${data.days_running} days of running, your outreach is building momentum.`;
  }

  const topSubjectSection = data.top_performing_subject ? `
    <div style="background:#f0f9ff;border:1px solid #7dd3fc;border-radius:8px;padding:18px 22px;margin-bottom:24px">
      <div style="font-size:12px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Best Performing Email</div>
      <div style="font-size:14px;color:#374151">Your best-performing email subject line is:</div>
      <div style="font-size:15px;font-weight:700;color:#0c4a6e;margin-top:8px;font-style:italic">"${data.top_performing_subject.subject}"</div>
      ${data.top_performing_subject.open_rate > 0 ? `<div style="font-size:12px;color:#0369a1;margin-top:6px">${data.top_performing_subject.open_rate.toFixed(1)}% of recipients opened this email</div>` : ""}
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

    <!-- Header -->
    <div style="background:#0f0f0f;padding:28px 32px">
      <div style="font-size:11px;font-weight:600;color:#6b7280;margin-bottom:6px">${data.client_name}</div>
      <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">Campaign Update</div>
      <div style="font-size:13px;color:#9ca3af">${dateFormatted} · ${data.campaign_name}</div>
    </div>

    <div style="padding:24px 32px">

      ${goodNewsSection}

      <!-- Yesterday at a glance -->
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Yesterday at a Glance</div>
      <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:24px">
        <tr>
          <td style="padding:16px;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
            <div style="font-size:28px;font-weight:800;color:#111;line-height:1">${data.emails_sent_yesterday}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:5px">new people contacted yesterday</div>
          </td>
          <td style="padding:16px;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
            <div style="font-size:28px;font-weight:800;color:#0369a1;line-height:1">${data.open_rate.toFixed(1)}%</div>
            <div style="font-size:11px;color:#6b7280;margin-top:5px">of recipients opened your email</div>
          </td>
          <td style="padding:16px;text-align:center;background:${data.new_replies_yesterday.length > 0 ? "#052e16" : "#f9fafb"};border:1px solid ${data.new_replies_yesterday.length > 0 ? "#166534" : "#e5e7eb"};border-radius:8px">
            <div style="font-size:28px;font-weight:800;color:${data.new_replies_yesterday.length > 0 ? "#4ade80" : "#111"};line-height:1">${data.new_replies_yesterday.length}</div>
            <div style="font-size:11px;color:${data.new_replies_yesterday.length > 0 ? "#86efac" : "#6b7280"};margin-top:5px">new interested prospects</div>
          </td>
        </tr>
      </table>

      <!-- Campaign Progress -->
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px">Campaign Progress</div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:24px">
        ${progressBar(activeWidth, "#6366f1", "Still to contact", data.leads_active, "people remaining")}
        ${progressBar(repliedWidth, "#22c55e", "Showed interest", data.leads_replied, "people replied")}
        ${progressBar(finishedWidth, "#9ca3af", "Received all emails", data.leads_finished, "completed sequence")}
        ${data.leads_bounced > 0 ? progressBar(bouncedWidth, "#ef4444", "Invalid emails found", data.leads_bounced, "bounced") : ""}
        <div style="margin-top:10px;font-size:12px;color:#9ca3af;text-align:right">${data.emails_sent_total} total emails sent across ${totalLeads} contacts</div>
      </div>

      <!-- What is happening -->
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">What's Happening</div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin-bottom:24px">
        <p style="margin:0;font-size:14px;line-height:1.75;color:#374151">${plainEnglish}</p>
      </div>

      ${topSubjectSection}

      <!-- What happens next -->
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">What Happens Next</div>
      <ol style="margin:0 0 24px;padding-left:20px;font-size:14px;color:#374151;line-height:2.2">
        ${data.next_steps.map(s => `<li>${s}</li>`).join("")}
      </ol>

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center">
      <div style="font-size:11px;color:#9ca3af">${systemName} · Automated Campaign Report</div>
      <div style="font-size:11px;color:#d1d5db;margin-top:4px">Reply <strong>STOP</strong> to stop receiving these reports</div>
      <div style="font-size:10px;color:#e5e7eb;margin-top:2px">Powered by your GTM system</div>
    </div>

  </div>
</body>
</html>`;
}

export async function sendClientProgressReport(
  campaign_id: number,
  client_email: string
): Promise<{ success: boolean; message: string; stats?: Record<string, unknown> }> {
  const camp = db.query<{ id: number; name: string; created_at: string; daily_limit: number }, [number]>(
    "SELECT id, name, created_at, daily_limit FROM campaigns WHERE id = ?"
  ).get(campaign_id);
  if (!camp) return { success: false, message: `Campaign ${campaign_id} not found` };

  const configRow = db.query<{ client_name: string | null }, [number]>(
    "SELECT client_name FROM client_report_config WHERE campaign_id = ?"
  ).get(campaign_id);
  const clientName = configRow?.client_name || "Client";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split("T")[0];
  const todayStr = new Date().toISOString().split("T")[0];

  // Emails sent yesterday
  const sentYesterday = db.query<{ count: number }, [number, string]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND DATE(sent_at) = ? AND bounced = 0"
  ).get(campaign_id, yStr)?.count ?? 0;

  // Total emails sent
  const sentTotal = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND bounced = 0"
  ).get(campaign_id)?.count ?? 0;

  // Lead counts
  const leadCounts = db.query<{ status: string; count: number }, [number]>(
    "SELECT status, COUNT(*) as count FROM leads WHERE campaign_id = ? GROUP BY status"
  ).all(campaign_id);
  const countMap: Record<string, number> = {};
  for (const r of leadCounts) countMap[r.status] = r.count;
  const leadsActive    = countMap["active"]       ?? 0;
  const leadsFinished  = countMap["finished"]     ?? 0;
  const leadsReplied   = countMap["replied"]      ?? 0;
  const leadsBounced   = countMap["bounced"]      ?? 0;
  const leadsUnsub     = countMap["unsubscribed"] ?? 0;

  // Open rate (overall for campaign)
  const totalForRate = sentTotal + leadsBounced;
  const totalOpened = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND opened = 1"
  ).get(campaign_id)?.count ?? 0;
  const openRate = totalForRate > 0 ? (totalOpened / totalForRate) * 100 : 0;

  // Replies yesterday
  const repliesYesterday = db.query<{ first_name: string; last_name: string; company: string }, [number, string]>(
    `SELECT l.first_name, l.last_name, l.company
     FROM replies r
     JOIN leads l ON l.id = r.lead_id
     WHERE l.campaign_id = ? AND DATE(r.received_at) = ?`
  ).all(campaign_id, yStr);
  const newReplies = repliesYesterday.map(r => ({
    name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.company || "Unknown",
    company: r.company || "",
  }));

  // Reply rate
  const totalReplied = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM replies r JOIN leads l ON l.id = r.lead_id WHERE l.campaign_id = ?"
  ).get(campaign_id)?.count ?? 0;
  const replyRate = totalForRate > 0 ? (totalReplied / totalForRate) * 100 : 0;

  // Top performing subject
  const topSubjectRow = db.query<{ subject: string; sent: number; opened: number }, [number]>(
    `SELECT sl.subject, COUNT(*) as sent, SUM(sl.opened) as opened
     FROM sent_log sl
     WHERE sl.campaign_id = ?
     GROUP BY sl.subject
     ORDER BY (CAST(SUM(sl.opened) AS REAL) / COUNT(*)) DESC
     LIMIT 1`
  ).get(campaign_id);
  const topPerformingSubject = topSubjectRow && topSubjectRow.sent >= 3
    ? { subject: topSubjectRow.subject, open_rate: topSubjectRow.sent > 0 ? (topSubjectRow.opened / topSubjectRow.sent) * 100 : 0 }
    : null;

  // Days running
  const daysRunning = camp.created_at
    ? Math.floor((Date.now() - new Date(camp.created_at).getTime()) / 86_400_000)
    : 0;

  // Next steps
  const nextSteps: string[] = [];
  const activeLeadsWithSendDate = db.query<{ count: number }, [number, string]>(
    "SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND status = 'active' AND next_send_date = ?"
  ).get(campaign_id, todayStr)?.count ?? 0;
  if (activeLeadsWithSendDate > 0) nextSteps.push(`${activeLeadsWithSendDate} more ${activeLeadsWithSendDate === 1 ? "person" : "people"} will receive their next email today`);

  const followUpCount = db.query<{ count: number }, [number, string]>(
    "SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND status = 'active' AND current_step > 1 AND next_send_date <= ?"
  ).get(campaign_id, todayStr)?.count ?? 0;
  if (followUpCount > 0) nextSteps.push(`Following up with ${followUpCount} ${followUpCount === 1 ? "person" : "people"} who received previous emails`);
  nextSteps.push("Monitoring for new replies throughout the day");
  if (leadsActive > 0) nextSteps.push(`${leadsActive} ${leadsActive === 1 ? "person" : "people"} still in your pipeline to contact`);

  const html = buildClientProgressHTML({
    client_name: clientName,
    campaign_name: camp.name,
    report_date: todayStr,
    emails_sent_yesterday: sentYesterday,
    emails_sent_total: sentTotal,
    open_rate: openRate,
    reply_rate: replyRate,
    new_replies_yesterday: newReplies,
    leads_remaining: leadsActive,
    leads_active: leadsActive,
    leads_finished: leadsFinished,
    leads_replied: leadsReplied,
    leads_bounced: leadsBounced,
    top_performing_subject: topPerformingSubject,
    days_running: daysRunning,
    next_steps: nextSteps,
  });

  const sender = db.query<{ email: string; app_password: string }, []>(
    "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
  ).get();
  if (!sender) return { success: false, message: "No active sending account available" };

  const systemNameRow = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'").get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";

  const dateLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: sender.email, pass: sender.app_password },
    });
    await transport.sendMail({
      from: `"${systemName}" <${sender.email}>`,
      to: client_email,
      subject: `Your Campaign Update for ${dateLabel} — ${camp.name}`,
      html,
    });
    const sentKey = `client_report_sent_${campaign_id}`;
    db.run(
      "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [sentKey, new Date().toISOString()]
    );
    console.log(`[emailReports] client progress report sent to ${client_email} for campaign ${camp.name}`);
    return {
      success: true,
      message: `Report sent to ${client_email}`,
      stats: { sentYesterday, sentTotal, openRate: openRate.toFixed(1), replyRate: replyRate.toFixed(1), newReplies: newReplies.length },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[emailReports] sendClientProgressReport failed:", msg);
    return { success: false, message: `Send failed: ${msg}` };
  }
}

export async function sendWeeklyClientDigest(
  campaign_id: number,
  client_email: string
): Promise<{ success: boolean; message: string }> {
  // Only send on Mondays (0=Sun, 1=Mon)
  if (new Date().getDay() !== 1) {
    return { success: false, message: "Weekly digest only sends on Mondays" };
  }

  const camp = db.query<{ id: number; name: string }, [number]>(
    "SELECT id, name FROM campaigns WHERE id = ?"
  ).get(campaign_id);
  if (!camp) return { success: false, message: `Campaign ${campaign_id} not found` };

  const configRow = db.query<{ client_name: string | null }, [number]>(
    "SELECT client_name FROM client_report_config WHERE campaign_id = ?"
  ).get(campaign_id);
  const clientName = configRow?.client_name || "Client";

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 7);
  const weekStartStr = weekStart.toISOString().split("T")[0];
  const todayStr = today.toISOString().split("T")[0];

  const sentTotal = db.query<{ count: number }, [number, string]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND DATE(sent_at) >= ? AND bounced = 0"
  ).get(campaign_id, weekStartStr)?.count ?? 0;

  const totalOpened = db.query<{ count: number }, [number, string]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND DATE(sent_at) >= ? AND opened = 1"
  ).get(campaign_id, weekStartStr)?.count ?? 0;

  const openRate = sentTotal > 0 ? (totalOpened / sentTotal) * 100 : 0;

  const weekReplies = db.query<{ first_name: string; last_name: string; company: string; campaign_name: string }, [number, string]>(
    `SELECT l.first_name, l.last_name, l.company, c.name as campaign_name
     FROM replies r
     JOIN leads l ON l.id = r.lead_id
     JOIN campaigns c ON c.id = l.campaign_id
     WHERE l.campaign_id = ? AND DATE(r.received_at) >= ?`
  ).all(campaign_id, weekStartStr);

  const totalReplied = weekReplies.length;
  const replyRate = sentTotal > 0 ? (totalReplied / sentTotal) * 100 : 0;

  const newLeads = db.query<{ count: number }, [number, string]>(
    "SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND DATE(created_at) >= ?"
  ).get(campaign_id, weekStartStr)?.count ?? 0;

  const activeCamps = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'"
  ).get()?.count ?? 0;

  const html = buildWeeklyDigestHTML({
    week_start: weekStartStr,
    week_end: todayStr,
    total_sent: sentTotal,
    total_opened: totalOpened,
    open_rate: openRate,
    total_replied: totalReplied,
    reply_rate: replyRate,
    new_leads: newLeads,
    leads_replied: weekReplies.map(r => ({
      first_name: r.first_name || "",
      last_name: r.last_name || "",
      company: r.company || "",
      campaign_name: r.campaign_name,
    })),
    active_campaigns: activeCamps,
  });

  const sender = db.query<{ email: string; app_password: string }, []>(
    "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
  ).get();
  if (!sender) return { success: false, message: "No active sending account" };

  const systemNameRow = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'").get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";

  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: sender.email, pass: sender.app_password },
    });
    await transport.sendMail({
      from: `"${systemName}" <${sender.email}>`,
      to: client_email,
      subject: `Weekly Campaign Summary — ${weekLabel} — ${camp.name}`,
      html,
    });
    console.log(`[emailReports] weekly digest sent to ${client_email} for campaign ${camp.name}`);
    return { success: true, message: `Weekly digest sent to ${client_email}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Send failed: ${msg}` };
  }
}

// ── Weekly Digest (stub) ──────────────────────────────────────────────────────

interface WeeklyStats {
  week_start: string;
  week_end: string;
  total_sent: number;
  total_opened: number;
  open_rate: number;
  total_replied: number;
  reply_rate: number;
  new_leads: number;
  leads_replied: Array<{ first_name: string; last_name: string; company: string; campaign_name: string }>;
  active_campaigns: number;
}

export function buildWeeklyDigestHTML(stats: WeeklyStats): string {
  const systemNameRow = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'").get();
  const systemName = systemNameRow?.value?.trim() || "GTM Warmup System";
  const dashRow = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'dashboard_url'").get();
  const dashUrl = dashRow?.value?.trim() || "http://localhost:3000";

  const weekLabel = `${new Date(stats.week_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(stats.week_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const repliedRows = stats.leads_replied.slice(0, 10).map(l =>
    `<tr><td style="padding:7px 12px;font-size:13px;color:#374151">${l.first_name} ${l.last_name}</td><td style="padding:7px 12px;font-size:12px;color:#6b7280">${l.company}</td><td style="padding:7px 12px;font-size:12px;color:#6b7280">${l.campaign_name}</td></tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="background:#0f0f0f;padding:28px 32px">
      <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px">Weekly Digest</div>
      <div style="font-size:18px;font-weight:700;color:#fff">Week in Review</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:4px">${weekLabel}</div>
    </div>
    <div style="padding:24px 32px">
      <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:24px">
        <tr>
          <td style="padding:16px;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px"><div style="font-size:26px;font-weight:800;color:#111">${stats.total_sent}</div><div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase">Sent</div></td>
          <td style="padding:16px;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px"><div style="font-size:26px;font-weight:800;color:#22c55e">${stats.open_rate.toFixed(1)}%</div><div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase">Open Rate</div></td>
          <td style="padding:16px;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px"><div style="font-size:26px;font-weight:800;color:#6366f1">${stats.reply_rate.toFixed(1)}%</div><div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase">Reply Rate</div></td>
          <td style="padding:16px;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px"><div style="font-size:26px;font-weight:800;color:#111">${stats.new_leads}</div><div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase">New Leads</div></td>
        </tr>
      </table>
      ${stats.leads_replied.length ? `
      <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111">Leads Who Replied This Week</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <thead><tr style="background:#f9fafb"><th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">Name</th><th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">Company</th><th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">Campaign</th></tr></thead>
        <tbody>${repliedRows}</tbody>
      </table>` : ""}
      <div style="text-align:center;padding:20px">
        <a href="${dashUrl}" style="display:inline-block;background:#4f46e5;color:#fff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none">View Dashboard</a>
      </div>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;text-align:center">
      <div style="font-size:11px;color:#9ca3af">${systemName} · Weekly Digest</div>
    </div>
  </div>
</body>
</html>`;
}
