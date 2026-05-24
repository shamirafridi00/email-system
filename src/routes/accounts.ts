import { Hono } from "hono";
import { db } from "../database";

const app = new Hono();

app.get("/", (c) => {
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

  const rows = clientId !== null
    ? db.query<Record<string, unknown>, [number]>(
        "SELECT id, email, domain, daily_limit, emails_sent_today, status, created_at, client_id FROM accounts WHERE client_id = ? ORDER BY created_at DESC"
      ).all(clientId)
    : db.query<Record<string, unknown>, []>(
        "SELECT id, email, domain, daily_limit, emails_sent_today, status, created_at, client_id FROM accounts ORDER BY created_at DESC"
      ).all();

  return c.json(rows);
});

app.post("/", async (c) => {
  const body = await c.req.json<{
    email: string;
    app_password: string;
    domain?: string;
    daily_limit?: number;
  }>();

  if (!body.email || !body.app_password) {
    return c.json({ error: "email and app_password are required" }, 400);
  }

  const clientSetting = db.query<{ value: string }, []>(
    "SELECT value FROM system_settings WHERE key = 'current_client_id'"
  ).get();
  const currentClientId = clientSetting ? Number(clientSetting.value) : null;

  const result = db.run(
    "INSERT INTO accounts (email, app_password, domain, daily_limit, client_id) VALUES (?, ?, ?, ?, ?)",
    [body.email, body.app_password, body.domain ?? null, body.daily_limit ?? 20, currentClientId]
  );

  return c.json({ id: result.lastInsertRowid, email: body.email }, 201);
});

app.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ daily_limit?: number; status?: string }>();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.daily_limit !== undefined) {
    fields.push("daily_limit = ?");
    values.push(body.daily_limit);
  }
  if (body.status !== undefined) {
    fields.push("status = ?");
    values.push(body.status);
  }

  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);

  values.push(id);
  db.run(`UPDATE accounts SET ${fields.join(", ")} WHERE id = ?`, values);
  return c.json({ success: true });
});

app.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.run("DELETE FROM accounts WHERE id = ?", [id]);
  return c.json({ success: true });
});

app.get("/:id/stats", (c) => {
  const id = Number(c.req.param("id"));
  const row = db
    .query<{ emails_sent_today: number; daily_limit: number }, [number]>(
      "SELECT emails_sent_today, daily_limit FROM accounts WHERE id = ?"
    )
    .get(id);

  if (!row) return c.json({ error: "account not found" }, 404);
  return c.json(row);
});

app.get("/:id/bounce-history", (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const rows = db
    .query<{
      id: number;
      lead_id: number;
      campaign_id: number;
      step_number: number;
      subject: string;
      sent_at: string;
    }, [number]>(
      `SELECT sl.id, sl.lead_id, sl.campaign_id, sl.step_number, sl.subject, sl.sent_at
       FROM sent_log sl
       JOIN campaigns c ON c.id = sl.campaign_id
       WHERE c.account_id = ? AND sl.bounced = 1
       ORDER BY sl.sent_at DESC
       LIMIT 50`
    )
    .all(id);

  return c.json(rows);
});

app.get("/:id/status-history", (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const rows = db
    .query<{
      id: number;
      previous_status: string;
      new_status: string;
      reason: string;
      changed_at: string;
    }, [number]>(
      `SELECT id, previous_status, new_status, reason, changed_at
       FROM account_status_history
       WHERE account_id = ?
       ORDER BY changed_at DESC
       LIMIT 20`
    )
    .all(id);

  return c.json(rows);
});

export default app;
