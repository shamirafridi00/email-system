import { Hono } from "hono";
import { db } from "../database";
import { getSequenceStats, rescheduleLeads } from "../modules/sequences";
import { logInfo, logWarning } from "../modules/logger";
import { validateEmailBatch, isValidFormat } from "../modules/emailValidator";
import { sendReplyNotification } from "../modules/emailReports";
import { detectLeadTimezone } from "../modules/timezoneMapper";

const app = new Hono();

// ─── PUBLIC: Unsubscribe (no auth) ───────────────────────────────────────────

function unsubscribePage(title: string, body: string, systemName = "GTM Warmup System"): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:500px;width:90%;text-align:center;color:#ffffff;padding:40px 20px">
${body}
<p style="margin-top:40px;font-size:12px;color:#555555">${systemName}</p>
</div></body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

app.get("/unsubscribe", (c) => {
  const token = c.req.query("token") ?? "";

  if (!token) {
    return unsubscribePage(
      "Invalid Link",
      `<h1 style="font-size:24px;color:#ef4444">Invalid Link</h1>
       <p style="color:#999999">This unsubscribe link is invalid or has already been used.</p>`
    );
  }

  const lead = db
    .query<{ id: number; email: string; status: string; campaign_id: number | null }, [string]>(
      "SELECT id, email, status, campaign_id FROM leads WHERE unsubscribe_token = ?"
    )
    .get(token);

  const systemNameRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'system_name'")
    .get();
  const systemName = systemNameRow?.value ?? "GTM Warmup System";

  if (!lead) {
    return unsubscribePage(
      "Invalid Link",
      `<h1 style="font-size:24px;color:#ef4444">Invalid Link</h1>
       <p style="color:#999999">This unsubscribe link is invalid or has already been used.</p>`,
      systemName
    );
  }

  if (lead.status === "unsubscribed") {
    return unsubscribePage(
      "Already Unsubscribed",
      `<h1 style="font-size:24px;color:#9ca3af">Already Unsubscribed</h1>
       <p style="color:#999999">You are already unsubscribed. Your email address will not receive any further emails from us.</p>`,
      systemName
    );
  }

  // Mark as unsubscribed
  db.run("UPDATE leads SET status = 'unsubscribed' WHERE id = ?", [lead.id]);

  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const ua = c.req.header("user-agent") ?? null;

  db.run(
    "INSERT INTO unsubscribe_log (lead_id, lead_email, token, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)",
    [lead.id, lead.email, token, ip, ua]
  );

  logInfo("system", "Lead unsubscribed", { email: lead.email, campaign_id: lead.campaign_id }).catch(() => {});

  return unsubscribePage(
    "Unsubscribed",
    `<h1 style="font-size:28px;color:#4ade80">✓ You have been unsubscribed successfully</h1>
     <p style="color:#cccccc;margin-top:12px">Your email address <strong style="color:#ffffff">${lead.email}</strong> has been removed from our mailing list.</p>
     <p style="color:#999999;margin-top:10px">You will not receive any further emails from us.<br>If you unsubscribed by mistake, please reply to the email you received.</p>`,
    systemName
  );
});

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

function parseCSV(csv: string) {
  const lines = csv.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const required = ["first_name", "last_name", "email", "company", "website", "personalized_line"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) return { error: `Missing CSV columns: ${missing.join(", ")}` };
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",").map((v) => v.trim());
    return {
      first_name: cols[idx.first_name] ?? "",
      last_name: cols[idx.last_name] ?? "",
      email: cols[idx.email] ?? "",
      company: cols[idx.company] ?? "",
      website: cols[idx.website] ?? "",
      personalized_line: cols[idx.personalized_line] ?? "",
    };
  }).filter((r) => r.email);
  return { rows, idx };
}

app.post("/validate-csv", async (c) => {
  const body = await c.req.json<{ campaign_id: number; csv: string }>();
  if (!body.campaign_id || !body.csv) {
    return c.json({ error: "campaign_id and csv are required" }, 400);
  }
  const parsed = parseCSV(body.csv);
  if (!parsed) return c.json({ error: "CSV must have a header row and at least one data row" }, 400);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const { rows } = parsed;
  const emails = rows.map((r) => r.email);
  const { results, summary } = await validateEmailBatch(emails);

  const checkDupe = db.prepare<{ id: number }, [string, number]>(
    "SELECT id FROM leads WHERE email = ? AND campaign_id = ?"
  );

  const detailed = results.map((res, i) => ({
    ...res,
    row: rows[i],
    is_duplicate: !!checkDupe.get(res.email, body.campaign_id),
  }));

  const duplicateCount = detailed.filter((r) => r.is_duplicate).length;

  return c.json({
    total_processed: emails.length,
    validation_summary: summary,
    duplicate_count: duplicateCount,
    details: detailed,
  });
});

app.post("/import", async (c) => {
  const body = await c.req.json<{
    campaign_id: number;
    csv: string;
    bypass_validation?: boolean;
  }>();

  if (!body.campaign_id || !body.csv) {
    return c.json({ error: "campaign_id and csv are required" }, 400);
  }

  const parsed = parseCSV(body.csv);
  if (!parsed) return c.json({ error: "CSV must have a header row and at least one data row" }, 400);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const { rows } = parsed;
  const today = new Date().toISOString().split("T")[0];
  const bypass = body.bypass_validation === true;

  if (bypass) {
    logWarning("system", "CSV import running with bypass_validation=true", { campaign_id: body.campaign_id, row_count: rows.length }).catch(() => {});
  }

  // Run validation (or format-only if bypass)
  let validationMap: Map<string, { valid: boolean; reason: string }>;
  if (bypass) {
    validationMap = new Map(rows.map((r) => [
      r.email,
      isValidFormat(r.email)
        ? { valid: true, reason: "Format check only (bypass)" }
        : { valid: false, reason: "Invalid email format" },
    ]));
  } else {
    const emails = rows.map((r) => r.email);
    const { results } = await validateEmailBatch(emails);
    validationMap = new Map(results.map((res) => [res.email, { valid: res.valid, reason: res.reason }]));
  }

  const insert = db.prepare(
    `INSERT INTO leads (campaign_id, first_name, last_name, email, company, website, personalized_line, current_step, next_send_date, status, unsubscribe_token, valid, validation_reason, timezone_offset, timezone_label, timezone_detected)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'active', lower(hex(randomblob(16))), ?, ?, ?, ?, ?)`
  );

  const checkDupe = db.prepare<{ id: number }, [string, number]>(
    "SELECT id FROM leads WHERE email = ? AND campaign_id = ?"
  );

  let imported = 0;
  let skipped = 0;
  let invalid = 0;
  let timezoneDetected = 0;
  const invalid_details: { email: string; reason: string }[] = [];
  const invalid_by_reason: Record<string, number> = {};

  for (const row of rows) {
    const validation = validationMap.get(row.email);
    if (!validation || !validation.valid) {
      invalid++;
      const reason = validation?.reason ?? "Unknown";
      invalid_details.push({ email: row.email, reason });
      invalid_by_reason[reason] = (invalid_by_reason[reason] ?? 0) + 1;
      continue;
    }

    const existing = checkDupe.get(row.email, body.campaign_id);
    if (existing) { skipped++; continue; }

    // Detect timezone from state/country columns if present in CSV
    const tzResult = detectLeadTimezone({
      state: (row as Record<string, string>).state ?? null,
      country: (row as Record<string, string>).country ?? null,
    });
    if (tzResult.timezone_detected) timezoneDetected++;

    insert.run(
      body.campaign_id,
      row.first_name,
      row.last_name,
      row.email,
      row.company,
      row.website,
      row.personalized_line,
      today,
      1,
      null,
      tzResult.timezone_offset,
      tzResult.timezone_label,
      tzResult.timezone_detected
    );
    imported++;
  }

  return c.json({
    imported,
    invalid,
    skipped,
    total_processed: rows.length,
    timezone_detected: timezoneDetected,
    invalid_details,
    validation_summary: { invalid_by_reason },
  });
});

app.post("/detect-timezones", (c) => {
  const leads = db
    .query<{ id: number; state: string | null; country: string | null }, []>(
      "SELECT id, NULL as state, NULL as country FROM leads WHERE timezone_detected = 0 OR timezone_offset IS NULL"
    )
    .all();

  let updated = 0;
  for (const lead of leads) {
    const tzResult = detectLeadTimezone({ state: lead.state, country: lead.country });
    if (tzResult.timezone_detected) {
      db.run(
        "UPDATE leads SET timezone_offset = ?, timezone_label = ?, timezone_detected = 1 WHERE id = ?",
        [tzResult.timezone_offset, tzResult.timezone_label, lead.id]
      );
      updated++;
    }
  }
  return c.json({ updated, total_checked: leads.length });
});

app.get("/stats", async (c) => {
  const setting = db.query<{ value: string }, []>(
    "SELECT value FROM system_settings WHERE key = 'current_client_id'"
  ).get();
  const clientId = setting ? Number(setting.value) : null;

  if (clientId !== null) {
    const campaignIds = db
      .query<{ id: number }, [number]>("SELECT id FROM campaigns WHERE client_id = ?")
      .all(clientId)
      .map(r => r.id);
    const inClause = campaignIds.length > 0 ? `(${campaignIds.join(",")})` : "(NULL)";
    const rows = db
      .query<{ status: string; count: number }, []>(
        `SELECT status, COUNT(*) as count FROM leads WHERE campaign_id IN ${inClause} GROUP BY status`
      )
      .all();
    return c.json(Object.fromEntries(rows.map((r) => [r.status, r.count])));
  }
  return c.json(await getSequenceStats());
});

app.get("/unsubscribe-log", (c) => {
  const rows = db
    .query<{
      id: number; lead_id: number; lead_email: string; token: string;
      unsubscribed_at: string; ip_address: string | null; user_agent: string | null;
    }, []>(
      `SELECT ul.*, c.name AS campaign_name
       FROM unsubscribe_log ul
       LEFT JOIN leads l ON l.id = ul.lead_id
       LEFT JOIN campaigns c ON c.id = l.campaign_id
       ORDER BY ul.unsubscribed_at DESC`
    )
    .all();
  return c.json(rows);
});

app.put("/:id/timezone", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{
    timezone_offset?: number;
    timezone_label?: string;
    optimal_send_hour?: number;
  }>();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.timezone_offset !== undefined) { fields.push("timezone_offset = ?"); values.push(body.timezone_offset); }
  if (body.timezone_label !== undefined)  { fields.push("timezone_label = ?");  values.push(body.timezone_label); }
  if (body.optimal_send_hour !== undefined) { fields.push("optimal_send_hour = ?"); values.push(body.optimal_send_hour); }
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);
  fields.push("timezone_detected = 1");
  values.push(id);
  db.run(`UPDATE leads SET ${fields.join(", ")} WHERE id = ?`, values);
  return c.json({ success: true });
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

  // If manually marking as replied, send notification
  if (body.status === "replied") {
    const lead = db
      .query<{ id: number; first_name: string; last_name: string; email: string; company: string; campaign_id: number | null; status: string }, [number]>(
        "SELECT id, first_name, last_name, email, company, campaign_id, status FROM leads WHERE id = ?"
      )
      .get(id);
    if (lead && lead.status !== "replied") {
      sendReplyNotification(lead, "Manual reply marked by system operator").catch(() => {});
    }
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
