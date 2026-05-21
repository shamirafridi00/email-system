import { Hono } from "hono";
import { db } from "../database";
import { getWarmupStats } from "../modules/warmup";
import { getSequenceStats } from "../modules/sequences";
import { testHubspotConnection } from "../modules/hubspot";
import { runAllNow } from "../scheduler";

const app = new Hono();

app.get("/stats", async (c) => {
  const [warmupStats, leadStats, hubspotConnected] = await Promise.all([
    Promise.resolve(getWarmupStats()),
    getSequenceStats(),
    testHubspotConnection(),
  ]);

  const emailsSentToday =
    db
      .query<{ total: number }, []>(
        "SELECT SUM(emails_sent_today) AS total FROM accounts"
      )
      .get()?.total ?? 0;

  const activeCampaigns =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM campaigns WHERE status = 'active'"
      )
      .get()?.count ?? 0;

  const unpushedReplies =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM replies WHERE pushed_to_hubspot = 0"
      )
      .get()?.count ?? 0;

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

export default app;
