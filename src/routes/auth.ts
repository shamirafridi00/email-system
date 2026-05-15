import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../database";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_TTL_SEC = SESSION_TTL_MS / 1000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const app = new Hono();

app.post("/login", async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();

  const usernameMatch = body.username === ADMIN_USERNAME;
  const [inputHash, storedHash] = await Promise.all([
    hashPassword(body.password),
    hashPassword(ADMIN_PASSWORD),
  ]);
  // Constant-time comparison via hash — prevents timing attacks
  const passwordMatch = inputHash === storedHash;

  if (!usernameMatch || !passwordMatch) {
    // Fixed delay so brute-force gets no timing signal
    await new Promise((r) => setTimeout(r, 500));
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = generateToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;

  db.run("INSERT INTO sessions (token, expires_at) VALUES (?, ?)", [
    token,
    expiresAt,
  ]);

  setCookie(c, "session", token, {
    httpOnly: true,
    path: "/",
    maxAge: SESSION_TTL_SEC,
    sameSite: "Lax",
  });

  return c.json({ success: true });
});

app.post("/logout", (c) => {
  const token = getCookie(c, "session");
  if (token) db.run("DELETE FROM sessions WHERE token = ?", [token]);
  deleteCookie(c, "session", { path: "/" });
  return c.json({ success: true });
});

app.get("/check", (c) => {
  const token = getCookie(c, "session");
  if (!token) return c.json({ authenticated: false });

  const row = db
    .query<{ expires_at: number }, [string]>(
      "SELECT expires_at FROM sessions WHERE token = ?"
    )
    .get(token);

  const authenticated = !!row && row.expires_at > Date.now();
  if (row && !authenticated) {
    db.run("DELETE FROM sessions WHERE token = ?", [token]);
  }

  return c.json({ authenticated });
});

export default app;
