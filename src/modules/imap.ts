import { ImapFlow } from "imapflow";
import { db } from "../database";
import { logWarning } from "./logger";
import { sendReplyNotification } from "./emailReports";
import { recordReply } from "./abTesting";

export interface ImapAccount {
  email: string;
  app_password: string;
}

interface LeadRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  campaign_id: number | null;
  status: string;
}

export async function checkReplies(account: ImapAccount): Promise<void> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: account.email, pass: account.app_password },
    logger: false,
    socketTimeout: 30000,
    connectionTimeout: 30000,
  });

  // Catch stray socket errors emitted after the main flow completes
  // so they never surface as unhandledRejection and crash the process
  client.on("error", (err: Error) => {
    console.error(`IMAP socket error for ${account.email}:`, err.message);
  });

  try {
    await client.connect();

    try {
      const lock = await client.getMailboxLock("INBOX");

      try {
        // Fetch all unseen messages with envelope + body text
        for await (const msg of client.fetch("1:*", {
          envelope: true,
          flags: true,
          bodyParts: ["text"],
        })) {
          if (msg.flags.has("\\Seen")) continue;

          const senderAddress = msg.envelope.from?.[0]?.address?.toLowerCase();
          if (!senderAddress) continue;

          // Extract plain text body for reply preview
          let replyPreview = "";
          try {
            const bodyPart = msg.bodyParts?.get("text");
            if (bodyPart) {
              replyPreview = Buffer.from(bodyPart).toString("utf8").trim().slice(0, 300);
            }
          } catch {
            // body extraction is best-effort
          }

          const lead = db
            .query<LeadRow, [string]>(
              "SELECT id, first_name, last_name, email, company, campaign_id, status FROM leads WHERE LOWER(email) = ?"
            )
            .get(senderAddress);

          if (lead) {
            if (lead.status !== "replied") {
              db.run("UPDATE leads SET status = 'replied' WHERE id = ?", [lead.id]);
              db.run("INSERT INTO replies (lead_id) VALUES (?)", [lead.id]);
              console.log(`Reply detected from ${senderAddress} (lead ${lead.id}) on ${account.email}`);

              // Record reply on any active A/B test for this lead's most recent sent log entry
              try {
                const abRow = db
                  .query<{ ab_test_id: number; ab_variant: string }, [number]>(
                    "SELECT ab_test_id, ab_variant FROM sent_log WHERE lead_id = ? AND ab_test_id IS NOT NULL ORDER BY sent_at DESC LIMIT 1"
                  )
                  .get(lead.id);
                if (abRow) {
                  recordReply(abRow.ab_test_id, abRow.ab_variant);
                }
              } catch {}

              // Send instant notification — never let this break the IMAP flow
              sendReplyNotification(lead, replyPreview || "No preview available").catch((err) => {
                console.error("[imap] sendReplyNotification failed:", err instanceof Error ? err.message : err);
              });
            }
          }

          // Mark seen regardless of match so we don't re-process it next run
          await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch((err: Error) => {
        console.error(`IMAP logout error for ${account.email}:`, err.message);
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`IMAP check failed for ${account.email}: ${msg}`);
    logWarning("imap", msg, { account_email: account.email }).catch(() => {});
    // Always resolve — a single account failure must never crash the scheduler
  }
}

// Runs checkReplies across every active sending account
export async function checkAllAccounts(): Promise<void> {
  const accounts = db
    .query<ImapAccount, []>(
      "SELECT email, app_password FROM accounts WHERE status != 'paused'"
    )
    .all();

  for (const account of accounts) {
    try {
      await checkReplies(account);
    } catch (err) {
      console.error(`IMAP check failed for ${account.email}:`, err);
    }
  }
}
