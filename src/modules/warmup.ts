import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { db } from "../database";
import { randomBusinessDelay, isUSBusinessHours, getNextUSBusinessStart } from "../utils/timezone";
import { sendFailureAlert, sendWarmupCompleteNotification } from "./emailReports";

interface WarmupAccount {
  id: number;
  email: string;
  app_password: string;
  daily_volume: number;
  active: number;
  warmup_started_at?: string | null;
}

interface ConversationEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  send_after_minutes: number;
}

interface ConversationFile {
  conversation_id?: string;
  emails: ConversationEmail[];
}

const SUBJECTS = [
  "Following up",
  "Quick question",
  "Checking in",
  "Touching base",
  "Quick thought",
  "Re our conversation",
];

const BODIES = [
  `Hey,\n\nJust wanted to follow up on what we discussed last week. Have you had a chance to look at the proposal? Let me know if you need anything from my end.\n\nBest,`,
  `Hi,\n\nHoping to catch you before the end of the week. Still waiting on the updated timeline from your side — can you send that over when you get a moment?\n\nThanks,`,
  `Hey,\n\nI was going over our notes from the last call and had a quick thought. Would it make sense to push the kickoff to next Wednesday instead? More runway for both teams.\n\nLet me know,`,
  `Hi,\n\nJust a quick check-in. We're wrapping up our end of the project this week and want to make sure we're aligned before we hand off. Are you free for a 15-minute call Thursday?\n\nBest,`,
  `Hey,\n\nDid you get a chance to review the draft I sent Monday? No rush, just want to make sure it didn't get buried. Happy to jump on a quick call if it's easier to talk through.\n\nCheers,`,
  `Hi,\n\nCircling back on this one. We had a brief conversation about moving forward but I haven't heard back. Are we still on track or has something changed on your end?\n\nThanks,`,
  `Hey,\n\nQuick one — are we still meeting tomorrow at 2pm? I haven't seen a calendar invite yet. Let me know and I'll send one over if needed.\n\nBest,`,
  `Hi,\n\nJust wanted to touch base and see how things are going on your end. We're making good progress here and I think we're in good shape for the deadline. Anything you need from us?\n\nTalk soon,`,
];

const REPLY_BODIES = [
  "Thanks for reaching out. I'll take a look and get back to you shortly.",
  "Got it, will get back to you soon.",
  "Sounds good, talk soon.",
  "Appreciated, let me check and come back to you.",
  "Thanks for the update. I'll follow up once I've had a chance to review.",
  "Got this, will circle back by end of week.",
  "Perfect, that works for me. Will confirm closer to the date.",
  "Thanks, noted. I'll loop in the team and get back to you.",
];

function buildTransport(email: string, appPassword: string) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: email, pass: appPassword },
  });
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function processConversationFile(filePath: string): void {
  let parsed: ConversationFile;

  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ConversationFile;
  } catch (err) {
    console.error(`Failed to parse conversation file ${filePath}:`, err);
    return;
  }

  const conversationId = parsed.conversation_id || "auto";

  // If outside US business hours, offset all sends so the first email starts
  // at the next business-day 8am Eastern + a random 0–60 min warm-start offset.
  let baseOffsetMs = 0;
  if (!isUSBusinessHours()) {
    const nextStart = getNextUSBusinessStart();
    const warmStartJitter = Math.floor(Math.random() * 60_000 * 60); // 0–60 min
    baseOffsetMs = nextStart.getTime() - Date.now() + warmStartJitter;
    console.log(
      `[warmup] outside business hours — conversation "${conversationId}" starts in ${Math.round(baseOffsetMs / 60_000)}m`
    );
  }

  for (const email of parsed.emails) {
    // Apply ±20% jitter to each scheduled delay
    const nominalMs = email.send_after_minutes * 60_000;
    const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8–1.2
    const scheduledMs = baseOffsetMs + Math.round(nominalMs * jitterFactor);

    setTimeout(
      async () => {
        try {
          const fromAccount = db
            .query<WarmupAccount, [string]>(
              "SELECT * FROM warmup_accounts WHERE email = ? AND active = 1"
            )
            .get(email.from);

          if (!fromAccount) {
            console.error(`Warmup account not found or inactive: ${email.from}`);
            return;
          }

          const transport = buildTransport(fromAccount.email, fromAccount.app_password);

          await transport.sendMail({
            from: fromAccount.email,
            to: email.to,
            subject: email.subject,
            text: email.body,
          });

          db.run(
            "INSERT INTO warmup_log (from_email, to_email, subject, conversation_id) VALUES (?, ?, ?, ?)",
            [fromAccount.email, email.to, email.subject, conversationId]
          );

          console.log(`Warmup sent: ${fromAccount.email} → ${email.to} | ${email.subject}`);
        } catch (err) {
          console.error(`Warmup send failed (${email.from} → ${email.to}):`, err);
        }
      },
      scheduledMs
    );
  }
}

export async function runWarmupAll(accountSubset?: WarmupAccount[], groupName?: string): Promise<void> {
  const setting = db
    .query<{ value: string }, []>(
      "SELECT value FROM system_settings WHERE key = 'warmup_running'"
    )
    .get();

  if (setting?.value !== "1") {
    console.log("[warmup] warmup is paused — skipping runWarmupAll");
    return;
  }

  let accounts: WarmupAccount[];
  if (accountSubset) {
    accounts = accountSubset;
  } else if (groupName) {
    accounts = db
      .query<WarmupAccount, [string]>(
        "SELECT * FROM warmup_accounts WHERE active = 1 AND group_name = ?"
      )
      .all(groupName);
  } else {
    accounts = db
      .query<WarmupAccount, []>(
        "SELECT * FROM warmup_accounts WHERE active = 1"
      )
      .all();
  }

  if (accounts.length < 2) {
    console.log("Need at least 2 active warmup accounts to run warmup.");
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  for (const receiver of accounts) {
    // Check if receiver has hit their daily schedule target — skip if so
    const receiverWeek = receiver.warmup_started_at
      ? Math.min(4, Math.floor((Date.now() - new Date(receiver.warmup_started_at).getTime()) / (7 * 86_400_000)) + 1)
      : 1;
    const receiverPlan = db
      .query<{ emails_per_day: number }, [number, number]>(
        "SELECT emails_per_day FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ? AND active = 1"
      )
      .get(receiver.id, receiverWeek);
    const receiverTarget = receiverPlan?.emails_per_day ?? (receiverWeek <= 1 ? 5 : receiverWeek === 2 ? 10 : 20);
    const receiverSentToday = db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND DATE(sent_at) = ?"
      )
      .get(receiver.email, today)?.count ?? 0;
    if (receiverSentToday >= receiverTarget) {
      console.log(`[warmup] ${receiver.email} has hit daily target (${receiverSentToday}/${receiverTarget}) — skipping`);
      continue;
    }

    // Pick a random sender that is not the receiver
    const pool = accounts.filter((a) => a.id !== receiver.id);
    const sender = randomItem(pool);

    // Check sender daily target too
    const senderWeek = sender.warmup_started_at
      ? Math.min(4, Math.floor((Date.now() - new Date(sender.warmup_started_at).getTime()) / (7 * 86_400_000)) + 1)
      : 1;
    const senderPlan = db
      .query<{ emails_per_day: number }, [number, number]>(
        "SELECT emails_per_day FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ? AND active = 1"
      )
      .get(sender.id, senderWeek);
    const senderTarget = senderPlan?.emails_per_day ?? (senderWeek <= 1 ? 5 : senderWeek === 2 ? 10 : 20);
    const senderSentToday = db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND DATE(sent_at) = ?"
      )
      .get(sender.email, today)?.count ?? 0;
    if (senderSentToday >= senderTarget) {
      console.log(`[warmup] ${sender.email} has hit daily target (${senderSentToday}/${senderTarget}) — skipping as sender`);
      continue;
    }

    console.log(
      `Attempting warmup: ${sender.email} → ${receiver.email} | app_password length: ${sender.app_password.length} chars`
    );

    const subject = randomItem(SUBJECTS);
    const body = randomItem(BODIES);

    try {
      // Send initial warmup email: sender → receiver
      const senderTransport = buildTransport(sender.email, sender.app_password);

      await senderTransport.sendMail({
        from: sender.email,
        to: receiver.email,
        subject,
        text: body,
      });

      const pairId = `${sender.email}:${receiver.email}`;
      db.run(
        "INSERT INTO warmup_log (from_email, to_email, subject, replied, conversation_id, pair_id) VALUES (?, ?, ?, 0, 'auto', ?)",
        [sender.email, receiver.email, subject, pairId]
      );

      // Set warmup_started_at if this is the first send for this account
      const senderRecord = db
        .query<{ warmup_started_at: string | null }, [number]>(
          "SELECT warmup_started_at FROM warmup_accounts WHERE id = ?"
        )
        .get(sender.id);
      if (!senderRecord?.warmup_started_at) {
        db.run("UPDATE warmup_accounts SET warmup_started_at = CURRENT_TIMESTAMP WHERE id = ?", [sender.id]);
      }

      // Reset consecutive failures on success
      db.run(
        "UPDATE warmup_accounts SET consecutive_failures = 0 WHERE id = ?",
        [sender.id]
      );

      // Check if sender just completed 14-day warmup for the first time
      {
        const senderFull = db
          .query<{ warmup_started_at: string | null; health_score: number; status: string }, [number]>(
            "SELECT warmup_started_at, health_score, status FROM warmup_accounts WHERE id = ?"
          )
          .get(sender.id);
        if (senderFull?.warmup_started_at) {
          const daysActive = Math.floor((Date.now() - new Date(senderFull.warmup_started_at).getTime()) / 86_400_000);
          const sentKey = `warmup_complete_sent_${sender.email}`;
          const alreadySent = db.query<{ value: string }, []>(`SELECT value FROM system_settings WHERE key = '${sentKey}'`).get();
          if (daysActive >= 14 && !alreadySent) {
            const totalSent = db.query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ?").get(sender.email)?.count ?? 0;
            const grade = senderFull.health_score >= 80 ? "Excellent" : senderFull.health_score >= 60 ? "Good" : senderFull.health_score >= 40 ? "Fair" : senderFull.health_score >= 20 ? "Poor" : "Critical";
            try {
              await sendWarmupCompleteNotification({ email: sender.email, days_active: daysActive, emails_sent_total: totalSent, health_score: senderFull.health_score, health_grade: grade });
            } catch (completeErr) {
              console.error(`[warmup] sendWarmupCompleteNotification failed for ${sender.email}:`, completeErr);
            }
          }
        }
      }

      // Update warmup_pairs table
      const existingPair = db
        .query<{ id: number }, [string, string]>(
          "SELECT id FROM warmup_pairs WHERE sender_email = ? AND receiver_email = ?"
        )
        .get(sender.email, receiver.email);
      if (existingPair) {
        db.run(
          "UPDATE warmup_pairs SET last_paired_at = CURRENT_TIMESTAMP, pair_count = pair_count + 1 WHERE id = ?",
          [existingPair.id]
        );
      } else {
        db.run(
          "INSERT INTO warmup_pairs (sender_email, receiver_email) VALUES (?, ?)",
          [sender.email, receiver.email]
        );
      }

      console.log(`Warmup sent: ${sender.email} → ${receiver.email} | ${subject}`);

      // Schedule reply chain into warmup_reply_queue (no setTimeout)
      const initialLogId = (db.query<{ id: number }, [string, string]>(
        "SELECT id FROM warmup_log WHERE from_email = ? AND to_email = ? ORDER BY sent_at DESC LIMIT 1"
      ).get(sender.email, receiver.email))?.id ?? 0;

      scheduleReplyChain({
        conversationId: `auto_${pairId}_${Date.now()}`,
        initialSubject: subject,
        senderEmail:    sender.email,
        receiverEmail:  receiver.email,
        parentLogId:    initialLogId,
      });
    } catch (err) {
      console.error(
        `Warmup cycle failed (${sender.email} → ${receiver.email}):`,
        err
      );
      // Track failure on sender account
      db.run(
        "UPDATE warmup_accounts SET consecutive_failures = consecutive_failures + 1, last_failure_at = CURRENT_TIMESTAMP WHERE id = ?",
        [sender.id]
      );
      const updatedFailures = db
        .query<{ consecutive_failures: number }, [number]>(
          "SELECT consecutive_failures FROM warmup_accounts WHERE id = ?"
        )
        .get(sender.id)?.consecutive_failures ?? 0;
      if (updatedFailures >= 3) {
        db.run(
          "INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason) VALUES (?, ?, 'warming', 'flagged', ?)",
          [sender.id, sender.email, `Authentication failure ${updatedFailures} during warmup cycle — account flagged`]
        );
      } else {
        db.run(
          "INSERT INTO account_status_history (account_id, account_email, previous_status, new_status, reason) VALUES (?, ?, 'warming', 'warming', ?)",
          [sender.id, sender.email, `Authentication failure ${updatedFailures} during warmup cycle`]
        );
      }
      if (updatedFailures >= 2) {
        try {
          await sendFailureAlert({
            email: sender.email,
            consecutive_failures: updatedFailures,
            last_failure_at: new Date().toISOString(),
            error_message: err instanceof Error ? err.message : String(err),
          });
        } catch (alertErr) {
          console.error(`[warmup] sendFailureAlert failed for ${sender.email}:`, alertErr);
        }
      }
    }
  }
}

// ─── Reply queue helpers ──────────────────────────────────────────────────────

const THREAD_CLOSERS = [
  "Sounds good, talk soon.",
  "Perfect, I'll get that to you by end of week.",
  "Great, thanks for the quick reply.",
  "Noted, I'll follow up once I have an update.",
];

const THREAD_SHORT = [
  "Got it, thanks.",
  "Will do.",
  "Perfect.",
  "Understood, thanks.",
];

function scheduleTime(from: Date, delayMs: number): Date {
  const proposed = new Date(from.getTime() + delayMs);
  if (isUSBusinessHours(proposed)) return proposed;
  // Move to next business day 8am ET + random 0–45 min
  const next = getNextUSBusinessStart(proposed);
  next.setTime(next.getTime() + Math.floor(Math.random() * 45 * 60_000));
  return next;
}

function scheduleReplyChain(opts: {
  conversationId: string;
  initialSubject: string;
  senderEmail: string;    // original sender (sends level 2, 4)
  receiverEmail: string;  // original receiver (sends level 1, 3)
  parentLogId: number;
}): void {
  const now = new Date();

  // Level 1: receiver → sender
  const t1 = scheduleTime(now, randomBusinessDelay());
  const s1 = `Re: ${opts.initialSubject}`;
  const b1 = randomItem(REPLY_BODIES);
  db.run(
    `INSERT INTO warmup_reply_queue (conversation_id, thread_level, from_email, to_email, subject, body, scheduled_at, status, parent_log_id)
     VALUES (?, 1, ?, ?, ?, ?, ?, 'pending', ?)`,
    [opts.conversationId, opts.receiverEmail, opts.senderEmail, s1, b1, t1.toISOString(), opts.parentLogId]
  );

  // Level 2: sender → receiver
  const t2 = scheduleTime(t1, randomBusinessDelay());
  const s2 = `Re: Re: ${opts.initialSubject}`;
  const b2 = randomItem(BODIES);
  db.run(
    `INSERT INTO warmup_reply_queue (conversation_id, thread_level, from_email, to_email, subject, body, scheduled_at, status, parent_log_id)
     VALUES (?, 2, ?, ?, ?, ?, ?, 'pending', ?)`,
    [opts.conversationId, opts.senderEmail, opts.receiverEmail, s2, b2, t2.toISOString(), opts.parentLogId]
  );

  // Level 3: 40% chance — receiver → sender
  if (Math.random() < 0.4) {
    const t3 = scheduleTime(t2, randomBusinessDelay());
    const s3 = `Re: Re: Re: ${opts.initialSubject}`;
    const b3 = randomItem(THREAD_CLOSERS);
    db.run(
      `INSERT INTO warmup_reply_queue (conversation_id, thread_level, from_email, to_email, subject, body, scheduled_at, status, parent_log_id)
       VALUES (?, 3, ?, ?, ?, ?, ?, 'pending', ?)`,
      [opts.conversationId, opts.receiverEmail, opts.senderEmail, s3, b3, t3.toISOString(), opts.parentLogId]
    );

    // Level 4: 20% of all conversations (50% of those that got level 3)
    if (Math.random() < 0.5) {
      const t4 = scheduleTime(t3, randomBusinessDelay());
      const s4 = `Re: Re: Re: Re: ${opts.initialSubject}`;
      const b4 = randomItem(THREAD_SHORT);
      db.run(
        `INSERT INTO warmup_reply_queue (conversation_id, thread_level, from_email, to_email, subject, body, scheduled_at, status, parent_log_id)
         VALUES (?, 4, ?, ?, ?, ?, ?, 'pending', ?)`,
        [opts.conversationId, opts.senderEmail, opts.receiverEmail, s4, b4, t4.toISOString(), opts.parentLogId]
      );
    }
  }

  console.log(`[warmup] queued reply chain for conversation ${opts.conversationId}`);
}

export async function processReplyQueue(): Promise<number> {
  const now = new Date().toISOString();

  const due = db.query<{
    id: number; conversation_id: string; thread_level: number;
    from_email: string; to_email: string; subject: string; body: string;
    scheduled_at: string; parent_log_id: number;
  }, [string]>(
    `SELECT id, conversation_id, thread_level, from_email, to_email, subject, body, scheduled_at, parent_log_id
     FROM warmup_reply_queue
     WHERE status = 'pending' AND scheduled_at <= ?
     ORDER BY scheduled_at ASC
     LIMIT 10`
  ).all(now);

  console.log(`[reply-queue] Processing reply queue — found ${due.length} due replies at ${now}`);

  let processed = 0;
  let failed    = 0;

  for (const row of due) {
    const acct = db.query<{ email: string; app_password: string }, [string]>(
      "SELECT email, app_password FROM warmup_accounts WHERE email = ? AND active = 1"
    ).get(row.from_email);

    if (!acct) {
      db.run("UPDATE warmup_reply_queue SET status = 'skipped' WHERE id = ?", [row.id]);
      console.warn(`[reply-queue] account not found/inactive: ${row.from_email} — skipped`);
      continue;
    }

    console.log(`[reply-queue] Attempting reply level ${row.thread_level} from ${acct.email} to ${row.to_email}`);

    try {
      const transport = buildTransport(acct.email, acct.app_password);
      await transport.sendMail({
        from:    acct.email,
        to:      row.to_email,
        subject: row.subject,
        text:    row.body,
      });

      db.run("UPDATE warmup_reply_queue SET status = 'sent' WHERE id = ?", [row.id]);

      const pairId = `${acct.email}:${row.to_email}`;
      db.run(
        "INSERT INTO warmup_log (from_email, to_email, subject, replied, conversation_id, pair_id) VALUES (?, ?, ?, 1, ?, ?)",
        [acct.email, row.to_email, row.subject, row.conversation_id, pairId]
      );

      // Update warmup_pairs
      const existingPair = db.query<{ id: number }, [string, string]>(
        "SELECT id FROM warmup_pairs WHERE sender_email = ? AND receiver_email = ?"
      ).get(acct.email, row.to_email);
      if (existingPair) {
        db.run(
          "UPDATE warmup_pairs SET last_paired_at = CURRENT_TIMESTAMP, pair_count = pair_count + 1 WHERE id = ?",
          [existingPair.id]
        );
      } else {
        db.run("INSERT INTO warmup_pairs (sender_email, receiver_email) VALUES (?, ?)", [acct.email, row.to_email]);
      }

      // Reset consecutive failures
      db.run("UPDATE warmup_accounts SET consecutive_failures = 0 WHERE email = ?", [acct.email]);

      console.log(`[reply-queue] Reply sent successfully — L${row.thread_level}: ${acct.email} → ${row.to_email} | ${row.subject}`);
      processed++;
    } catch (err) {
      db.run("UPDATE warmup_reply_queue SET status = 'failed' WHERE id = ?", [row.id]);
      db.run(
        "UPDATE warmup_accounts SET consecutive_failures = consecutive_failures + 1, last_failure_at = CURRENT_TIMESTAMP WHERE email = ?",
        [acct.email]
      );
      console.error(`[reply-queue] Reply failed — L${row.thread_level}: ${acct.email} → ${row.to_email} | Error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`[reply-queue] Queue processing complete — sent ${processed} failed ${failed}`);

  // Reschedule missed sends (pending but scheduled_at > 4 hours ago)
  const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000).toISOString();
  const missedRows = db.query<{ id: number }, [string]>(
    "SELECT id FROM warmup_reply_queue WHERE status = 'pending' AND scheduled_at < ?"
  ).all(fourHoursAgo);

  if (missedRows.length > 0) {
    const nextWindow = getNextUSBusinessStart();
    for (const m of missedRows) {
      const rescheduled = new Date(nextWindow.getTime() + Math.floor(Math.random() * 30 * 60_000));
      db.run("UPDATE warmup_reply_queue SET scheduled_at = ? WHERE id = ?", [rescheduled.toISOString(), m.id]);
    }
    console.log(`[reply-queue] rescheduled ${missedRows.length} missed reply(ies) to next business window`);
  }

  return processed;
}

export interface GeneratedConversation {
  conversation_id: string;
  emails: ConversationEmail[];
}

export function generateConversation(
  senderEmail: string,
  receiverEmail: string,
  topic: string
): GeneratedConversation {
  const convId = `auto_${topic.replace(/\s+/g, "_")}_${Date.now()}`;

  // Pick a random entry from the library for this topic, fallback to any random
  let libEntry = db
    .query<{ subject: string; body_sender: string; body_receiver: string }, [string]>(
      "SELECT subject, body_sender, body_receiver FROM warmup_conversations_library WHERE topic = ? ORDER BY RANDOM() LIMIT 1"
    )
    .get(topic);

  if (!libEntry) {
    libEntry = db
      .query<{ subject: string; body_sender: string; body_receiver: string }, []>(
        "SELECT subject, body_sender, body_receiver FROM warmup_conversations_library ORDER BY RANDOM() LIMIT 1"
      )
      .get() ?? { subject: "Following up", body_sender: randomItem(BODIES), body_receiver: randomItem(REPLY_BODIES) };
  }

  // Randomly choose 4, 5, or 6 emails
  const emailCount = 4 + Math.floor(Math.random() * 3); // 4–6
  const schedules: number[][] = [
    [0, 45, 120, 240],
    [0, 30, 90, 180, 300],
    [0, 25, 70, 140, 220, 320],
  ];
  const schedule = schedules[emailCount - 4];

  const emails: ConversationEmail[] = [];
  for (let i = 0; i < emailCount; i++) {
    const fromEmail = i % 2 === 0 ? senderEmail : receiverEmail;
    const toEmail = i % 2 === 0 ? receiverEmail : senderEmail;

    const subject = i === 0 ? libEntry.subject : `Re: ${libEntry.subject}`;

    let body: string;
    if (i === 0) {
      body = libEntry.body_sender;
    } else if (i === 1) {
      body = libEntry.body_receiver;
    } else {
      body = i % 2 === 0 ? randomItem(BODIES) : randomItem(REPLY_BODIES);
    }

    emails.push({
      from: fromEmail,
      to: toEmail,
      subject,
      body,
      send_after_minutes: schedule[i],
    });
  }

  return { conversation_id: convId, emails };
}

export async function generateDailyConversations(): Promise<{ generated: number; skipped: string }> {
  const setting = db
    .query<{ value: string }, []>(
      "SELECT value FROM system_settings WHERE key = 'auto_generate_conversations'"
    )
    .get();

  if (setting?.value !== "1") {
    return { generated: 0, skipped: "auto-generate is disabled" };
  }

  const accounts = db
    .query<WarmupAccount & { warmup_started_at: string | null }, []>(
      "SELECT * FROM warmup_accounts WHERE active = 1"
    )
    .all();

  if (accounts.length < 2) {
    return { generated: 0, skipped: "fewer than 2 active accounts" };
  }

  const CONVERSATIONS_DIR_PATH = new URL("../../conversations", import.meta.url).pathname;
  const today = new Date().toISOString().split("T")[0];
  let generated = 0;

  // For each account, determine how many more conversations to generate based on schedule plan
  const accountTargets: { account: typeof accounts[0]; remaining: number }[] = [];
  for (const acct of accounts) {
    const weekNum = acct.warmup_started_at
      ? Math.min(4, Math.floor((Date.now() - new Date(acct.warmup_started_at).getTime()) / (7 * 86_400_000)) + 1)
      : 1;
    const plan = db
      .query<{ emails_per_day: number }, [number, number]>(
        "SELECT emails_per_day FROM warmup_schedule_plans WHERE account_id = ? AND week_number = ? AND active = 1"
      )
      .get(acct.id, weekNum);
    const target = plan?.emails_per_day ?? (weekNum <= 1 ? 5 : weekNum === 2 ? 10 : 20);
    const sentToday = db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) as count FROM warmup_log WHERE from_email = ? AND DATE(sent_at) = ?"
      )
      .get(acct.email, today)?.count ?? 0;
    const remaining = Math.max(0, target - sentToday);
    if (remaining > 0) accountTargets.push({ account: acct, remaining });
  }

  // Generate conversations to fill gaps — pair accounts that still need volume
  const pairs: { sender: typeof accounts[0]; receiver: typeof accounts[0]; topic: string }[] = [];
  for (const { account: sender, remaining } of accountTargets) {
    const possibleReceivers = accounts.filter((a) => a.id !== sender.id);
    if (possibleReceivers.length === 0) continue;
    const convCount = Math.ceil(remaining / 2); // each conversation covers ~2 sends (send + reply)
    for (let i = 0; i < Math.min(convCount, 3); i++) {
      const receiver = possibleReceivers[Math.floor(Math.random() * possibleReceivers.length)];
      const row = db
        .query<{ topic: string }, []>(
          "SELECT topic FROM warmup_conversations_library ORDER BY RANDOM() LIMIT 1"
        )
        .get();
      pairs.push({ sender, receiver, topic: row?.topic ?? "project kickoff" });
    }
  }

  // Deduplicate and cap at 5 total
  const seen = new Set<string>();
  const uniquePairs = pairs.filter((p) => {
    const key = `${p.sender.id}:${p.receiver.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);

  if (uniquePairs.length === 0) {
    // Fallback: generate 2 random conversations if no targets computed
    const shuffled = accounts.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(2, Math.floor(accounts.length / 2)); i++) {
      const row = db.query<{ topic: string }, []>("SELECT topic FROM warmup_conversations_library ORDER BY RANDOM() LIMIT 1").get();
      uniquePairs.push({ sender: shuffled[i * 2], receiver: shuffled[i * 2 + 1], topic: row?.topic ?? "project kickoff" });
    }
  }

  for (let i = 0; i < uniquePairs.length; i++) {
    const { sender, receiver, topic } = uniquePairs[i];
    const conv = generateConversation(sender.email, receiver.email, topic);
    const filename = `auto_${topic.replace(/\s+/g, "_")}_${Date.now()}_${i}.json`;
    const filePath = `${CONVERSATIONS_DIR_PATH}/${filename}`;

    try {
      const { writeFileSync } = await import("fs");
      writeFileSync(filePath, JSON.stringify(conv, null, 2), "utf-8");
      processConversationFile(filePath);
      db.run(
        "INSERT INTO conversation_files (filename, email_count, status, topic, source) VALUES (?, ?, 'scheduled', ?, 'auto')",
        [filename, conv.emails.length, topic]
      );
      generated++;
    } catch (err) {
      console.error(`[warmup] generateDailyConversations: failed to write ${filename}:`, err);
    }

    if (i < uniquePairs.length - 1) await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[warmup] generateDailyConversations: generated ${generated} conversation(s)`);
  return { generated, skipped: "" };
}

export function getWarmupStats(): { sent_today: number } {
  const today = new Date().toISOString().split("T")[0];
  const row = db
    .query<{ count: number }, [string]>(
      "SELECT COUNT(*) as count FROM warmup_log WHERE DATE(sent_at) = ?"
    )
    .get(today);

  return { sent_today: row?.count ?? 0 };
}
