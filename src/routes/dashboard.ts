import { Hono } from "hono";
import { db } from "../database";
import { getWarmupStats } from "../modules/warmup";
import { getSequenceStats } from "../modules/sequences";
import { testHubspotConnection } from "../modules/hubspot";
import { runAllNow } from "../scheduler";
import { runHealthCheck, getQuickStatus } from "../modules/healthCheck";
import { clearResolvedErrors, markResolved } from "../modules/logger";
import { createBackup, restoreBackup, listBackups, deleteBackup, getBackupStats, getBackupDir } from "../modules/backup";
import { checkAllDNS } from "../modules/dnsChecker";
import { getBounceStats, checkBounceRates } from "../modules/bounceMonitor";
import { sendReplyNotification, sendClientProgressReport, buildClientProgressHTML } from "../modules/emailReports";
import * as fs from "fs";
import * as path from "path";

// Per-process DNS result cache: domain → { result, ts }
const dnsCache = new Map<string, { result: Awaited<ReturnType<typeof checkAllDNS>>; ts: number }>();
const DNS_CACHE_TTL = 5 * 60 * 1000;

const app = new Hono();

function getCurrentClientId(): number | null {
  const row = db.query<{ value: string }, []>(
    "SELECT value FROM system_settings WHERE key = 'current_client_id'"
  ).get();
  return row ? Number(row.value) : null;
}

app.get("/stats", async (c) => {
  const clientId = getCurrentClientId();

  const [warmupStats, hubspotConnected] = await Promise.all([
    Promise.resolve(getWarmupStats()),
    testHubspotConnection(),
  ]);

  // All campaign IDs belonging to current client
  const campaignIds = clientId !== null
    ? db.query<{ id: number }, [number]>("SELECT id FROM campaigns WHERE client_id = ?").all(clientId).map(r => r.id)
    : null; // null = no filter = all clients
  const inClause = campaignIds !== null
    ? campaignIds.length > 0 ? `(${campaignIds.join(",")})` : "(NULL)"
    : null;

  const emailsSentToday = inClause !== null
    ? db.query<{ total: number }, []>(
        `SELECT SUM(emails_sent_today) AS total FROM accounts WHERE client_id = ?`
      ).get(clientId!)?.total ?? 0
    : db.query<{ total: number }, []>("SELECT SUM(emails_sent_today) AS total FROM accounts").get()?.total ?? 0;

  const activeCampaigns = inClause !== null
    ? db.query<{ count: number }, []>(
        `SELECT COUNT(*) AS count FROM campaigns WHERE status = 'active' AND client_id = ?`
      ).get(clientId!)?.count ?? 0
    : db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM campaigns WHERE status = 'active'").get()?.count ?? 0;

  const leadStatusRows = inClause !== null
    ? db.query<{ status: string; count: number }, []>(
        `SELECT status, COUNT(*) as count FROM leads WHERE campaign_id IN ${inClause} GROUP BY status`
      ).all()
    : db.query<{ status: string; count: number }, []>("SELECT status, COUNT(*) as count FROM leads GROUP BY status").all();
  const leadStats = Object.fromEntries(leadStatusRows.map((r) => [r.status, r.count]));

  const unpushedReplies = inClause !== null
    ? db.query<{ count: number }, []>(
        `SELECT COUNT(*) AS count FROM replies r
         JOIN leads l ON l.id = r.lead_id
         WHERE r.pushed_to_hubspot = 0 AND l.campaign_id IN ${inClause}`
      ).get()?.count ?? 0
    : db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM replies WHERE pushed_to_hubspot = 0").get()?.count ?? 0;

  return c.json({
    warmup_sent_today: warmupStats.sent_today,
    lead_stats: leadStats,
    emails_sent_today: emailsSentToday,
    active_campaigns: activeCampaigns,
    hubspot_connected: hubspotConnected,
    unpushed_replies: unpushedReplies,
  });
});

app.post("/settings/token", async (c) => {
  const body = await c.req.json<{ token: string }>();
  if (!body.token) return c.json({ error: "token is required" }, 400);
  process.env.HUBSPOT_TOKEN = body.token;
  return c.json({ success: true });
});

app.get("/settings/notification-email", (c) => {
  const row = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'notification_email'").get();
  return c.json({ email: row?.value ?? "" });
});

app.post("/settings/notification-email", async (c) => {
  const body = await c.req.json<{ email: string }>();
  const email = (body.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Invalid email address" }, 400);
  }
  db.run(
    "INSERT INTO system_settings (key, value) VALUES ('notification_email', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [email]
  );
  return c.json({ success: true, email });
});

app.get("/settings/send-warmup-summary", (c) => {
  const row = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'send_warmup_summary'").get();
  return c.json({ enabled: row?.value === "1" });
});

app.post("/settings/send-warmup-summary", async (c) => {
  const body = await c.req.json<{ enabled: boolean }>();
  const val = body.enabled ? "1" : "0";
  db.run(
    "INSERT INTO system_settings (key, value) VALUES ('send_warmup_summary', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [val]
  );
  return c.json({ success: true, enabled: body.enabled });
});

app.get("/settings/system-name", (c) => {
  const row = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'").get();
  return c.json({ name: row?.value ?? "GTM Warmup System" });
});

app.post("/settings/system-name", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = (body.name ?? "").trim();
  db.run(
    "INSERT INTO system_settings (key, value) VALUES ('system_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [name]
  );
  return c.json({ success: true, name });
});

app.get("/settings/dashboard-url", (c) => {
  const row = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'dashboard_url'").get();
  return c.json({ url: row?.value ?? "http://localhost:3000" });
});

app.get("/settings/reply-notifications", (c) => {
  const row = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'reply_notifications_enabled'").get();
  // Default to enabled (treat missing as enabled)
  const enabled = row ? row.value !== "0" : true;
  return c.json({ enabled });
});

app.post("/settings/reply-notifications", async (c) => {
  const body = await c.req.json<{ enabled: boolean }>();
  const val = body.enabled ? "1" : "0";
  db.run(
    "INSERT INTO system_settings (key, value) VALUES ('reply_notifications_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [val]
  );
  return c.json({ success: true, enabled: body.enabled });
});

app.post("/settings/test-reply-notification", async (c) => {
  const campRow = db.query<{ id: number; name: string }, []>("SELECT id, name FROM campaigns WHERE status = 'active' LIMIT 1").get();
  const fakeLead = {
    id: 0,
    first_name: "Test",
    last_name: "Lead",
    email: "test@example.com",
    company: "Acme Agency",
    campaign_id: campRow?.id ?? null,
  };
  // Clear rate limit key so test always sends
  db.run("DELETE FROM system_settings WHERE key = 'reply_notif_sent_test@example.com'");
  await sendReplyNotification(
    fakeLead,
    "This is a test reply to verify your notification system is working correctly."
  );
  return c.json({ success: true, message: `Test reply notification sent to your notification email` });
});

app.post("/settings/dashboard-url", async (c) => {
  const body = await c.req.json<{ url: string }>();
  const url = (body.url ?? "").trim();
  db.run(
    "INSERT INTO system_settings (key, value) VALUES ('dashboard_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [url]
  );
  return c.json({ success: true, url });
});

const RUN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

app.post("/run-now", async (c) => {
  const row = db
    .query<{ value: string }, []>(
      "SELECT value FROM system_settings WHERE key = 'last_run_at'"
    )
    .get();

  if (row) {
    const elapsed = Date.now() - parseInt(row.value, 10);
    if (elapsed < RUN_COOLDOWN_MS) {
      const remainingMs = RUN_COOLDOWN_MS - elapsed;
      const minutes = Math.ceil(remainingMs / 60000);
      return c.json(
        { error: `Please wait ${minutes} minute${minutes !== 1 ? "s" : ""} before running again` },
        429
      );
    }
  }

  db.run(
    "INSERT INTO system_settings (key, value) VALUES ('last_run_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [Date.now().toString()]
  );

  const result = await runAllNow();
  return c.json({ ...result, last_run_at: Date.now() });
});

app.get("/warmup-stats", (c) => {
  const sentToday =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE DATE(sent_at) = DATE('now')"
      )
      .get()?.count ?? 0;

  const sentTotal =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_log"
      )
      .get()?.count ?? 0;

  const accountCount =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_accounts"
      )
      .get()?.count ?? 0;

  const startDateRow =
    db
      .query<{ start_date: string | null }, []>(
        "SELECT MIN(DATE(sent_at)) as start_date FROM warmup_log"
      )
      .get();

  const startDate = startDateRow?.start_date ?? null;
  let daysRunning = 0;
  if (startDate) {
    const msPerDay = 86400000;
    daysRunning = Math.floor((Date.now() - new Date(startDate).getTime()) / msPerDay) + 1;
  }

  const last7Days = db
    .query<{ day: string; count: number }, []>(
      `SELECT DATE(sent_at) as day, COUNT(*) as count
       FROM warmup_log
       WHERE sent_at >= DATE('now', '-6 days')
       GROUP BY day
       ORDER BY day ASC`
    )
    .all();

  const statusRow =
    db
      .query<{ value: string }, []>(
        "SELECT value FROM system_settings WHERE key = 'warmup_running'"
      )
      .get();
  const warmupRunning = statusRow?.value === "1";

  return c.json({
    sent_today: sentToday,
    sent_total: sentTotal,
    account_count: accountCount,
    start_date: startDate,
    days_running: daysRunning,
    last_7_days: last7Days,
    warmup_running: warmupRunning,
  });
});

app.get("/activity", (c) => {
  const clientId = getCurrentClientId();
  const campaignIds = clientId !== null
    ? db.query<{ id: number }, [number]>("SELECT id FROM campaigns WHERE client_id = ?").all(clientId).map(r => r.id)
    : null;
  const inClause = campaignIds !== null
    ? campaignIds.length > 0 ? `(${campaignIds.join(",")})` : "(NULL)"
    : null;

  const sentActivity = db
    .query<
      {
        type: "sent";
        first_name: string;
        email: string;
        company: string;
        subject: string;
        timestamp: string;
        bounced: number;
      },
      []
    >(
      `SELECT
         'sent' AS type,
         l.first_name, l.email, l.company,
         sl.subject, sl.sent_at AS timestamp, sl.bounced
       FROM sent_log sl
       JOIN leads l ON l.id = sl.lead_id
       ${inClause !== null ? `WHERE sl.campaign_id IN ${inClause}` : ""}
       ORDER BY sl.sent_at DESC
       LIMIT 20`
    )
    .all();

  const warmupActivity = db
    .query<
      {
        type: "warmup";
        from_email: string;
        to_email: string;
        subject: string;
        timestamp: string;
        replied: number;
      },
      []
    >(
      `SELECT
         'warmup' AS type,
         from_email, to_email, subject,
         sent_at AS timestamp, replied
       FROM warmup_log
       ORDER BY sent_at DESC
       LIMIT 20`
    )
    .all();

  const merged = [...sentActivity, ...warmupActivity].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ).slice(0, 20);

  return c.json(merged);
});

// ─── Error Log ────────────────────────────────────────────────────────────────

app.get("/errors/stats", (c) => {
  const total_unresolved = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM system_errors WHERE resolved = 0"
  ).get()?.count ?? 0;

  const bySeverity = db.query<{ severity: string; count: number }, []>(
    "SELECT severity, COUNT(*) as count FROM system_errors WHERE resolved = 0 GROUP BY severity"
  ).all();

  const byType = db.query<{ error_type: string; count: number }, []>(
    "SELECT error_type, COUNT(*) as count FROM system_errors WHERE resolved = 0 GROUP BY error_type"
  ).all();

  const sev: Record<string, number> = {};
  for (const r of bySeverity) sev[r.severity] = r.count;

  const typ: Record<string, number> = {};
  for (const r of byType) typ[r.error_type] = r.count;

  return c.json({
    total_unresolved,
    critical_count: sev["critical"] ?? 0,
    error_count: sev["error"] ?? 0,
    warning_count: sev["warning"] ?? 0,
    info_count: sev["info"] ?? 0,
    by_type: typ,
  });
});

app.get("/errors", (c) => {
  const severity = c.req.query("severity") || "";
  const error_type = c.req.query("error_type") || "";
  const resolved = c.req.query("resolved") ?? "0";
  const limit = parseInt(c.req.query("limit") ?? "20");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const conditions: string[] = [`resolved = ?`];
  const params: (string | number)[] = [resolved === "1" ? 1 : 0];

  if (severity) { conditions.push("severity = ?"); params.push(severity); }
  if (error_type) { conditions.push("error_type = ?"); params.push(error_type); }

  const where = conditions.join(" AND ");

  const total = db.query<{ count: number }, (string | number)[]>(
    `SELECT COUNT(*) as count FROM system_errors WHERE ${where}`
  ).get(...params as [])?.count ?? 0;

  const rows = db.query<Record<string, unknown>, (string | number)[]>(
    `SELECT * FROM system_errors WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params as [], limit, offset);

  return c.json({ errors: rows, total, limit, offset });
});

app.put("/errors/resolve-all", (c) => {
  const severity = c.req.query("severity") || "";
  const error_type = c.req.query("error_type") || "";

  const conditions: string[] = ["resolved = 0"];
  const params: string[] = [];

  if (severity) { conditions.push("severity = ?"); params.push(severity); }
  if (error_type) { conditions.push("error_type = ?"); params.push(error_type); }

  const where = conditions.join(" AND ");
  const info = db.run(`UPDATE system_errors SET resolved = 1 WHERE ${where}`, params);
  return c.json({ success: true, resolved: info.changes });
});

app.delete("/errors/clear-resolved", async (c) => {
  const count = await clearResolvedErrors();
  return c.json({ success: true, deleted: count });
});

app.put("/errors/:id/resolve", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  await markResolved(id);
  return c.json({ success: true });
});

// ─── Backup Settings ─────────────────────────────────────────────────────────

app.get("/settings/auto-backup", (c) => {
  const row = db.query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'auto_backup_enabled'").get();
  return c.json({ enabled: row?.value === "1" });
});

app.post("/settings/auto-backup", async (c) => {
  const body = await c.req.json<{ enabled: boolean }>();
  const val = body.enabled ? "1" : "0";
  db.run("INSERT INTO system_settings (key, value) VALUES ('auto_backup_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [val]);
  return c.json({ success: true, enabled: body.enabled });
});

// ─── Backup & Restore ────────────────────────────────────────────────────────

function validateBackupFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return false;
  return /^(system_db_backup_|pre_restore_backup_)\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/.test(filename);
}

app.get("/backups/stats", async (c) => {
  const stats = await getBackupStats();
  return c.json(stats);
});

app.get("/backups", async (c) => {
  const backups = await listBackups();
  return c.json(backups);
});

app.post("/backups/create", async (c) => {
  const body = await c.req.json<{ note?: string }>().catch(() => ({}));
  const result = await createBackup(body.note ?? "Manual backup");
  if (!result.success) return c.json({ error: result.error }, 500);
  return c.json(result, 201);
});

app.post("/backups/restore", async (c) => {
  const body = await c.req.json<{ filename: string }>().catch(() => ({ filename: "" }));
  if (!validateBackupFilename(body.filename)) {
    return c.json({ error: "Invalid backup filename" }, 400);
  }
  const result = await restoreBackup(body.filename);
  if (!result.success) return c.json({ error: result.error }, 500);
  return c.json(result);
});

app.get("/backups/download/:filename", (c) => {
  const filename = c.req.param("filename");
  if (!validateBackupFilename(filename)) return c.json({ error: "Invalid filename" }, 400);

  const filePath = path.join(getBackupDir(), filename);
  if (!fs.existsSync(filePath)) return c.json({ error: "File not found" }, 404);

  const data = fs.readFileSync(filePath);
  return new Response(data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(data.length),
    },
  });
});

app.delete("/backups/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (!validateBackupFilename(filename)) return c.json({ error: "Invalid filename" }, 400);
  const result = await deleteBackup(filename);
  if (!result.success) return c.json({ error: result.error }, 500);
  return c.json(result);
});

app.get("/health", async (c) => {
  const result = await runHealthCheck();
  return c.json(result);
});

app.get("/health/quick", async (c) => {
  const status = await getQuickStatus();
  return c.json({ overall_status: status, checked_at: new Date().toISOString() });
});

// ─── Campaign Analytics ───────────────────────────────────────────────────────

app.get("/campaign-stats", (c) => {
  const clientId = getCurrentClientId();

  const campaigns = clientId !== null
    ? db.query<{ id: number; name: string }, [number]>("SELECT id, name FROM campaigns WHERE client_id = ?").all(clientId)
    : db.query<{ id: number; name: string }, []>("SELECT id, name FROM campaigns").all();

  const result = campaigns.map((camp) => {
    const sent = db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND bounced = 0"
    ).get(camp.id)?.count ?? 0;

    const opened = db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND opened = 1"
    ).get(camp.id)?.count ?? 0;

    const replied = db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND status = 'replied'"
    ).get(camp.id)?.count ?? 0;

    const bounced = db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND bounced = 1"
    ).get(camp.id)?.count ?? 0;

    const unsubscribed = db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND status = 'unsubscribed'"
    ).get(camp.id)?.count ?? 0;

    const total = sent + bounced;
    return {
      campaign_id: camp.id,
      campaign_name: camp.name,
      total_sent: sent,
      total_opened: opened,
      open_rate: total > 0 ? +((opened / total) * 100).toFixed(1) : 0,
      total_replied: replied,
      reply_rate: total > 0 ? +((replied / total) * 100).toFixed(1) : 0,
      total_bounced: bounced,
      bounce_rate: total > 0 ? +((bounced / total) * 100).toFixed(1) : 0,
      total_unsubscribed: unsubscribed,
    };
  });

  // Aggregate totals
  const totals = result.reduce(
    (acc, r) => ({
      total_sent: acc.total_sent + r.total_sent,
      total_opened: acc.total_opened + r.total_opened,
      total_replied: acc.total_replied + r.total_replied,
      total_bounced: acc.total_bounced + r.total_bounced,
    }),
    { total_sent: 0, total_opened: 0, total_replied: 0, total_bounced: 0 }
  );
  const t = totals.total_sent + totals.total_bounced;
  const aggregate = {
    ...totals,
    open_rate: t > 0 ? +((totals.total_opened / t) * 100).toFixed(1) : 0,
    reply_rate: t > 0 ? +((totals.total_replied / t) * 100).toFixed(1) : 0,
    bounce_rate: t > 0 ? +((totals.total_bounced / t) * 100).toFixed(1) : 0,
  };

  return c.json({ campaigns: result, aggregate });
});

app.get("/campaign-stats/:id", (c) => {
  const id = Number(c.req.param("id"));

  const sent = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND bounced = 0"
  ).get(id)?.count ?? 0;

  const opened = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND opened = 1"
  ).get(id)?.count ?? 0;

  const replied = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND status = 'replied'"
  ).get(id)?.count ?? 0;

  const bounced = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND bounced = 1"
  ).get(id)?.count ?? 0;

  const unsubscribed = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND status = 'unsubscribed'"
  ).get(id)?.count ?? 0;

  const total = sent + bounced;

  const perStep = db
    .query<{ step_number: number; sent: number; opened: number; replied: number }, [number]>(
      `SELECT
         sl.step_number,
         COUNT(*) as sent,
         SUM(sl.opened) as opened,
         0 as replied
       FROM sent_log sl
       WHERE sl.campaign_id = ?
       GROUP BY sl.step_number
       ORDER BY sl.step_number`
    )
    .all(id)
    .map((s) => ({
      step_number: s.step_number,
      sent: s.sent,
      opened: s.opened ?? 0,
      open_rate: s.sent > 0 ? +((s.opened / s.sent) * 100).toFixed(1) : 0,
    }));

  return c.json({
    campaign_id: id,
    total_sent: sent,
    total_opened: opened,
    open_rate: total > 0 ? +((opened / total) * 100).toFixed(1) : 0,
    total_replied: replied,
    reply_rate: total > 0 ? +((replied / total) * 100).toFixed(1) : 0,
    total_bounced: bounced,
    bounce_rate: total > 0 ? +((bounced / total) * 100).toFixed(1) : 0,
    total_unsubscribed: unsubscribed,
    per_step: perStep,
  });
});

// ─── Client Progress Reports ─────────────────────────────────────────────────

app.get("/client-reports", (c) => {
  const rows = db
    .query<{
      id: number;
      campaign_id: number;
      campaign_name: string;
      client_email: string;
      client_name: string | null;
      send_daily: number;
      send_weekly: number;
      send_time_hour: number;
      active: number;
      created_at: string;
    }, []>(
      `SELECT cr.id, cr.campaign_id, c.name AS campaign_name, cr.client_email, cr.client_name,
              cr.send_daily, cr.send_weekly, cr.send_time_hour, cr.active, cr.created_at
       FROM client_report_config cr
       JOIN campaigns c ON c.id = cr.campaign_id
       ORDER BY cr.created_at DESC`
    )
    .all();

  // Enrich with last sent time
  const result = rows.map((r) => {
    const sentRow = db.query<{ value: string }, [string]>(
      "SELECT value FROM system_settings WHERE key = ?"
    ).get(`client_report_sent_${r.campaign_id}`);
    return { ...r, last_sent_at: sentRow?.value ?? null };
  });

  return c.json(result);
});

app.post("/client-reports", async (c) => {
  const body = await c.req.json<{
    campaign_id: number;
    client_email: string;
    client_name?: string;
    send_daily?: boolean;
    send_weekly?: boolean;
    send_time_hour?: number;
  }>();

  if (!body.campaign_id || !body.client_email) {
    return c.json({ error: "campaign_id and client_email are required" }, 400);
  }

  db.run(
    `INSERT INTO client_report_config (campaign_id, client_email, client_name, send_daily, send_weekly, send_time_hour)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id) DO UPDATE SET
       client_email = excluded.client_email,
       client_name = excluded.client_name,
       send_daily = excluded.send_daily,
       send_weekly = excluded.send_weekly,
       send_time_hour = excluded.send_time_hour`,
    [
      body.campaign_id,
      body.client_email,
      body.client_name ?? null,
      body.send_daily !== false ? 1 : 0,
      body.send_weekly !== false ? 1 : 0,
      body.send_time_hour ?? 8,
    ]
  );

  return c.json({ success: true });
});

app.delete("/client-reports/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  db.run("DELETE FROM client_report_config WHERE id = ?", [id]);
  return c.json({ success: true });
});

app.post("/client-reports/:id/send-now", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const cfg = db.query<{ campaign_id: number; client_email: string }, [number]>(
    "SELECT campaign_id, client_email FROM client_report_config WHERE id = ?"
  ).get(id);
  if (!cfg) return c.json({ error: "Configuration not found" }, 404);

  const result = await sendClientProgressReport(cfg.campaign_id, cfg.client_email);
  if (!result.success) return c.json({ error: result.message }, 500);
  return c.json(result);
});

app.post("/client-reports/:id/preview", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const cfg = db.query<{ campaign_id: number; client_email: string }, [number]>(
    "SELECT campaign_id, client_email FROM client_report_config WHERE id = ?"
  ).get(id);
  if (!cfg) return c.json({ error: "Configuration not found" }, 404);

  const camp = db.query<{ id: number; name: string; created_at: string; daily_limit: number }, [number]>(
    "SELECT id, name, created_at, daily_limit FROM campaigns WHERE id = ?"
  ).get(cfg.campaign_id);
  if (!camp) return c.json({ error: "Campaign not found" }, 404);

  const configRow = db.query<{ client_name: string | null }, [number]>(
    "SELECT client_name FROM client_report_config WHERE campaign_id = ?"
  ).get(cfg.campaign_id);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split("T")[0];
  const todayStr = new Date().toISOString().split("T")[0];

  const sentYesterday = db.query<{ count: number }, [number, string]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND DATE(sent_at) = ? AND bounced = 0"
  ).get(cfg.campaign_id, yStr)?.count ?? 0;
  const sentTotal = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND bounced = 0"
  ).get(cfg.campaign_id)?.count ?? 0;
  const leadCounts = db.query<{ status: string; count: number }, [number]>(
    "SELECT status, COUNT(*) as count FROM leads WHERE campaign_id = ? GROUP BY status"
  ).all(cfg.campaign_id);
  const cm: Record<string, number> = {};
  for (const r of leadCounts) cm[r.status] = r.count;
  const totalOpened = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND opened = 1"
  ).get(cfg.campaign_id)?.count ?? 0;
  const totalForRate = sentTotal + (cm["bounced"] ?? 0);
  const openRate = totalForRate > 0 ? (totalOpened / totalForRate) * 100 : 0;
  const repliesYesterday = db.query<{ first_name: string; last_name: string; company: string }, [number, string]>(
    `SELECT l.first_name, l.last_name, l.company FROM replies r JOIN leads l ON l.id = r.lead_id
     WHERE l.campaign_id = ? AND DATE(r.received_at) = ?`
  ).all(cfg.campaign_id, yStr);
  const totalReplied = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM replies r JOIN leads l ON l.id = r.lead_id WHERE l.campaign_id = ?"
  ).get(cfg.campaign_id)?.count ?? 0;
  const replyRate = totalForRate > 0 ? (totalReplied / totalForRate) * 100 : 0;
  const topSubjectRow = db.query<{ subject: string; sent: number; opened: number }, [number]>(
    `SELECT sl.subject, COUNT(*) as sent, SUM(sl.opened) as opened FROM sent_log sl
     WHERE sl.campaign_id = ? GROUP BY sl.subject
     ORDER BY (CAST(SUM(sl.opened) AS REAL) / COUNT(*)) DESC LIMIT 1`
  ).get(cfg.campaign_id);
  const daysRunning = camp.created_at ? Math.floor((Date.now() - new Date(camp.created_at).getTime()) / 86_400_000) : 0;
  const todaySends = db.query<{ count: number }, [number, string]>(
    "SELECT COUNT(*) as count FROM leads WHERE campaign_id = ? AND status = 'active' AND next_send_date = ?"
  ).get(cfg.campaign_id, todayStr)?.count ?? 0;
  const nextSteps: string[] = [];
  if (todaySends > 0) nextSteps.push(`${todaySends} more ${todaySends === 1 ? "person" : "people"} will receive their next email today`);
  nextSteps.push("Monitoring for new replies throughout the day");
  if ((cm["active"] ?? 0) > 0) nextSteps.push(`${cm["active"]} ${(cm["active"] ?? 0) === 1 ? "person" : "people"} still in your pipeline to contact`);

  const html = buildClientProgressHTML({
    client_name: configRow?.client_name || "Client",
    campaign_name: camp.name,
    report_date: todayStr,
    emails_sent_yesterday: sentYesterday,
    emails_sent_total: sentTotal,
    open_rate: openRate,
    reply_rate: replyRate,
    new_replies_yesterday: repliesYesterday.map(r => ({
      name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Unknown",
      company: r.company || "",
    })),
    leads_remaining: cm["active"] ?? 0,
    leads_active: cm["active"] ?? 0,
    leads_finished: cm["finished"] ?? 0,
    leads_replied: cm["replied"] ?? 0,
    leads_bounced: cm["bounced"] ?? 0,
    top_performing_subject: topSubjectRow && topSubjectRow.sent >= 3
      ? { subject: topSubjectRow.subject, open_rate: topSubjectRow.sent > 0 ? (topSubjectRow.opened / topSubjectRow.sent) * 100 : 0 }
      : null,
    days_running: daysRunning,
    next_steps: nextSteps,
  });

  return c.json({ html });
});

// ─── Bounce Stats ────────────────────────────────────────────────────────────

app.get("/bounce-stats", async (c) => {
  const clientId = getCurrentClientId();
  const allStats = await getBounceStats();
  if (clientId === null) return c.json(allStats);
  // Filter to accounts belonging to current client
  const clientAccountIds = new Set(
    db.query<{ id: number }, [number]>("SELECT id FROM accounts WHERE client_id = ?").all(clientId).map(r => r.id)
  );
  return c.json(allStats.filter(s => clientAccountIds.has(s.account_id)));
});

app.post("/bounce-check", async (c) => {
  const results = await checkBounceRates();
  const warned = results.filter(r => r.action_taken === "warning").length;
  const paused = results.filter(r => r.action_taken === "paused").length;
  return c.json({ results, warned, paused, checked: results.length });
});

// ─── DNS Checker ─────────────────────────────────────────────────────────────

const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

app.post("/dns-check", async (c) => {
  const body = await c.req.json<{ domain: string }>();
  const domain = (body.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];

  if (!domain || !DOMAIN_REGEX.test(domain)) {
    return c.json({ error: "Invalid domain format" }, 400);
  }

  // Serve from cache if fresh
  const cached = dnsCache.get(domain);
  if (cached && Date.now() - cached.ts < DNS_CACHE_TTL) {
    return c.json(cached.result);
  }

  const result = await checkAllDNS(domain);

  dnsCache.set(domain, { result, ts: Date.now() });

  db.run(
    `INSERT INTO dns_check_log (domain, overall_score, overall_status, spf_found, dkim_found, dmarc_found)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      domain,
      result.overall_score,
      result.overall_status,
      result.spf.found ? 1 : 0,
      result.dkim.found ? 1 : 0,
      result.dmarc.found ? 1 : 0,
    ]
  );

  return c.json(result);
});

app.get("/dns-check/history", (c) => {
  const rows = db
    .query<{
      id: number;
      domain: string;
      overall_score: number;
      overall_status: string;
      spf_found: number;
      dkim_found: number;
      dmarc_found: number;
      checked_at: string;
    }, []>(
      `SELECT id, domain, overall_score, overall_status, spf_found, dkim_found, dmarc_found, checked_at
       FROM dns_check_log
       ORDER BY checked_at DESC
       LIMIT 20`
    )
    .all();
  return c.json(rows);
});

app.get("/analytics", (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 14)));
  const clientId = getCurrentClientId();

  // Build a reusable IN clause from this client's campaign IDs
  const clientCampaignIds = clientId !== null
    ? db.query<{ id: number }, [number]>("SELECT id FROM campaigns WHERE client_id = ?").all(clientId).map(r => r.id)
    : null;
  const inClause = clientCampaignIds !== null
    ? clientCampaignIds.length > 0 ? `(${clientCampaignIds.join(",")})` : "(NULL)"
    : null;

  // Legacy join/where vars kept for the queries that still use them
  const cJoin = clientId !== null ? "JOIN campaigns c ON c.id = sl.campaign_id" : "";
  const cWhere = clientId !== null ? "AND c.client_id = ?" : "";
  const cParam = clientId !== null ? [clientId] : [];

  // Generate date list for the window
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  const startDate = dates[0] as string;

  // daily_sends
  const dailySentRaw = db
    .query<{ date: string; sent: number; bounced: number }, unknown[]>(
      `SELECT DATE(sl.sent_at) AS date,
              SUM(CASE WHEN sl.bounced = 0 THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN sl.bounced = 1 THEN 1 ELSE 0 END) AS bounced
       FROM sent_log sl ${cJoin}
       WHERE DATE(sl.sent_at) >= ? ${cWhere}
       GROUP BY DATE(sl.sent_at)`
    )
    .all(startDate, ...cParam);

  const dailyOpenedRaw = db
    .query<{ date: string; opened: number }, unknown[]>(
      `SELECT DATE(eo.opened_at) AS date, COUNT(*) AS opened
       FROM email_opens eo
       JOIN sent_log sl ON sl.tracking_token = eo.tracking_token
       ${clientId !== null ? "JOIN campaigns c ON c.id = sl.campaign_id" : ""}
       WHERE DATE(eo.opened_at) >= ? ${cWhere}
       GROUP BY DATE(eo.opened_at)`
    )
    .all(startDate, ...cParam);

  const dailyRepliedRaw = db
    .query<{ date: string; replied: number }, unknown[]>(
      `SELECT DATE(r.received_at) AS date, COUNT(*) AS replied
       FROM replies r
       JOIN leads l ON l.id = r.lead_id
       ${clientId !== null ? "JOIN campaigns c ON c.id = l.campaign_id" : ""}
       WHERE DATE(r.received_at) >= ? ${cWhere}
       GROUP BY DATE(r.received_at)`
    )
    .all(startDate, ...cParam);

  const sentMap = Object.fromEntries(dailySentRaw.map(r => [r.date, { sent: r.sent, bounced: r.bounced }]));
  const openedMap = Object.fromEntries(dailyOpenedRaw.map(r => [r.date, r.opened]));
  const repliedMap = Object.fromEntries(dailyRepliedRaw.map(r => [r.date, r.replied]));

  const daily_sends = dates.map(date => ({
    date,
    sent: sentMap[date]?.sent ?? 0,
    bounced: sentMap[date]?.bounced ?? 0,
    opened: openedMap[date] ?? 0,
    replied: repliedMap[date] ?? 0,
  }));

  // campaign_comparison
  const campClientFilter = clientId !== null ? "WHERE c.client_id = ?" : "";
  const campaignRows = db
    .query<{
      campaign_id: number; campaign_name: string; status: string;
      total_sent: number; total_bounced: number;
    }, unknown[]>(
      `SELECT c.id AS campaign_id, c.name AS campaign_name, c.status,
              COUNT(CASE WHEN sl.bounced = 0 THEN 1 END) AS total_sent,
              COUNT(CASE WHEN sl.bounced = 1 THEN 1 END) AS total_bounced
       FROM campaigns c
       LEFT JOIN sent_log sl ON sl.campaign_id = c.id
       ${campClientFilter}
       GROUP BY c.id`
    )
    .all(...cParam);

  const campaignOpened = db
    .query<{ campaign_id: number; cnt: number }, unknown[]>(
      `SELECT sl.campaign_id, COUNT(DISTINCT eo.lead_id) AS cnt
       FROM email_opens eo
       JOIN sent_log sl ON sl.tracking_token = eo.tracking_token
       ${clientId !== null ? "JOIN campaigns c ON c.id = sl.campaign_id WHERE c.client_id = ?" : ""}
       GROUP BY sl.campaign_id`
    )
    .all(...cParam);

  const campaignReplied = db
    .query<{ campaign_id: number; cnt: number }, unknown[]>(
      `SELECT l.campaign_id, COUNT(*) AS cnt
       FROM replies r
       JOIN leads l ON l.id = r.lead_id
       ${clientId !== null ? "JOIN campaigns c ON c.id = l.campaign_id WHERE c.client_id = ?" : ""}
       GROUP BY l.campaign_id`
    )
    .all(...cParam);

  const campaignActiveLeads = db
    .query<{ campaign_id: number; cnt: number }, unknown[]>(
      `SELECT l.campaign_id, COUNT(*) AS cnt FROM leads l
       ${clientId !== null ? "JOIN campaigns c ON c.id = l.campaign_id WHERE l.status = 'active' AND c.client_id = ?" : "WHERE l.status = 'active'"}
       GROUP BY l.campaign_id`
    )
    .all(...cParam);

  const openedByCamp = Object.fromEntries(campaignOpened.map(r => [r.campaign_id, r.cnt]));
  const repliedByCamp = Object.fromEntries(campaignReplied.map(r => [r.campaign_id, r.cnt]));
  const activeLeadsByCamp = Object.fromEntries(campaignActiveLeads.map(r => [r.campaign_id, r.cnt]));

  const campaign_comparison = campaignRows.map(r => {
    const total_opened = openedByCamp[r.campaign_id] ?? 0;
    const total_replied = repliedByCamp[r.campaign_id] ?? 0;
    const sent = r.total_sent;
    return {
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      status: r.status,
      total_sent: sent,
      total_opened,
      total_replied,
      total_bounced: r.total_bounced,
      open_rate: sent > 0 ? Math.round((total_opened / sent) * 1000) / 10 : 0,
      reply_rate: sent > 0 ? Math.round((total_replied / sent) * 1000) / 10 : 0,
      bounce_rate: sent > 0 ? Math.round((r.total_bounced / sent) * 1000) / 10 : 0,
      active_leads: activeLeadsByCamp[r.campaign_id] ?? 0,
    };
  });

  // step_performance
  const stepRows = db
    .query<{ step_number: number; total_sent: number; total_replied: number }, unknown[]>(
      `SELECT sl.step_number,
              COUNT(CASE WHEN sl.bounced = 0 THEN 1 END) AS total_sent,
              COUNT(CASE WHEN sl.bounced = 1 THEN 1 END) AS _ignored
       FROM sent_log sl ${cJoin}
       ${clientId !== null ? "WHERE c.client_id = ?" : ""}
       GROUP BY sl.step_number
       ORDER BY sl.step_number`
    )
    .all(...cParam);

  const stepOpened = db
    .query<{ step_number: number; cnt: number }, unknown[]>(
      `SELECT sl.step_number, COUNT(DISTINCT eo.lead_id) AS cnt
       FROM email_opens eo
       JOIN sent_log sl ON sl.tracking_token = eo.tracking_token
       ${clientId !== null ? "JOIN campaigns c ON c.id = sl.campaign_id WHERE c.client_id = ?" : ""}
       GROUP BY sl.step_number`
    )
    .all(...cParam);

  const stepReplied = db
    .query<{ step_number: number; cnt: number }, unknown[]>(
      `SELECT sl.step_number, COUNT(DISTINCT r.lead_id) AS cnt
       FROM replies r
       JOIN sent_log sl ON sl.lead_id = r.lead_id AND sl.step_number = (
         SELECT MAX(sl2.step_number) FROM sent_log sl2 WHERE sl2.lead_id = r.lead_id
       )
       ${clientId !== null ? "JOIN campaigns c ON c.id = sl.campaign_id WHERE c.client_id = ?" : ""}
       GROUP BY sl.step_number`
    )
    .all(...cParam);

  const stepOpenedMap = Object.fromEntries(stepOpened.map(r => [r.step_number, r.cnt]));
  const stepRepliedMap = Object.fromEntries(stepReplied.map(r => [r.step_number, r.cnt]));

  const step_performance = stepRows.map(r => {
    const total_opened = stepOpenedMap[r.step_number] ?? 0;
    const total_replied = stepRepliedMap[r.step_number] ?? 0;
    return {
      step_number: r.step_number,
      total_sent: r.total_sent,
      total_opened,
      open_rate: r.total_sent > 0 ? Math.round((total_opened / r.total_sent) * 1000) / 10 : 0,
      total_replied,
      reply_rate: r.total_sent > 0 ? Math.round((total_replied / r.total_sent) * 1000) / 10 : 0,
    };
  });

  // hourly_distribution
  const hourlyRaw = db
    .query<{ hour: number; count: number }, unknown[]>(
      `SELECT CAST(strftime('%H', sl.sent_at) AS INTEGER) AS hour, COUNT(*) AS count
       FROM sent_log sl ${cJoin}
       ${clientId !== null ? "WHERE c.client_id = ?" : ""}
       GROUP BY hour
       ORDER BY hour`
    )
    .all(...cParam);

  const hourlyMap = Object.fromEntries(hourlyRaw.map(r => [r.hour, r.count]));
  const hourly_distribution = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourlyMap[h] ?? 0 }));

  // lead_status_over_time
  const leadStatusRaw = db
    .query<{ date: string; status: string; count: number }, unknown[]>(
      `SELECT DATE(l.created_at) AS date, l.status, COUNT(*) AS count
       FROM leads l
       ${clientId !== null ? "JOIN campaigns c ON c.id = l.campaign_id" : ""}
       WHERE DATE(l.created_at) >= ? ${cWhere}
       GROUP BY DATE(l.created_at), l.status`
    )
    .all(startDate, ...cParam);

  const leadStatusByDate: Record<string, Record<string, number>> = {};
  for (const r of leadStatusRaw) {
    if (!leadStatusByDate[r.date]) leadStatusByDate[r.date] = {};
    leadStatusByDate[r.date][r.status] = r.count;
  }
  const lead_status_over_time = dates.map(date => ({
    date,
    active: leadStatusByDate[date]?.active ?? 0,
    replied: leadStatusByDate[date]?.replied ?? 0,
    finished: leadStatusByDate[date]?.finished ?? 0,
    bounced: leadStatusByDate[date]?.bounced ?? 0,
    unsubscribed: leadStatusByDate[date]?.unsubscribed ?? 0,
  }));

  // top_subjects
  const top_subjects = db
    .query<{ subject: string; sent_count: number; open_count: number; open_rate: number }, unknown[]>(
      `SELECT sl.subject,
              COUNT(CASE WHEN sl.bounced = 0 THEN 1 END) AS sent_count,
              COUNT(DISTINCT eo.lead_id) AS open_count,
              ROUND(COUNT(DISTINCT eo.lead_id) * 100.0 / NULLIF(COUNT(CASE WHEN sl.bounced = 0 THEN 1 END), 0), 1) AS open_rate
       FROM sent_log sl
       LEFT JOIN email_opens eo ON eo.tracking_token = sl.tracking_token
       ${clientId !== null ? "JOIN campaigns c ON c.id = sl.campaign_id WHERE c.client_id = ?" : ""}
       GROUP BY sl.subject
       ORDER BY open_count DESC
       LIMIT 10`
    )
    .all(...cParam);

  // summary
  const totals = db
    .query<{ total_sent: number; total_bounced: number }, unknown[]>(
      `SELECT COUNT(CASE WHEN sl.bounced = 0 THEN 1 END) AS total_sent,
              COUNT(CASE WHEN sl.bounced = 1 THEN 1 END) AS total_bounced
       FROM sent_log sl ${cJoin}
       ${clientId !== null ? "WHERE c.client_id = ?" : ""}`
    )
    .get(...cParam) ?? { total_sent: 0, total_bounced: 0 };

  const totalOpened = db.query<{ cnt: number }, unknown[]>(
    `SELECT COUNT(DISTINCT eo.lead_id) AS cnt FROM email_opens eo
     JOIN sent_log sl ON sl.tracking_token = eo.tracking_token
     ${clientId !== null ? "JOIN campaigns c ON c.id = sl.campaign_id WHERE c.client_id = ?" : ""}`
  ).get(...cParam)?.cnt ?? 0;

  const totalReplied = db.query<{ cnt: number }, unknown[]>(
    `SELECT COUNT(*) AS cnt FROM replies r
     JOIN leads l ON l.id = r.lead_id
     ${clientId !== null ? "JOIN campaigns c ON c.id = l.campaign_id WHERE c.client_id = ?" : ""}`
  ).get(...cParam)?.cnt ?? 0;

  const totalUnsub = db.query<{ cnt: number }, unknown[]>(
    `SELECT COUNT(*) AS cnt FROM leads l
     ${clientId !== null ? "JOIN campaigns c ON c.id = l.campaign_id WHERE l.status = 'unsubscribed' AND c.client_id = ?" : "WHERE l.status = 'unsubscribed'"}`
  ).get(...cParam)?.cnt ?? 0;

  const totalLeads = db.query<{ cnt: number }, unknown[]>(
    `SELECT COUNT(*) AS cnt FROM leads l
     ${clientId !== null ? "JOIN campaigns c ON c.id = l.campaign_id WHERE c.client_id = ?" : ""}`
  ).get(...cParam)?.cnt ?? 0;

  const activeCampaigns = db.query<{ cnt: number }, unknown[]>(
    `SELECT COUNT(*) AS cnt FROM campaigns WHERE status = 'active'${clientId !== null ? " AND client_id = ?" : ""}`
  ).get(...cParam)?.cnt ?? 0;

  const sent = totals.total_sent;
  const bestCamp = campaign_comparison.filter(c => c.total_sent >= 5).sort((a, b) => b.reply_rate - a.reply_rate)[0];
  const worstCamp = campaign_comparison.filter(c => c.total_sent >= 5).sort((a, b) => a.reply_rate - b.reply_rate)[0];

  const summary = {
    total_emails_sent: sent,
    total_opened: totalOpened,
    overall_open_rate: sent > 0 ? Math.round((totalOpened / sent) * 1000) / 10 : 0,
    total_replied: totalReplied,
    overall_reply_rate: sent > 0 ? Math.round((totalReplied / sent) * 1000) / 10 : 0,
    total_bounced: totals.total_bounced,
    overall_bounce_rate: sent > 0 ? Math.round((totals.total_bounced / sent) * 1000) / 10 : 0,
    total_unsubscribed: totalUnsub,
    active_campaigns: activeCampaigns,
    total_leads: totalLeads,
    best_performing_campaign: bestCamp ? { name: bestCamp.campaign_name, reply_rate: bestCamp.reply_rate } : null,
    worst_performing_campaign: worstCamp && worstCamp.campaign_id !== bestCamp?.campaign_id ? { name: worstCamp.campaign_name, reply_rate: worstCamp.reply_rate } : null,
  };

  return c.json({ daily_sends, campaign_comparison, step_performance, hourly_distribution, lead_status_over_time, top_subjects, summary });
});

// ─── CSV Export helpers ───────────────────────────────────────────────────────

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function convertToCSV(rows: Record<string, unknown>[], headers?: string[]): string {
  if (!rows.length) return headers ? headers.join(",") + "\n" : "";
  const keys = headers ?? Object.keys(rows[0]);
  const lines = [keys.join(",")];
  for (const row of rows) {
    lines.push(keys.map(k => csvEscape(row[k])).join(","));
  }
  return lines.join("\n");
}

function csvDate(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Export endpoints ─────────────────────────────────────────────────────────

app.get("/export/leads", (c) => {
  const campaignId = c.req.query("campaign_id");
  const status = c.req.query("status");

  let sql = `SELECT l.first_name, l.last_name, l.email, l.company, l.website,
                    l.current_step, l.status, l.timezone_label, l.opened, l.open_count,
                    l.next_send_date, l.created_at, l.personalized_line,
                    c.name AS campaign_name
             FROM leads l
             LEFT JOIN campaigns c ON c.id = l.campaign_id
             WHERE 1=1`;
  const params: unknown[] = [];
  if (campaignId) { sql += " AND l.campaign_id = ?"; params.push(Number(campaignId)); }
  if (status)     { sql += " AND l.status = ?";      params.push(status); }
  sql += " ORDER BY l.created_at DESC";

  const rows = db.query<Record<string, unknown>, unknown[]>(sql).all(...params);
  const headers = ["campaign_name","first_name","last_name","email","company","website",
                   "current_step","status","timezone_label","opened","open_count",
                   "next_send_date","created_at","personalized_line"];
  const csv = convertToCSV(rows as Record<string, unknown>[], headers);

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="leads_export_${csvDate()}.csv"`);
  return c.body(csv);
});

app.get("/export/sent-log", (c) => {
  const campaignId = c.req.query("campaign_id");
  const dateFrom   = c.req.query("date_from");
  const dateTo     = c.req.query("date_to");
  const limitRaw   = c.req.query("limit");
  const limit      = limitRaw === "all" || limitRaw === "0" ? null : Number(limitRaw ?? 1000);

  let sql = `SELECT sl.sent_at, l.first_name AS lead_first_name, l.last_name AS lead_last_name,
                    l.email AS lead_email, l.company AS lead_company,
                    c.name AS campaign_name, sl.step_number, sl.subject,
                    sl.bounced, sl.opened, sl.opened_at, sl.tracking_token
             FROM sent_log sl
             LEFT JOIN leads l ON l.id = sl.lead_id
             LEFT JOIN campaigns c ON c.id = sl.campaign_id
             WHERE 1=1`;
  const params: unknown[] = [];
  if (campaignId) { sql += " AND sl.campaign_id = ?"; params.push(Number(campaignId)); }
  if (dateFrom)   { sql += " AND DATE(sl.sent_at) >= ?"; params.push(dateFrom); }
  if (dateTo)     { sql += " AND DATE(sl.sent_at) <= ?"; params.push(dateTo); }
  sql += " ORDER BY sl.sent_at DESC";
  if (limit)      { sql += ` LIMIT ${limit}`; }

  const rows = db.query<Record<string, unknown>, unknown[]>(sql).all(...params);
  const headers = ["sent_at","lead_first_name","lead_last_name","lead_email","lead_company",
                   "campaign_name","step_number","subject","bounced","opened","opened_at","tracking_token"];
  const csv = convertToCSV(rows as Record<string, unknown>[], headers);

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="sent_log_${csvDate()}.csv"`);
  return c.body(csv);
});

app.get("/export/warmup-log", (c) => {
  const dateFrom       = c.req.query("date_from");
  const dateTo         = c.req.query("date_to");
  const conversationId = c.req.query("conversation_id");
  const limitRaw       = c.req.query("limit");
  const limit          = Number(limitRaw ?? 1000);

  let sql = `SELECT sent_at, from_email, to_email, subject, replied, conversation_id, topic, pair_id
             FROM warmup_log WHERE 1=1`;
  const params: unknown[] = [];
  if (dateFrom)       { sql += " AND DATE(sent_at) >= ?";     params.push(dateFrom); }
  if (dateTo)         { sql += " AND DATE(sent_at) <= ?";     params.push(dateTo); }
  if (conversationId) { sql += " AND conversation_id = ?";    params.push(conversationId); }
  sql += " ORDER BY sent_at DESC";
  if (limit)          { sql += ` LIMIT ${limit}`; }

  const rows = db.query<Record<string, unknown>, unknown[]>(sql).all(...params);
  const headers = ["sent_at","from_email","to_email","subject","replied","conversation_id","topic","pair_id"];
  const csv = convertToCSV(rows as Record<string, unknown>[], headers);

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="warmup_log_${csvDate()}.csv"`);
  return c.body(csv);
});

app.get("/export/replies", (c) => {
  const rows = db.query<Record<string, unknown>, []>(
    `SELECT r.received_at, l.first_name AS lead_first_name, l.last_name AS lead_last_name,
            l.email AS lead_email, l.company AS lead_company,
            c.name AS campaign_name, r.pushed_to_hubspot
     FROM replies r
     JOIN leads l ON l.id = r.lead_id
     LEFT JOIN campaigns c ON c.id = l.campaign_id
     ORDER BY r.received_at DESC`
  ).all();
  const headers = ["received_at","lead_first_name","lead_last_name","lead_email",
                   "lead_company","campaign_name","pushed_to_hubspot"];
  const csv = convertToCSV(rows, headers);

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="replies_${csvDate()}.csv"`);
  return c.body(csv);
});

app.get("/export/analytics", (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30)));

  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  const startDate = dates[0] as string;

  const sentRaw = db.query<{ date: string; sent: number; bounced: number }, [string]>(
    `SELECT DATE(sent_at) AS date,
            SUM(CASE WHEN bounced=0 THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN bounced=1 THEN 1 ELSE 0 END) AS bounced
     FROM sent_log WHERE DATE(sent_at) >= ? GROUP BY DATE(sent_at)`
  ).all(startDate);

  const openedRaw = db.query<{ date: string; opened: number }, [string]>(
    `SELECT DATE(opened_at) AS date, COUNT(*) AS opened
     FROM email_opens WHERE DATE(opened_at) >= ? GROUP BY DATE(opened_at)`
  ).all(startDate);

  const repliedRaw = db.query<{ date: string; replied: number }, [string]>(
    `SELECT DATE(received_at) AS date, COUNT(*) AS replied
     FROM replies WHERE DATE(received_at) >= ? GROUP BY DATE(received_at)`
  ).all(startDate);

  const sentMap    = Object.fromEntries(sentRaw.map(r => [r.date, { sent: r.sent, bounced: r.bounced }]));
  const openedMap  = Object.fromEntries(openedRaw.map(r => [r.date, r.opened]));
  const repliedMap = Object.fromEntries(repliedRaw.map(r => [r.date, r.replied]));

  const rows = dates.map(date => ({
    Date: date,
    Sent: sentMap[date]?.sent ?? 0,
    Opened: openedMap[date] ?? 0,
    Replied: repliedMap[date] ?? 0,
    Bounced: sentMap[date]?.bounced ?? 0,
  }));

  const csv = convertToCSV(rows as Record<string, unknown>[], ["Date","Sent","Opened","Replied","Bounced"]);
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="analytics_${csvDate()}.csv"`);
  return c.body(csv);
});

// ─── Blacklist Routes ─────────────────────────────────────────────────────────
import { isBlacklisted, addToBlacklist, getBlacklistStats } from "../modules/blacklistChecker";

app.get("/blacklist/stats", async (c) => {
  const stats = await getBlacklistStats();
  return c.json(stats);
});

app.get("/blacklist/check", (c) => {
  const email = c.req.query("email") ?? "";
  if (!email) return c.json({ error: "email param required" }, 400);
  const result = isBlacklisted(email);
  return c.json(result);
});

app.get("/blacklist", (c) => {
  const type = c.req.query("type") ?? "";
  const active = c.req.query("active") ?? "1";
  const search = c.req.query("search") ?? "";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (type === "email" || type === "domain") {
    conditions.push("type = ?");
    params.push(type);
  }
  if (active !== "all") {
    conditions.push("active = ?");
    params.push(parseInt(active));
  }
  if (search) {
    conditions.push("value LIKE ?");
    params.push(`%${search}%`);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const rows = db.query(`SELECT * FROM blacklist ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = (db.query(`SELECT COUNT(*) as count FROM blacklist ${where}`).get(...params) as { count: number })?.count ?? 0;

  return c.json({ rows, total });
});

app.post("/blacklist", async (c) => {
  const body = await c.req.json<{ value: string; type: string; reason?: string }>();
  if (!body.value || !body.type) return c.json({ error: "value and type are required" }, 400);
  const result = await addToBlacklist(body.value.trim(), body.type, body.reason ?? null, "manual");
  if (!result.success) return c.json({ error: result.error }, 400);
  return c.json({ success: true, is_new: result.is_new });
});

app.delete("/blacklist/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  db.run("UPDATE blacklist SET active = 0 WHERE id = ?", [id]);
  return c.json({ success: true });
});

app.put("/blacklist/:id/restore", (c) => {
  const id = parseInt(c.req.param("id"));
  db.run("UPDATE blacklist SET active = 1 WHERE id = ?", [id]);
  return c.json({ success: true });
});

app.delete("/blacklist/:id/permanent", (c) => {
  const id = parseInt(c.req.param("id"));
  const row = db.query<{ added_by: string }, [number]>("SELECT added_by FROM blacklist WHERE id = ?").get(id);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.added_by === "system-seed") return c.json({ error: "Cannot permanently delete system-seeded entries" }, 403);
  db.run("DELETE FROM blacklist WHERE id = ?", [id]);
  return c.json({ success: true });
});

app.post("/blacklist/bulk-import", async (c) => {
  const body = await c.req.json<{ csv: string }>();
  if (!body.csv) return c.json({ error: "csv is required" }, 400);

  const lines = body.csv.trim().split("\n");
  const header = (lines[0] ?? "").toLowerCase().split(",").map((h) => h.trim());
  const valueIdx = header.indexOf("value");
  const typeIdx = header.indexOf("type");
  const reasonIdx = header.indexOf("reason");

  if (valueIdx === -1 || typeIdx === -1) return c.json({ error: "CSV must have value and type columns" }, 400);

  let added = 0, skipped = 0, errors = 0;
  const errorDetails: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = (lines[i] ?? "").split(",").map((c) => c.trim());
    const value = cols[valueIdx] ?? "";
    const type = cols[typeIdx] ?? "";
    const reason = reasonIdx >= 0 ? (cols[reasonIdx] ?? null) : null;
    if (!value || !type) { errors++; continue; }
    const result = await addToBlacklist(value, type, reason, "manual");
    if (!result.success) { errors++; errorDetails.push(`Row ${i}: ${result.error}`); }
    else if (result.is_new) added++;
    else skipped++;
  }

  return c.json({ added, skipped, errors, error_details: errorDetails });
});

export default app;
