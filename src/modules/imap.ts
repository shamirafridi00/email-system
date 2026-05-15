import { ImapFlow } from "imapflow";
import { db } from "../database";

export interface ImapAccount {
  email: string;
  app_password: string;
}

interface LeadRow {
  id: number;
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
        // Fetch all unseen messages — only envelope (headers), no body download
        for await (const msg of client.fetch("1:*", {
          envelope: true,
          flags: true,
        })) {
          if (msg.flags.has("\\Seen")) continue;

          const senderAddress = msg.envelope.from?.[0]?.address?.toLowerCase();
          if (!senderAddress) continue;

          const lead = db
            .query<LeadRow, [string]>(
              "SELECT id, status FROM leads WHERE LOWER(email) = ?"
            )
            .get(senderAddress);

          if (lead) {
            if (lead.status !== "replied") {
              db.run("UPDATE leads SET status = 'replied' WHERE id = ?", [
                lead.id,
              ]);
              db.run("INSERT INTO replies (lead_id) VALUES (?)", [lead.id]);
              console.log(
                `Reply detected from ${senderAddress} (lead ${lead.id}) on ${account.email}`
              );
            }
          }

          // Mark seen regardless of match so we don't re-process it next run
          await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"], {
            uid: true,
          });
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
