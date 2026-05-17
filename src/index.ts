import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFileSync } from "fs";
import { join } from "path";

import { initDatabase } from "./database";
import { startScheduler } from "./scheduler";
import { requireAuth } from "./middleware/auth";
import authRoutes from "./routes/auth";
import accountsRoutes from "./routes/accounts";
import warmupRoutes from "./routes/warmup";
import campaignsRoutes from "./routes/campaigns";
import leadsRoutes from "./routes/leads";
import dashboardRoutes from "./routes/dashboard";

initDatabase();
startScheduler();

const app = new Hono();

app.use("*", cors({ origin: "*", credentials: true }));

// Public routes — no auth required
app.route("/auth", authRoutes);

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

app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: err.message ?? "Internal server error" }, 500);
});

export default {
  port: 3000,
  fetch: app.fetch,
  idleTimeout: 120,
};