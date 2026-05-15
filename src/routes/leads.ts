import { Hono } from "hono";
import { db } from "../database";
import { getSequenceStats, rescheduleLeads } from "../modules/sequences";

const app = new Hono();

app.get("/", (c) => {
  const campaignId = c.req.query("campaign_id");

  const rows = campaignId
    ? db
        .query<
          {
            id: number;
            campaign_id: number;
            campaign_name: string;
            first_name: string;
            last_name: string;
            email: string;
            company: string;
            website: string;
            personalized_line: string;
            current_step: number;
            next_send_date: string;
            status: string;
            created_at: string;
          },
          [number]
        >(
          `SELECT l.*, c.name AS campaign_name
           FROM leads l
           LEFT JOIN campaigns c ON c.id = l.campaign_id
           WHERE l.campaign_id = ?
           ORDER BY l.created_at DESC`
        )
        .all(Number(campaignId))
    : db
        .query<
          {
            id: number;
            campaign_id: number;
            campaign_name: string;
            first_name: string;
            last_name: string;
            email: string;
            company: string;
            website: string;
            personalized_line: string;
            current_step: number;
            next_send_date: string;
            status: string;
            created_at: string;
          },
          []
        >(
          `SELECT l.*, c.name AS campaign_name
           FROM leads l
           LEFT JOIN campaigns c ON c.id = l.campaign_id
           ORDER BY l.created_at DESC`
        )
        .all();

  return c.json(rows);
});

app.post("/import", async (c) => {
  const body = await c.req.json<{ campaign_id: number; csv: string }>();

  if (!body.campaign_id || !body.csv) {
    return c.json({ error: "campaign_id and csv are required" }, 400);
  }

  const today = new Date().toISOString().split("T")[0];
  const lines = body.csv.trim().split("\n").map((l) => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    return c.json({ error: "CSV must have a header row and at least one data row" }, 400);
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const required = ["first_name", "last_name", "email", "company", "website", "personalized_line"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return c.json({ error: `Missing CSV columns: ${missing.join(", ")}` }, 400);
  }

  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  let imported = 0;
  let skipped = 0;

  const insert = db.prepare(
    `INSERT INTO leads (campaign_id, first_name, last_name, email, company, website, personalized_line, current_step, next_send_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'active')`
  );

  const checkDupe = db.prepare<{ id: number }, [string, number]>(
    "SELECT id FROM leads WHERE email = ? AND campaign_id = ?"
  );

  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((v) => v.trim());
    const email = cols[idx.email] ?? "";
    if (!email) { skipped++; continue; }

    const existing = checkDupe.get(email, body.campaign_id);
    if (existing) { skipped++; continue; }

    insert.run(
      body.campaign_id,
      cols[idx.first_name] ?? "",
      cols[idx.last_name] ?? "",
      email,
      cols[idx.company] ?? "",
      cols[idx.website] ?? "",
      cols[idx.personalized_line] ?? "",
      today
    );
    imported++;
  }

  return c.json({ imported, skipped });
});

app.get("/stats", async (c) => {
  return c.json(await getSequenceStats());
});

app.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    status?: string;
    next_send_date?: string;
    current_step?: number;
    first_name?: string;
    last_name?: string;
    company?: string;
    website?: string;
    personalized_line?: string;
  }>();

  const allowed = ["status", "next_send_date", "current_step", "first_name", "last_name", "company", "website", "personalized_line"];
  const fieldMap: Record<string, unknown> = {};
  for (const key of allowed) {
    if ((body as Record<string, unknown>)[key] !== undefined) {
      fieldMap[key] = (body as Record<string, unknown>)[key];
    }
  }

  if (Object.keys(fieldMap).length === 0) {
    return c.json({ error: "no fields to update" }, 400);
  }

  const fields = Object.keys(fieldMap).map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(fieldMap), id];
  db.run(`UPDATE leads SET ${fields} WHERE id = ?`, values);
  return c.json({ success: true });
});

app.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.run("DELETE FROM leads WHERE id = ?", [id]);
  return c.json({ success: true });
});

app.post("/:id/reset", (c) => {
  const id = Number(c.req.param("id"));
  const today = new Date().toISOString().split("T")[0];
  db.run(
    "UPDATE leads SET status = 'active', current_step = 1, next_send_date = ? WHERE id = ?",
    [today, id]
  );
  return c.json({ success: true });
});

export default app;
