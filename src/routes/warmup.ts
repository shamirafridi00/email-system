import { Hono } from "hono";
import { writeFileSync } from "fs";
import { join } from "path";
import { db } from "../database";
import { processConversationFile, runWarmupAll, getWarmupStats } from "../modules/warmup";

const app = new Hono();

const CONVERSATIONS_DIR = join(import.meta.dir, "../../conversations");

app.get("/accounts", (c) => {
  const rows = db
    .query<
      { id: number; email: string; daily_volume: number; active: number; last_active: string | null },
      []
    >(
      `SELECT wa.id, wa.email, wa.daily_volume, wa.active,
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

app.get("/log", (c) => {
  const rows = db
    .query<
      {
        id: number;
        from_email: string;
        to_email: string;
        subject: string;
        sent_at: string;
        replied: number;
      },
      []
    >(
      "SELECT id, from_email, to_email, subject, sent_at, replied FROM warmup_log ORDER BY sent_at DESC LIMIT 100"
    )
    .all();
  return c.json(rows);
});

app.get("/stats", (c) => {
  return c.json(getWarmupStats());
});

export default app;
