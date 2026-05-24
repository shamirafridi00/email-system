import { readdirSync, mkdirSync, renameSync } from "fs";
import { join } from "path";

import { runSequences } from "./modules/sequences";
import { checkBounceRates } from "./modules/bounceMonitor";
import { checkAllAccounts, checkReplies, type ImapAccount } from "./modules/imap";
import { runWarmupAll, processConversationFile, generateDailyConversations, processReplyQueue } from "./modules/warmup";
import { sendWarmupSummaryEmail, sendClientProgressReport, sendWeeklyClientDigest } from "./modules/emailReports";
import { pushToHubspot, getUnpushedReplies } from "./modules/hubspot";
import { db, resetDailyCounts } from "./database";
import { isUSBusinessHours } from "./utils/timezone";
import { logError } from "./modules/logger";
import { createBackup } from "./modules/backup";

// Minimal cron-like scheduler: runs callback at next matching wall-clock minute
function scheduleCron(cronExpr: string, label: string, fn: () => void): void {
  function msUntilNextTick(): number {
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next.getTime() - now.getTime();
  }

  function matchesCron(expr: string, now: Date): boolean {
    const [min, hour, , , dow] = expr.split(" ");
    const matches = (field: string, val: number): boolean => {
      if (field === "*") return true;
      if (field.startsWith("*/")) return val % parseInt(field.slice(2)) === 0;
      if (field.includes("-")) {
        const [lo, hi] = field.split("-").map(Number);
        return val >= lo && val <= hi;
      }
      if (field.includes(",")) return field.split(",").map(Number).includes(val);
      return parseInt(field) === val;
    };
    return (
      matches(min, now.getMinutes()) &&
      matches(hour, now.getHours()) &&
      matches(dow, now.getDay())
    );
  }

  function tick(): void {
    const now = new Date();
    if (matchesCron(cronExpr, now)) {
      try { fn(); } catch (e) { console.error(`[cron:${label}] error:`, e); }
    }
    setTimeout(tick, msUntilNextTick());
  }

  setTimeout(tick, msUntilNextTick());
}

const CONVERSATIONS_DIR = process.env.CONVERSATIONS_DIR || join(process.cwd(), "conversations");
const PROCESSED_DIR = join(CONVERSATIONS_DIR, "processed");

// Ensure directories exist on startup
mkdirSync(CONVERSATIONS_DIR, { recursive: true });
mkdirSync(PROCESSED_DIR, { recursive: true });

// Tracks files dispatched this session so a 5-min tick doesn't re-queue them
const dispatchedFiles = new Set<string>();

// Registry of cron jobs registered at startup — used by health check
const registeredJobs = new Set<string>();
export function getRegisteredJobs(): string[] { return Array.from(registeredJobs); }

function getAllAccounts(): ImapAccount[] {
  const rows = db
    .query<ImapAccount, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused'"
    )
    .all();
  console.log(`[imap] querying accounts table — found ${rows.length} active account(s): ${rows.map(r => r.email).join(", ") || "none"}`);
  return rows;
}

async function checkAndPushReplies(): Promise<number> {
  const accounts = getAllAccounts();
  for (const account of accounts) {
    try {
      await checkReplies(account);
    } catch (err) {
      console.error(`IMAP check failed for ${account.email}:`, err);
    }
  }

  const unpushed = getUnpushedReplies();
  for (const reply of unpushed) {
    await pushToHubspot(reply, reply.hubspot_token);
  }
  return unpushed.length;
}

function scanConversations(): void {
  try {
    mkdirSync(PROCESSED_DIR, { recursive: true });
  } catch {
    // already exists
  }

  let files: string[];
  try {
    files = readdirSync(CONVERSATIONS_DIR).filter(
      (f) => f.endsWith(".json") && !dispatchedFiles.has(f)
    );
  } catch {
    return;
  }

  if (files.length === 0) return;

  for (const file of files) {
    const src = join(CONVERSATIONS_DIR, file);
    dispatchedFiles.add(file);
    processConversationFile(src);

    try {
      renameSync(src, join(PROCESSED_DIR, file));
    } catch (err) {
      console.error(`Could not move ${file} to processed/:`, err);
    }
  }

  console.log(
    `[scheduler] conversation scan: dispatched ${files.length} file(s) — ${files.join(", ")}`
  );
}

export function startScheduler(): void {
  // Job 1 — midnight reset
  scheduleCron("0 0 * * *", "midnight-reset", async () => {
    try {
      resetDailyCounts();
      console.log(`[scheduler] daily counts reset at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[scheduler] midnight-reset failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job midnight-reset failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("midnight-reset");

  // Job 2 — sequence runner, every hour 9am–5pm Mon–Fri
  scheduleCron("0 9-17 * * 1-5", "sequence-runner", async () => {
    try {
      console.log(`[scheduler] running sequences at ${new Date().toISOString()}`);
      const stats = await runSequences();
      console.log(
        `[scheduler] sequences done — processed:${stats.processed} sent:${stats.sent} skipped:${stats.skipped} bounced:${stats.bounced} finished:${stats.finished}`
      );

      // Run bounce check after each sequence run
      try {
        const bounceResults = await checkBounceRates();
        const warned = bounceResults.filter(r => r.action_taken === "warning").length;
        const paused = bounceResults.filter(r => r.action_taken === "paused").length;
        if (warned > 0 || paused > 0) {
          console.log(`[scheduler] bounce check — ${warned} warned, ${paused} paused`);
        }
      } catch (bounceErr) {
        console.error("[scheduler] bounce check failed:", bounceErr);
      }
    } catch (err) {
      console.error("[scheduler] sequence-runner failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job sequence-runner failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("sequence-runner");

  // Job 3 — reply check + HubSpot push, every 2 hours
  scheduleCron("0 */2 * * *", "reply-check-hubspot", async () => {
    try {
      console.log(`[scheduler] checking replies at ${new Date().toISOString()}`);
      const pushed = await checkAndPushReplies();
      console.log(`[scheduler] reply check done — pushed ${pushed} to HubSpot`);
    } catch (err) {
      console.error("[scheduler] reply-check-hubspot failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job reply-check-hubspot failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("reply-check-hubspot");

  // Job 4 — natural warmup: fires every 30 min Mon–Fri, then decides probabilistically
  scheduleCron("*/30 * * * 1-5", "natural-warmup", async () => {
    try {
      if (!isUSBusinessHours()) {
        console.log(`[scheduler] warmup — outside US business hours, skipping`);
        return;
      }

      // ~60% probability per tick for natural irregularity
      if (Math.random() < 0.40) {
        console.log(`[scheduler] warmup — skipped this tick (probabilistic)`);
        return;
      }

      // Random lead-in delay 0–15 minutes so sends don't land on the half-hour
      const jitterMs = Math.floor(Math.random() * 900_000);
      console.log(`[scheduler] warmup — starting in ${Math.round(jitterMs / 60_000)}m`);

      await new Promise((r) => setTimeout(r, jitterMs));

      // Pick a random subset of 2–4 active accounts for this cycle
      const allAccounts = db
        .query<{ id: number; email: string; app_password: string; daily_volume: number; active: number }, []>(
          "SELECT * FROM warmup_accounts WHERE active = 1"
        )
        .all();

      if (allAccounts.length < 2) {
        console.log(`[scheduler] warmup — fewer than 2 active accounts, skipping`);
        return;
      }

      const subsetSize = Math.min(allAccounts.length, 2 + Math.floor(Math.random() * 3)); // 2–4
      const shuffled = allAccounts.slice().sort(() => Math.random() - 0.5);
      const subset = shuffled.slice(0, subsetSize);

      console.log(`[scheduler] warmup — running with ${subset.length} accounts: ${subset.map(a => a.email).join(", ")}`);
      await runWarmupAll(subset);
      console.log(`[scheduler] warmup — cycle complete`);
    } catch (err) {
      console.error("[scheduler] natural-warmup failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job natural-warmup failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("natural-warmup");

  // Job 5 — conversation file scanner, every 5 minutes
  scheduleCron("*/5 * * * *", "conversation-scanner", () => {
    try {
      scanConversations();
    } catch (err) {
      console.error("[scheduler] conversation-scanner failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job conversation-scanner failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("conversation-scanner");

  // Job 6 — daily auto conversation generator, Mon–Fri at 6am UTC (2am ET)
  scheduleCron("0 6 * * 1-5", "auto-conversation-generator", async () => {
    try {
      console.log(`[scheduler] auto-generate conversations at ${new Date().toISOString()}`);
      const result = await generateDailyConversations();
      if (result.skipped) {
        console.log(`[scheduler] auto-generate skipped: ${result.skipped}`);
      } else {
        console.log(`[scheduler] auto-generate done — generated ${result.generated} conversation(s)`);
      }
    } catch (err) {
      console.error("[scheduler] auto-conversation-generator failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job auto-conversation-generator failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("auto-conversation-generator");

  // Job 8 — reply queue processor, every 15 minutes
  scheduleCron("*/15 * * * *", "reply-queue-processor", async () => {
    console.log(`[scheduler] reply queue processor firing at ${new Date().toISOString()}`);
    try {
      const count = await processReplyQueue();
      console.log(`[scheduler] reply-queue: processed ${count} reply(ies)`);
    } catch (err) {
      console.error("[scheduler] reply-queue error:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job reply-queue-processor failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("reply-queue-processor");

  // Job 7 — daily warmup summary email, 2am UTC = 7am Pakistan Standard Time (PKT = UTC+5)
  scheduleCron("0 2 * * *", "warmup-summary-email", async () => {
    try {
      const setting = db
        .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'send_warmup_summary'")
        .get();
      if (setting?.value !== "1") {
        console.log("[scheduler] warmup summary email disabled — skipping");
        return;
      }
      console.log(`[scheduler] sending warmup summary email at ${new Date().toISOString()}`);
      const result = await sendWarmupSummaryEmail();
      console.log(`[scheduler] summary email: ${result.success ? "sent" : "failed"} — ${result.message}`);
    } catch (err) {
      console.error("[scheduler] warmup-summary-email failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job warmup-summary-email failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("warmup-summary-email");

  // Job 9 — daily database backup at 1am UTC
  scheduleCron("0 1 * * *", "daily-backup", async () => {
    try {
      const autoRow = db
        .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'auto_backup_enabled'")
        .get();
      if (autoRow?.value !== "1") {
        console.log("[scheduler] daily-backup — auto backup disabled, skipping");
        return;
      }
      console.log(`[scheduler] daily-backup starting at ${new Date().toISOString()}`);
      const result = await createBackup("Automatic daily backup");
      if (result.success) {
        console.log(`[scheduler] daily-backup done — ${result.filename} (${result.file_size_kb}KB)`);
      } else {
        console.error(`[scheduler] daily-backup failed: ${result.error}`);
        logError({ error_type: "scheduler", severity: "critical", message: `Daily backup failed: ${result.error}` }).catch(() => {});
      }
    } catch (err) {
      console.error("[scheduler] daily-backup threw:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job daily-backup failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("daily-backup");

  // Job 10 — daily bounce rate check, 3am UTC
  scheduleCron("0 3 * * *", "daily-bounce-check", async () => {
    try {
      console.log(`[scheduler] daily bounce check starting at ${new Date().toISOString()}`);
      const results = await checkBounceRates();
      const warned = results.filter(r => r.action_taken === "warning").length;
      const paused = results.filter(r => r.action_taken === "paused").length;
      console.log(`[scheduler] daily bounce check done — ${results.length} accounts checked, ${warned} warned, ${paused} paused`);
    } catch (err) {
      console.error("[scheduler] daily-bounce-check failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job daily-bounce-check failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("daily-bounce-check");

  // Job 11 — client progress reports, 3am UTC = 8am Pakistan time
  scheduleCron("0 3 * * *", "client-progress-reports", async () => {
    try {
      const configs = db
        .query<{ id: number; campaign_id: number; client_email: string; send_daily: number; send_weekly: number }, []>(
          "SELECT id, campaign_id, client_email, send_daily, send_weekly FROM client_report_config WHERE active = 1"
        )
        .all();

      const isMonday = new Date().getDay() === 1;

      for (const cfg of configs) {
        if (cfg.send_daily) {
          try {
            const result = await sendClientProgressReport(cfg.campaign_id, cfg.client_email);
            console.log(`[scheduler] client-progress-report campaign=${cfg.campaign_id}: ${result.message}`);
          } catch (err) {
            console.error(`[scheduler] client-progress-report failed for campaign ${cfg.campaign_id}:`, err);
          }
        }
        if (isMonday && cfg.send_weekly) {
          try {
            const result = await sendWeeklyClientDigest(cfg.campaign_id, cfg.client_email);
            console.log(`[scheduler] weekly-digest campaign=${cfg.campaign_id}: ${result.message}`);
          } catch (err) {
            console.error(`[scheduler] weekly-digest failed for campaign ${cfg.campaign_id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("[scheduler] client-progress-reports job failed:", err);
      logError({ error_type: "scheduler", severity: "critical", message: `Cron job client-progress-reports failed: ${err instanceof Error ? err.message : String(err)}`, stack_trace: err instanceof Error ? err.stack : undefined }).catch(() => {});
    }
  });
  registeredJobs.add("client-progress-reports");

  console.log(`
[scheduler] registered jobs:
  0 0 * * *        — midnight daily count reset
  0 9-17 * * 1-5   — sequence runner (Mon–Fri, 9am–5pm)
  0 */2 * * *      — reply check + HubSpot push (every 2h)
  */30 * * * 1-5   — natural warmup (US Eastern business hours, probabilistic)
  */5 * * * *      — conversation file scanner (every 5m)
  0 6 * * 1-5      — auto conversation generator (Mon–Fri, 6am UTC / 2am ET)
  0 2 * * *        — daily warmup summary email (2am UTC / 7am PKT)
  */15 * * * *     — reply queue processor (every 15 min)
  0 1 * * *        — daily database backup (1am UTC)
  0 3 * * *        — daily bounce rate check (3am UTC)
  0 3 * * *        — client progress reports (3am UTC / 8am PKT)
`);
}

export async function runAllNow(): Promise<{
  sequences: Awaited<ReturnType<typeof runSequences>>;
  repliesPushed: number;
  warmupRan: boolean;
}> {
  console.log("[runAllNow] starting manual run...");

  console.log("[runAllNow] running sequences...");
  const sequences = await runSequences();
  console.log("[runAllNow] sequences:", sequences);

  console.log("[runAllNow] checking replies and pushing to HubSpot...");
  const repliesPushed = await checkAndPushReplies();
  console.log(`[runAllNow] pushed ${repliesPushed} replies to HubSpot`);

  console.log("[runAllNow] running warmup...");
  await runWarmupAll();
  console.log("[runAllNow] warmup done");

  const summary = { sequences, repliesPushed, warmupRan: true };
  console.log("[runAllNow] complete:", summary);
  return summary;
}
