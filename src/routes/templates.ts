import { Hono } from "hono";
import { db } from "../database";

const app = new Hono();

function getCurrentClientId(): number | null {
  const row = db.query<{ value: string }, []>(
    "SELECT value FROM system_settings WHERE key = 'current_client_id'"
  ).get();
  return row ? Number(row.value) : null;
}

function getTemplateWithSteps(id: number) {
  const tpl = db.query<{
    id: number; name: string; description: string | null; category: string;
    daily_limit: number; send_days: string; send_start_hour: number; send_end_hour: number;
    timezone_aware: number; created_from_campaign_id: number | null; usage_count: number;
    created_at: string; updated_at: string;
  }, [number]>("SELECT * FROM campaign_templates WHERE id = ?").get(id);
  if (!tpl) return null;
  const steps = db.query<{
    id: number; template_id: number; step_number: number; subject: string; body: string; delay_days: number;
  }, [number]>("SELECT * FROM template_steps WHERE template_id = ? ORDER BY step_number ASC").all(id);
  return { ...tpl, steps };
}

// GET / — all templates with step count, optional ?category= filter
app.get("/", (c) => {
  const category = c.req.query("category");
  const rows = category
    ? db.query<Record<string, unknown>, [string]>(`
        SELECT t.*, COUNT(s.id) AS step_count
        FROM campaign_templates t
        LEFT JOIN template_steps s ON s.template_id = t.id
        WHERE t.category = ?
        GROUP BY t.id ORDER BY t.usage_count DESC, t.created_at DESC
      `).all(category)
    : db.query<Record<string, unknown>, []>(`
        SELECT t.*, COUNT(s.id) AS step_count
        FROM campaign_templates t
        LEFT JOIN template_steps s ON s.template_id = t.id
        GROUP BY t.id ORDER BY t.usage_count DESC, t.created_at DESC
      `).all();
  return c.json(rows);
});

// GET /:id — single template with all steps
app.get("/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const tpl = getTemplateWithSteps(id);
  if (!tpl) return c.json({ error: "Template not found" }, 404);
  return c.json(tpl);
});

// POST / — create new template
app.post("/", async (c) => {
  const body = await c.req.json<{
    name: string;
    description?: string;
    category?: string;
    daily_limit?: number;
    send_days?: string;
    send_start_hour?: number;
    send_end_hour?: number;
    timezone_aware?: number;
    steps: { step_number: number; subject: string; body: string; delay_days?: number }[];
  }>();

  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "at least one step is required" }, 400);
  }

  const result = db.run(
    `INSERT INTO campaign_templates (name, description, category, daily_limit, send_days, send_start_hour, send_end_hour, timezone_aware)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.name.trim(),
      body.description ?? null,
      body.category ?? "general",
      body.daily_limit ?? 20,
      body.send_days ?? "mon,tue,wed,thu,fri",
      body.send_start_hour ?? 9,
      body.send_end_hour ?? 17,
      body.timezone_aware ?? 0,
    ]
  );
  const tplId = Number(result.lastInsertRowid);

  const insertStep = db.prepare(
    "INSERT INTO template_steps (template_id, step_number, subject, body, delay_days) VALUES (?, ?, ?, ?, ?)"
  );
  for (const step of body.steps) {
    insertStep.run(tplId, step.step_number, step.subject, step.body, step.delay_days ?? 0);
  }

  return c.json(getTemplateWithSteps(tplId), 201);
});

// PUT /:id — update template and optionally replace steps
app.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const existing = db.query<{ id: number }, [number]>("SELECT id FROM campaign_templates WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Template not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    category?: string;
    daily_limit?: number;
    send_days?: string;
    send_start_hour?: number;
    send_end_hour?: number;
    timezone_aware?: number;
    steps?: { step_number: number; subject: string; body: string; delay_days?: number }[];
  }>();

  const allowed = ["name", "description", "category", "daily_limit", "send_days", "send_start_hour", "send_end_hour", "timezone_aware"] as const;
  const fieldMap: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) fieldMap[key] = body[key];
  }
  fieldMap.updated_at = new Date().toISOString();

  const fields = Object.keys(fieldMap).map((k) => `${k} = ?`).join(", ");
  db.run(`UPDATE campaign_templates SET ${fields} WHERE id = ?`, [...Object.values(fieldMap), id]);

  if (Array.isArray(body.steps) && body.steps.length > 0) {
    db.run("DELETE FROM template_steps WHERE template_id = ?", [id]);
    const insertStep = db.prepare(
      "INSERT INTO template_steps (template_id, step_number, subject, body, delay_days) VALUES (?, ?, ?, ?, ?)"
    );
    for (const step of body.steps) {
      insertStep.run(id, step.step_number, step.subject, step.body, step.delay_days ?? 0);
    }
  }

  return c.json(getTemplateWithSteps(id));
});

// DELETE /:id — delete template (system templates id <= 3 with no created_from_campaign_id are protected)
app.delete("/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const tpl = db.query<{ id: number; created_from_campaign_id: number | null }, [number]>(
    "SELECT id, created_from_campaign_id FROM campaign_templates WHERE id = ?"
  ).get(id);
  if (!tpl) return c.json({ error: "Template not found" }, 404);
  if (id <= 3 && tpl.created_from_campaign_id === null) {
    return c.json({ error: "System templates cannot be deleted" }, 400);
  }
  db.run("DELETE FROM template_steps WHERE template_id = ?", [id]);
  db.run("DELETE FROM campaign_templates WHERE id = ?", [id]);
  return c.json({ success: true });
});

// POST /:id/use — create a campaign from this template
app.post("/:id/use", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const tpl = getTemplateWithSteps(id);
  if (!tpl) return c.json({ error: "Template not found" }, 404);

  const body = await c.req.json<{ name: string; account_id: number; client_id?: number }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!body.account_id) return c.json({ error: "account_id is required" }, 400);

  const clientId = body.client_id ?? getCurrentClientId();

  const campResult = db.run(
    `INSERT INTO campaigns (name, account_id, daily_limit, send_days, send_start_hour, send_end_hour, timezone_aware, client_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      body.name.trim(),
      body.account_id,
      tpl.daily_limit,
      tpl.send_days,
      tpl.send_start_hour,
      tpl.send_end_hour,
      tpl.timezone_aware,
      clientId,
    ]
  );
  const campaignId = Number(campResult.lastInsertRowid);

  const insertStep = db.prepare(
    `INSERT INTO sequence_steps (campaign_id, step_number, subject, body, delay_days)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const step of tpl.steps) {
    insertStep.run(campaignId, step.step_number, step.subject, step.body, step.delay_days);
  }

  db.run("UPDATE campaign_templates SET usage_count = usage_count + 1 WHERE id = ?", [id]);

  return c.json({ success: true, campaign_id: campaignId, steps_created: tpl.steps.length }, 201);
});

// POST /save-from-campaign — save existing campaign as a template
app.post("/save-from-campaign", async (c) => {
  const body = await c.req.json<{
    campaign_id: number;
    name: string;
    description?: string;
    category?: string;
  }>();

  if (!body.campaign_id) return c.json({ error: "campaign_id is required" }, 400);
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const campaign = db.query<{
    id: number; daily_limit: number; send_days: string; send_start_hour: number;
    send_end_hour: number; timezone_aware: number;
  }, [number]>("SELECT * FROM campaigns WHERE id = ?").get(body.campaign_id);
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);

  const steps = db.query<{
    step_number: number; subject: string; body: string; delay_days: number;
  }, [number]>(
    "SELECT step_number, subject, body, delay_days FROM sequence_steps WHERE campaign_id = ? ORDER BY step_number ASC"
  ).all(body.campaign_id);

  const result = db.run(
    `INSERT INTO campaign_templates (name, description, category, daily_limit, send_days, send_start_hour, send_end_hour, timezone_aware, created_from_campaign_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.name.trim(),
      body.description ?? null,
      body.category ?? "general",
      campaign.daily_limit,
      campaign.send_days,
      campaign.send_start_hour,
      campaign.send_end_hour,
      campaign.timezone_aware,
      body.campaign_id,
    ]
  );
  const tplId = Number(result.lastInsertRowid);

  const insertStep = db.prepare(
    "INSERT INTO template_steps (template_id, step_number, subject, body, delay_days) VALUES (?, ?, ?, ?, ?)"
  );
  for (const step of steps) {
    insertStep.run(tplId, step.step_number, step.subject, step.body, step.delay_days);
  }

  return c.json(getTemplateWithSteps(tplId), 201);
});

export default app;
