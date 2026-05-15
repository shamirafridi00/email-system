import { readdirSync, mkdirSync, renameSync } from "fs";
import { join } from "path";

import { runSequences } from "./modules/sequences";
import { checkAllAccounts, checkReplies, type ImapAccount } from "./modules/imap";
import { runWarmupAll, processConversationFile } from "./modules/warmup";
import { pushToHubspot, getUnpushedReplies } from "./modules/hubspot";
import { db, resetDailyCounts } from "./database";

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

  // Job 4 — morning warmup
  Bun.cron("0 8 * * *", async () => {
    console.log(`[scheduler] morning warmup starting at ${new Date().toISOString()}`);
    await runWarmupAll();
    const count = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_accounts WHERE active = 1"
      )
      .get()?.count ?? 0;
    console.log(`[scheduler] morning warmup complete — ${count} accounts processed`);
  });

  // Job 5 — afternoon warmup
  Bun.cron("0 14 * * *", async () => {
    console.log(`[scheduler] afternoon warmup starting at ${new Date().toISOString()}`);
    await runWarmupAll();
    const count = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM warmup_accounts WHERE active = 1"
      )
      .get()?.count ?? 0;
    console.log(`[scheduler] afternoon warmup complete — ${count} accounts processed`);
  });

  // Job 6 — conversation file scanner, every 5 minutes
  Bun.cron("*/5 * * * *", () => {
    scanConversations();
  });

  console.log(`
[scheduler] registered jobs:
  0 0 * * *       — midnight daily count reset
  0 9-17 * * 1-5  — sequence runner (Mon–Fri, 9am–5pm)
  0 */2 * * *     — reply check + HubSpot push (every 2h)
  0 8 * * *       — morning warmup
  0 14 * * *      — afternoon warmup
  */5 * * * *     — conversation file scanner (every 5m)
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
