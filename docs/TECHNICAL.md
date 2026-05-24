# Technical Documentation

## Architecture Overview

The GTM Email System is a monolithic server-side application built on Bun with a single-page frontend. There is no build step — TypeScript is executed directly by Bun, and the frontend uses vanilla JS loaded via `<script>` tags.

### Request Flow

```
Browser
  │
  ├── GET / → serves public/index.html (authenticated)
  ├── GET /public/* → serves static assets (unauthenticated)
  ├── GET /login → serves login.html (unauthenticated)
  ├── GET /track/open/:token → pixel tracking (unauthenticated)
  └── GET /leads/unsubscribe → unsubscribe page (unauthenticated)
       │
       ▼
  src/index.ts (Hono app)
       │
  ├── middleware/auth.ts → validates session cookie
       │
  ├── routes/campaigns.ts
  ├── routes/leads.ts
  ├── routes/accounts.ts
  ├── routes/warmup.ts
  ├── routes/dashboard.ts
  ├── routes/clients.ts
  ├── routes/templates.ts
  └── routes/abtests.ts
       │
       ▼
  modules/ (business logic)
       │
       ▼
  database.ts → bun:sqlite → data/system.db
```

### Scheduler Architecture

```
src/index.ts
  └── startScheduler()
        │
        ├── Bun.cron("0 0 * * *")          → resetDailyCounts()
        ├── Bun.cron("0 9-17 * * 1-5")     → runSequences() + checkBounceRates()
        ├── Bun.cron("0 */2 * * *")         → checkAllAccounts() + pushToHubspot()
        ├── Bun.cron("*/30 * * * 1-5")      → isUSBusinessHours() → runWarmupAll()
        ├── Bun.cron("*/5 * * * *")         → scanConversations()
        ├── Bun.cron("0 6 * * 1-5")         → generateDailyConversations()
        ├── Bun.cron("0 2 * * *")           → sendWarmupSummaryEmail()
        ├── Bun.cron("*/15 * * * *")        → processReplyQueue()
        ├── Bun.cron("0 1 * * *")           → createBackup()
        ├── Bun.cron("0 3 * * *")           → checkBounceRates()
        └── Bun.cron("0 3 * * *")           → sendClientProgressReport()
```

All cron errors are caught and logged to the `system_errors` table. A job failure never crashes the server.

---

## Module Documentation

### `src/modules/sender.ts`

**Purpose:** Core email sending engine. Builds HTML emails with tracking pixels, unsubscribe links, and sends via Gmail SMTP using nodemailer.

**Exports:**
- `sendEmail(opts: SendOptions): Promise<void>` — Sends a single email. Checks blacklist first. Builds HTML from plain text body. Embeds tracking pixel and unsubscribe link if tokens provided. Uses Gmail SMTP with app password.
- `interpolate(template: string, vars: Record<string, string>): string` — Replaces `{{variable}}` placeholders in subject/body with lead field values.
- `type AccountRow` — Type definition for account database rows.

**Dependencies:** nodemailer, blacklistChecker, database

**Key behavior:**
- Converts plain text body to HTML by wrapping paragraphs in `<p>` tags
- Embeds a 1×1 transparent GIF at `/track/open/:token`
- Adds unsubscribe footer linking to `/leads/unsubscribe?token=:token`
- Adds random jitter delay (100–500ms) before sending for human-like patterns

---

### `src/modules/sequences.ts`

**Purpose:** Sequence runner — the core campaign engine. For each active lead due for a send, checks scheduling windows, assigns A/B test variants, sends the email, logs to sent_log, and advances the lead to the next step.

**Exports:**
- `runSequences(): Promise<RunResult>` — Main entry point. Processes all active leads.
- `getSequenceStats(campaignId: number)` — Returns sent/open/reply counts for a campaign.
- `rescheduleLeads(campaignId: number, delayDays: number)` — Bulk reschedule leads.

**Key logic:**
1. Query all active leads in active campaigns where `next_send_date <= today`
2. For timezone-aware campaigns, check if lead's local hour is within 2h of `optimal_send_hour`
3. For standard campaigns, check if current UTC time is within `send_days`/`send_start_hour`/`send_end_hour`
4. Check account daily limit — skip if exceeded
5. Look up the current sequence step for this lead
6. Check `getActiveTest()` — if A/B test exists, call `assignVariant()`, override subject
7. Send via `sendEmail()`, log to `sent_log` with `ab_test_id` and `ab_variant`
8. Advance lead to next step or mark `finished`

---

### `src/modules/warmup.ts`

**Purpose:** Warmup engine. Manages natural-looking email conversations between warmup accounts, generates daily conversations from the library, processes the reply queue, and handles conversation JSON file uploads.

**Exports:**
- `runWarmupAll(accounts?: WarmupAccount[]): Promise<void>` — Run one warmup cycle across provided accounts (or all active accounts).
- `processConversationFile(filePath: string): void` — Parse a conversation JSON file and queue all emails via the reply queue.
- `generateDailyConversations(): Promise<{ generated: number, skipped?: string }>` — Generate fresh conversation pairs from the library if auto-generate is enabled.
- `processReplyQueue(): Promise<number>` — Send all queued reply emails that are due. Returns count sent.

**Reply queue flow:**
1. `warmup_reply_queue` table holds scheduled replies with `scheduled_at` timestamp
2. `processReplyQueue()` selects rows where `scheduled_at <= now` and `status = 'pending'`
3. Sends via Gmail SMTP using the `from_email` account's credentials
4. Marks row `status = 'sent'`

---

### `src/modules/imap.ts`

**Purpose:** IMAP reply detection. Connects to each active sending account's Gmail inbox, finds unread messages from known leads, marks them as replied, and records A/B reply metrics.

**Exports:**
- `checkReplies(account: ImapAccount): Promise<void>` — Check one account for new replies.
- `checkAllAccounts(): Promise<void>` — Run checkReplies for every active account.

**Key behavior:**
- Uses imapflow to fetch unseen messages from INBOX
- Looks up sender address in `leads` table (case-insensitive)
- If lead found and not already replied: updates status, inserts to `replies`, sends reply notification
- Checks `sent_log` for `ab_test_id` on the lead's most recent send → calls `recordReply()`
- Marks message as `\Seen` regardless of lead match to prevent re-processing

---

### `src/modules/abTesting.ts`

**Purpose:** A/B test variant assignment, open/reply recording, winner detection, and winner application.

**Exports:**
- `getActiveTest(campaign_id, step_number): ABTestRow | null` — Find running test for campaign+step.
- `assignVariant(ab_test_id): "a" | "b"` — Return variant with fewer sends (maintains 50/50 split).
- `recordOpen(ab_test_id, variant): void` — Increment opened count for variant.
- `recordReply(ab_test_id, variant): void` — Increment replied count for variant.
- `checkForWinner(ab_test_id): string | null` — If both variants have ≥ `min_sample_size` sends and open rate difference ≥ `confidence_threshold`, declare winner and update status.
- `applyWinner(ab_test_id): string | null` — Update `sequence_steps.subject` to winning variant's subject.
- `getTestStats(ab_test_id): Promise<Record<string, unknown>>` — Full stats object with rates, leader, recommendation string.

---

### `src/modules/blacklistChecker.ts`

**Purpose:** Prevent sends to blocked emails or domains. Checked before every email send.

**Exports:**
- `isBlacklisted(email: string): BlacklistResult` — Check email against blacklist table. Checks exact email match first, then domain match.
- `checkBatchBlacklist(emails: string[]): Promise<Array<{ email, result }>>` — Batch check for CSV validation.
- `autoBlacklistBounced(email: string): Promise<void>` — Automatically add a bounced email to the blacklist.

---

### `src/modules/bounceMonitor.ts`

**Purpose:** Track bounce rates per account and auto-pause accounts with unacceptable rates.

**Exports:**
- `checkBounceRates(): Promise<BounceCheckResult[]>` — Check all active accounts. Returns result per account with action taken.

**Thresholds:**
- Minimum sends before checking: 10
- Warning threshold: 5% bounce rate (7-day window)
- Auto-pause threshold: 10% bounce rate (7-day window)

---

### `src/modules/emailValidator.ts`

**Purpose:** Validate email addresses before importing leads.

**Exports:**
- `validateEmailBatch(emails: string[]): Promise<ValidationResult[]>` — MX record lookup + format check per email.
- `isValidFormat(email: string): boolean` — Regex format check only.

---

### `src/modules/hubspot.ts`

**Purpose:** Push reply notifications to HubSpot CRM contact timeline.

**Exports:**
- `pushToHubspot(reply, hubspotToken): Promise<void>` — Create engagement on HubSpot contact.
- `getUnpushedReplies(): ReplyRow[]` — Fetch replies not yet pushed.
- `testHubspotConnection(token?: string): Promise<boolean>` — Verify token validity.

---

### `src/modules/healthCheck.ts`

**Purpose:** System health monitoring across all components.

**Exports:**
- `runHealthCheck(): Promise<HealthResult>` — Run all checks, return overall status.

**Checks performed:**
- `database` — query `system_settings` table
- `hubspot` — API call to HubSpot contacts endpoint
- `smtp` — verify nodemailer can create transport (no actual send)
- `scheduler` — compare registered jobs against expected 11-job list
- `disk` — check backup directory is writable

---

### `src/modules/dnsChecker.ts`

**Purpose:** DNS record verification for email deliverability.

**Exports:**
- `checkDomain(domain: string): Promise<DNSCheckResult>` — Check SPF, DKIM, DMARC, MX for domain.

**DKIM selectors tried:** `google`, `default`, `mail`, `smtp`, `email`, `dkim`, `k1`

---

### `src/modules/backup.ts`

**Purpose:** SQLite database backup with automatic retention.

**Exports:**
- `createBackup(note?: string): Promise<BackupResult>` — Copy `data/system.db` to `backups/` with timestamp. Trims to 7 most recent.
- `listBackups(): BackupEntry[]` — List all backup records.
- `restoreBackup(filename: string): Promise<void>` — Copy backup file back to `data/system.db`.

---

### `src/modules/logger.ts`

**Purpose:** Structured logging to `system_errors` table.

**Exports:**
- `logInfo(type, message, context?): Promise<void>`
- `logWarning(type, message, context?): Promise<void>`
- `logError(opts: { error_type, severity, message, stack_trace?, context? }): Promise<void>`

---

### `src/modules/timezoneMapper.ts`

**Purpose:** Detect lead timezone from state/country fields in CSV import.

**Exports:**
- `detectLeadTimezone(opts: { state, country }): { timezone_offset, timezone_label, optimal_send_hour, timezone_detected }`
- `calculateTimezoneAwareSendDate(delayDays, tzOffset, optimalHour): Date`

---

### `src/utils/timezone.ts`

**Purpose:** US Eastern business hours check used by the warmup scheduler.

**Exports:**
- `isUSBusinessHours(): boolean` — Returns true if current UTC time falls within 9am–5pm US Eastern (accounting for EST/EDT).

---

## Database Schema Details

### `accounts`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `email` | TEXT UNIQUE | Gmail address used for SMTP |
| `app_password` | TEXT | Gmail app password (not account password) |
| `domain` | TEXT | Sending domain for tracking |
| `daily_limit` | INTEGER | Max emails per day (default 20) |
| `emails_sent_today` | INTEGER | Running count, reset at midnight |
| `status` | TEXT | `warming`, `active`, `paused`, `flagged` |
| `client_id` | INTEGER | FK to clients (multi-tenant) |
| `created_at` | DATETIME | Creation timestamp |

### `warmup_accounts`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `email` | TEXT UNIQUE | Gmail address |
| `app_password` | TEXT | Gmail app password |
| `daily_volume` | INTEGER | Target warmup emails per day |
| `active` | INTEGER | 1=active, 0=inactive |
| `warmup_started_at` | DATETIME | When warmup began |
| `warmup_target_days` | INTEGER | Target warmup duration |
| `health_score` | INTEGER | 0–100 score updated per cycle |
| `last_verified_at` | DATETIME | Last successful IMAP verification |
| `status` | TEXT | `warming`, `ready`, `paused` |
| `daily_target` | INTEGER | Current day's target |
| `group_name` | TEXT | Group label for batch operations |
| `client_id` | INTEGER | FK to clients |

### `sent_log`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `lead_id` | INTEGER FK | Lead this email was sent to |
| `campaign_id` | INTEGER FK | Campaign |
| `step_number` | INTEGER | Which step in the sequence |
| `subject` | TEXT | Actual subject line used |
| `sent_at` | DATETIME | Send timestamp |
| `bounced` | INTEGER | 1 if bounced |
| `tracking_token` | TEXT | UUID for open tracking pixel |
| `opened` | INTEGER | 1 if first open recorded |
| `opened_at` | DATETIME | First open timestamp |
| `ab_test_id` | INTEGER | FK to ab_tests if A/B test active |
| `ab_variant` | TEXT | `a` or `b` |

### `ab_tests`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `campaign_id` | INTEGER | Campaign being tested |
| `step_number` | INTEGER | Which sequence step |
| `name` | TEXT | Human-readable test name |
| `status` | TEXT | `running`, `winner_declared`, `stopped` |
| `variant_a_subject` | TEXT | Subject line for variant A |
| `variant_b_subject` | TEXT | Subject line for variant B |
| `variant_a_sent` | INTEGER | Emails sent with variant A |
| `variant_b_sent` | INTEGER | Emails sent with variant B |
| `variant_a_opened` | INTEGER | Opens for variant A |
| `variant_b_opened` | INTEGER | Opens for variant B |
| `variant_a_replied` | INTEGER | Replies for variant A |
| `variant_b_replied` | INTEGER | Replies for variant B |
| `winner` | TEXT | `a`, `b`, or NULL |
| `winner_declared_at` | DATETIME | When winner was declared |
| `min_sample_size` | INTEGER | Min sends per variant before declaring (default 50) |
| `confidence_threshold` | REAL | Min open rate difference required (default 0.1 = 10%) |
| `auto_declare` | INTEGER | 1=auto-declare when threshold met |
| `created_at` | DATETIME | Creation timestamp |

### `system_settings`
| Key | Description |
|---|---|
| `current_client_id` | ID of the active client for UI context |
| `admin_username` | Login username |
| `admin_password_hash` | Bcrypt hash of admin password |
| `notification_email` | Email address for system notifications |
| `system_name` | Brand name shown in emails and UI |
| `hubspot_token` | Global HubSpot API token |
| `send_warmup_summary` | `1` = send daily warmup summary emails |
| `auto_backup_enabled` | `1` = run daily automated backups |
| `dashboard_url` | Public URL used in unsubscribe/tracking links |
| `auto_generate_conversations` | `1` = auto-generate daily warmup conversations |

---

## Authentication System

Sessions are stored in the `sessions` table with a random UUID token and expiry timestamp.

**Login flow:**
1. `POST /auth/login` with `{ username, password }`
2. Validates against `admin_username` and `admin_password_hash` in `system_settings`
3. Generates UUID token, inserts into `sessions` with expiry `now + 7 days`
4. Returns `Set-Cookie: session=<token>; HttpOnly; Path=/`

**Request auth flow:**
1. `middleware/auth.ts` reads `Cookie: session=<token>`
2. Queries `sessions` where `token = ? AND expires_at > now`
3. If not found → 401 JSON response
4. If found → continues to route handler

**Logout:** Deletes the session row from the database.

---

## Email Sending Pipeline

```
Lead imported to campaign
        │
        ▼
Scheduler fires runSequences() (Mon–Fri, 9am–5pm UTC)
        │
        ▼
Query active leads where next_send_date <= today
        │
        ▼
For each lead:
  1. Timezone check — is it within 2h of lead's optimal_send_hour?
  2. Send window check — is today/time within campaign's send_days/hours?
  3. Account daily limit check — has account hit its daily cap?
  4. Look up sequence step for current_step number
  5. Blacklist check via isBlacklisted(lead.email)
  6. A/B test check — getActiveTest(campaign_id, step_number)
     └── if test found: assignVariant() → override subject
  7. Interpolate {{variables}} in subject and body
  8. sendEmail() via Gmail SMTP
     ├── Embeds tracking pixel: /track/open/:tracking_token
     └── Embeds unsubscribe link: /leads/unsubscribe?token=:unsubscribe_token
  9. INSERT into sent_log (with ab_test_id, ab_variant)
  10. UPDATE accounts.emails_sent_today + 1
  11. Advance lead: UPDATE leads SET current_step = next_step, next_send_date = today + delay_days
      └── If no next step: SET status = 'finished'
        │
        ▼
Open tracked: GET /track/open/:token
  → UPDATE sent_log SET opened=1, opened_at
  → UPDATE leads SET opened=1, open_count+1
  → INSERT into email_opens
  → If ab_test_id: recordOpen() → checkForWinner()
        │
        ▼
Reply detected: checkReplies() every 2 hours
  → UPDATE leads SET status='replied'
  → INSERT into replies
  → If ab_test_id: recordReply()
  → pushToHubspot() if token configured
```

---

## Warmup System Architecture

**Warmup cycle (every 30 min, Mon–Fri):**
1. `isUSBusinessHours()` check — skip if outside 9am–5pm ET
2. 40% random skip for natural irregularity
3. Random jitter: 0–15 minute delay before starting
4. Pick random subset of 2–4 active warmup accounts
5. `runWarmupAll(subset)` — each account sends to 1–2 other accounts
6. Messages drawn from predefined templates or conversation library
7. Replies scheduled in `warmup_reply_queue` with realistic delays (30–120 min)

**Reply queue processor (every 15 min):**
1. Query `warmup_reply_queue` where `scheduled_at <= now AND status = 'pending'`
2. Send each reply via `from_email`'s SMTP credentials
3. Mark as `sent`

**Auto conversation generator (6am UTC, Mon–Fri):**
1. Checks `auto_generate_conversations` setting
2. Pulls random topic pairs from `warmup_conversations_library`
3. Selects 2 random active warmup accounts as sender/receiver
4. Writes conversation JSON to `conversations/` directory
5. Conversation scanner picks it up within 5 minutes

---

## Multi-Client System

Each data record (campaigns, accounts, warmup_accounts) has a `client_id` FK column. The active client is stored in `system_settings.current_client_id`.

**Client switch flow:**
1. `POST /clients/:id/switch` updates `system_settings.current_client_id`
2. Frontend calls `window.location.reload()` — full page reload reinitializes all state
3. All subsequent API calls filter by the new `current_client_id`

**HubSpot per-client:**
- Each client row has its own `hubspot_token` and `hubspot_portal_id`
- When pushing replies, the system reads the lead's campaign → campaign's client → client's HubSpot token

**Force delete flow:**
1. Find Default Client ID
2. `UPDATE campaigns SET client_id = defaultId WHERE client_id = deletedId`
3. Same for accounts, warmup_accounts
4. `DELETE FROM clients WHERE id = deletedId`
5. If deleted client was active, switch to Default Client

---

## A/B Testing Logic

**Variant assignment (50/50 split):**
```
assignVariant(ab_test_id):
  SELECT variant_a_sent, variant_b_sent FROM ab_tests WHERE id = ?
  if variant_b_sent < variant_a_sent → return "b"
  else → return "a"
```

This ensures strict 50/50 by always sending to the side with fewer total sends.

**Winner detection:**
```
checkForWinner(ab_test_id):
  if auto_declare = 0 → return null
  if variant_a_sent < min_sample_size OR variant_b_sent < min_sample_size → return null
  rate_a = variant_a_opened / variant_a_sent
  rate_b = variant_b_opened / variant_b_sent
  diff = |rate_a - rate_b|
  if diff < confidence_threshold → return null
  winner = rate_a >= rate_b ? "a" : "b"
  UPDATE ab_tests SET winner, status='winner_declared', winner_declared_at
  return winner
```

**Winner application:**
```
applyWinner(ab_test_id):
  winning_subject = winner == "b" ? variant_b_subject : variant_a_subject
  UPDATE sequence_steps SET subject = winning_subject
    WHERE campaign_id = test.campaign_id AND step_number = test.step_number
```

---

## Error Handling

**Structured logging:**
All significant events are logged to `system_errors` with:
- `error_type`: module name (`scheduler`, `imap`, `sender`, `system`)
- `severity`: `info`, `warning`, `error`, `critical`
- `message`: human-readable description
- `stack_trace`: full stack for exceptions
- `context`: JSON blob with relevant IDs/data

**Scheduler error containment:**
Every cron job body is wrapped in `try/catch`. Errors are logged but never rethrown. A single failing job never terminates the process.

**IMAP error containment:**
`checkReplies()` catches all errors per account. One bad account never blocks checking the others. Socket errors after logout are handled via `client.on('error')`.

**Open tracking:**
The entire pixel handler is wrapped in try/catch. Tracking errors never affect the 1×1 GIF response.

---

## Adding New Features

### 1. Add database table

In `src/database.ts`, inside `initDatabase()`:

```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS my_feature (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
// For new columns on existing tables, use migrations:
try { db.exec("ALTER TABLE existing_table ADD COLUMN new_col TEXT DEFAULT NULL"); } catch {}
```

### 2. Create route file

```typescript
// src/routes/myfeature.ts
import { Hono } from "hono";
import { db } from "../database";

const app = new Hono();

app.get("/", (c) => {
  const rows = db.query("SELECT * FROM my_feature").all();
  return c.json(rows);
});

export default app;
```

### 3. Register route in index.ts

```typescript
import myfeatureRoutes from "./routes/myfeature";
// ...
app.route("/myfeature", myfeatureRoutes);
```

### 4. Add HTML section to index.html

```html
<div id="section-myfeature" class="section">
  <div class="section-header">
    <div class="section-title">My Feature</div>
  </div>
  <div id="myfeature-content">
    <div class="loading"><span class="spinner"></span></div>
  </div>
</div>
```

### 5. Add sidebar nav link

```html
<a data-section="myfeature">
  <i data-lucide="icon-name" style="width:15px;height:15px"></i> My Feature
</a>
```

### 6. Create frontend JS file

```javascript
// public/js/myfeature.js
var myfeatureState = { items: [] };

async function loadMyFeature() {
  var items = await api('/myfeature');
  myfeatureState.items = items;
  renderMyFeature();
}

function renderMyFeature() {
  var el = document.getElementById('myfeature-content');
  el.innerHTML = myfeatureState.items.map(function(item) {
    return '<div>' + escHtml(item.name) + '</div>';
  }).join('');
}
```

### 7. Register in navigation.js

```javascript
'myfeature': loadMyFeature,
```

### 8. Add script tag to index.html

```html
<script src="/public/js/myfeature.js"></script>
```
