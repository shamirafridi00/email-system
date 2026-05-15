import { Hono } from "hono";
import { db } from "../database";
import { sendEmail, interpolate } from "../modules/sender";

const app = new Hono();

const VALID_STATUSES = ["draft", "active", "paused", "completed"] as const;

app.get("/", (c) => {
  const rows = db
    .query<
      {
        id: number;
        name: string;
        account_id: number;
        account_email: string;
        status: string;
        daily_limit: number;
        send_days: string;
        send_start_hour: number;
        send_end_hour: number;
        created_at: string;
      },
      []
    >(
      `SELECT c.id, c.name, c.account_id, a.email AS account_email,
              c.status, c.daily_limit, c.send_days,
              c.send_start_hour, c.send_end_hour, c.created_at
       FROM campaigns c
       LEFT JOIN accounts a ON a.id = c.account_id
       ORDER BY c.created_at DESC`
    )
    .all();
  return c.json(rows);
});

app.post("/", async (c) => {
  const body = await c.req.json<{
    name: string;
    account_id: number;
    daily_limit?: number;
    send_days?: string;
    send_start_hour?: number;
    send_end_hour?: number;
  }>();

  if (!body.name || !body.account_id) {
    return c.json({ error: "name and account_id are required" }, 400);
  }

  const result = db.run(
    `INSERT INTO campaigns (name, account_id, daily_limit, send_days, send_start_hour, send_end_hour)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      body.name,
      body.account_id,
      body.daily_limit ?? 20,
      body.send_days ?? "mon,tue,wed,thu,fri",
      body.send_start_hour ?? 9,
      body.send_end_hour ?? 17,
    ]
  );

  return c.json({ id: result.lastInsertRowid, name: body.name }, 201);
});

app.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    name?: string;
    account_id?: number;
    daily_limit?: number;
    send_days?: string;
    send_start_hour?: number;
    send_end_hour?: number;
    status?: string;
  }>();

  const fieldMap: Record<string, unknown> = {};
  for (const key of ["name", "account_id", "daily_limit", "send_days", "send_start_hour", "send_end_hour", "status"] as const) {
    if (body[key] !== undefined) fieldMap[key] = body[key];
  }

  if (Object.keys(fieldMap).length === 0) {
    return c.json({ error: "no fields to update" }, 400);
  }

  const fields = Object.keys(fieldMap).map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(fieldMap), id];
  db.run(`UPDATE campaigns SET ${fields} WHERE id = ?`, values);
  return c.json({ success: true });
});

app.put("/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ status: string }>();

  if (!VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }

  db.run("UPDATE campaigns SET status = ? WHERE id = ?", [body.status, id]);
  return c.json({ success: true });
});

app.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.run("DELETE FROM sequence_steps WHERE campaign_id = ?", [id]);
  db.run("UPDATE leads SET campaign_id = NULL WHERE campaign_id = ?", [id]);
  db.run("DELETE FROM campaigns WHERE id = ?", [id]);
  return c.json({ success: true });
});

// Sequence steps

app.get("/:id/steps", (c) => {
  const id = Number(c.req.param("id"));
  const rows = db
    .query<
      { id: number; step_number: number; subject: string; body: string; delay_days: number },
      [number]
    >(
      "SELECT id, step_number, subject, body, delay_days FROM sequence_steps WHERE campaign_id = ? ORDER BY step_number ASC"
    )
    .all(id);
  return c.json(rows);
});

app.post("/:id/steps", async (c) => {
  const campaignId = Number(c.req.param("id"));
  const body = await c.req.json<{
    step_number: number;
    subject: string;
    body: string;
    delay_days?: number;
  }>();

  if (!body.step_number || !body.subject || !body.body) {
    return c.json({ error: "step_number, subject, and body are required" }, 400);
  }

  const result = db.run(
    "INSERT INTO sequence_steps (campaign_id, step_number, subject, body, delay_days) VALUES (?, ?, ?, ?, ?)",
    [campaignId, body.step_number, body.subject, body.body, body.delay_days ?? 0]
  );

  return c.json({ id: result.lastInsertRowid }, 201);
});

app.put("/:id/steps/:stepId", async (c) => {
  const stepId = Number(c.req.param("stepId"));
  const body = await c.req.json<{
    step_number?: number;
    subject?: string;
    body?: string;
    delay_days?: number;
  }>();

  const fieldMap: Record<string, unknown> = {};
  for (const key of ["step_number", "subject", "body", "delay_days"] as const) {
    if (body[key] !== undefined) fieldMap[key] = body[key];
  }

  if (Object.keys(fieldMap).length === 0) {
    return c.json({ error: "no fields to update" }, 400);
  }

  const fields = Object.keys(fieldMap).map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(fieldMap), stepId];
  db.run(`UPDATE sequence_steps SET ${fields} WHERE id = ?`, values);
  return c.json({ success: true });
});

app.delete("/:id/steps/:stepId", (c) => {
  const stepId = Number(c.req.param("stepId"));
  db.run("DELETE FROM sequence_steps WHERE id = ?", [stepId]);
  return c.json({ success: true });
});

const TEST_VARS: Record<string, string> = {
  first_name: "Alex",
  last_name: "Johnson",
  company: "Acme Studio",
  personalized_line: "noticed your recent work on the website redesign looks sharp",
};

app.post("/:id/steps/:stepId/test", async (c) => {
  const stepId = Number(c.req.param("stepId"));
  const body = await c.req.json<{ test_email: string }>();

  if (!body.test_email) {
    return c.json({ error: "test_email is required" }, 400);
  }

  const step = db
    .query<{ subject: string; body: string }, [number]>(
      "SELECT subject, body FROM sequence_steps WHERE id = ?"
    )
    .get(stepId);

  if (!step) return c.json({ error: "Step not found" }, 404);

  const account = db
    .query<{ email: string; app_password: string }, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
    )
    .get();

  if (!account) {
    return c.json({ error: "No active sending account found — add one in Sending Accounts first" }, 400);
  }

  try {
    await sendEmail({
      from: account.email,
      to: body.test_email,
      subject: interpolate(step.subject, TEST_VARS),
      body: interpolate(step.body, TEST_VARS),
      appPassword: account.app_password,
    });
    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Test email failed:`, err);
    return c.json({ error: msg }, 500);
  }
});

export default app;
