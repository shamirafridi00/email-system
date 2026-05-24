import { db } from "../database";
import nodemailer from "nodemailer";

export type ErrorType = "smtp" | "imap" | "hubspot" | "scheduler" | "warmup" | "campaign" | "system";
export type Severity = "info" | "warning" | "error" | "critical";

interface LogErrorOpts {
  error_type: ErrorType;
  severity: Severity;
  message: string;
  stack_trace?: string;
  context?: Record<string, unknown>;
}

export async function logError(opts: LogErrorOpts): Promise<void> {
  try {
    const contextStr = opts.context ? JSON.stringify(opts.context) : null;
    db.run(
      `INSERT INTO system_errors (error_type, severity, message, stack_trace, context)
       VALUES (?, ?, ?, ?, ?)`,
      [opts.error_type, opts.severity, opts.message, opts.stack_trace ?? null, contextStr]
    );
  } catch (dbErr) {
    console.error("[logger] Failed to write to system_errors:", dbErr);
  }

  if (opts.severity === "critical") {
    try {
      const notifRow = db
        .query<{ value: string }, []>(
          "SELECT value FROM system_settings WHERE key = 'notification_email'"
        )
        .get();
      const notifEmail = notifRow?.value?.trim();
      if (!notifEmail) return;

      const senderRow = db
        .query<{ email: string; app_password: string }, []>(
          "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
        )
        .get();
      if (!senderRow) return;

      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: senderRow.email, pass: senderRow.app_password },
      });

      const timestamp = new Date().toISOString();
      await transporter.sendMail({
        from: senderRow.email,
        to: notifEmail,
        subject: `CRITICAL ERROR — ${opts.error_type} — ${timestamp}`,
        text: `A critical error occurred in the warmup system.\n\nType: ${opts.error_type}\nTime: ${timestamp}\n\nMessage:\n${opts.message}\n\n${opts.stack_trace ? `Stack Trace:\n${opts.stack_trace}\n\n` : ""}${opts.context ? `Context:\n${JSON.stringify(opts.context, null, 2)}` : ""}`,
      });
    } catch (mailErr) {
      console.error("[logger] Failed to send critical alert email:", mailErr);
    }
  }
}

export async function logWarning(
  error_type: ErrorType,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  return logError({ error_type, severity: "warning", message, context });
}

export async function logInfo(
  error_type: ErrorType,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  return logError({ error_type, severity: "info", message, context });
}

export async function clearResolvedErrors(): Promise<number> {
  const info = db.run("DELETE FROM system_errors WHERE resolved = 1");
  return info.changes;
}

export async function markResolved(id: number): Promise<void> {
  db.run("UPDATE system_errors SET resolved = 1 WHERE id = ?", [id]);
}

export async function getRecentErrors(
  limit = 50,
  severity?: Severity
): Promise<unknown[]> {
  if (severity) {
    return db
      .query("SELECT * FROM system_errors WHERE severity = ? ORDER BY created_at DESC LIMIT ?")
      .all(severity, limit);
  }
  return db
    .query("SELECT * FROM system_errors ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}
