import { db } from "../database";
import { getRegisteredJobs } from "../scheduler";
import { createTransport } from "nodemailer";
import { ImapFlow } from "imapflow";
import * as os from "os";

export type CheckStatus = "ok" | "warning" | "error";

export interface CheckResult {
  status: CheckStatus;
  message: string;
  [key: string]: unknown;
}

export interface HealthResult {
  checked_at: string;
  overall_status: CheckStatus;
  checks: Record<string, CheckResult>;
}

const EXPECTED_JOBS = [
  "midnight-reset",
  "sequence-runner",
  "reply-check-hubspot",
  "natural-warmup",
  "conversation-scanner",
  "auto-conversation-generator",
  "warmup-summary-email",
  "reply-queue-processor",
  "daily-backup",
  "daily-bounce-check",
  "client-progress-reports",
];

async function checkDatabase(): Promise<CheckResult> {
  try {
    db.query("SELECT 1 FROM system_settings LIMIT 1").get();
    return { status: "ok", message: "Database responding normally" };
  } catch (err: unknown) {
    return { status: "error", message: (err as Error).message };
  }
}

async function checkHubspot(): Promise<CheckResult> {
  const row = db
    .query<{ value: string }, []>(
      "SELECT value FROM system_settings WHERE key = 'hubspot_token'"
    )
    .get();
  const token = row?.value || process.env.HUBSPOT_TOKEN;
  if (!token) {
    return { status: "warning", message: "HubSpot token not configured" };
  }
  try {
    const res = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 200) return { status: "ok", message: "HubSpot connected" };
    if (res.status === 401) return { status: "error", message: "Invalid HubSpot token" };
    return { status: "error", message: `HubSpot returned HTTP ${res.status}` };
  } catch (err: unknown) {
    return { status: "error", message: (err as Error).message };
  }
}

async function checkSmtp(): Promise<CheckResult & { accounts: { email: string; status: CheckStatus; message: string }[] }> {
  const accounts = db
    .query<{ email: string; app_password: string }, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused'"
    )
    .all();

  if (!accounts.length) {
    return { status: "warning", message: "No sending accounts configured", accounts: [] };
  }

  const results = await Promise.allSettled(
    accounts.map(async (acct) => {
      const transporter = createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: acct.email, pass: acct.app_password },
      });
      await transporter.verify();
      return acct.email;
    })
  );

  const accountResults = results.map((r, i) => ({
    email: accounts[i].email,
    status: (r.status === "fulfilled" ? "ok" : "error") as CheckStatus,
    message: r.status === "fulfilled" ? "SMTP verified" : (r.reason as Error).message,
  }));

  const hasError = accountResults.some((a) => a.status === "error");
  const allError = accountResults.every((a) => a.status === "error");

  return {
    status: allError ? "error" : hasError ? "warning" : "ok",
    message: allError
      ? "All SMTP accounts failed verification"
      : hasError
      ? `${accountResults.filter((a) => a.status === "error").length} account(s) failed SMTP verification`
      : `All ${accountResults.length} account(s) verified`,
    accounts: accountResults,
  };
}

async function checkImap(): Promise<CheckResult> {
  const account = db
    .query<{ email: string; app_password: string }, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused' LIMIT 1"
    )
    .get();

  if (!account) {
    return { status: "warning", message: "No accounts configured for IMAP check" };
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: account.email, pass: account.app_password },
    logger: false,
  });

  const timeout = new Promise<CheckResult>((_, reject) =>
    setTimeout(() => reject(new Error("IMAP connection timed out after 10s")), 10_000)
  );

  const connect = (async (): Promise<CheckResult> => {
    try {
      await client.connect();
      await client.logout();
      return { status: "ok", message: "IMAP connection successful" };
    } catch (err: unknown) {
      return { status: "error", message: (err as Error).message };
    }
  })();

  return Promise.race([connect, timeout]).catch((err: Error) => ({
    status: "error" as CheckStatus,
    message: err.message,
  }));
}

async function checkScheduler(): Promise<CheckResult> {
  const registered = getRegisteredJobs();
  const missing = EXPECTED_JOBS.filter((j) => !registered.includes(j));
  if (missing.length === 0) {
    return { status: "ok", message: `All ${EXPECTED_JOBS.length} cron jobs registered` };
  }
  return {
    status: "warning",
    message: `Missing jobs: ${missing.join(", ")}`,
    missing_jobs: missing,
    registered_jobs: registered,
  };
}

async function checkWarmupSystem(): Promise<CheckResult> {
  const runningRow = db
    .query<{ value: string }, []>(
      "SELECT value FROM system_settings WHERE key = 'warmup_running'"
    )
    .get();
  const warmupRunning = runningRow?.value === "1";

  const activeCount =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_accounts WHERE active = 1"
      )
      .get()?.count ?? 0;

  const sentToday =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE DATE(sent_at) = DATE('now')"
      )
      .get()?.count ?? 0;

  const extra = { warmup_running: warmupRunning, active_accounts: activeCount, sent_today: sentToday };

  if (activeCount === 0) {
    return { status: "error", message: "No active warmup accounts", ...extra };
  }
  if (activeCount === 1) {
    return { status: "error", message: "Only 1 active account — need at least 2 to warmup", ...extra };
  }
  if (!warmupRunning) {
    return { status: "warning", message: "Warmup system is paused", ...extra };
  }
  return { status: "ok", message: `Warmup running — ${activeCount} accounts, ${sentToday} sent today`, ...extra };
}

async function checkReplyQueue(): Promise<CheckResult> {
  const pending =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_reply_queue WHERE status = 'pending'"
      )
      .get()?.count ?? 0;

  const failed =
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_reply_queue WHERE status = 'failed'"
      )
      .get()?.count ?? 0;

  const extra = { pending_count: pending, failed_count: failed };

  if (failed > 20) {
    return { status: "error", message: `${failed} failed replies in queue`, ...extra };
  }
  if (failed > 5) {
    return { status: "warning", message: `${failed} failed replies in queue`, ...extra };
  }
  return { status: "ok", message: `Queue healthy — ${pending} pending, ${failed} failed`, ...extra };
}

async function checkDiskMemory(): Promise<CheckResult> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const procMem = process.memoryUsage();

  const toMB = (b: number) => Math.round(b / 1024 / 1024);

  const extra = {
    total_mem_mb: toMB(totalMem),
    free_mem_mb: toMB(freeMem),
    used_mem_mb: toMB(totalMem - freeMem),
    process_rss_mb: toMB(procMem.rss),
    process_heap_mb: toMB(procMem.heapUsed),
  };

  if (freeMem < 100 * 1024 * 1024) {
    return {
      status: "warning",
      message: `Low memory — only ${toMB(freeMem)}MB free`,
      ...extra,
    };
  }
  return {
    status: "ok",
    message: `${toMB(freeMem)}MB free of ${toMB(totalMem)}MB`,
    ...extra,
  };
}

export async function runHealthCheck(): Promise<HealthResult> {
  const [dbResult, hubspotResult, smtpResult, imapResult, schedulerResult, warmupResult, queueResult, memResult] =
    await Promise.allSettled([
      checkDatabase(),
      checkHubspot(),
      checkSmtp(),
      checkImap(),
      checkScheduler(),
      checkWarmupSystem(),
      checkReplyQueue(),
      checkDiskMemory(),
    ]);

  const settle = (r: PromiseSettledResult<CheckResult>): CheckResult =>
    r.status === "fulfilled"
      ? r.value
      : { status: "error", message: (r.reason as Error)?.message ?? "Unknown error" };

  const checks: Record<string, CheckResult> = {
    database: settle(dbResult),
    hubspot: settle(hubspotResult),
    smtp: settle(smtpResult),
    imap: settle(imapResult),
    scheduler: settle(schedulerResult),
    warmup_system: settle(warmupResult),
    reply_queue: settle(queueResult),
    memory: settle(memResult),
  };

  const statuses = Object.values(checks).map((c) => c.status);
  const overall_status: CheckStatus = statuses.includes("error")
    ? "error"
    : statuses.includes("warning")
    ? "warning"
    : "ok";

  return { checked_at: new Date().toISOString(), overall_status, checks };
}

export async function getQuickStatus(): Promise<CheckStatus> {
  // Only run DB and warmup checks for quick status — fast and non-blocking
  try {
    const [dbResult, warmupResult] = await Promise.allSettled([
      checkDatabase(),
      checkWarmupSystem(),
    ]);
    const statuses = [dbResult, warmupResult].map((r) =>
      r.status === "fulfilled" ? r.value.status : ("error" as CheckStatus)
    );
    return statuses.includes("error") ? "error" : statuses.includes("warning") ? "warning" : "ok";
  } catch {
    return "error";
  }
}
