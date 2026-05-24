# Changelog

## v1.0.0 — Current Release

**Completed:** May 2026

---

### Warmup System

- **Natural warmup engine** — sends AI-generated conversation emails between Gmail accounts to build sender reputation
- **Conversation file upload** — upload JSON conversation files for custom warmup sequences
- **Auto conversation generator** — generates fresh warmup conversations daily from a curated Topics Library (Mon–Fri, 6am UTC)
- **Topics Library** — 8+ curated conversation topic pairs for the web design / agency industry, manageable from UI
- **Reply queue processor** — schedules threaded replies with realistic delays to simulate natural email conversations
- **US Eastern Business Hours scheduling** — warmup only fires during 9am–5pm ET Monday–Friday
- **Probabilistic send scheduling** — 60% fire rate per 30-minute tick for human-like irregularity
- **Account groups** — group warmup accounts and run warmup for specific subsets
- **Warmup schedule planner** — weekly ramp-up targets per account (week 1: 5/day → week 4: 20/day)
- **Warmup readiness check** — 6-factor go/no-go signal (health score, daily volume, days warming, consecutive failures, last verified, paused status)
- **Inbox placement test** — send test emails to seed addresses and report inbox vs spam placement
- **Health score tracking** — per-account score updated on each successful warmup cycle
- **Account status history** — full audit log of every status change per account with reason
- **Warmup analytics dashboard** — 7-day chart, reply rates, daily volume trends
- **Warmup calendar** — visual monthly calendar showing daily send volumes
- **Daily warmup summary email** — automated morning report at 7am PKT with per-account breakdown
- **Duplicate conversation detection** — fingerprinting + similarity scoring prevents re-uploading identical conversations
- **Bulk warmup account import** — CSV upload for adding multiple accounts at once

### Campaign System

- **Multi-step email sequences** — create campaigns with unlimited sequence steps and configurable delay between steps
- **Timezone-aware sending** — detects lead timezone from state/country data and sends at local business hours
- **Open tracking** — unique 1×1 pixel per email, records first open and repeat opens
- **Reply detection** — IMAP scan every 2 hours detects replies and marks leads as replied
- **HubSpot CRM integration** — push reply notifications to HubSpot contact timeline, per-client API tokens
- **Bounce detection** — tracks bounces in sent_log, auto-pauses accounts exceeding 10% 7-day bounce rate
- **Lead import via CSV** — supports Apollo export format, validates emails before import
- **Email validation** — MX record check + format validation with per-lead results
- **Blacklist management** — block individual emails or entire domains from all sends
- **Unsubscribe links** — every email includes a branded unsubscribe page with token verification
- **A/B testing** — split leads 50/50 across two subject lines, auto-declare winner when confidence threshold met
- **Campaign templates** — save campaign configurations as reusable templates with 3 built-in defaults
- **Campaign analytics** — open rate, reply rate, bounce rate, step-by-step breakdown with Chart.js graphs
- **Multi-client support** — complete data isolation per client, one-click switching, per-client HubSpot tokens
- **Client progress reports** — automated daily email summaries and weekly Monday digests per campaign
- **Export data** — CSV exports for leads, sent log, open log, reply log
- **DNS checker** — verify SPF, DKIM, DMARC, and MX records with remediation recommendations
- **Health check dashboard** — real-time status of database, SMTP, IMAP, HubSpot, and all 11 scheduler jobs
- **Error log** — structured error logging with severity levels (info/warning/error/critical) and resolution tracking
- **Automated backups** — daily SQLite database backup at 1am UTC, keeps 7 most recent copies
- **Getting Started page** — setup checklist with real-time completion tracking and quick action cards

### UI / Design System

- **Design system** — CSS custom properties (30+ variables), consistent dark palette (`#0a0a0a` base)
- **Lucide SVG icons** — 29 sidebar icons replacing emoji with clean vector icons
- **Responsive layout** — sidebar + main content split, collapsible sections
- **Toast notifications** — success/error/warning/info variants with slide-in animation
- **Login page redesign** — branded card layout matching design system
- **Getting Started landing page** — welcome card, quick actions grid, setup checklist
