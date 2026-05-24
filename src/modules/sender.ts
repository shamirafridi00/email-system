import nodemailer from "nodemailer";
import { db } from "../database";
import { isBlacklisted } from "./blacklistChecker";

export interface SendOptions {
  from: string;
  to: string;
  subject: string;
  body: string;
  appPassword: string;
  unsubscribe_token?: string;
  lead_email?: string;
  tracking_token?: string;
}

export interface AccountRow {
  id: number;
  email: string;
  app_password: string;
  daily_limit: number;
  emails_sent_today: number;
  status: string;
}

function buildTransport(email: string, appPassword: string) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: email, pass: appPassword },
  });
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function capitalizeSentences(text: string): string {
  return text.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, pre, letter) => pre + letter.toUpperCase());
}

function buildHtml(text: string, unsubscribeUrl?: string, leadEmail?: string, trackingPixelUrl?: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).join("<br>");
      return `<p style="margin:0 0 14px 0">${lines}</p>`;
    })
    .join("\n");

  const footer = unsubscribeUrl
    ? `\n<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#888888;text-align:center">
You received this email because ${leadEmail ?? "your email"} matched your business profile.
To unsubscribe, <a href="${unsubscribeUrl}" style="color:#888888">click here</a>.
</div>`
    : "";

  const pixel = trackingPixelUrl
    ? `\n<img src="${trackingPixelUrl}" width="1" height="1" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0" alt="" border="0">`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>
<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222222;max-width:600px">
${paragraphs}${footer}${pixel}
</div>
</body>
</html>`;
}

export async function sendEmail(opts: SendOptions): Promise<void> {
  const blacklistCheck = isBlacklisted(opts.to);
  if (blacklistCheck.blacklisted) {
    throw new Error(`Email address is blacklisted: ${blacklistCheck.reason}`);
  }

  const processedBody = capitalizeSentences(opts.body);
  const transport = buildTransport(opts.from, opts.appPassword);

  const dashboardRow = db
    .query<{ value: string }, []>("SELECT value FROM system_settings WHERE key = 'dashboard_url'")
    .get();
  const base = (dashboardRow?.value ?? "http://localhost:3000").replace(/\/$/, "");

  let unsubscribeUrl: string | undefined;
  if (opts.unsubscribe_token) {
    unsubscribeUrl = `${base}/leads/unsubscribe?token=${opts.unsubscribe_token}`;
  }

  let trackingPixelUrl: string | undefined;
  if (opts.tracking_token) {
    trackingPixelUrl = `${base}/track/open/${opts.tracking_token}`;
  }

  const plainText = unsubscribeUrl
    ? `${processedBody}\n\n--\nTo unsubscribe visit: ${unsubscribeUrl}`
    : processedBody;

  const mailOptions: Parameters<typeof transport.sendMail>[0] = {
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: plainText,
    html: buildHtml(processedBody, unsubscribeUrl, opts.lead_email, trackingPixelUrl),
  };

  if (unsubscribeUrl) {
    mailOptions.headers = { "List-Unsubscribe": `<${unsubscribeUrl}>` };
  }

  await transport.sendMail(mailOptions);
}

export function interpolate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function isWithinSendWindow(
  startHour: number,
  endHour: number,
  sendDays: string
): boolean {
  const now = new Date();
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayName = dayNames[now.getDay()];
  const allowedDays = sendDays.split(",").map((d) => d.trim().toLowerCase());

  if (!allowedDays.includes(todayName)) return false;

  const hour = now.getHours();
  return hour >= startHour && hour < endHour;
}

export async function processCampaignSends() {
  const campaigns = db
    .query<
      {
        id: number;
        account_id: number;
        daily_limit: number;
        send_days: string;
        send_start_hour: number;
        send_end_hour: number;
      },
      []
    >(
      "SELECT id, account_id, daily_limit, send_days, send_start_hour, send_end_hour FROM campaigns WHERE status = 'active'"
    )
    .all();

  for (const campaign of campaigns) {
    if (
      !isWithinSendWindow(
        campaign.send_start_hour,
        campaign.send_end_hour,
        campaign.send_days
      )
    ) {
      continue;
    }

    const account = db
      .query<AccountRow, [number]>(
        "SELECT * FROM accounts WHERE id = ? AND status != 'paused'"
      )
      .get(campaign.account_id);

    if (!account) continue;
    if (account.emails_sent_today >= account.daily_limit) continue;

    const today = new Date().toISOString().split("T")[0];

    // Count emails sent today for this campaign
    const sentToday = (
      db
        .query<{ count: number }, [number, string]>(
          "SELECT COUNT(*) as count FROM sent_log WHERE campaign_id = ? AND DATE(sent_at) = ?"
        )
        .get(campaign.id, today) ?? { count: 0 }
    ).count;

    if (sentToday >= campaign.daily_limit) continue;

    const leads = db
      .query<
        {
          id: number;
          first_name: string;
          last_name: string;
          email: string;
          company: string;
          personalized_line: string;
          current_step: number;
        },
        [number, string]
      >(
        `SELECT id, first_name, last_name, email, company, personalized_line, current_step
         FROM leads
         WHERE campaign_id = ?
           AND status = 'active'
           AND (next_send_date IS NULL OR next_send_date <= ?)
         LIMIT ?`
      )
      .all(campaign.id, today, campaign.daily_limit - sentToday);

    for (const lead of leads) {
      if (account.emails_sent_today >= account.daily_limit) break;

      const step = db
        .query<{ subject: string; body: string; delay_days: number }, [number, number]>(
          "SELECT subject, body, delay_days FROM sequence_steps WHERE campaign_id = ? AND step_number = ?"
        )
        .get(campaign.id, lead.current_step);

      if (!step) {
        db.run("UPDATE leads SET status = 'finished' WHERE id = ?", [lead.id]);
        continue;
      }

      const vars = {
        first_name: lead.first_name ?? "",
        last_name: lead.last_name ?? "",
        company: lead.company ?? "",
        personalized_line: lead.personalized_line ?? "",
      };

      try {
        await sendEmail({
          from: account.email,
          to: lead.email,
          subject: interpolate(step.subject, vars),
          body: interpolate(step.body, vars),
          appPassword: account.app_password,
        });

        const nextStep = db
          .query<{ step_number: number }, [number, number]>(
            "SELECT step_number FROM sequence_steps WHERE campaign_id = ? AND step_number > ? ORDER BY step_number ASC LIMIT 1"
          )
          .get(campaign.id, lead.current_step);

        const nextSendDate = nextStep
          ? new Date(Date.now() + step.delay_days * 86400000)
              .toISOString()
              .split("T")[0]
          : null;

        db.run(
          "INSERT INTO sent_log (lead_id, campaign_id, step_number, subject) VALUES (?, ?, ?, ?)",
          [
            lead.id,
            campaign.id,
            lead.current_step,
            interpolate(step.subject, vars),
          ]
        );

        if (nextStep) {
          db.run(
            "UPDATE leads SET current_step = ?, next_send_date = ? WHERE id = ?",
            [nextStep.step_number, nextSendDate, lead.id]
          );
        } else {
          db.run(
            "UPDATE leads SET status = 'finished', next_send_date = NULL WHERE id = ?",
            [lead.id]
          );
        }

        db.run(
          "UPDATE accounts SET emails_sent_today = emails_sent_today + 1 WHERE id = ?",
          [account.id]
        );
        account.emails_sent_today++;

        // Human-like delay between sends: 60–180 seconds
        await randomDelay(60_000, 180_000);
      } catch (err) {
        console.error(`Failed to send to ${lead.email}:`, err);
        if ((err as Error).message?.includes("bounce")) {
          db.run("UPDATE leads SET status = 'bounced' WHERE id = ?", [lead.id]);
        }
      }
    }
  }
}
