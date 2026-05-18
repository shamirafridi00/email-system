import { Hono } from "hono";
import { writeFileSync } from "fs";
import { join } from "path";
import nodemailer from "nodemailer";
import { db } from "../database";
import { processConversationFile, runWarmupAll, getWarmupStats } from "../modules/warmup";

const app = new Hono();

const CONVERSATIONS_DIR = join(import.meta.dir, "../../conversations");

app.get("/accounts", (c) => {
  const rows = db
    .query<
      { id: number; email: string; daily_volume: number; active: number; last_active: string | null; consecutive_failures: number; last_verified_at: string | null },
      []
    >(
      `SELECT wa.id, wa.email, wa.daily_volume, wa.active,
              wa.consecutive_failures, wa.last_verified_at,
              MAX(wl.sent_at) AS last_active
       FROM warmup_accounts wa
       LEFT JOIN warmup_log wl ON wl.from_email = wa.email
       GROUP BY wa.id
       ORDER BY wa.id ASC`
    )
    .all();
  return c.json(rows);
});

app.post("/accounts", async (c) => {
  const body = await c.req.json<{ email: string; app_password: string; daily_volume?: number }>();

  if (!body.email || !body.app_password) {
    return c.json({ error: "email and app_password are required" }, 400);
  }

  const result = db.run(
    "INSERT INTO warmup_accounts (email, app_password, daily_volume) VALUES (?, ?, ?)",
    [body.email, body.app_password, body.daily_volume ?? 5]
  );

  return c.json({ id: result.lastInsertRowid, email: body.email }, 201);
});

app.get("/accounts/progress", (c) => {
  const today = new Date().toISOString().split("T")[0];

  const accounts = db
    .query<
      {
        id: number;
        email: string;
        warmup_started_at: string | null;
        warmup_target_days: number;
        daily_target: number;
        consecutive_failures: number;
        status: string;
      },
      []
    >(
      `SELECT id, email, warmup_started_at, warmup_target_days, daily_target, consecutive_failures, status
       FROM warmup_accounts ORDER BY id ASC`
    )
    .all();

  const results = accounts.map((acct) => {
    let warmupStartedAt = acct.warmup_started_at;
    if (!warmupStartedAt) {
      const firstLog = db
        .query<{ sent_at: string }, [string]>(
          "SELECT sent_at FROM warmup_log WHERE from_email = ? ORDER BY sent_at ASC LIMIT 1"
        )
        .get(acct.email);
      if (firstLog) {
        warmupStartedAt = firstLog.sent_at.split("T")[0];
        db.run("UPDATE warmup_accounts SET warmup_started_at = ? WHERE id = ?", [
          warmupStartedAt,
          acct.id,
        ]);
      }
    }

    const targetDays = acct.warmup_target_days ?? 14;

    let daysActive = 0;
    if (warmupStartedAt) {
      const startDate = new Date(warmupStartedAt);
      const todayDate = new Date(today);
      daysActive = Math.max(
        0,
        Math.floor((todayDate.getTime() - startDate.getTime()) / 86_400_000)
      );
    }

    const daysRemaining = Math.max(0, targetDays - daysActive);
    const progressPercentage = Math.min(100, Math.round((daysActive / targetDays) * 100));

    const emailsSentTotal =
      (db
        .query<{ count: number }, [string]>(
          "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ?"
        )
        .get(acct.email)?.count ?? 0);

    const emailsSentToday =
      (db
        .query<{ count: number }, [string, string]>(
          "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND DATE(sent_at) = ?"
        )
        .get(acct.email, today)?.count ?? 0);

    const emailsReceivedTotal =
      (db
        .query<{ count: number }, [string]>(
          "SELECT COUNT(*) as count FROM warmup_log WHERE to_email = ?"
        )
        .get(acct.email)?.count ?? 0);

    let readinessStatus: string;
    if (daysActive === 0) {
      readinessStatus = "not_started";
    } else if (daysActive < 7) {
      readinessStatus = "early_warmup";
    } else if (daysActive < 14) {
      readinessStatus = "mid_warmup";
    } else if (emailsSentTotal > 50) {
      readinessStatus = "ready";
    } else {
      readinessStatus = "needs_more_volume";
    }

    let recommendedTarget: number;
    if (daysActive < 7) {
      recommendedTarget = 5;
    } else if (daysActive < 14) {
      recommendedTarget = 10;
    } else {
      recommendedTarget = 20;
    }

    const dailyTarget = acct.daily_target ?? recommendedTarget;

    // ── Health Score ──────────────────────────────────────────────────────────

    // Factor 1: Consistency (40pts) — days with ≥1 send in last 7 days
    const activeDaysRows = db
      .query<{ day: string }, [string]>(
        `SELECT DATE(sent_at) as day
         FROM warmup_log
         WHERE from_email = ?
           AND sent_at >= DATE('now', '-6 days')
         GROUP BY DATE(sent_at)`
      )
      .all(acct.email);
    const consistencyScore = Math.round(activeDaysRows.length * (40 / 7));

    // Factor 2: Volume (30pts) — avg daily sends vs daily_target over last 7 days
    const last7SentRow = db
      .query<{ total: number }, [string]>(
        `SELECT COUNT(*) as total FROM warmup_log
         WHERE from_email = ? AND sent_at >= DATE('now', '-6 days')`
      )
      .get(acct.email);
    const avgDaily = (last7SentRow?.total ?? 0) / 7;
    const volumeRatio = dailyTarget > 0 ? avgDaily / dailyTarget : 0;
    let volumeScore: number;
    if (volumeRatio >= 1) volumeScore = 30;
    else if (volumeRatio >= 0.5) volumeScore = 20;
    else if (volumeRatio >= 0.25) volumeScore = 10;
    else volumeScore = 0;

    // Factor 3: Reply Rate (20pts)
    const repliedRow = db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND replied = 1"
      )
      .get(acct.email);
    const repliedCount = repliedRow?.count ?? 0;
    let replyRateScore: number;
    if (emailsSentTotal === 0) {
      replyRateScore = 0;
    } else {
      const replyRate = repliedCount / emailsSentTotal;
      if (replyRate > 0.3) replyRateScore = 20;
      else if (replyRate >= 0.15) replyRateScore = 15;
      else if (replyRate >= 0.05) replyRateScore = 10;
      else replyRateScore = 5;
    }

    // Factor 4: Reliability (10pts)
    const failures = acct.consecutive_failures ?? 0;
    let reliabilityScore: number;
    if (failures === 0) reliabilityScore = 10;
    else if (failures === 1) reliabilityScore = 7;
    else if (failures === 2) reliabilityScore = 4;
    else reliabilityScore = 0;

    const healthScore = Math.min(100, consistencyScore + volumeScore + replyRateScore + reliabilityScore);

    let healthGrade: string;
    if (healthScore >= 80) healthGrade = "Excellent";
    else if (healthScore >= 60) healthGrade = "Good";
    else if (healthScore >= 40) healthGrade = "Fair";
    else if (healthScore >= 20) healthGrade = "Poor";
    else healthGrade = "Critical";

    db.run("UPDATE warmup_accounts SET health_score = ? WHERE id = ?", [healthScore, acct.id]);

    return {
      id: acct.id,
      email: acct.email,
      status: acct.status,
      warmup_started_at: warmupStartedAt,
      warmup_target_days: targetDays,
      days_active: daysActive,
      days_remaining: daysRemaining,
      progress_percentage: progressPercentage,
      emails_sent_total: emailsSentTotal,
      emails_sent_today: emailsSentToday,
      emails_received_total: emailsReceivedTotal,
      readiness_status: readinessStatus,
      daily_target: dailyTarget,
      recommended_target: recommendedTarget,
      consecutive_failures: failures,
      health_score: healthScore,
      health_grade: healthGrade,
      score_breakdown: {
        consistency: { score: consistencyScore, max: 40 },
        volume:      { score: volumeScore,      max: 30 },
        reply_rate:  { score: replyRateScore,   max: 20 },
        reliability: { score: reliabilityScore, max: 10 },
      },
    };
  });

  return c.json(results);
});

async function verifyAccount(id: number): Promise<{
  id: number;
  email: string;
  success: boolean;
  message: string;
  verified_at?: string;
  error?: string;
}> {
  const acct = db
    .query<{ id: number; email: string; app_password: string; consecutive_failures: number }, [number]>(
      "SELECT id, email, app_password, consecutive_failures FROM warmup_accounts WHERE id = ?"
    )
    .get(id);

  if (!acct) return { id, email: "", success: false, message: "Account not found" };

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: acct.email, pass: acct.app_password },
    });
    await transporter.verify();

    const verifiedAt = new Date().toISOString();
    db.run(
      "UPDATE warmup_accounts SET last_verified_at = ?, consecutive_failures = 0, status = CASE WHEN status = 'flagged' THEN 'warming' ELSE status END WHERE id = ?",
      [verifiedAt, acct.id]
    );

    return { id: acct.id, email: acct.email, success: true, message: "App password verified successfully", verified_at: verifiedAt };
  } catch (err: unknown) {
    const failures = (acct.consecutive_failures ?? 0) + 1;
    db.run(
      "UPDATE warmup_accounts SET consecutive_failures = ?, last_failure_at = CURRENT_TIMESTAMP, status = CASE WHEN ? >= 3 THEN 'flagged' ELSE status END WHERE id = ?",
      [failures, failures, acct.id]
    );
    const errMsg = err instanceof Error ? err.message : String(err);
    return { id: acct.id, email: acct.email, success: false, message: "Authentication failed. Check your app password.", error: errMsg };
  }
}

app.post("/accounts/verify-all", async (c) => {
  const accounts = db
    .query<{ id: number }, []>("SELECT id FROM warmup_accounts WHERE active = 1 ORDER BY id ASC")
    .all();

  const results: Awaited<ReturnType<typeof verifyAccount>>[] = [];
  for (const acct of accounts) {
    results.push(await verifyAccount(acct.id));
    if (accounts.indexOf(acct) < accounts.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return c.json(results);
});

app.post("/accounts/:id/verify", async (c) => {
  const id = Number(c.req.param("id"));
  const result = await verifyAccount(id);
  return c.json(result, result.success ? 200 : 400);
});

app.put("/accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ active: number }>();
  db.run("UPDATE warmup_accounts SET active = ? WHERE id = ?", [body.active ? 1 : 0, id]);
  return c.json({ success: true });
});

app.delete("/accounts/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.run("DELETE FROM warmup_accounts WHERE id = ?", [id]);
  return c.json({ success: true });
});

app.post("/upload", async (c) => {
  const body = await c.req.json<{ filename: string; content: string }>();

  if (!body.filename || !body.content) {
    return c.json({ error: "filename and content are required" }, 400);
  }

  let parsed: { emails?: unknown[] };
  try {
    parsed = JSON.parse(body.content) as { emails?: unknown[] };
  } catch {
    return c.json({ error: "content is not valid JSON" }, 400);
  }

  const scheduledCount = Array.isArray(parsed.emails) ? parsed.emails.length : 0;
  const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(CONVERSATIONS_DIR, safeName);

  writeFileSync(filePath, body.content, "utf-8");
  processConversationFile(filePath);

  db.run(
    "INSERT INTO conversation_files (filename, email_count, status) VALUES (?, ?, 'scheduled')",
    [safeName, scheduledCount]
  );

  return c.json({ success: true, scheduled_emails: scheduledCount, filename: safeName });
});

app.get("/conversations", (c) => {
  const rows = db
    .query<
      { id: number; filename: string; uploaded_at: string; email_count: number; status: string },
      []
    >(
      "SELECT id, filename, uploaded_at, email_count, status FROM conversation_files ORDER BY uploaded_at DESC"
    )
    .all();
  return c.json(rows);
});

app.post("/run", async (c) => {
  await runWarmupAll();
  return c.json({ success: true, message: "warmup run triggered" });
});

app.post("/start", (c) => {
  db.run("UPDATE system_settings SET value = '1' WHERE key = 'warmup_running'");
  console.log("[warmup] warmup started");
  return c.json({ success: true, warmup_running: true });
});

app.post("/stop", (c) => {
  db.run("UPDATE system_settings SET value = '0' WHERE key = 'warmup_running'");
  console.log("[warmup] warmup stopped");
  return c.json({ success: true, warmup_running: false });
});

app.get("/status", (c) => {
  const row = db
    .query<{ value: string }, []>(
      "SELECT value FROM system_settings WHERE key = 'warmup_running'"
    )
    .get();
  return c.json({ warmup_running: row?.value === "1" });
});

app.get("/log/conversations", (c) => {
  const rows = db
    .query<{ conversation_id: string }, []>(
      "SELECT DISTINCT conversation_id FROM warmup_log WHERE conversation_id IS NOT NULL ORDER BY conversation_id ASC"
    )
    .all();
  return c.json(rows.map(function(r) { return r.conversation_id; }));
});

app.get("/log", (c) => {
  const convId = c.req.query("conversation_id");
  const rows = convId
    ? db.query<
        { id: number; from_email: string; to_email: string; subject: string; sent_at: string; replied: number; conversation_id: string },
        [string]
      >(
        "SELECT id, from_email, to_email, subject, sent_at, replied, conversation_id FROM warmup_log WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 200"
      ).all(convId)
    : db.query<
        { id: number; from_email: string; to_email: string; subject: string; sent_at: string; replied: number; conversation_id: string },
        []
      >(
        "SELECT id, from_email, to_email, subject, sent_at, replied, conversation_id FROM warmup_log ORDER BY sent_at DESC LIMIT 200"
      ).all();
  return c.json(rows);
});

app.delete("/log", (c) => {
  db.run("DELETE FROM warmup_log");
  return c.json({ success: true });
});

app.get("/stats", (c) => {
  return c.json(getWarmupStats());
});

export default app;
