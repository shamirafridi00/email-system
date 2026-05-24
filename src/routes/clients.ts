import { Hono } from "hono";
import { db } from "../database";

const app = new Hono();

app.get("/", (c) => {
  const rows = db.query<{
    id: number; name: string; contact_name: string; contact_email: string;
    hubspot_token: string | null; hubspot_portal_id: string | null;
    status: string; notes: string | null; color: string; created_at: string;
    campaign_count: number; account_count: number;
  }, []>(`
    SELECT
      cl.*,
      COUNT(DISTINCT c.id) AS campaign_count,
      COUNT(DISTINCT a.id) AS account_count
    FROM clients cl
    LEFT JOIN campaigns c ON c.client_id = cl.id
    LEFT JOIN accounts a ON a.client_id = cl.id
    GROUP BY cl.id
    ORDER BY cl.name ASC
  `).all();
  return c.json(rows);
});

app.get("/current", (c) => {
  const setting = db.query<{ value: string }, []>(
    "SELECT value FROM system_settings WHERE key = 'current_client_id'"
  ).get();
  const clientId = setting ? Number(setting.value) : 1;
  const client = db.query<{
    id: number; name: string; contact_name: string; contact_email: string;
    hubspot_token: string | null; hubspot_portal_id: string | null;
    status: string; notes: string | null; color: string; created_at: string;
    campaign_count: number; account_count: number;
  }, [number]>(`
    SELECT
      cl.*,
      COUNT(DISTINCT c.id) AS campaign_count,
      COUNT(DISTINCT a.id) AS account_count
    FROM clients cl
    LEFT JOIN campaigns c ON c.client_id = cl.id
    LEFT JOIN accounts a ON a.client_id = cl.id
    WHERE cl.id = ?
    GROUP BY cl.id
  `).get(clientId);
  if (!client) return c.json({ error: "Current client not found" }, 404);
  return c.json(client);
});

app.post("/", async (c) => {
  const body = await c.req.json<{
    name: string; contact_name?: string; contact_email?: string;
    hubspot_token?: string; hubspot_portal_id?: string;
    notes?: string; color?: string;
  }>();
  console.log("[POST /clients] received body:", body);
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  const result = db.run(
    `INSERT INTO clients (name, contact_name, contact_email, hubspot_token, hubspot_portal_id, notes, color)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      body.name.trim(),
      body.contact_name ?? null,
      body.contact_email ?? null,
      body.hubspot_token ?? null,
      body.hubspot_portal_id ?? null,
      body.notes ?? null,
      body.color ?? "#6366f1",
    ]
  );
  const created = db.query<{ id: number; name: string }, [number]>(
    "SELECT * FROM clients WHERE id = ?"
  ).get(Number(result.lastInsertRowid));
  return c.json(created, 201);
});

app.get("/:id/stats", (c) => {
  const id = Number(c.req.param("id"));
  const stats = db.query<{
    total_campaigns: number; total_leads: number; emails_sent: number;
    opens: number; replies: number; active_leads: number; replied_leads: number;
    last_activity: string | null;
  }, [number]>(`
    SELECT
      COUNT(DISTINCT c.id) AS total_campaigns,
      COUNT(DISTINCT l.id) AS total_leads,
      COUNT(sl.id) AS emails_sent,
      SUM(CASE WHEN sl.opened = 1 THEN 1 ELSE 0 END) AS opens,
      COUNT(DISTINCT r.id) AS replies,
      COUNT(DISTINCT CASE WHEN l.status = 'active' THEN l.id END) AS active_leads,
      COUNT(DISTINCT CASE WHEN l.status = 'replied' THEN l.id END) AS replied_leads,
      MAX(sl.sent_at) AS last_activity
    FROM clients cl
    LEFT JOIN campaigns c ON c.client_id = cl.id
    LEFT JOIN leads l ON l.campaign_id = c.id
    LEFT JOIN sent_log sl ON sl.campaign_id = c.id
    LEFT JOIN replies r ON r.lead_id = l.id
    WHERE cl.id = ?
  `).get(id);
  if (!stats) return c.json({ error: "Client not found" }, 404);
  const openRate = stats.emails_sent > 0 ? Math.round((stats.opens / stats.emails_sent) * 100) : 0;
  const replyRate = stats.total_leads > 0 ? Math.round((stats.replies / stats.total_leads) * 100) : 0;
  return c.json({ ...stats, open_rate: openRate, reply_rate: replyRate });
});

app.post("/:id/switch", (c) => {
  const id = Number(c.req.param("id"));
  const client = db.query<{ id: number }, [number]>("SELECT id FROM clients WHERE id = ?").get(id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('current_client_id', ?)", [String(id)]);
  return c.json({ success: true, current_client_id: id });
});

app.get("/:id", (c) => {
  const id = Number(c.req.param("id"));
  const client = db.query<{
    id: number; name: string; contact_name: string; contact_email: string;
    hubspot_token: string | null; hubspot_portal_id: string | null;
    status: string; notes: string | null; color: string; created_at: string;
  }, [number]>("SELECT * FROM clients WHERE id = ?").get(id);
  if (!client) return c.json({ error: "Client not found" }, 404);
  const campaigns = db.query<{ id: number; name: string; status: string }, [number]>(
    "SELECT id, name, status FROM campaigns WHERE client_id = ? ORDER BY created_at DESC"
  ).all(id);
  const accounts = db.query<{ id: number; email: string; status: string }, [number]>(
    "SELECT id, email, status FROM accounts WHERE client_id = ? ORDER BY created_at DESC"
  ).all(id);
  return c.json({ ...client, campaigns, accounts });
});

app.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    name?: string; contact_name?: string; contact_email?: string;
    hubspot_token?: string; hubspot_portal_id?: string;
    status?: string; notes?: string; color?: string;
  }>();
  const allowed = ["name", "contact_name", "contact_email", "hubspot_token", "hubspot_portal_id", "status", "notes", "color"] as const;
  const fieldMap: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) fieldMap[key] = body[key];
  }
  if (Object.keys(fieldMap).length === 0) return c.json({ error: "no fields to update" }, 400);
  const fields = Object.keys(fieldMap).map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(fieldMap), id];
  db.run(`UPDATE clients SET ${fields} WHERE id = ?`, values);
  const updated = db.query<Record<string, unknown>, [number]>("SELECT * FROM clients WHERE id = ?").get(id);
  return c.json(updated);
});

app.delete("/:id", (c) => {
  const rawId = c.req.param("id");
  const id = parseInt(rawId, 10);
  const force = c.req.query("force") === "true";
  console.log(`[DELETE /clients/:id] rawId="${rawId}" parsedId=${id} force=${force}`);

  // Prevent deleting the default client
  const client = db.query<{ name: string }, [number]>("SELECT name FROM clients WHERE id = ?").get(id);
  console.log(`[DELETE /clients/:id] client lookup result:`, client);
  if (!client) {
    console.log(`[DELETE /clients/:id] client not found for id=${id}`);
    return c.json({ error: "Client not found" }, 404);
  }
  if (client.name === "Default Client") {
    console.log(`[DELETE /clients/:id] blocked — attempt to delete Default Client`);
    return c.json({ error: "default_client", message: "Default Client cannot be deleted. It is the system default client." }, 400);
  }

  const activeCampaigns = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM campaigns WHERE client_id = ? AND status = 'active'"
  ).get(id);

  // Find the default client for reassignment
  const defaultClient = db.query<{ id: number }, []>(
    "SELECT id FROM clients WHERE name = 'Default Client' ORDER BY id ASC LIMIT 1"
  ).get();
  const defaultId = defaultClient?.id ?? 1;

  if (activeCampaigns && activeCampaigns.count > 0 && !force) {
    return c.json({ error: "Cannot delete client with active campaigns.", active_campaign_count: activeCampaigns.count }, 400);
  }

  // Reassign all campaigns, accounts, warmup_accounts to Default Client then hard delete
  const campaignResult = db.run("UPDATE campaigns SET client_id = ? WHERE client_id = ?", [defaultId, id]);
  const accountResult = db.run("UPDATE accounts SET client_id = ? WHERE client_id = ?", [defaultId, id]);
  const warmupResult = db.run("UPDATE warmup_accounts SET client_id = ? WHERE client_id = ?", [defaultId, id]);

  db.run("DELETE FROM clients WHERE id = ?", [id]);

  // If this was the active client, switch to default
  const currentSetting = db.query<{ value: string }, []>(
    "SELECT value FROM system_settings WHERE key = 'current_client_id'"
  ).get();
  if (currentSetting && Number(currentSetting.value) === id) {
    db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('current_client_id', ?)", [String(defaultId)]);
  }

  return c.json({
    success: true,
    campaigns_reassigned: campaignResult.changes,
    accounts_reassigned: accountResult.changes + warmupResult.changes,
  });
});

export default app;
