import nodemailer from "nodemailer";
import { db } from "../database";

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
    const weekColors: Record<number, string> = { 1: "#f59e0b", 2: "#818cf8", 3: "#22c55e", 4: "#4ade80" };
    const weekColor = weekColors[acct.current_week] ?? "#6b7280";
    const weekBadge = acct.current_week > 0
      ? `<span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;background:#1f1f1f;color:${weekColor};border:1px solid ${weekColor}40">Wk ${acct.current_week}</span>`
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

export async function sendWarmupSummaryEmail(): Promise<{ success: boolean; message: string }> {
  // Yesterday's date
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split("T")[0];

  // Query yesterday's warmup log
  const sentRows = db
    .query<{ from_email: string; to_email: string; replied: number }, []>(
      `SELECT from_email, to_email, replied FROM warmup_log WHERE DATE(sent_at) = '${yStr}'`
    )
    .all();

  const totalSent = sentRows.length;
  const totalReceived = sentRows.filter((r) => r.replied === 1).length;

  // Per-account sent counts
  const sentByEmail: Record<string, number> = {};
  for (const r of sentRows) {
    sentByEmail[r.from_email] = (sentByEmail[r.from_email] ?? 0) + 1;
  }

  // All active warmup accounts
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

  // Conversations processed yesterday
  const conversations: ConversationActivity[] = db
    .query<{ filename: string; topic: string | null; source: string | null; email_count: number }, []>(
      `SELECT filename, topic, source, email_count FROM conversation_files WHERE DATE(uploaded_at) = '${yStr}'`
    )
    .all();

  // Health alerts
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

  const data: SummaryData = {
    date: yStr,
    total_sent: totalSent,
    total_received: totalReceived,
    active_accounts: warmupAccounts.length,
    accounts_on_track: accounts.filter((a) => a.on_track).length,
    accounts,
    conversations,
    alerts,
  };

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

  const subject = `Warmup Report — ${yesterday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  try {
    await transport.sendMail({
      from: `"Email Warmup System" <${sender.email}>`,
      to: notifEmail,
      subject,
      html,
    });
    console.log(`[emailReports] summary sent to ${notifEmail}`);
    return { success: true, message: `Summary email sent to ${notifEmail}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[emailReports] failed to send summary:", msg);
    return { success: false, message: `Send failed: ${msg}` };
  }
}

export async function sendClientProgressEmail(_campaignId: number): Promise<{ success: boolean; message: string }> {
  return { success: false, message: "Not implemented" };
}
