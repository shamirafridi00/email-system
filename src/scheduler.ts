import { readdirSync, mkdirSync, renameSync } from "fs";
import { join } from "path";

import { runSequences } from "./modules/sequences";
import { checkAllAccounts, checkReplies, type ImapAccount } from "./modules/imap";
import { runWarmupAll, processConversationFile, generateDailyConversations } from "./modules/warmup";
import { sendWarmupSummaryEmail } from "./modules/emailReports";
import { pushToHubspot, getUnpushedReplies } from "./modules/hubspot";
import { db, resetDailyCounts } from "./database";
import { isUSBusinessHours } from "./utils/timezone";

const CONVERSATIONS_DIR = join(import.meta.dir, "../conversations");
const PROCESSED_DIR = join(CONVERSATIONS_DIR, "processed");

// Tracks files dispatched this session so a 5-min tick doesn't re-queue them
const dispatchedFiles = new Set<string>();

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
    await pushToHubspot(reply);
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
  Bun.cron("0 0 * * *", () => {
    resetDailyCounts();
    console.log(`[scheduler] daily counts reset at ${new Date().toISOString()}`);
  });

  // Job 2 — sequence runner, every hour 9am–5pm Mon–Fri
  Bun.cron("0 9-17 * * 1-5", async () => {
    console.log(`[scheduler] running sequences at ${new Date().toISOString()}`);
    const stats = await runSequences();
    console.log(
      `[scheduler] sequences done — processed:${stats.processed} sent:${stats.sent} skipped:${stats.skipped} bounced:${stats.bounced} finished:${stats.finished}`
    );
  });

  // Job 3 — reply check + HubSpot push, every 2 hours
  Bun.cron("0 */2 * * *", async () => {
    console.log(`[scheduler] checking replies at ${new Date().toISOString()}`);
    const pushed = await checkAndPushReplies();
    console.log(`[scheduler] reply check done — pushed ${pushed} to HubSpot`);
  });

  // Job 4 — natural warmup: fires every 30 min Mon–Fri, then decides probabilistically
  Bun.cron("*/30 * * * 1-5", async () => {
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
  });

  // Job 5 — conversation file scanner, every 5 minutes
  Bun.cron("*/5 * * * *", () => {
    scanConversations();
  });

  // Job 6 — daily auto conversation generator, Mon–Fri at 6am UTC (2am ET)
  Bun.cron("0 6 * * 1-5", async () => {
    console.log(`[scheduler] auto-generate conversations at ${new Date().toISOString()}`);
    const result = await generateDailyConversations();
    if (result.skipped) {
      console.log(`[scheduler] auto-generate skipped: ${result.skipped}`);
    } else {
      console.log(`[scheduler] auto-generate done — generated ${result.generated} conversation(s)`);
    }
  });

  // Job 7 — daily warmup summary email, every day at 7am UTC (3am ET)
  Bun.cron("0 7 * * *", async () => {
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
  });

  console.log(`
[scheduler] registered jobs:
  0 0 * * *        — midnight daily count reset
  0 9-17 * * 1-5   — sequence runner (Mon–Fri, 9am–5pm)
  0 */2 * * *      — reply check + HubSpot push (every 2h)
  */30 * * * 1-5   — natural warmup (US Eastern business hours, probabilistic)
  */5 * * * *      — conversation file scanner (every 5m)
  0 6 * * 1-5      — auto conversation generator (Mon–Fri, 6am UTC / 2am ET)
  0 7 * * *        — daily warmup summary email (7am UTC / 3am ET)
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
