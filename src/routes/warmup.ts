import { Hono } from "hono";
import { writeFileSync } from "fs";
import { join } from "path";
import { promises as dns } from "dns";
import nodemailer from "nodemailer";
import { db } from "../database";
import { processConversationFile, runWarmupAll, getWarmupStats, generateConversation, type GeneratedConversation } from "../modules/warmup";

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

interface ReadinessCheck {
  name: string;
  status: "pass" | "warning" | "fail";
  message: string;
  points_earned: number;
  points_max: number;
  detail?: string;
}

interface ReadinessResult {
  id: number;
  email: string;
  overall_score: number;
  overall_status: string;
  overall_color: string;
  recommendation: string;
  checks: ReadinessCheck[];
}

async function runReadinessCheckForAccount(id: number): Promise<ReadinessResult | null> {
  const acct = db
    .query<{
      id: number; email: string; warmup_started_at: string | null;
      consecutive_failures: number;
    }, [number]>(
      "SELECT id, email, warmup_started_at, consecutive_failures FROM warmup_accounts WHERE id = ?"
    )
    .get(id);

  if (!acct) return null;

  const domain = acct.email.split("@")[1] ?? "";
  const checks: ReadinessCheck[] = [];

  // ── Check 1: DNS Records (25 pts) ─────────────────────────────────────────
  let spfPass = false; let spfDetail = "";
  let dkimPass = false; let dkimDetail = "";
  let dmarcPass = false; let dmarcDetail = "";

  try {
    const txtRecords = await dns.resolveTxt(domain);
    for (const recs of txtRecords) {
      const joined = recs.join("");
      if (!spfPass && joined.includes("v=spf1")) { spfPass = true; spfDetail = joined.slice(0, 80); }
      if (!dkimPass && (joined.includes("p=") || joined.toLowerCase().includes("dkim"))) {
        dkimPass = true; dkimDetail = joined.slice(0, 80);
      }
    }
  } catch {}

  try {
    const dmarcRecs = await dns.resolveTxt(`_dmarc.${domain}`);
    for (const recs of dmarcRecs) {
      const joined = recs.join("");
      if (joined.includes("v=DMARC1")) { dmarcPass = true; dmarcDetail = joined.slice(0, 80); }
    }
  } catch {}

  const dnsAll = spfPass && dkimPass && dmarcPass;
  const dnsSome = spfPass || dkimPass || dmarcPass;
  const dnsParts = [
    spfPass ? "SPF ✓" : "SPF ✗",
    dkimPass ? "DKIM ✓" : "DKIM ✗",
    dmarcPass ? "DMARC ✓" : "DMARC ✗",
  ].join("  ");

  checks.push({
    name: "DNS Records",
    status: dnsAll ? "pass" : dnsSome ? "warning" : "fail",
    message: dnsAll
      ? `All DNS records configured — ${dnsParts}`
      : `Some records missing — ${dnsParts}`,
    points_earned: dnsAll ? 25 : dnsSome ? 12 : 0,
    points_max: 25,
    detail: [spfDetail, dkimDetail, dmarcDetail].filter(Boolean).join(" | ").slice(0, 120) || undefined,
  });

  // ── Check 2: Warmup Duration (25 pts) ─────────────────────────────────────
  let durationStatus: "pass" | "warning" | "fail";
  let durationMsg: string;
  let durationPts = 0;
  let daysActive = 0;

  if (!acct.warmup_started_at) {
    durationStatus = "fail"; durationMsg = "Warmup has not started yet";
  } else {
    daysActive = Math.floor((Date.now() - new Date(acct.warmup_started_at).getTime()) / 86_400_000);
    if (daysActive >= 14) {
      durationStatus = "pass"; durationMsg = `${daysActive} days active — full warmup complete`; durationPts = 25;
    } else if (daysActive >= 7) {
      const rem = 14 - daysActive;
      durationStatus = "warning"; durationMsg = `${daysActive} days active — ${rem} more day${rem === 1 ? "" : "s"} to go`; durationPts = 13;
    } else {
      const rem = 14 - daysActive;
      durationStatus = "fail"; durationMsg = `Only ${daysActive} day${daysActive === 1 ? "" : "s"} active — ${rem} days remaining`;
    }
  }

  checks.push({ name: "Warmup Duration", status: durationStatus, message: durationMsg, points_earned: durationPts, points_max: 25 });

  // ── Check 3: Volume Sufficiency (20 pts) ──────────────────────────────────
  const totalSent = db
    .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ?")
    .get(acct.email)?.count ?? 0;

  let volStatus: "pass" | "warning" | "fail";
  let volMsg: string; let volPts = 0;
  if (totalSent >= 50) { volStatus = "pass"; volMsg = `${totalSent} warmup emails sent — excellent volume`; volPts = 20; }
  else if (totalSent >= 30) { volStatus = "warning"; volMsg = `${totalSent} warmup emails sent — borderline, consider sending more`; volPts = 10; }
  else { volStatus = "fail"; volMsg = `Only ${totalSent} sent — need at least 30 warmup emails`; }

  checks.push({ name: "Volume Sufficiency", status: volStatus, message: volMsg, points_earned: volPts, points_max: 20 });

  // ── Check 4: Reply Rate (15 pts) ──────────────────────────────────────────
  const replied = db
    .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND replied = 1")
    .get(acct.email)?.count ?? 0;

  const replyRate = totalSent > 0 ? replied / totalSent : 0;
  const replyPct = (replyRate * 100).toFixed(1);
  let replyStatus: "pass" | "warning" | "fail";
  let replyMsg: string; let replyPts = 0;
  if (replyRate > 0.2) { replyStatus = "pass"; replyMsg = `${replyPct}% reply rate — strong engagement`; replyPts = 15; }
  else if (replyRate >= 0.1) { replyStatus = "warning"; replyMsg = `${replyPct}% reply rate — acceptable but could be higher`; replyPts = 8; }
  else { replyStatus = "fail"; replyMsg = totalSent === 0 ? "No emails sent yet" : `${replyPct}% reply rate — too low (need >10%)`; }

  checks.push({ name: "Reply Rate", status: replyStatus, message: replyMsg, points_earned: replyPts, points_max: 15 });

  // ── Check 5: Authentication Health (10 pts) ───────────────────────────────
  const failures = acct.consecutive_failures ?? 0;
  let authStatus: "pass" | "warning" | "fail";
  let authMsg: string; let authPts = 0;
  if (failures === 0) { authStatus = "pass"; authMsg = "No authentication failures"; authPts = 10; }
  else if (failures <= 2) { authStatus = "warning"; authMsg = `${failures} consecutive failure${failures > 1 ? "s" : ""} — verify app password`; authPts = 5; }
  else { authStatus = "fail"; authMsg = `${failures} consecutive failures — fix app password before sending`; }

  checks.push({ name: "Authentication Health", status: authStatus, message: authMsg, points_earned: authPts, points_max: 10 });

  // ── Check 6: Recent Activity (5 pts) ──────────────────────────────────────
  const recentCount = db
    .query<{ count: number }, [string]>(
      "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND sent_at >= datetime('now', '-3 days')"
    )
    .get(acct.email)?.count ?? 0;

  let recentStatus: "pass" | "warning" | "fail";
  let recentMsg: string; let recentPts = 0;
  if (recentCount > 0) { recentStatus = "pass"; recentMsg = `${recentCount} email${recentCount === 1 ? "" : "s"} sent in last 3 days`; recentPts = 5; }
  else { recentStatus = "fail"; recentMsg = "No warmup activity in the last 3 days"; }

  checks.push({ name: "Recent Activity", status: recentStatus, message: recentMsg, points_earned: recentPts, points_max: 5 });

  // ── Overall score ─────────────────────────────────────────────────────────
  const score = checks.reduce((sum, c) => sum + c.points_earned, 0);
  let overallStatus: string; let overallColor: string; let recommendation: string;
  if (score >= 90) {
    overallStatus = "Ready to Launch"; overallColor = "#22c55e";
    recommendation = "Your account is well-warmed and ready for real cold email campaigns. Monitor reply rates after launch.";
  } else if (score >= 70) {
    overallStatus = "Almost Ready"; overallColor = "#f59e0b";
    const weak = checks.filter(c => c.status !== "pass").map(c => c.name).join(", ");
    recommendation = `Address these before launching: ${weak}.`;
  } else if (score >= 50) {
    overallStatus = "Needs Work"; overallColor = "#f97316";
    const failing = checks.filter(c => c.status === "fail").map(c => c.name).join(", ");
    recommendation = `Fix critical issues first: ${failing || "review all checks"}.`;
  } else {
    overallStatus = "Not Ready"; overallColor = "#ef4444";
    recommendation = "Do not launch campaigns yet. Continue warmup and resolve all failing checks.";
  }

  return { id: acct.id, email: acct.email, overall_score: score, overall_status: overallStatus, overall_color: overallColor, recommendation, checks };
}

app.get("/accounts/readiness-all", async (c) => {
  const accounts = db
    .query<{ id: number }, []>("SELECT id FROM warmup_accounts WHERE active = 1 ORDER BY id ASC")
    .all();

  const results: ReadinessResult[] = [];
  for (const acct of accounts) {
    const r = await runReadinessCheckForAccount(acct.id);
    if (r) results.push(r);
  }

  return c.json(results);
});

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

app.post("/accounts/:id/readiness-check", async (c) => {
  const id = Number(c.req.param("id"));
  const result = await runReadinessCheckForAccount(id);
  if (!result) return c.json({ error: "Account not found" }, 404);
  return c.json(result);
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

app.get("/conversations/topics", (c) => {
  const rows = db
    .query<{ topic: string }, []>(
      "SELECT DISTINCT topic FROM warmup_conversations_library WHERE topic IS NOT NULL ORDER BY topic ASC"
    )
    .all();
  return c.json(rows.map((r) => r.topic));
});

app.post("/conversations/generate", async (c) => {
  const body = await c.req.json<{ topic?: string; sender_email?: string; receiver_email?: string }>().catch(() => ({}));

  const accounts = db
    .query<{ id: number; email: string; app_password: string; daily_volume: number; active: number }, []>(
      "SELECT * FROM warmup_accounts WHERE active = 1"
    )
    .all();

  if (accounts.length < 2) {
    return c.json({ error: "Need at least 2 active warmup accounts to generate a conversation" }, 400);
  }

  const shuffled = accounts.slice().sort(() => Math.random() - 0.5);
  const sender = body.sender_email
    ? accounts.find((a) => a.email === body.sender_email) ?? shuffled[0]
    : shuffled[0];
  const receiver = body.receiver_email
    ? accounts.find((a) => a.email === body.receiver_email && a.email !== sender.email) ?? shuffled.find((a) => a.email !== sender.email)!
    : shuffled.find((a) => a.email !== sender.email)!;

  let topic = body.topic ?? null;
  if (!topic) {
    const row = db
      .query<{ topic: string }, []>(
        "SELECT topic FROM warmup_conversations_library ORDER BY RANDOM() LIMIT 1"
      )
      .get();
    topic = row?.topic ?? "project kickoff";
  }

  const conv = generateConversation(sender.email, receiver.email, topic);

  const filename = `auto_${topic.replace(/\s+/g, "_")}_${Date.now()}.json`;
  const filePath = join(CONVERSATIONS_DIR, filename);
  const content = JSON.stringify(conv, null, 2);

  writeFileSync(filePath, content, "utf-8");
  processConversationFile(filePath);

  db.run(
    "INSERT INTO conversation_files (filename, email_count, status, topic, source) VALUES (?, ?, 'scheduled', ?, 'auto')",
    [filename, conv.emails.length, topic]
  );

  return c.json({
    success: true,
    filename,
    topic,
    sender: sender.email,
    receiver: receiver.email,
    email_count: conv.emails.length,
    conversation_id: conv.conversation_id,
  });
});

app.post("/conversations/generate-bulk", async (c) => {
  const body = await c.req.json<{ count?: number; topic?: string }>().catch(() => ({}));
  const count = Math.min(5, Math.max(1, body.count ?? 3));

  const accounts = db
    .query<{ id: number; email: string; app_password: string; daily_volume: number; active: number }, []>(
      "SELECT * FROM warmup_accounts WHERE active = 1"
    )
    .all();

  if (accounts.length < 2) {
    return c.json({ error: "Need at least 2 active warmup accounts" }, 400);
  }

  const results: { filename: string; topic: string; sender: string; receiver: string; email_count: number }[] = [];

  for (let i = 0; i < count; i++) {
    let topic = body.topic ?? null;
    if (!topic) {
      const row = db
        .query<{ topic: string }, []>(
          "SELECT topic FROM warmup_conversations_library ORDER BY RANDOM() LIMIT 1"
        )
        .get();
      topic = row?.topic ?? "project kickoff";
    }

    const shuffled = accounts.slice().sort(() => Math.random() - 0.5);
    const sender = shuffled[0];
    const receiver = shuffled.find((a) => a.email !== sender.email)!;

    const conv = generateConversation(sender.email, receiver.email, topic);
    const filename = `auto_${topic.replace(/\s+/g, "_")}_${Date.now()}_${i}.json`;
    const filePath = join(CONVERSATIONS_DIR, filename);
    const content = JSON.stringify(conv, null, 2);

    writeFileSync(filePath, content, "utf-8");
    processConversationFile(filePath);

    db.run(
      "INSERT INTO conversation_files (filename, email_count, status, topic, source) VALUES (?, ?, 'scheduled', ?, 'auto')",
      [filename, conv.emails.length, topic]
    );

    results.push({ filename, topic, sender: sender.email, receiver: receiver.email, email_count: conv.emails.length });

    if (i < count - 1) await new Promise((r) => setTimeout(r, 100));
  }

  return c.json({ success: true, generated: results.length, conversations: results });
});

app.get("/conversations", (c) => {
  const rows = db
    .query<
      { id: number; filename: string; uploaded_at: string; email_count: number; status: string; topic: string | null; source: string | null },
      []
    >(
      "SELECT id, filename, uploaded_at, email_count, status, topic, source FROM conversation_files ORDER BY uploaded_at DESC"
    )
    .all();
  return c.json(rows);
});

app.get("/schedule/summary", (c) => {
  const today = new Date().toISOString().split("T")[0];

  const accounts = db
    .query<{ id: number; email: string; warmup_started_at: string | null }, []>(
      "SELECT id, email, warmup_started_at FROM warmup_accounts WHERE active = 1"
    )
    .all();

  const weekCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  let onTrack = 0;
  let behind = 0;
  const projections: { email: string; ready_date: string | null; week: number }[] = [];

  for (const acct of accounts) {
    let weekNum = 0;
    let readyDate: string | null = null;

    if (acct.warmup_started_at) {
      const start = new Date(acct.warmup_started_at);
      const daysActive = Math.floor((Date.now() - start.getTime()) / 86_400_000);
      weekNum = Math.min(4, Math.floor(daysActive / 7) + 1);
      const ready = new Date(start.getTime() + 14 * 86_400_000);
      readyDate = ready.toISOString().split("T")[0];
    }

    weekCounts[weekNum] = (weekCounts[weekNum] || 0) + 1;

    const plan = db
      .query<{ emails_per_day: number }, [number, number]>(
        "SELECT emails_per_day FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ? AND active = 1"
      )
      .get(acct.id, Math.max(1, weekNum));
    const target = plan?.emails_per_day ?? (weekNum <= 1 ? 5 : weekNum === 2 ? 10 : 20);

    const sentToday = db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND DATE(sent_at) = ?"
      )
      .get(acct.email, today)?.count ?? 0;

    if (sentToday >= target) onTrack++;
    else behind++;

    projections.push({ email: acct.email, ready_date: readyDate, week: weekNum });
  }

  return c.json({
    week_counts: weekCounts,
    on_track: onTrack,
    behind,
    total_accounts: accounts.length,
    projections,
  });
});

app.get("/schedule", (c) => {
  const today = new Date().toISOString().split("T")[0];
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const accounts = db
    .query<{ id: number; email: string; warmup_started_at: string | null }, []>(
      "SELECT id, email, warmup_started_at FROM warmup_accounts ORDER BY id ASC"
    )
    .all();

  const result = accounts.map((acct) => {
    let weekNum = 0;
    let readyDate: string | null = null;

    if (acct.warmup_started_at) {
      const start = new Date(acct.warmup_started_at);
      const daysActive = Math.floor((Date.now() - start.getTime()) / 86_400_000);
      weekNum = Math.min(4, Math.floor(daysActive / 7) + 1);
      const ready = new Date(start.getTime() + 14 * 86_400_000);
      readyDate = ready.toISOString().split("T")[0];
    }

    const plan = db
      .query<{ emails_per_day: number }, [number, number]>(
        "SELECT emails_per_day FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ? AND active = 1"
      )
      .get(acct.id, Math.max(1, weekNum));
    const dailyTarget = plan?.emails_per_day ?? (weekNum <= 1 ? 5 : weekNum === 2 ? 10 : 20);

    const sentToday = db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND DATE(sent_at) = ?"
      )
      .get(acct.email, today)?.count ?? 0;

    const sentThisWeek = db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND DATE(sent_at) >= ?"
      )
      .get(acct.email, weekStartStr)?.count ?? 0;

    // Ensure plan rows exist for this account (seed if new account)
    for (const wk of [1, 2, 3, 4]) {
      const exists = db
        .query<{ id: number }, [number, number]>(
          "SELECT id FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ?"
        )
        .get(acct.id, wk);
      if (!exists) {
        const defaults = [5, 10, 20, 20];
        db.run(
          "INSERT INTO warmup_schedule_plans (account_id, week_number, emails_per_day) VALUES (?, ?, ?)",
          [acct.id, wk, defaults[wk - 1]]
        );
      }
    }

    const allWeekPlans = db
      .query<{ week_number: number; emails_per_day: number }, [number]>(
        "SELECT week_number, emails_per_day FROM warmup_schedule_plans WHERE account_id = ? AND active = 1 ORDER BY week_number ASC"
      )
      .all(acct.id);

    return {
      id: acct.id,
      email: acct.email,
      warmup_started_at: acct.warmup_started_at,
      current_week: weekNum,
      daily_target: dailyTarget,
      sent_today: sentToday,
      sent_this_week: sentThisWeek,
      on_track: sentToday >= dailyTarget,
      projected_ready_date: readyDate,
      week_plans: allWeekPlans,
    };
  });

  return c.json(result);
});

app.post("/schedule", async (c) => {
  const body = await c.req.json<{ entries: { account_id: number; week_number: number; emails_per_day: number }[] }>();

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return c.json({ error: "entries array is required" }, 400);
  }

  for (const entry of body.entries) {
    const exists = db
      .query<{ id: number }, [number, number]>(
        "SELECT id FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ?"
      )
      .get(entry.account_id, entry.week_number);

    if (exists) {
      db.run(
        "UPDATE warmup_schedule_plans SET emails_per_day = ? WHERE account_id = ? AND week_number = ?",
        [entry.emails_per_day, entry.account_id, entry.week_number]
      );
    } else {
      db.run(
        "INSERT INTO warmup_schedule_plans (account_id, week_number, emails_per_day) VALUES (?, ?, ?)",
        [entry.account_id, entry.week_number, entry.emails_per_day]
      );
    }
  }

  return c.json({ success: true, updated: body.entries.length });
});

app.get("/settings/auto-generate", (c) => {
  const row = db
    .query<{ value: string }, []>(
      "SELECT value FROM system_settings WHERE key = 'auto_generate_conversations'"
    )
    .get();
  return c.json({ enabled: row?.value === "1" });
});

app.post("/settings/auto-generate", async (c) => {
  const body = await c.req.json<{ enabled: boolean }>();
  const val = body.enabled ? "1" : "0";
  db.run(
    "INSERT INTO system_settings (key, value) VALUES ('auto_generate_conversations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [val]
  );
  return c.json({ success: true, enabled: body.enabled });
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
