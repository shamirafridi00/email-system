import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { db } from "../database";
import { randomBusinessDelay, isUSBusinessHours, getNextUSBusinessStart } from "../utils/timezone";

interface WarmupAccount {
  id: number;
  email: string;
  app_password: string;
  daily_volume: number;
  active: number;
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

export async function runWarmupAll(accountSubset?: WarmupAccount[]): Promise<void> {
  const setting = db
    .query<{ value: string }, []>(
      "SELECT value FROM system_settings WHERE key = 'warmup_running'"
    )
    .get();

  if (setting?.value !== "1") {
    console.log("[warmup] warmup is paused — skipping runWarmupAll");
    return;
  }

  const accounts = accountSubset ?? db
    .query<WarmupAccount, []>(
      "SELECT * FROM warmup_accounts WHERE active = 1"
    )
    .all();

  if (accounts.length < 2) {
    console.log("Need at least 2 active warmup accounts to run warmup.");
    return;
  }

  for (const receiver of accounts) {
    // Pick a random sender that is not the receiver
    const pool = accounts.filter((a) => a.id !== receiver.id);
    const sender = randomItem(pool);

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

      // Auto-reply: receiver → sender with weighted human-like delay
      const replyDelayMs = randomBusinessDelay();
      await new Promise((r) => setTimeout(r, replyDelayMs));

      const replyBody = randomItem(REPLY_BODIES);
      const replySubject = `Re: ${subject}`;
      const receiverTransport = buildTransport(
        receiver.email,
        receiver.app_password
      );

      await receiverTransport.sendMail({
        from: receiver.email,
        to: sender.email,
        subject: replySubject,
        text: replyBody,
      });

      const replyPairId = `${receiver.email}:${sender.email}`;
      db.run(
        "INSERT INTO warmup_log (from_email, to_email, subject, replied, conversation_id, pair_id) VALUES (?, ?, ?, 1, 'auto', ?)",
        [receiver.email, sender.email, replySubject, replyPairId]
      );

      // Set warmup_started_at for receiver if needed
      const receiverRecord = db
        .query<{ warmup_started_at: string | null }, [number]>(
          "SELECT warmup_started_at FROM warmup_accounts WHERE id = ?"
        )
        .get(receiver.id);
      if (!receiverRecord?.warmup_started_at) {
        db.run("UPDATE warmup_accounts SET warmup_started_at = CURRENT_TIMESTAMP WHERE id = ?", [receiver.id]);
      }

      // Reset consecutive failures for receiver on success
      db.run(
        "UPDATE warmup_accounts SET consecutive_failures = 0 WHERE id = ?",
        [receiver.id]
      );

      // Update warmup_pairs for reply direction
      const existingReplyPair = db
        .query<{ id: number }, [string, string]>(
          "SELECT id FROM warmup_pairs WHERE sender_email = ? AND receiver_email = ?"
        )
        .get(receiver.email, sender.email);
      if (existingReplyPair) {
        db.run(
          "UPDATE warmup_pairs SET last_paired_at = CURRENT_TIMESTAMP, pair_count = pair_count + 1 WHERE id = ?",
          [existingReplyPair.id]
        );
      } else {
        db.run(
          "INSERT INTO warmup_pairs (sender_email, receiver_email) VALUES (?, ?)",
          [receiver.email, sender.email]
        );
      }

      console.log(
        `Warmup reply: ${receiver.email} → ${sender.email} | ${replySubject}`
      );
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
    }
  }
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
    .query<WarmupAccount, []>("SELECT * FROM warmup_accounts WHERE active = 1")
    .all();

  if (accounts.length < 2) {
    return { generated: 0, skipped: "fewer than 2 active accounts" };
  }

  // Generate 2–3 conversations randomly each day
  const count = 2 + Math.floor(Math.random() * 2);
  const CONVERSATIONS_DIR_PATH = new URL("../../conversations", import.meta.url).pathname;

  let generated = 0;
  for (let i = 0; i < count; i++) {
    const row = db
      .query<{ topic: string }, []>(
        "SELECT topic FROM warmup_conversations_library ORDER BY RANDOM() LIMIT 1"
      )
      .get();
    const topic = row?.topic ?? "project kickoff";

    const shuffled = accounts.slice().sort(() => Math.random() - 0.5);
    const sender = shuffled[0];
    const receiver = shuffled.find((a) => a.id !== sender.id)!;

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

    if (i < count - 1) await new Promise((r) => setTimeout(r, 200));
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
