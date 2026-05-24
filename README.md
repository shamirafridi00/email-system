# GTM Email System

A self-hosted GTM (Go-To-Market) email automation platform for cold outreach and inbox warmup. Run your entire email acquisition pipeline — warmup, campaign sequencing, lead management, A/B testing, and client reporting — from a single server you control.

---

## Project Overview

This system replaces SaaS tools like Instantly, Lemlist, and Mailshake with a fully self-hosted stack. All data stays on your server. No per-seat pricing. No sending limits imposed by a third party.

**Key capabilities:**
- Warm up Gmail accounts with AI-generated conversation threads before sending campaigns
- Run multi-step cold email sequences with automatic follow-ups
- Track opens (pixel tracking), replies (IMAP), and bounces in real time
- Import leads from Apollo or any CSV source with email validation
- A/B test subject lines and auto-declare winners based on open rates
- Manage multiple clients, each with isolated campaigns and HubSpot connections
- Generate automated daily and weekly progress reports for clients
- Check DNS health (SPF, DKIM, DMARC) for sending domains
- Monitor bounce rates and auto-pause accounts that exceed thresholds

---

## Tech Stack

| Technology | Role | Why |
|---|---|---|
| **Bun** | Runtime & cron scheduler | Faster than Node, built-in SQLite bindings, native cron support |
| **Hono** | HTTP framework | Lightweight, typed, runs natively on Bun |
| **SQLite (bun:sqlite)** | Database | Zero-dependency, file-based, sufficient for single-server workloads |
| **Nodemailer** | SMTP email sending | Battle-tested Gmail SMTP with app password support |
| **imapflow** | IMAP reply checking | Modern IMAP client with async iterator support |
| **Chart.js** | Frontend charts | Minimal dependency, renders in-browser without a build step |
| **Lucide** | SVG icon library | Consistent, lightweight, tree-shakeable icon set |

---

## Features Overview

### Warmup System
- Natural warmup email sending between Gmail accounts
- AI-generated multi-turn conversation threads
- Topics Library — curated conversation pairs for web design / agency industry
- Conversation file upload and auto-processing via JSON
- Reply queue processor — schedules thread replies with realistic delays
- US Eastern Business Hours scheduling — warmup only fires during 9am–5pm ET
- Probabilistic send scheduling — 60% chance per 30-min tick for human-like patterns
- Account groups — run warmup for a subset of accounts simultaneously
- Warmup schedule planner — weekly ramp-up targets (week 1: 5/day → week 4: 20/day)
- Readiness check — 6-factor go/no-go signal before launching campaigns
- Health score tracking per account
- Account history log with status change timeline
- Warmup analytics dashboard with 7-day charts
- Warmup calendar — visual daily volume view
- Inbox placement test — send to seed addresses and report inbox vs spam
- Daily warmup summary email (7am PKT) with per-account breakdown
- Duplicate conversation detection with similarity scoring
- Bulk account import via CSV

### Campaign System
- Multi-step email sequences with configurable delay between steps
- Timezone-aware sending — emails arrive at lead's local business hours
- Open tracking via 1×1 pixel with unique token per email
- Reply detection via IMAP scan every 2 hours
- Bounce detection and auto-pause of high-bounce accounts
- HubSpot CRM integration — push replies to contact timeline
- Lead import via CSV with email validation (MX check + format check)
- Apollo CSV format support with automatic field mapping
- Blacklist management — block emails and domains from all sends
- Unsubscribe links in every email with branded landing page
- A/B testing — split leads 50/50 across two subject lines, auto-declare winner
- Campaign templates — save and reuse campaign configurations
- Campaign analytics — open rate, reply rate, bounce rate per campaign
- Multi-client support — separate data per client with one-click switching
- Client progress reports — automated daily and weekly email summaries
- Export data to CSV for leads, sent log, open log
- DNS checker — verify SPF, DKIM, DMARC, MX records for sending domains
- Health check dashboard — real-time status of all system components
- Error log with severity levels and resolution tracking
- Automated daily database backups with 7-backup retention
- Getting Started checklist — tracks setup completion

---

## Quick Start

1. **Install Bun**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd email-sender
   ```

3. **Install dependencies**
   ```bash
   bun install
   ```

4. **Run the server**
   ```bash
   bun run src/index.ts
   ```

5. **Open the app**
   Navigate to [http://localhost:3000](http://localhost:3000)

6. **Log in with default credentials**
   - Username: `admin`
   - Password: `admin123`

7. **Change your credentials immediately**
   Go to Settings → change both username and password before adding any email accounts.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ADMIN_USERNAME` | Login username | `admin` (stored in DB after first run) |
| `ADMIN_PASSWORD` | Login password | `admin123` (stored in DB after first run) |
| `PORT` | HTTP server port | `3000` |
| `HUBSPOT_TOKEN` | Global HubSpot API token (overridden per-client) | none |
| `NODE_ENV` | Runtime environment | `development` |

> **Note:** Most configuration is stored in the database via the Settings page rather than environment variables. This includes notification email, system name, HubSpot credentials, and scheduler feature flags.

---

## Project Structure

```
email-sender/
├── src/
│   ├── index.ts                  # App entry, routes, open tracking, unsubscribe
│   ├── database.ts               # DB init, schema migrations, seed data
│   ├── scheduler.ts              # 11 cron jobs orchestration
│   ├── middleware/
│   │   └── auth.ts               # Session token middleware
│   ├── routes/
│   │   ├── auth.ts               # Login/logout endpoints
│   │   ├── accounts.ts           # Sending account CRUD
│   │   ├── campaigns.ts          # Campaign + sequence step CRUD
│   │   ├── leads.ts              # Lead import, validation, management
│   │   ├── warmup.ts             # Warmup account and conversation management
│   │   ├── dashboard.ts          # Aggregated stats endpoints
│   │   ├── clients.ts            # Multi-client management
│   │   ├── templates.ts          # Campaign template CRUD
│   │   └── abtests.ts            # A/B test management
│   ├── modules/
│   │   ├── sender.ts             # Gmail SMTP sending, HTML builder, tracking
│   │   ├── sequences.ts          # Sequence runner, per-lead step logic
│   │   ├── imap.ts               # IMAP reply detection
│   │   ├── warmup.ts             # Warmup engine, reply queue, conversation gen
│   │   ├── hubspot.ts            # HubSpot CRM push integration
│   │   ├── emailReports.ts       # Client reports, warmup summaries
│   │   ├── abTesting.ts          # A/B variant assignment and winner logic
│   │   ├── blacklistChecker.ts   # Email/domain blacklist enforcement
│   │   ├── bounceMonitor.ts      # Bounce rate tracking, account auto-pause
│   │   ├── emailValidator.ts     # MX record + format email validation
│   │   ├── dnsChecker.ts         # SPF/DKIM/DMARC/MX DNS verification
│   │   ├── healthCheck.ts        # System health monitoring
│   │   ├── backup.ts             # DB backup and restore
│   │   ├── logger.ts             # Structured error/info/warning logging
│   │   └── timezoneMapper.ts     # Lead timezone detection and mapping
│   └── utils/
│       └── timezone.ts           # US Eastern business hours utility
├── public/
│   ├── index.html                # Single-page app shell
│   ├── login.html                # Login page
│   ├── css/style.css             # Design system CSS
│   └── js/
│       ├── api.js                # Authenticated fetch wrapper, toast
│       ├── dashboard.js          # Campaign dashboard
│       ├── warmup.js             # Warmup UI
│       ├── campaigns.js          # Campaign management UI
│       ├── leads.js              # Lead management UI
│       ├── accounts.js           # Sending accounts UI
│       ├── settings.js           # Settings UI
│       ├── analytics.js          # Analytics charts
│       ├── templates.js          # Campaign templates UI
│       ├── abtests.js            # A/B testing UI
│       ├── clients.js            # Multi-client switcher UI
│       ├── navigation.js         # Section routing and boot logic
│       └── gettingStarted.js     # Getting Started checklist
├── data/system.db                # SQLite database (auto-created)
├── conversations/                # Conversation JSON files to process
│   └── processed/                # Processed conversation files
├── backups/                      # Automated database backups
└── docs/                         # Technical and user documentation
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `accounts` | Sending Gmail accounts with SMTP credentials and daily limits |
| `warmup_accounts` | Gmail accounts used for warmup (separate from campaign senders) |
| `warmup_log` | Log of every warmup email sent with conversation context |
| `campaigns` | Campaign definitions with schedule, account, and client link |
| `sequence_steps` | Email steps belonging to a campaign (subject, body, delay) |
| `leads` | Prospects imported to campaigns with status tracking |
| `sent_log` | Record of every email sent with tracking token and A/B variant |
| `replies` | Detected replies from IMAP scan |
| `email_opens` | Open events captured by tracking pixel |
| `unsubscribe_log` | Unsubscribe events with IP and user agent |
| `clients` | Client accounts with HubSpot credentials and display color |
| `system_settings` | Key-value store for app configuration |
| `sessions` | Active login sessions with expiry |
| `blacklist` | Blocked emails and domains |
| `campaign_templates` | Reusable campaign configurations |
| `template_steps` | Steps belonging to a campaign template |
| `ab_tests` | A/B test definitions with variant subjects and stats |
| `warmup_schedule` | Daily warmup target schedule per account |
| `warmup_schedule_plans` | Weekly ramp-up plan per warmup account |
| `warmup_conversations_library` | Curated topic/subject/body pairs for auto-generation |
| `warmup_pairs` | Tracks which accounts have been paired to avoid repetition |
| `warmup_reply_queue` | Scheduled reply messages for conversation threads |
| `account_status_history` | Status change audit log per account |
| `inbox_placement_tests` | Records of inbox placement test sends and results |
| `placement_test_accounts` | Seed email accounts for inbox placement testing |
| `client_report_config` | Per-campaign client email report configuration |
| `dns_check_log` | Historical DNS check results per domain |
| `system_errors` | Structured error log with severity and resolution tracking |
| `backup_log` | Record of database backups with file size |
| `conversation_files` | Metadata for uploaded conversation JSON files |

---

## API Routes Reference

### Auth
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/auth/login` | Authenticate and receive session cookie | No |
| POST | `/auth/logout` | Invalidate session | Yes |

### Dashboard
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/dashboard/stats` | Campaign and warmup aggregate stats | Yes |
| GET | `/dashboard/warmup` | Warmup-specific dashboard data | Yes |
| POST | `/dashboard/run-now` | Manually trigger all scheduler jobs | Yes |

### Campaigns
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/campaigns` | List campaigns for current client | Yes |
| POST | `/campaigns` | Create campaign | Yes |
| PUT | `/campaigns/:id` | Update campaign | Yes |
| DELETE | `/campaigns/:id` | Delete campaign | Yes |
| GET | `/campaigns/:id/steps` | Get sequence steps | Yes |
| POST | `/campaigns/:id/steps` | Add sequence step | Yes |
| PUT | `/campaigns/:id/steps/:stepId` | Update step | Yes |
| DELETE | `/campaigns/:id/steps/:stepId` | Delete step | Yes |
| GET | `/campaigns/:id/stats` | Open/reply/bounce stats | Yes |

### Leads
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/leads` | List leads with optional campaign filter | Yes |
| POST | `/leads/import` | Import validated leads from CSV | Yes |
| POST | `/leads/validate-csv` | Validate CSV before import | Yes |
| PUT | `/leads/:id` | Update lead status or data | Yes |
| DELETE | `/leads/:id` | Delete lead | Yes |
| GET | `/leads/unsubscribe` | Unsubscribe landing page | No |

### Accounts
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/accounts` | List sending accounts | Yes |
| POST | `/accounts` | Add account | Yes |
| PUT | `/accounts/:id` | Update account | Yes |
| DELETE | `/accounts/:id` | Delete account | Yes |

### Warmup
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/warmup/accounts` | List warmup accounts | Yes |
| POST | `/warmup/accounts` | Add warmup account | Yes |
| PUT | `/warmup/accounts/:id` | Update warmup account | Yes |
| DELETE | `/warmup/accounts/:id` | Delete warmup account | Yes |
| GET | `/warmup/accounts/progress` | Health scores and daily progress | Yes |
| GET | `/warmup/accounts/groups` | Account groups | Yes |
| POST | `/warmup/accounts/groups/run` | Run warmup for a group | Yes |
| GET | `/warmup/accounts/readiness-all` | Readiness check for all accounts | Yes |
| GET | `/warmup/schedule` | Schedule planner data | Yes |
| POST | `/warmup/conversations/upload` | Upload conversation JSON | Yes |
| POST | `/warmup/conversations/generate` | Generate conversations now | Yes |
| GET | `/warmup/log` | Warmup email log | Yes |

### Templates
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/templates` | List templates | Yes |
| GET | `/templates/:id` | Get template with steps | Yes |
| POST | `/templates` | Create template | Yes |
| PUT | `/templates/:id` | Update template | Yes |
| DELETE | `/templates/:id` | Delete template (non-system only) | Yes |
| POST | `/templates/:id/use` | Create campaign from template | Yes |
| POST | `/templates/save-from-campaign` | Save campaign as template | Yes |

### A/B Tests
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/abtests` | List tests with optional filters | Yes |
| GET | `/abtests/:id` | Get test with full stats | Yes |
| POST | `/abtests` | Create test | Yes |
| PUT | `/abtests/:id` | Update test settings | Yes |
| POST | `/abtests/:id/declare-winner` | Manually declare winner | Yes |
| POST | `/abtests/:id/stop` | Stop test | Yes |
| POST | `/abtests/:id/check-winner` | Trigger winner check | Yes |
| DELETE | `/abtests/:id` | Delete stopped test | Yes |

### Clients
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/clients` | List all clients | Yes |
| GET | `/clients/current` | Get active client | Yes |
| POST | `/clients` | Create client | Yes |
| PUT | `/clients/:id` | Update client | Yes |
| DELETE | `/clients/:id` | Delete and reassign data to Default Client | Yes |
| POST | `/clients/:id/switch` | Switch active client | Yes |

### Tracking (Public — No Auth)
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/track/open/:token` | Open tracking pixel (1×1 GIF) | No |
| GET | `/leads/unsubscribe?token=` | Unsubscribe landing page | No |

---

## Scheduler Jobs

| Job Name | Cron Pattern | Description | Timezone Note |
|---|---|---|---|
| `midnight-reset` | `0 0 * * *` | Reset daily email sent counts | UTC midnight |
| `sequence-runner` | `0 9-17 * * 1-5` | Run sequences + bounce check | Mon–Fri 9am–5pm UTC |
| `reply-check-hubspot` | `0 */2 * * *` | IMAP scan + HubSpot push | Every 2 hours |
| `natural-warmup` | `*/30 * * * 1-5` | Probabilistic warmup (US biz hours only) | US Eastern 9am–5pm |
| `conversation-scanner` | `*/5 * * * *` | Process new conversation JSON files | Continuous |
| `auto-conversation-generator` | `0 6 * * 1-5` | Generate daily warmup conversations | 6am UTC = 2am ET |
| `warmup-summary-email` | `0 2 * * *` | Daily warmup summary email | 2am UTC = 7am PKT |
| `reply-queue-processor` | `*/15 * * * *` | Send scheduled warmup thread replies | Every 15 minutes |
| `daily-backup` | `0 1 * * *` | Backup SQLite, keep 7 copies | 1am UTC |
| `daily-bounce-check` | `0 3 * * *` | Bounce rate check, auto-pause bad accounts | 3am UTC |
| `client-progress-reports` | `0 3 * * *` | Daily reports + Monday weekly digest | 3am UTC = 8am PKT |

---

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full instructions including Railway, VPS, and Docker.

**Quick Railway deploy:**
1. Push repo to GitHub
2. Create Railway project → Deploy from GitHub
3. Set environment variable: `PORT=3000`
4. Add Volume mounted at `/app/data` for persistent SQLite storage
5. Set start command: `bun run src/index.ts`

---

## Contributing

**Code style:**
- TypeScript for all server-side code; vanilla JS (no framework) for frontend
- All DB queries use parameterized statements — no string interpolation
- Every new scheduler job logs errors to `system_errors` table via `logError()`
- Never let scheduler jobs throw uncaught exceptions

**Adding a new feature:**
1. Add table migrations to `src/database.ts` using `try { ALTER TABLE } catch {}`
2. Create route file in `src/routes/` and register in `src/index.ts`
3. Add section HTML to `public/index.html`
4. Create `public/js/featureName.js` with state object and load function
5. Register loader in `public/js/navigation.js`

See [docs/TECHNICAL.md](docs/TECHNICAL.md) for detailed architecture documentation.

---

## License

MIT License — use freely, modify as needed, no warranty.
