import { Hono } from "hono";
import { db } from "../database";

const app = new Hono();

app.get("/", (c) => {
  const rows = db
    .query<
      {
        id: number;
        email: string;
        domain: string;
        daily_limit: number;
        emails_sent_today: number;
        status: string;
        created_at: string;
      },
      []
    >(
      "SELECT id, email, domain, daily_limit, emails_sent_today, status, created_at FROM accounts ORDER BY created_at DESC"
    )
    .all();
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

  const result = db.run(
    "INSERT INTO accounts (email, app_password, domain, daily_limit) VALUES (?, ?, ?, ?)",
    [body.email, body.app_password, body.domain ?? null, body.daily_limit ?? 20]
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

export default app;
