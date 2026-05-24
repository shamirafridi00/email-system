import { db } from "../database";
import { sendEmail, interpolate, type AccountRow } from "./sender";
import { randomUUID } from "crypto";
import { calculateTimezoneAwareSendDate } from "./timezoneMapper";
import { isBlacklisted, autoBlacklistBounced } from "./blacklistChecker";
import { logWarning } from "./logger";

interface LeadRow {
  id: number;
  campaign_id: number;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  personalized_line: string;
  current_step: number;
  account_id: number;
  send_days: string;
  send_start_hour: number;
  send_end_hour: number;
  campaign_daily_limit: number;
  unsubscribe_token: string | null;
  timezone_offset: number | null;
  optimal_send_hour: number;
  timezone_aware: number;
}

interface StepRow {
  subject: string;
  body: string;
  delay_days: number;
}

interface RunResult {
  processed: number;
  sent: number;
  skipped: number;
  bounced: number;
  finished: number;
}

interface StatusCount {
  status: string;
  count: number;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function isWithinSendWindow(
  sendDays: string,
  startHour: number,
  endHour: number
): boolean {
  const now = new Date();
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayName = dayNames[now.getDay()];
  const allowed = sendDays.split(",").map((d) => d.trim().toLowerCase());
  if (!allowed.includes(todayName)) return false;
  const hour = now.getHours();
  return hour >= startHour && hour < endHour;
}

// Per-run account cache so we don't hit the DB on every lead
const accountCache = new Map<number, AccountRow>();

function getAccount(accountId: number): AccountRow | null {
  if (accountCache.has(accountId)) return accountCache.get(accountId)!;
  const row = db
    .query<AccountRow, [number]>(
      "SELECT id, email, app_password, daily_limit, emails_sent_today, status FROM accounts WHERE id = ? AND status != 'paused'"
    )
    .get(accountId);
  if (row) accountCache.set(accountId, row);
  return row ?? null;
}

export async function runSequences(): Promise<RunResult> {
  accountCache.clear();

  const today = new Date().toISOString().split("T")[0];
  const result: RunResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    bounced: 0,
    finished: 0,
  };

  const leads = db
    .query<LeadRow, [string]>(
      `SELECT
         l.id, l.campaign_id, l.first_name, l.last_name, l.email,
         l.company, l.personalized_line, l.current_step, l.unsubscribe_token,
         l.timezone_offset, COALESCE(l.optimal_send_hour, 9) AS optimal_send_hour,
         c.account_id, c.send_days, c.send_start_hour, c.send_end_hour,
         c.daily_limit AS campaign_daily_limit, COALESCE(c.timezone_aware, 0) AS timezone_aware
       FROM leads l
       JOIN campaigns c ON c.id = l.campaign_id
       WHERE l.status = 'active'
         AND c.status = 'active'
         AND (l.next_send_date IS NULL OR l.next_send_date <= ?)`
    )
    .all(today);

  for (const lead of leads) {
    result.processed++;

    // Timezone-aware time check: only send if we're within 2h of the lead's optimal local hour
    if (lead.timezone_aware && lead.timezone_offset !== null) {
      const nowUtc = new Date();
      const leadLocalHour = ((nowUtc.getUTCHours() + lead.timezone_offset) % 24 + 24) % 24;
      if (leadLocalHour < lead.optimal_send_hour || leadLocalHour >= lead.optimal_send_hour + 2) {
        result.skipped++;
        continue;
      }
    } else if (
      !isWithinSendWindow(lead.send_days, lead.send_start_hour, lead.send_end_hour)
    ) {
      result.skipped++;
      continue;
    }

    const account = getAccount(lead.account_id);
    if (!account) {
      result.skipped++;
      continue;
    }

    if (account.emails_sent_today >= account.daily_limit) {
      result.skipped++;
      continue;
    }

    const step = db
      .query<StepRow, [number, number]>(
        "SELECT subject, body, delay_days FROM sequence_steps WHERE campaign_id = ? AND step_number = ?"
      )
      .get(lead.campaign_id, lead.current_step);

    if (!step) {
      db.run("UPDATE leads SET status = 'finished' WHERE id = ?", [lead.id]);
      result.finished++;
      continue;
    }

    const blacklistCheck = isBlacklisted(lead.email);
    if (blacklistCheck.blacklisted) {
      db.run("UPDATE leads SET status = 'unsubscribed', validation_reason = ? WHERE id = ?", [
        `Blacklisted - ${blacklistCheck.reason}`,
        lead.id,
      ]);
      logWarning("campaign", `Skipped blacklisted email: ${lead.email} — ${blacklistCheck.reason}`, { lead_id: lead.id }).catch(() => {});
      result.skipped++;
      continue;
    }

    const vars: Record<string, string> = {
      first_name: lead.first_name ?? "",
      last_name: lead.last_name ?? "",
      company: lead.company ?? "",
      personalized_line: lead.personalized_line ?? "",
    };

    const subject = interpolate(step.subject, vars);
    const body = interpolate(step.body, vars);

    try {
      const tracking_token = randomUUID();

      await sendEmail({
        from: account.email,
        to: lead.email,
        subject,
        body,
        appPassword: account.app_password,
        unsubscribe_token: lead.unsubscribe_token ?? undefined,
        lead_email: lead.email,
        tracking_token,
      });

      db.run(
        "INSERT INTO sent_log (lead_id, campaign_id, step_number, subject, tracking_token) VALUES (?, ?, ?, ?, ?)",
        [lead.id, lead.campaign_id, lead.current_step, subject, tracking_token]
      );

      db.run(
        "UPDATE accounts SET emails_sent_today = emails_sent_today + 1 WHERE id = ?",
        [account.id]
      );
      account.emails_sent_today++;

      const nextStep = db
        .query<{ step_number: number; delay_days: number }, [number, number]>(
          `SELECT step_number, delay_days FROM sequence_steps
           WHERE campaign_id = ? AND step_number > ?
           ORDER BY step_number ASC LIMIT 1`
        )
        .get(lead.campaign_id, lead.current_step);

      if (nextStep) {
        let nextSendDate: string;
        if (lead.timezone_aware && lead.timezone_offset !== null) {
          const tzDate = calculateTimezoneAwareSendDate(
            nextStep.delay_days,
            lead.timezone_offset,
            lead.optimal_send_hour
          );
          nextSendDate = tzDate.toISOString().split("T")[0];
        } else {
          nextSendDate = addDays(today, nextStep.delay_days);
        }
        db.run(
          "UPDATE leads SET current_step = ?, next_send_date = ? WHERE id = ?",
          [nextStep.step_number, nextSendDate, lead.id]
        );
      } else {
        db.run(
          "UPDATE leads SET status = 'finished', next_send_date = NULL WHERE id = ?",
          [lead.id]
        );
        result.finished++;
      }

      result.sent++;
      console.log(
        `Sequence sent: ${account.email} → ${lead.email} | step ${lead.current_step} | ${subject}`
      );
    } catch (err) {
      const message = (err as Error).message ?? "";
      console.error(`Sequence send failed for lead ${lead.id}:`, err);

      if (
        message.includes("bounce") ||
        message.includes("550") ||
        message.includes("554")
      ) {
        db.run(
          "INSERT INTO sent_log (lead_id, campaign_id, step_number, subject, bounced, tracking_token) VALUES (?, ?, ?, ?, 1, ?)",
          [lead.id, lead.campaign_id, lead.current_step, subject, randomUUID()]
        );
        db.run("UPDATE leads SET status = 'bounced' WHERE id = ?", [lead.id]);
        autoBlacklistBounced(lead.email).catch(() => {});
        result.bounced++;
      } else {
        result.skipped++;
      }
    }
  }

  return result;
}

export async function getSequenceStats(): Promise<Record<string, number>> {
  const rows = db
    .query<StatusCount, []>(
      "SELECT status, COUNT(*) as count FROM leads GROUP BY status"
    )
    .all();

  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

// Resets all active leads in a campaign back to step 1 / today — testing only
export async function rescheduleLeads(campaignId: number): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  db.run(
    "UPDATE leads SET current_step = 1, next_send_date = ? WHERE campaign_id = ? AND status = 'active'",
    [today, campaignId]
  );
  console.log(
    `Rescheduled active leads in campaign ${campaignId} to step 1 / ${today}`
  );
}
