import { Hono } from "hono";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { promises as dns } from "dns";
import nodemailer from "nodemailer";
import { db } from "../database";
import { processConversationFile, runWarmupAll, getWarmupStats, generateConversation, processReplyQueue, type GeneratedConversation } from "../modules/warmup";
import { sendWarmupSummaryEmail, buildWarmupSummaryHTML, buildSummaryData, sendFailureAlert, sendWarmupCompleteNotification } from "../modules/emailReports";

const app = new Hono();

const CONVERSATIONS_DIR = join(import.meta.dir, "../../conversations");

function getCurrentClientId(): number {
  const row = db.query<{ value: string }, []>(
    "SELECT value FROM system_settings WHERE key = 'current_client_id'"
  ).get();
  return row ? Number(row.value) : 1;
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────

interface ConvEmail { from?: string; to?: string; subject?: string; body?: string; send_after_minutes?: number; }
interface ConvFingerprint {
  subjects: string[];
  first_body: string;
  sender_email: string;
  receiver_email: string;
  email_count: number;
}

function fingerprint(conv: { emails?: ConvEmail[] }): ConvFingerprint {
  const emails = conv.emails ?? [];
  const stripRe = (s: string) => s.toLowerCase().replace(/^re:\s*/i, "").trim();
  const stripPunct = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  return {
    subjects:       emails.map((e) => stripRe(e.subject ?? "")),
    first_body:     stripPunct(emails[0]?.body ?? "").slice(0, 50),
    sender_email:   emails[0]?.from ?? "",
    receiver_email: emails[0]?.to   ?? "",
    email_count:    emails.length,
  };
}

function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const len = Math.max(a.length, b.length);
  let matches = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / len;
}

interface DuplicateResult {
  is_duplicate: boolean;
  duplicates: { conversation_id: string; uploaded_at: string; similarity_score: number; matched_elements: string[] }[];
  highest_similarity_score: number;
  recommendation: string;
}

function checkDuplicates(newConv: { emails?: ConvEmail[] }): DuplicateResult {
  const fp = fingerprint(newConv);

  const recentFiles = db.query<{ filename: string; uploaded_at: string }, []>(
    "SELECT filename, uploaded_at FROM conversation_files ORDER BY uploaded_at DESC LIMIT 20"
  ).all();

  const duplicates: DuplicateResult["duplicates"] = [];

  for (const file of recentFiles) {
    let parsed: { emails?: ConvEmail[]; conversation_id?: string } | null = null;

    for (const dir of [CONVERSATIONS_DIR, join(CONVERSATIONS_DIR, "processed")]) {
      const p = join(dir, file.filename);
      if (existsSync(p)) {
        try { parsed = JSON.parse(readFileSync(p, "utf-8")); break; } catch { /* skip */ }
      }
    }
    if (!parsed) continue;

    const rfp = fingerprint(parsed);
    let score = 0;
    const matched: string[] = [];

    // Same sender+receiver pair (40 pts)
    if (fp.sender_email && fp.sender_email === rfp.sender_email &&
        fp.receiver_email && fp.receiver_email === rfp.receiver_email) {
      score += 40; matched.push("sender/receiver pair");
    }

    // Subject matches (20 pts each, cap 40)
    let subjectScore = 0;
    for (const s of fp.subjects) {
      if (s && rfp.subjects.some((rs) => rs === s)) {
        subjectScore = Math.min(subjectScore + 20, 40);
      }
    }
    if (subjectScore > 0) { score += subjectScore; matched.push("subject lines"); }

    // First body similarity ≥ 80% (30 pts)
    if (fp.first_body && rfp.first_body) {
      const sim = stringSimilarity(fp.first_body, rfp.first_body);
      if (sim >= 0.8) { score += 30; matched.push("opening body text"); }
    }

    // Same email count (10 pts)
    if (fp.email_count === rfp.email_count && fp.email_count > 0) {
      score += 10; matched.push("email count");
    }

    if (score > 0) {
      duplicates.push({
        conversation_id: parsed.conversation_id ?? file.filename,
        uploaded_at:     file.uploaded_at,
        similarity_score: score,
        matched_elements: matched,
      });
    }
  }

  duplicates.sort((a, b) => b.similarity_score - a.similarity_score);
  const highest = duplicates[0]?.similarity_score ?? 0;
  const isDuplicate = highest > 70;

  let recommendation = "This conversation looks unique.";
  if (isDuplicate) {
    recommendation = "This conversation is very similar to recent ones. Consider using a different topic or account pair.";
  } else if (highest >= 40) {
    recommendation = "This conversation has some similarities to recent ones. It should be fine but consider varying the content.";
  }

  return { is_duplicate: isDuplicate, duplicates, highest_similarity_score: highest, recommendation };
}

app.post("/conversations/check-duplicate", async (c) => {
  const body = await c.req.json<{ conversation_json?: object }>().catch(() => ({}));
  if (!body.conversation_json) return c.json({ error: "conversation_json is required" }, 400);
  return c.json(checkDuplicates(body.conversation_json as { emails?: ConvEmail[] }));
});

app.get("/accounts", (c) => {
  const showAll = c.req.query("show_all") === "true";
  const explicitClientId = c.req.query("client_id");

  let clientId: number | null = null;
  if (!showAll) {
    if (explicitClientId) {
      clientId = Number(explicitClientId);
    } else {
      const setting = db.query<{ value: string }, []>(
        "SELECT value FROM system_settings WHERE key = 'current_client_id'"
      ).get();
      if (setting) clientId = Number(setting.value);
    }
  }

  const baseQuery = `SELECT wa.id, wa.email, wa.daily_volume, wa.active,
          wa.consecutive_failures, wa.last_verified_at,
          MAX(wl.sent_at) AS last_active
   FROM warmup_accounts wa
   LEFT JOIN warmup_log wl ON wl.from_email = wa.email`;

  const rows = clientId !== null
    ? db.query<Record<string, unknown>, [number]>(
        `${baseQuery} WHERE wa.client_id = ? GROUP BY wa.id ORDER BY wa.id ASC`
      ).all(clientId)
    : db.query<Record<string, unknown>, []>(
        `${baseQuery} GROUP BY wa.id ORDER BY wa.id ASC`
      ).all();

  return c.json(rows);
});

app.get("/accounts/import-template", (c) => {
  const csv = [
    "email,app_password,daily_target,group_name",
    "warmup1@gmail.com,abcd efgh ijkl mnop,5,default",
    "warmup2@gmail.com,qrst uvwx yzab cdef,5,default",
  ].join("\n");
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", "attachment; filename=\"warmup-accounts-template.csv\"");
  return c.body(csv);
});

app.post("/accounts/bulk-import", async (c) => {
  const body = await c.req.json<{ csv: string }>();
  const raw = (body.csv ?? "").trim();
  if (!raw) return c.json({ error: "CSV content is required" }, 400);

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return c.json({ error: "CSV must have a header row and at least one data row" }, 400);

  // Parse header — detect column indices case-insensitively
  const headerCols = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, ""));
  const emailIdx = headerCols.findIndex((h) => ["email", "email", "emailaddress", "email_address"].includes(h) || h.includes("email"));
  const passIdx  = headerCols.findIndex((h) => ["app_password", "password", "app_pwd", "apppassword", "apppwd"].includes(h) || h.includes("password") || h.includes("pwd"));
  const targetIdx = headerCols.findIndex((h) => ["daily_target", "daily_limit", "limit"].includes(h));
  const groupIdx  = headerCols.findIndex((h) => ["group_name", "group"].includes(h));

  if (emailIdx === -1 || passIdx === -1) {
    return c.json({
      error: "CSV must have email and app_password columns",
      detected_headers: lines[0].split(",").map((h) => h.trim()),
    }, 400);
  }

  const imported: string[] = [];
  const skipped: { email: string; reason: string }[] = [];
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((v) => v.trim());
    const email      = cols[emailIdx] ?? "";
    const rawPass    = cols[passIdx]  ?? "";
    const appPass    = rawPass.replace(/\s/g, "");
    const dailyTarget = targetIdx >= 0 && cols[targetIdx] ? parseInt(cols[targetIdx], 10) || 5 : 5;
    const groupName   = groupIdx  >= 0 && cols[groupIdx]  ? cols[groupIdx] : "default";

    if (!email) continue;

    if (!emailRe.test(email)) {
      skipped.push({ email, reason: "invalid email format" });
      continue;
    }

    const existing = db
      .query<{ id: number }, [string]>("SELECT id FROM warmup_accounts WHERE email = ?")
      .get(email);
    if (existing) {
      skipped.push({ email, reason: "already exists" });
      continue;
    }

    if (appPass.length !== 16) {
      skipped.push({ email, reason: `invalid app password length (${appPass.length} chars, expected 16)` });
      continue;
    }

    const bulkClientId = getCurrentClientId();
    db.run(
      "INSERT INTO warmup_accounts (email, app_password, daily_volume, group_name, status, consecutive_failures, client_id) VALUES (?, ?, ?, ?, 'warming', 0, ?)",
      [email, appPass, dailyTarget, groupName, bulkClientId]
    );

    // Seed default schedule plan for this new account
    const newAcct = db.query<{ id: number }, [string]>("SELECT id FROM warmup_accounts WHERE email = ?").get(email);
    if (newAcct) {
      const defaultTargets = [{ week: 1, epd: 5 }, { week: 2, epd: 10 }, { week: 3, epd: 20 }, { week: 4, epd: 20 }];
      for (const t of defaultTargets) {
        db.run("INSERT OR IGNORE INTO warmup_schedule_plans (account_id, week_number, emails_per_day) VALUES (?, ?, ?)", [newAcct.id, t.week, t.epd]);
      }
    }

    db.run(
      "INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason) VALUES (?, ?, NULL, 'warming', 'Account created via bulk import')",
      [newAcct?.id ?? 0, email]
    );
    imported.push(email);
  }

  return c.json({ imported: imported.length, skipped: skipped.length, imported_emails: imported, skipped_details: skipped });
});

app.get("/accounts/groups", (c) => {
  const today = new Date().toISOString().split("T")[0];
  const clientId = getCurrentClientId();
  const groups = db
    .query<{ group_name: string | null }, [number]>(
      "SELECT DISTINCT COALESCE(group_name, 'default') as group_name FROM warmup_accounts WHERE client_id = ? OR client_id IS NULL ORDER BY group_name ASC"
    )
    .all(clientId);

  const result = groups.map((g) => {
    const gName = g.group_name ?? "default";
    const counts = db
      .query<{ account_count: number; active_count: number; avg_health_score: number }, [string, number]>(
        `SELECT COUNT(*) as account_count,
                SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count,
                AVG(COALESCE(health_score, 0)) as avg_health_score
         FROM warmup_accounts WHERE COALESCE(group_name, 'default') = ? AND (client_id = ? OR client_id IS NULL)`
      )
      .get(gName, clientId);
    const sentToday = db
      .query<{ count: number }, [string, string, number]>(
        `SELECT COUNT(*) as count FROM warmup_log wl
         JOIN warmup_accounts wa ON wa.email = wl.from_email
         WHERE COALESCE(wa.group_name, 'default') = ? AND DATE(wl.sent_at) = ? AND (wa.client_id = ? OR wa.client_id IS NULL)`
      )
      .get(gName, today, clientId)?.count ?? 0;
    return {
      group_name: gName,
      account_count: counts?.account_count ?? 0,
      active_count: counts?.active_count ?? 0,
      sent_today: sentToday,
      avg_health_score: Math.round(counts?.avg_health_score ?? 0),
    };
  });

  return c.json(result);
});

app.post("/accounts/groups/rename", async (c) => {
  const body = await c.req.json<{ old_name: string; new_name: string }>();
  const oldName = (body.old_name ?? "").trim();
  const newName = (body.new_name ?? "").trim();
  if (!newName) return c.json({ error: "new_name is required" }, 400);
  if (newName.length > 50) return c.json({ error: "Group name must be 50 characters or fewer" }, 400);
  if (oldName.toLowerCase() === newName.toLowerCase()) return c.json({ error: "New name must be different from current name" }, 400);
  const conflict = db
    .query<{ id: number }, [string]>("SELECT id FROM warmup_accounts WHERE LOWER(COALESCE(group_name, 'default')) = LOWER(?) LIMIT 1")
    .get(newName);
  if (conflict) return c.json({ error: "A group with that name already exists" }, 400);
  const result = db.run(
    "UPDATE warmup_accounts SET group_name = ? WHERE COALESCE(group_name, 'default') = ?",
    [newName, oldName]
  );
  return c.json({ success: true, updated: result.changes });
});

app.post("/accounts/groups/run", async (c) => {
  const body = await c.req.json<{ group_name: string }>();
  const groupName = (body.group_name ?? "").trim();
  if (!groupName) return c.json({ error: "group_name is required" }, 400);
  const clientId = getCurrentClientId();
  // Only run accounts for current client in this group
  const groupAccounts = db
    .query<{ id: number; email: string; app_password: string; daily_volume: number; active: number }, [string, number]>(
      "SELECT id, email, app_password, daily_volume, active FROM warmup_accounts WHERE COALESCE(group_name, 'default') = ? AND (client_id = ? OR client_id IS NULL) AND active = 1"
    )
    .all(groupName, clientId);
  await runWarmupAll(groupAccounts.length > 0 ? groupAccounts : undefined, groupName);
  return c.json({ success: true, message: `Warmup run triggered for group "${groupName}"` });
});

app.delete("/accounts/groups/:groupName", (c) => {
  const groupName = c.req.param("groupName");
  const moveTo = c.req.query("move_to") ?? "default";
  const result = db.run(
    "UPDATE warmup_accounts SET group_name = ? WHERE COALESCE(group_name, 'default') = ?",
    [moveTo, groupName]
  );
  return c.json({ success: true, moved: result.changes, moved_to: moveTo });
});

app.get("/accounts/history/all", (c) => {
  const rows = db
    .query<{
      id: number; account_id: number; account_email: string;
      previous_status: string | null; new_status: string;
      reason: string; changed_at: string;
    }, []>(
      `SELECT ash.id, ash.account_id, wa.email as account_email,
              ash.previous_status, ash.new_status, ash.reason, ash.changed_at
       FROM account_status_history ash
       JOIN warmup_accounts wa ON wa.id = ash.account_id
       ORDER BY ash.changed_at DESC LIMIT 100`
    )
    .all();
  return c.json(rows);
});

app.post("/accounts", async (c) => {
  const body = await c.req.json<{ email: string; app_password: string; daily_volume?: number }>();

  if (!body.email || !body.app_password) {
    return c.json({ error: "email and app_password are required" }, 400);
  }

  const clientId = getCurrentClientId();
  const result = db.run(
    "INSERT INTO warmup_accounts (email, app_password, daily_volume, client_id) VALUES (?, ?, ?, ?)",
    [body.email, body.app_password, body.daily_volume ?? 5, clientId]
  );

  const newId = result.lastInsertRowid;
  db.run(
    "INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason) VALUES (?, ?, NULL, 'warming', 'Account created manually')",
    [newId, body.email]
  );

  return c.json({ id: newId, email: body.email }, 201);
});

app.get("/accounts/progress", (c) => {
  const today = new Date().toISOString().split("T")[0];

  const clientId = getCurrentClientId();
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
      [number]
    >(
      `SELECT id, email, warmup_started_at, warmup_target_days, daily_target, consecutive_failures, status
       FROM warmup_accounts WHERE client_id = ? OR client_id IS NULL ORDER BY id ASC`
    )
    .all(clientId);

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

    // Fire warmup complete notification if just hit ready and never sent before
    if (readinessStatus === "ready") {
      const sentKey = `warmup_complete_sent_${acct.email}`;
      const alreadySent = db.query<{ value: string }, []>(`SELECT value FROM system_settings WHERE key = '${sentKey}'`).get();
      if (!alreadySent) {
        sendWarmupCompleteNotification({
          email: acct.email,
          days_active: daysActive,
          emails_sent_total: emailsSentTotal,
          health_score: healthScore,
          health_grade: healthGrade,
        }).catch((e) => console.error(`[progress] sendWarmupCompleteNotification failed for ${acct.email}:`, e));
      }
    }

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
    const prevStatus = acct.consecutive_failures >= 3 ? "flagged" : "warming";
    db.run(
      "UPDATE warmup_accounts SET last_verified_at = ?, consecutive_failures = 0, status = CASE WHEN status = 'flagged' THEN 'warming' ELSE status END WHERE id = ?",
      [verifiedAt, acct.id]
    );
    if (prevStatus === "flagged") {
      db.run(
        "INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason) VALUES (?, ?, 'flagged', 'warming', 'Verified successfully via manual check')",
        [acct.id, acct.email]
      );
    }

    return { id: acct.id, email: acct.email, success: true, message: "App password verified successfully", verified_at: verifiedAt };
  } catch (err: unknown) {
    const failures = (acct.consecutive_failures ?? 0) + 1;
    db.run(
      "UPDATE warmup_accounts SET consecutive_failures = ?, last_failure_at = CURRENT_TIMESTAMP, status = CASE WHEN ? >= 3 THEN 'flagged' ELSE status END WHERE id = ?",
      [failures, failures, acct.id]
    );
    if (failures >= 3) {
      db.run(
        "INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason) VALUES (?, ?, 'warming', 'flagged', ?)",
        [acct.id, acct.email, `Authentication failure ${failures} — account flagged`]
      );
    } else {
      db.run(
        "INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason) VALUES (?, ?, 'warming', 'warming', ?)",
        [acct.id, acct.email, `Authentication failure ${failures}`]
      );
    }
    if (failures >= 2) {
      try {
        await sendFailureAlert({
          email: acct.email,
          consecutive_failures: failures,
          last_failure_at: new Date().toISOString(),
          error_message: err instanceof Error ? err.message : String(err),
        });
      } catch (alertErr) {
        console.error(`[verify] sendFailureAlert failed for ${acct.email}:`, alertErr);
      }
    }
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
  const clientId = getCurrentClientId();
  const accounts = db
    .query<{ id: number }, [number]>("SELECT id FROM warmup_accounts WHERE active = 1 AND (client_id = ? OR client_id IS NULL) ORDER BY id ASC")
    .all(clientId);

  const results: ReadinessResult[] = [];
  for (const acct of accounts) {
    const r = await runReadinessCheckForAccount(acct.id);
    if (r) results.push(r);
  }

  return c.json(results);
});

app.post("/accounts/verify-all", async (c) => {
  const clientId = getCurrentClientId();
  const accounts = db
    .query<{ id: number }, [number]>("SELECT id FROM warmup_accounts WHERE active = 1 AND (client_id = ? OR client_id IS NULL) ORDER BY id ASC")
    .all(clientId);

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

app.get("/accounts/:id/history", (c) => {
  const id = Number(c.req.param("id"));
  const acct = db
    .query<{ email: string; status: string }, [number]>("SELECT email, status FROM warmup_accounts WHERE id = ?")
    .get(id);
  if (!acct) return c.json({ error: "Account not found" }, 404);
  const rows = db
    .query<{ id: number; previous_status: string | null; new_status: string; reason: string; changed_at: string }, [number]>(
      "SELECT id, previous_status, new_status, reason, changed_at FROM account_status_history WHERE account_id = ? ORDER BY changed_at DESC"
    )
    .all(id);
  return c.json({ account_id: id, email: acct.email, current_status: acct.status, history: rows });
});

app.delete("/accounts/:id/history", (c) => {
  const id = Number(c.req.param("id"));
  const result = db.run("DELETE FROM account_status_history WHERE account_id = ?", [id]);
  return c.json({ success: true, deleted: result.changes });
});

app.put("/accounts/:id/group", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ group_name: string }>();
  const groupName = (body.group_name ?? "").trim();
  if (!groupName) return c.json({ error: "group_name is required" }, 400);
  if (groupName.length > 50) return c.json({ error: "Group name must be 50 characters or fewer" }, 400);
  db.run("UPDATE warmup_accounts SET group_name = ? WHERE id = ?", [groupName, id]);
  const updated = db.query<{ id: number; email: string; group_name: string }, [number]>(
    "SELECT id, email, group_name FROM warmup_accounts WHERE id = ?"
  ).get(id);
  return c.json({ success: true, account: updated });
});

app.put("/accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ active: number }>();
  const acct = db.query<{ email: string; active: number }, [number]>("SELECT email, active FROM warmup_accounts WHERE id = ?").get(id);
  db.run("UPDATE warmup_accounts SET active = ? WHERE id = ?", [body.active ? 1 : 0, id]);
  if (acct) {
    const prevStatus = acct.active ? "warming" : "paused";
    const newStatus = body.active ? "warming" : "paused";
    const reason = body.active ? "Account resumed manually" : "Account paused manually";
    db.run(
      "INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason) VALUES (?, ?, ?, ?, ?)",
      [id, acct.email, prevStatus, newStatus, reason]
    );
  }
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

  const dupResult = checkDuplicates(parsed as { emails?: ConvEmail[] });

  db.run(
    `INSERT INTO conversation_files (filename, email_count, status, source, is_duplicate, similarity_score, duplicate_of)
     VALUES (?, ?, 'scheduled', 'manual', ?, ?, ?)`,
    [safeName, scheduledCount,
     dupResult.is_duplicate ? 1 : 0,
     dupResult.highest_similarity_score || null,
     dupResult.duplicates[0]?.conversation_id ?? null]
  );

  return c.json({ success: true, scheduled_emails: scheduledCount, filename: safeName, duplicate_check: dupResult });
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

  // Build a pool of topics to try (for retry on duplicate)
  const topicPool = db
    .query<{ topic: string }, []>("SELECT topic FROM warmup_conversations_library ORDER BY RANDOM()")
    .all()
    .map((r) => r.topic);

  if (!topic) topic = topicPool[0] ?? "project kickoff";

  let conv = generateConversation(sender.email, receiver.email, topic);
  let dupResult = checkDuplicates(conv as unknown as { emails?: ConvEmail[] });
  let dupWarning: string | null = null;

  // Retry up to 3 times with different topics if highly duplicate
  if (dupResult.is_duplicate && dupResult.highest_similarity_score > 85) {
    for (let attempt = 1; attempt < 3; attempt++) {
      const altTopic = topicPool[attempt] ?? topicPool[0];
      if (!altTopic || altTopic === topic) continue;
      const altConv = generateConversation(sender.email, receiver.email, altTopic);
      const altDup  = checkDuplicates(altConv as unknown as { emails?: ConvEmail[] });
      if (!altDup.is_duplicate || altDup.highest_similarity_score < dupResult.highest_similarity_score) {
        conv = altConv; topic = altTopic; dupResult = altDup; break;
      }
    }
    if (dupResult.is_duplicate) {
      dupWarning = dupResult.recommendation;
    }
  }

  const filename = `auto_${topic.replace(/\s+/g, "_")}_${Date.now()}.json`;
  const filePath = join(CONVERSATIONS_DIR, filename);
  const content = JSON.stringify(conv, null, 2);

  writeFileSync(filePath, content, "utf-8");
  processConversationFile(filePath);

  db.run(
    `INSERT INTO conversation_files (filename, email_count, status, topic, source, is_duplicate, similarity_score, duplicate_of)
     VALUES (?, ?, 'scheduled', ?, 'auto', ?, ?, ?)`,
    [filename, conv.emails.length, topic,
     dupResult.is_duplicate ? 1 : 0,
     dupResult.highest_similarity_score || null,
     dupResult.duplicates[0]?.conversation_id ?? null]
  );

  return c.json({
    success: true,
    filename,
    topic,
    sender: sender.email,
    receiver: receiver.email,
    email_count: conv.emails.length,
    conversation_id: conv.conversation_id,
    duplicate_check: dupResult,
    ...(dupWarning ? { warning: dupWarning } : {}),
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
      { id: number; filename: string; uploaded_at: string; email_count: number; status: string; topic: string | null; source: string | null; is_duplicate: number; similarity_score: number | null; duplicate_of: string | null },
      []
    >(
      "SELECT id, filename, uploaded_at, email_count, status, topic, source, is_duplicate, similarity_score, duplicate_of FROM conversation_files ORDER BY uploaded_at DESC"
    )
    .all();
  return c.json(rows);
});

app.get("/schedule/summary", (c) => {
  const today = new Date().toISOString().split("T")[0];
  const clientId = getCurrentClientId();

  const accounts = db
    .query<{ id: number; email: string; warmup_started_at: string | null }, [number]>(
      "SELECT id, email, warmup_started_at FROM warmup_accounts WHERE active = 1 AND (client_id = ? OR client_id IS NULL)"
    )
    .all(clientId);

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
  const clientId = getCurrentClientId();

  const accounts = db
    .query<{ id: number; email: string; warmup_started_at: string | null }, [number]>(
      "SELECT id, email, warmup_started_at FROM warmup_accounts WHERE client_id = ? OR client_id IS NULL ORDER BY id ASC"
    )
    .all(clientId);

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

app.get("/reports/preview-summary", (c) => {
  const data = buildSummaryData();
  const html = buildWarmupSummaryHTML(data);
  return c.json({ html });
});

app.post("/reports/send-summary", async (c) => {
  const result = await sendWarmupSummaryEmail();
  return c.json(result, result.success ? 200 : 400);
});

app.post("/reports/test-failure-alert", async (c) => {
  const acct = db
    .query<{ email: string }, []>("SELECT email FROM warmup_accounts LIMIT 1")
    .get();
  if (!acct) {
    return c.json({ success: false, message: "No warmup accounts found" }, 400);
  }
  try {
    await sendFailureAlert({
      email: acct.email,
      consecutive_failures: 3,
      last_failure_at: new Date().toISOString(),
      error_message: "Test alert — this is a simulated authentication failure",
    });
    return c.json({ success: true, message: `Test failure alert sent for ${acct.email}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, message: msg }, 500);
  }
});

app.post("/reports/test-complete-notification", async (c) => {
  const acct = db
    .query<{ email: string }, []>("SELECT email FROM warmup_accounts LIMIT 1")
    .get();
  if (!acct) {
    return c.json({ success: false, message: "No warmup accounts found" }, 400);
  }
  // Temporarily clear the dedup key so the test always sends
  const sentKey = `warmup_complete_sent_${acct.email}`;
  db.run(`DELETE FROM system_settings WHERE key = '${sentKey}'`);
  const result = await sendWarmupCompleteNotification({
    email: acct.email,
    days_active: 14,
    emails_sent_total: 87,
    health_score: 82,
    health_grade: "Excellent",
  });
  return c.json(result, result.success ? 200 : 400);
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

// ─── Reply Queue ──────────────────────────────────────────────────────────────

app.get("/reply-queue", (c) => {
  const status = c.req.query("status") ?? "";
  const rows = status
    ? db.query<{
        id: number; conversation_id: string; thread_level: number;
        from_email: string; to_email: string; subject: string;
        scheduled_at: string; status: string; created_at: string;
      }, [string]>(
        `SELECT id, conversation_id, thread_level, from_email, to_email, subject, scheduled_at, status, created_at
         FROM warmup_reply_queue WHERE status = ? ORDER BY scheduled_at ASC`
      ).all(status)
    : db.query<{
        id: number; conversation_id: string; thread_level: number;
        from_email: string; to_email: string; subject: string;
        scheduled_at: string; status: string; created_at: string;
      }, []>(
        `SELECT id, conversation_id, thread_level, from_email, to_email, subject, scheduled_at, status, created_at
         FROM warmup_reply_queue ORDER BY scheduled_at ASC`
      ).all();

  return c.json(rows);
});

app.post("/reply-queue/process", async (c) => {
  console.log("[reply-queue] Processing reply queue — manually triggered");
  const count = await processReplyQueue();
  console.log(`[reply-queue] Manual process complete — processed ${count} reply(ies)`);
  return c.json({ success: true, processed: count });
});

app.delete("/reply-queue/clear", (c) => {
  const info = db.run("DELETE FROM warmup_reply_queue WHERE status = 'sent'");
  return c.json({ success: true, deleted: info.changes });
});

app.delete("/reply-queue/failed", (c) => {
  const info = db.run("DELETE FROM warmup_reply_queue WHERE status = 'failed'");
  return c.json({ success: true, deleted: info.changes });
});

// ─── Warmup Analytics ────────────────────────────────────────────────────────

app.get("/analytics", (c) => {
  const days = Math.min(90, Math.max(1, parseInt(c.req.query("days") ?? "14")));
  const pad  = (n: number) => String(n).padStart(2, "0");

  // Build date array for last N days
  const dateList: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dateList.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  // ── daily_sends ──
  const sentByDay = db.query<{ day: string; sent: number; received: number; unique_senders: number }, [string, string]>(
    `SELECT DATE(sent_at) as day,
            COUNT(*) as sent,
            SUM(replied) as received,
            COUNT(DISTINCT from_email) as unique_senders
     FROM warmup_log
     WHERE DATE(sent_at) BETWEEN ? AND ?
     GROUP BY day
     ORDER BY day ASC`
  ).all(dateList[0], dateList[dateList.length - 1]);

  const sentMap: Record<string, { sent: number; received: number; unique_senders: number }> = {};
  for (const r of sentByDay) sentMap[r.day] = { sent: r.sent, received: r.received ?? 0, unique_senders: r.unique_senders };

  const daily_sends = dateList.map((date) => ({
    date,
    sent:           sentMap[date]?.sent           ?? 0,
    received:       sentMap[date]?.received       ?? 0,
    unique_senders: sentMap[date]?.unique_senders ?? 0,
  }));

  // ── per_account_stats ──
  const accounts = db.query<{
    email: string; health_score: number; warmup_started_at: string | null;
  }, []>("SELECT email, health_score, warmup_started_at FROM warmup_accounts ORDER BY email ASC").all();

  const per_account_stats = accounts.map((acct) => {
    const totals = db.query<{ total_sent: number; total_received: number }, [string]>(
      "SELECT COUNT(*) as total_sent, SUM(replied) as total_received FROM warmup_log WHERE from_email = ?"
    ).get(acct.email);

    const bestDayRow = db.query<{ day: string; count: number }, [string]>(
      `SELECT DATE(sent_at) as day, COUNT(*) as count FROM warmup_log WHERE from_email = ? GROUP BY day ORDER BY count DESC LIMIT 1`
    ).get(acct.email);

    const daysActive = acct.warmup_started_at
      ? Math.max(1, Math.ceil((Date.now() - new Date(acct.warmup_started_at).getTime()) / 86400000))
      : 1;

    const totalSent     = totals?.total_sent     ?? 0;
    const totalReceived = totals?.total_received ?? 0;
    return {
      email:           acct.email,
      total_sent:      totalSent,
      total_received:  totalReceived,
      avg_daily_sends: Math.round(totalSent / daysActive),
      best_day:        bestDayRow ? { date: bestDayRow.day, count: bestDayRow.count } : null,
      reply_rate:      totalSent > 0 ? Math.round((totalReceived / totalSent) * 100) : 0,
      health_score:    acct.health_score ?? 0,
    };
  });

  // ── topic_distribution ──
  const topic_distribution = db.query<{ topic: string; count: number }, []>(
    `SELECT topic, COUNT(*) as count FROM conversation_files WHERE topic IS NOT NULL GROUP BY topic ORDER BY count DESC`
  ).all();

  // ── hourly_distribution ──
  const hourlyRaw = db.query<{ hour: number; count: number }, []>(
    `SELECT CAST(strftime('%H', sent_at) AS INTEGER) as hour, COUNT(*) as count FROM warmup_log GROUP BY hour ORDER BY hour ASC`
  ).all();
  const hourMap: Record<number, number> = {};
  for (const r of hourlyRaw) hourMap[r.hour] = r.count;
  const hourly_distribution = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourMap[h] ?? 0 }));

  // ── pair_activity ──
  const pair_activity = db.query<{
    sender_email: string; receiver_email: string; pair_count: number; last_paired_at: string;
  }, []>(
    `SELECT sender_email, receiver_email, pair_count, last_paired_at FROM warmup_pairs ORDER BY pair_count DESC LIMIT 10`
  ).all();

  // ── weekly_trend ──
  const weeklyRaw = db.query<{ week_start: string; total_sent: number }, []>(
    `SELECT DATE(sent_at, 'weekday 1', '-6 days') as week_start, COUNT(*) as total_sent
     FROM warmup_log
     GROUP BY week_start
     ORDER BY week_start DESC
     LIMIT 4`
  ).all().reverse();
  const weekly_trend = weeklyRaw.map((r) => ({ week_start: r.week_start, total_sent: r.total_sent }));

  return c.json({
    days,
    daily_sends,
    per_account_stats,
    topic_distribution,
    hourly_distribution,
    pair_activity,
    weekly_trend,
  });
});

// ─── Conversation Scheduling Calendar ────────────────────────────────────────

app.get("/calendar", (c) => {
  const now   = new Date();
  const month = parseInt(c.req.query("month") ?? String(now.getMonth() + 1));
  const year  = parseInt(c.req.query("year")  ?? String(now.getFullYear()));

  if (isNaN(month) || month < 1 || month > 12) return c.json({ error: "Invalid month" }, 400);
  if (isNaN(year)  || year  < 2000 || year > 2100) return c.json({ error: "Invalid year" }, 400);

  // First/last day of the month
  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();

  // Pad to YYYY-MM-DD
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStr = `${year}-${pad(month)}`;

  // conversation_files grouped by date
  const convRows = db.query<{ day: string; count: number }, [string]>(
    `SELECT DATE(uploaded_at) as day, COUNT(*) as count
     FROM conversation_files
     WHERE strftime('%Y-%m', uploaded_at) = ?
     GROUP BY day`
  ).all(monthStr);
  const convByDay: Record<string, number> = {};
  for (const r of convRows) convByDay[r.day] = r.count;

  // Full conversation_files rows for this month (for per-day arrays)
  const convFiles = db.query<{
    id: number; filename: string; email_count: number; status: string;
    topic: string | null; source: string | null; uploaded_at: string;
  }, [string]>(
    `SELECT id, filename, email_count, status, topic, source, uploaded_at
     FROM conversation_files
     WHERE strftime('%Y-%m', uploaded_at) = ?
     ORDER BY uploaded_at ASC`
  ).all(monthStr);

  // warmup_log sent counts grouped by day
  const sentRows = db.query<{ day: string; count: number }, [string]>(
    `SELECT DATE(sent_at) as day, COUNT(*) as count
     FROM warmup_log
     WHERE strftime('%Y-%m', sent_at) = ?
     GROUP BY day`
  ).all(monthStr);
  const sentByDay: Record<string, number> = {};
  for (const r of sentRows) sentByDay[r.day] = r.count;

  // Active accounts for received counts
  const activeEmails = db.query<{ email: string }, []>(
    "SELECT email FROM warmup_accounts WHERE active = 1"
  ).all().map((r) => r.email);

  const receivedRows = activeEmails.length > 0
    ? db.query<{ day: string; count: number }, []>(
        `SELECT DATE(sent_at) as day, COUNT(*) as count
         FROM warmup_log
         WHERE strftime('%Y-%m', sent_at) = '${monthStr}'
           AND to_email IN (${activeEmails.map(() => "?").join(",")})
         GROUP BY day`
      ).all(...activeEmails as [])
    : [];
  const receivedByDay: Record<string, number> = {};
  for (const r of receivedRows) receivedByDay[r.day] = r.count;

  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`;
    const dow = new Date(year, month - 1, d).getDay(); // 0=Sun
    const isWeekend = dow === 0 || dow === 6;
    const dayConvs  = convFiles.filter((f) => f.uploaded_at.startsWith(dateStr));

    days.push({
      date:               dateStr,
      day_of_week:        dow,
      is_today:           dateStr === todayStr,
      is_weekend:         isWeekend,
      is_us_business_day: !isWeekend,
      conversations:      dayConvs,
      emails_sent:        sentByDay[dateStr]     ?? 0,
      emails_received:    receivedByDay[dateStr] ?? 0,
    });
  }

  // Monthly summary
  const totalConvs    = convFiles.length;
  const totalSent     = Object.values(sentByDay).reduce((a, b) => a + b, 0);
  const totalReceived = Object.values(receivedByDay).reduce((a, b) => a + b, 0);
  const daysWithActivity = days.filter((d) => d.emails_sent > 0 || d.conversations.length > 0).length;
  const businessDays = days.filter((d) => d.is_us_business_day);

  let busiestDay = { date: "", count: 0 };
  for (const [date, count] of Object.entries(sentByDay)) {
    if (count > busiestDay.count) busiestDay = { date, count };
  }

  return c.json({
    month,
    year,
    days,
    monthly_summary: {
      total_conversations:   totalConvs,
      total_emails_sent:     totalSent,
      total_emails_received: totalReceived,
      days_with_activity:    daysWithActivity,
      days_without_activity: businessDays.length - businessDays.filter((d) => d.emails_sent > 0).length,
      busiest_day:           busiestDay.date ? busiestDay : null,
      average_daily_sends:   daysWithActivity > 0 ? Math.round(totalSent / daysWithActivity) : 0,
    },
    active_accounts: activeEmails,
  });
});

app.get("/calendar/day/:date", (c) => {
  const dateStr = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return c.json({ error: "Date must be YYYY-MM-DD" }, 400);

  const convFiles = db.query<{
    id: number; filename: string; email_count: number; status: string;
    topic: string | null; source: string | null; uploaded_at: string;
  }, [string]>(
    `SELECT id, filename, email_count, status, topic, source, uploaded_at
     FROM conversation_files
     WHERE DATE(uploaded_at) = ?
     ORDER BY uploaded_at ASC`
  ).all(dateStr);

  // Per-account sent counts
  const sentByAccount = db.query<{ from_email: string; sent: number }, [string]>(
    `SELECT from_email, COUNT(*) as sent
     FROM warmup_log
     WHERE DATE(sent_at) = ?
     GROUP BY from_email
     ORDER BY sent DESC`
  ).all(dateStr);

  // Per-account received counts
  const receivedByAccount = db.query<{ to_email: string; received: number }, [string]>(
    `SELECT to_email, COUNT(*) as received
     FROM warmup_log
     WHERE DATE(sent_at) = ?
     GROUP BY to_email
     ORDER BY received DESC`
  ).all(dateStr);

  // Account pairs
  const pairs = db.query<{ from_email: string; to_email: string; count: number }, [string]>(
    `SELECT from_email, to_email, COUNT(*) as count
     FROM warmup_log
     WHERE DATE(sent_at) = ?
     GROUP BY from_email, to_email
     ORDER BY count DESC`
  ).all(dateStr);

  const totalSent     = sentByAccount.reduce((a, r) => a + r.sent, 0);
  const totalReceived = receivedByAccount.reduce((a, r) => a + r.received, 0);

  // Merge sent/received per account
  const accountMap: Record<string, { sent: number; received: number }> = {};
  for (const r of sentByAccount)     { accountMap[r.from_email] = { sent: r.sent, received: 0 }; }
  for (const r of receivedByAccount) {
    if (!accountMap[r.to_email]) accountMap[r.to_email] = { sent: 0, received: 0 };
    accountMap[r.to_email].received = r.received;
  }
  const per_account = Object.entries(accountMap).map(([email, v]) => ({ email, ...v }));

  return c.json({
    date: dateStr,
    conversations: convFiles,
    per_account,
    pairs,
    total_sent: totalSent,
    total_received: totalReceived,
  });
});

// ─── Conversation Topics Library ─────────────────────────────────────────────

app.get("/library/topics", (c) => {
  const rows = db.query<{
    id: number; topic: string; subject: string;
    body_sender: string; body_receiver: string; created_at: string;
  }, []>(
    "SELECT id, topic, subject, body_sender, body_receiver, created_at FROM warmup_conversations_library ORDER BY topic ASC"
  ).all();

  const result = rows.map((r) => {
    const usage = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) as count FROM conversation_files WHERE topic = ?"
    ).get(r.topic);
    return { ...r, usage_count: usage?.count ?? 0 };
  });

  return c.json(result);
});

app.post("/library/topics", async (c) => {
  const body = await c.req.json<{ topic?: string; subject?: string; body_sender?: string; body_receiver?: string }>().catch(() => ({}));
  const { topic = "", subject = "", body_sender = "", body_receiver = "" } = body;

  if (!topic.trim() || !subject.trim() || !body_sender.trim() || !body_receiver.trim()) {
    return c.json({ error: "All four fields (topic, subject, body_sender, body_receiver) are required" }, 400);
  }

  const dup = db.query<{ id: number }, [string]>(
    "SELECT id FROM warmup_conversations_library WHERE LOWER(topic) = LOWER(?)"
  ).get(topic.trim());
  if (dup) return c.json({ error: "A topic with that name already exists" }, 400);

  const info = db.run(
    "INSERT INTO warmup_conversations_library (topic, subject, body_sender, body_receiver) VALUES (?, ?, ?, ?)",
    [topic.trim(), subject.trim(), body_sender.trim(), body_receiver.trim()]
  );

  const created = db.query<{
    id: number; topic: string; subject: string;
    body_sender: string; body_receiver: string; created_at: string;
  }, [number]>(
    "SELECT id, topic, subject, body_sender, body_receiver, created_at FROM warmup_conversations_library WHERE id = ?"
  ).get(info.lastInsertRowid as number);

  return c.json({ ...created, usage_count: 0 }, 201);
});

app.put("/library/topics/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = db.query<{ id: number; topic: string }, [number]>(
    "SELECT id, topic FROM warmup_conversations_library WHERE id = ?"
  ).get(id);
  if (!existing) return c.json({ error: "Topic not found" }, 404);

  const body = await c.req.json<{ topic?: string; subject?: string; body_sender?: string; body_receiver?: string }>().catch(() => ({}));
  const topic       = (body.topic        ?? "").trim();
  const subject     = (body.subject      ?? "").trim();
  const body_sender = (body.body_sender  ?? "").trim();
  const body_receiver = (body.body_receiver ?? "").trim();

  if (!topic || !subject || !body_sender || !body_receiver) {
    return c.json({ error: "All four fields are required" }, 400);
  }

  if (topic.toLowerCase() !== existing.topic.toLowerCase()) {
    const dup = db.query<{ id: number }, [string, number]>(
      "SELECT id FROM warmup_conversations_library WHERE LOWER(topic) = LOWER(?) AND id != ?"
    ).get(topic, id);
    if (dup) return c.json({ error: "A topic with that name already exists" }, 400);
  }

  db.run(
    "UPDATE warmup_conversations_library SET topic = ?, subject = ?, body_sender = ?, body_receiver = ? WHERE id = ?",
    [topic, subject, body_sender, body_receiver, id]
  );

  const updated = db.query<{
    id: number; topic: string; subject: string;
    body_sender: string; body_receiver: string; created_at: string;
  }, [number]>(
    "SELECT id, topic, subject, body_sender, body_receiver, created_at FROM warmup_conversations_library WHERE id = ?"
  ).get(id);

  const usage = db.query<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM conversation_files WHERE topic = ?"
  ).get(updated!.topic);

  return c.json({ ...updated, usage_count: usage?.count ?? 0 });
});

app.delete("/library/topics/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const row = db.query<{ id: number; topic: string }, [number]>(
    "SELECT id, topic FROM warmup_conversations_library WHERE id = ?"
  ).get(id);
  if (!row) return c.json({ error: "Topic not found" }, 404);

  const usage = db.query<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM conversation_files WHERE topic = ?"
  ).get(row.topic);
  const usageCount = usage?.count ?? 0;

  db.run("DELETE FROM warmup_conversations_library WHERE id = ?", [id]);

  return c.json({
    success: true,
    deleted_topic: row.topic,
    usage_count: usageCount,
    warning: usageCount > 0
      ? `This topic had been used ${usageCount} time(s). Already-scheduled conversations are not affected.`
      : null,
  });
});

app.get("/library/topics/:id/preview", (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const row = db.query<{ topic: string }, [number]>(
    "SELECT topic FROM warmup_conversations_library WHERE id = ?"
  ).get(id);
  if (!row) return c.json({ error: "Topic not found" }, 404);

  const conv = generateConversation("example@sender.com", "example@receiver.com", row.topic);
  return c.json(conv);
});

// ─── Inbox Placement Test ─────────────────────────────────────────────────────

app.get("/placement/accounts", (c) => {
  const rows = db.query<{
    id: number; email: string; provider: string; label: string; active: number; created_at: string;
  }, []>(
    "SELECT id, email, provider, label, active, created_at FROM placement_test_accounts ORDER BY created_at ASC"
  ).all();
  return c.json(rows);
});

app.post("/placement/accounts", async (c) => {
  const body = await c.req.json<{ email?: string; app_password?: string; provider?: string; label?: string }>().catch(() => ({}));
  const email       = (body.email        ?? "").trim();
  const app_password = (body.app_password ?? "").trim();
  const provider    = (body.provider     ?? "gmail").trim();
  const label       = (body.label        ?? "").trim();

  if (!email || !app_password) return c.json({ error: "email and app_password are required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "Invalid email format" }, 400);

  const dup = db.query<{ id: number }, [string]>(
    "SELECT id FROM placement_test_accounts WHERE email = ?"
  ).get(email);
  if (dup) return c.json({ error: "This email is already a test inbox" }, 400);

  const info = db.run(
    "INSERT INTO placement_test_accounts (email, app_password, provider, label) VALUES (?, ?, ?, ?)",
    [email, app_password, provider, label]
  );

  const created = db.query<{
    id: number; email: string; provider: string; label: string; active: number; created_at: string;
  }, [number]>(
    "SELECT id, email, provider, label, active, created_at FROM placement_test_accounts WHERE id = ?"
  ).get(info.lastInsertRowid as number);

  return c.json(created, 201);
});

app.delete("/placement/accounts/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  db.run("DELETE FROM placement_test_accounts WHERE id = ?", [id]);
  return c.json({ success: true });
});

app.post("/placement/run", async (c) => {
  const body = await c.req.json<{ sending_account_id?: number; test_name?: string }>().catch(() => ({}));
  const accountId = body.sending_account_id;
  if (!accountId) return c.json({ error: "sending_account_id is required" }, 400);

  const sendingAccount = db.query<{ id: number; email: string; app_password: string }, [number]>(
    "SELECT id, email, app_password FROM accounts WHERE id = ?"
  ).get(accountId);
  if (!sendingAccount) return c.json({ error: "Sending account not found" }, 404);

  const testAccounts = db.query<{
    id: number; email: string; provider: string; label: string;
  }, []>(
    "SELECT id, email, provider, label FROM placement_test_accounts WHERE active = 1"
  ).all();
  if (!testAccounts.length) return c.json({ error: "Add at least one test inbox account first" }, 400);

  const systemName = db.query<{ value: string }, []>(
    "SELECT value FROM system_settings WHERE key = 'system_name'"
  ).get()?.value ?? "GTM Warmup System";

  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " + now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const testName = (body.test_name ?? `Placement Test ${dateLabel}`).trim();
  const subject  = `Inbox Placement Test — ${dateLabel}`;
  const emailBody = `Hi,\n\nJust sending a quick test to check deliverability. Please ignore this message — it is being automatically tracked.\n\nIf you see this in your inbox, everything is working correctly.\n\nBest,\n${systemName}`;

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: sendingAccount.email, pass: sendingAccount.app_password },
  });

  const insertedIds: number[] = [];
  const sentEmails: string[]  = [];

  for (const testAcct of testAccounts) {
    try {
      await transport.sendMail({
        from:    `"${systemName}" <${sendingAccount.email}>`,
        to:      testAcct.email,
        subject,
        text:    emailBody,
      });

      const info = db.run(
        `INSERT INTO inbox_placement_tests (test_name, sending_account_email, test_email, subject, status)
         VALUES (?, ?, ?, ?, 'sent')`,
        [testName, sendingAccount.email, testAcct.email, subject]
      );
      insertedIds.push(info.lastInsertRowid as number);
      sentEmails.push(testAcct.email);
      console.log(`[placement] Sent test email from ${sendingAccount.email} to ${testAcct.email}`);
    } catch (err) {
      console.error(`[placement] Failed to send to ${testAcct.email}:`, err);
    }
  }

  return c.json({
    test_ids:        insertedIds,
    sending_account: sendingAccount.email,
    test_emails:     sentEmails,
    test_name:       testName,
    message:         "Check your test inboxes and report back where each email landed.",
  });
});

app.post("/placement/report", async (c) => {
  const body = await c.req.json<{ test_id?: number; placement?: string }>().catch(() => ({}));
  const testId    = body.test_id;
  const placement = body.placement ?? "unknown";

  if (!testId) return c.json({ error: "test_id is required" }, 400);
  if (!["inbox", "spam", "promotions", "unknown"].includes(placement)) {
    return c.json({ error: "placement must be inbox, spam, promotions, or unknown" }, 400);
  }

  const row = db.query<{ id: number }, [number]>(
    "SELECT id FROM inbox_placement_tests WHERE id = ?"
  ).get(testId);
  if (!row) return c.json({ error: "Test not found" }, 404);

  db.run(
    "UPDATE inbox_placement_tests SET placement = ?, reported_at = CURRENT_TIMESTAMP, status = 'reported' WHERE id = ?",
    [placement, testId]
  );

  return c.json({ success: true, test_id: testId, placement });
});

app.get("/placement/results", (c) => {
  const days = Math.min(365, Math.max(1, parseInt(c.req.query("days") ?? "30")));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const allTests = db.query<{
    id: number; test_name: string; sending_account_email: string; test_email: string;
    subject: string; sent_at: string; placement: string; reported_at: string | null;
    status: string;
  }, [string]>(
    `SELECT id, test_name, sending_account_email, test_email, subject, sent_at, placement, reported_at, status
     FROM inbox_placement_tests
     WHERE sent_at >= ?
     ORDER BY sent_at DESC`
  ).all(since);

  // Group by sending account
  const accountMap: Record<string, {
    total_tests: number; inbox_count: number; spam_count: number;
    promotions_count: number; unknown_count: number; last_test_at: string;
  }> = {};

  for (const t of allTests) {
    if (!accountMap[t.sending_account_email]) {
      accountMap[t.sending_account_email] = {
        total_tests: 0, inbox_count: 0, spam_count: 0,
        promotions_count: 0, unknown_count: 0, last_test_at: t.sent_at,
      };
    }
    const a = accountMap[t.sending_account_email];
    a.total_tests++;
    if (t.placement === "inbox")      a.inbox_count++;
    else if (t.placement === "spam")  a.spam_count++;
    else if (t.placement === "promotions") a.promotions_count++;
    else                              a.unknown_count++;
    if (t.sent_at > a.last_test_at)   a.last_test_at = t.sent_at;
  }

  const per_account = Object.entries(accountMap).map(([email, s]) => ({
    sending_account_email: email,
    ...s,
    inbox_rate: s.total_tests > 0 ? Math.round((s.inbox_count / s.total_tests) * 100) : 0,
  }));

  return c.json({
    per_account,
    recent_tests: allTests.slice(0, 20),
  });
});

app.get("/placement/tests", (c) => {
  const status = c.req.query("status") ?? "";
  const rows = status
    ? db.query<{
        id: number; test_name: string; sending_account_email: string; test_email: string;
        subject: string; sent_at: string; placement: string; status: string;
      }, [string]>(
        "SELECT id, test_name, sending_account_email, test_email, subject, sent_at, placement, status FROM inbox_placement_tests WHERE status = ? ORDER BY sent_at DESC"
      ).all(status)
    : db.query<{
        id: number; test_name: string; sending_account_email: string; test_email: string;
        subject: string; sent_at: string; placement: string; status: string;
      }, []>(
        "SELECT id, test_name, sending_account_email, test_email, subject, sent_at, placement, status FROM inbox_placement_tests ORDER BY sent_at DESC"
      ).all();
  return c.json(rows);
});

export default app;
