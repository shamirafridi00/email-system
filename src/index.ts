import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFileSync } from "fs";
import { join } from "path";

import { initDatabase, db } from "./database";
import { startScheduler } from "./scheduler";
import { requireAuth } from "./middleware/auth";
import { logInfo } from "./modules/logger";

const TRACKING_PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
import authRoutes from "./routes/auth";
import accountsRoutes from "./routes/accounts";
import warmupRoutes from "./routes/warmup";
import campaignsRoutes from "./routes/campaigns";
import leadsRoutes from "./routes/leads";
import dashboardRoutes from "./routes/dashboard";
import clientsRoutes from "./routes/clients";

initDatabase();
startScheduler();

const app = new Hono();

app.use("*", cors({ origin: "*", credentials: true }));

// Public routes — no auth required
app.route("/auth", authRoutes);

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

app.get("/leads/unsubscribe", (c) => {
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

// Open tracking pixel — always returns a 1x1 GIF, never errors
app.get("/track/open/:token", (c) => {
  const pixelResponse = () =>
    new Response(TRACKING_PIXEL, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });

  try {
    const token = c.req.param("token");
    const now = new Date().toISOString();

    const row = db
      .query<{ id: number; lead_id: number; campaign_id: number; step_number: number; opened: number }, [string]>(
        "SELECT id, lead_id, campaign_id, step_number, opened FROM sent_log WHERE tracking_token = ?"
      )
      .get(token);

    if (!row) return pixelResponse();

    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
      c.req.header("x-real-ip") ??
      null;
    const ua = c.req.header("user-agent") ?? null;

    const lead = db
      .query<{ email: string }, [number]>("SELECT email FROM leads WHERE id = ?")
      .get(row.lead_id);
    const email = lead?.email ?? "";

    if (!row.opened) {
      // First open
      db.run("UPDATE sent_log SET opened = 1, opened_at = ? WHERE id = ?", [now, row.id]);
      db.run(
        "UPDATE leads SET opened = 1, opened_at = ?, open_count = open_count + 1 WHERE id = ?",
        [now, row.lead_id]
      );
      db.run(
        `INSERT INTO email_opens (tracking_token, lead_id, campaign_id, step_number, email, ip_address, user_agent, open_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [token, row.lead_id, row.campaign_id, row.step_number, email, ip, ua]
      );
      logInfo("system", `Email opened by ${email}`, { lead_id: row.lead_id, campaign_id: row.campaign_id }).catch(() => {});
    } else {
      // Repeat open — increment counts
      db.run(
        "UPDATE email_opens SET open_count = open_count + 1, opened_at = ? WHERE tracking_token = ?",
        [now, token]
      );
      db.run(
        "UPDATE leads SET open_count = open_count + 1 WHERE id = ?",
        [row.lead_id]
      );
    }
  } catch {
    // Never let tracking errors affect the response
  }

  return pixelResponse();
});

app.get("/login", (c) => {
  const html = readFileSync(join(import.meta.dir, "../public/login.html"), "utf-8");
  return c.html(html);
});

app.get("/public/*", (c) => {
  const filePath = join(import.meta.dir, "../", c.req.path);
  try {
    const file = Bun.file(filePath);
    return new Response(file);
  } catch {
    return c.text("Not found", 404);
  }
});

// Everything below requires a valid session
app.use("*", requireAuth);

app.get("/", (c) => {
  try {
    const html = readFileSync(join(import.meta.dir, "../public/index.html"), "utf-8");
    return c.html(html);
  } catch {
    return c.text("Email System running — drop index.html in /public to serve UI");
  }
});

app.route("/accounts", accountsRoutes);
app.route("/warmup", warmupRoutes);
app.route("/campaigns", campaignsRoutes);
app.route("/leads", leadsRoutes);
app.route("/dashboard", dashboardRoutes);
app.route("/clients", clientsRoutes);

app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: err.message ?? "Internal server error" }, 500);
});

export default {
  port: 3000,
  fetch: app.fetch,
  idleTimeout: 120,
};