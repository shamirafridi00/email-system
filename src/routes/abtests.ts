import { Hono } from "hono";
import { db } from "../database";
import { getTestStats, applyWinner, checkForWinner } from "../modules/abTesting";

const app = new Hono();

// GET / — all tests with optional filters
app.get("/", (c) => {
  const campaignId = c.req.query("campaign_id");
  const status = c.req.query("status");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (campaignId) {
    conditions.push("t.campaign_id = ?");
    params.push(parseInt(campaignId, 10));
  }
  if (status) {
    conditions.push("t.status = ?");
    params.push(status);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const rows = db
    .query<Record<string, unknown>, unknown[]>(
      `SELECT t.*, c.name as campaign_name
       FROM ab_tests t
       LEFT JOIN campaigns c ON c.id = t.campaign_id
       ${where}
       ORDER BY t.created_at DESC`
    )
    .all(...params);

  return c.json(rows);
});

// GET /:id — single test with full stats
app.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const stats = await getTestStats(id);
  if (!stats) return c.json({ error: "Test not found" }, 404);
  return c.json(stats);
});

// POST / — create new test
app.post("/", async (c) => {
  const body = await c.req.json<{
    campaign_id: number;
    step_number: number;
    name: string;
    variant_a_subject: string;
    variant_b_subject: string;
    min_sample_size?: number;
    confidence_threshold?: number;
    auto_declare?: boolean;
  }>();

  if (!body.campaign_id) return c.json({ error: "campaign_id is required" }, 400);
  if (!body.step_number) return c.json({ error: "step_number is required" }, 400);
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!body.variant_a_subject?.trim()) return c.json({ error: "variant_a_subject is required" }, 400);
  if (!body.variant_b_subject?.trim()) return c.json({ error: "variant_b_subject is required" }, 400);

  // Validate campaign step exists
  const step = db
    .query<{ id: number }, [number, number]>(
      "SELECT id FROM sequence_steps WHERE campaign_id = ? AND step_number = ?"
    )
    .get(body.campaign_id, body.step_number);
  if (!step) return c.json({ error: "No sequence step found for that campaign and step number" }, 400);

  // Check no running test exists for same campaign+step
  const existing = db
    .query<{ id: number }, [number, number]>(
      "SELECT id FROM ab_tests WHERE campaign_id = ? AND step_number = ? AND status = 'running'"
    )
    .get(body.campaign_id, body.step_number);
  if (existing) return c.json({ error: "A running test already exists for this campaign step" }, 400);

  const result = db.run(
    `INSERT INTO ab_tests (campaign_id, step_number, name, variant_a_subject, variant_b_subject, min_sample_size, confidence_threshold, auto_declare)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.campaign_id,
      body.step_number,
      body.name.trim(),
      body.variant_a_subject.trim(),
      body.variant_b_subject.trim(),
      body.min_sample_size ?? 50,
      body.confidence_threshold ?? 0.1,
      body.auto_declare !== false ? 1 : 0,
    ]
  );

  const id = Number(result.lastInsertRowid);
  const created = await getTestStats(id);
  return c.json(created, 201);
});

// PUT /:id — update test settings
app.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const existing = db.query<{ id: number }, [number]>("SELECT id FROM ab_tests WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Test not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    min_sample_size?: number;
    confidence_threshold?: number;
    auto_declare?: boolean;
    status?: string;
  }>();

  const allowed = ["name", "min_sample_size", "confidence_threshold", "auto_declare", "status"] as const;
  const fieldMap: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      fieldMap[key] = key === "auto_declare" ? (body[key] ? 1 : 0) : body[key];
    }
  }

  if (Object.keys(fieldMap).length === 0) return c.json({ error: "No fields to update" }, 400);

  const fields = Object.keys(fieldMap).map((k) => `${k} = ?`).join(", ");
  db.run(`UPDATE ab_tests SET ${fields} WHERE id = ?`, [...Object.values(fieldMap), id]);

  const updated = await getTestStats(id);
  return c.json(updated);
});

// POST /:id/declare-winner — manually declare winner
app.post("/:id/declare-winner", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const test = db
    .query<{ id: number; status: string }, [number]>(
      "SELECT id, status FROM ab_tests WHERE id = ?"
    )
    .get(id);
  if (!test) return c.json({ error: "Test not found" }, 404);

  const body = await c.req.json<{ winner: string }>();
  if (body.winner !== "a" && body.winner !== "b") {
    return c.json({ error: "winner must be 'a' or 'b'" }, 400);
  }

  const now = new Date().toISOString();
  db.run(
    "UPDATE ab_tests SET winner = ?, status = 'winner_declared', winner_declared_at = ? WHERE id = ?",
    [body.winner, now, id]
  );

  const winningSubject = applyWinner(id);
  return c.json({ success: true, winner: body.winner, winning_subject: winningSubject });
});

// POST /:id/stop — stop test without declaring winner
app.post("/:id/stop", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const test = db.query<{ id: number }, [number]>("SELECT id FROM ab_tests WHERE id = ?").get(id);
  if (!test) return c.json({ error: "Test not found" }, 404);

  db.run("UPDATE ab_tests SET status = 'stopped' WHERE id = ?", [id]);
  return c.json({ success: true });
});

// POST /:id/check-winner — manually trigger winner check
app.post("/:id/check-winner", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const winner = checkForWinner(id);
  return c.json({ winner: winner ?? null, declared: winner !== null });
});

// DELETE /:id — only allow deleting stopped tests
app.delete("/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const test = db.query<{ id: number; status: string }, [number]>(
    "SELECT id, status FROM ab_tests WHERE id = ?"
  ).get(id);
  if (!test) return c.json({ error: "Test not found" }, 404);
  if (test.status === "running") {
    return c.json({ error: "Stop the test before deleting it" }, 400);
  }

  db.run("DELETE FROM ab_tests WHERE id = ?", [id]);
  return c.json({ success: true });
});

export default app;
