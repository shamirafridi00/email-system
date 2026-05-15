import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "../database";

export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, "session");

  if (token) {
    const row = db
      .query<{ expires_at: number }, [string]>(
        "SELECT expires_at FROM sessions WHERE token = ?"
      )
      .get(token);

    if (row) {
      if (row.expires_at > Date.now()) {
        return next();
      }
      // Expired — delete it
      db.run("DELETE FROM sessions WHERE token = ?", [token]);
    }
  }

  const acceptsHtml = c.req.header("accept")?.includes("text/html");
  if (acceptsHtml) return c.redirect("/login");
  return c.json({ error: "Unauthorized" }, 401);
}
