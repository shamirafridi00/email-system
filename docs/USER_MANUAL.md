# User Manual

**GTM Email System** — A complete guide for non-technical users.

---

## What This System Does

This system helps you send cold emails to potential clients. It does two main things:

1. **Warms up your email accounts** — Before you can send cold emails, your Gmail accounts need to "warm up" so that Google doesn't flag your emails as spam. This system automatically sends natural-looking emails back and forth between your accounts to build up their reputation over 2–4 weeks.

2. **Runs your campaigns** — Once your accounts are warmed up, you can import a list of prospects and the system will automatically send them your email sequence, follow up at the right time, track who opens it, and detect when someone replies.

Think of it like having an assistant who sends emails for you while you sleep.

---

## Getting Started

### How to Log In

1. Open your browser and go to your system URL (e.g., `http://localhost:3000` or your Railway URL)
2. Enter your username and password
3. Click **Sign In**

Default credentials (change these immediately):
- Username: `admin`
- Password: `admin123`

### How to Navigate

The left sidebar has three sections:

- **Warmup System** — everything related to warming up your email accounts
- **Campaign System** — campaigns, leads, analytics, templates
- **Settings** — account settings, health checks, backups

Click any item in the sidebar to go to that page. The top bar shows which client you're currently working in and lets you switch between clients.

---

## Phase 1: Setup

### Step 1 — Change Your Password

1. Click **Settings** in the left sidebar
2. Find the "Admin Password" section
3. Enter a new strong password
4. Click Save

Do this before anything else.

### Step 2 — Add Your Warmup Email Accounts

These are the Gmail accounts you'll use for warming up. They should be the same accounts you plan to send cold emails from.

1. Click **Warmup Accounts** in the sidebar
2. Click **+ Add Account**
3. Enter the Gmail address (e.g., `john@yourdomain.com`)
4. Enter the Gmail **App Password** (not your regular Gmail password — see below)
5. Set a daily volume target (start with 5, it will ramp up automatically)
6. Click **Add Account**

**How to get a Gmail App Password:**
1. Go to your Google Account → Security
2. Enable 2-Step Verification if not already enabled
3. Search for "App passwords"
4. Create a new app password for "Mail"
5. Google gives you a 16-character password — copy this into the system

### Step 3 — Configure Notification Email

1. Go to **Settings**
2. Find "Notification Email"
3. Enter the email address where you want to receive daily warmup summaries and reply alerts
4. Enable "Send daily warmup summary" if you want a morning report

### Step 4 — Connect HubSpot (Optional)

If you use HubSpot CRM and want replies to automatically appear in your HubSpot contacts:

1. Go to **Clients** in the Settings section
2. Click on your client (or Default Client)
3. Find the HubSpot section
4. Paste your HubSpot Private App token
5. Click Save

When someone replies to your campaign, it will automatically create a note on their HubSpot contact.

---

## Phase 2: Warming Up

### What Is Warmup and Why Does It Matter?

When you create a new Gmail account or a custom domain email, Google treats it as suspicious if it suddenly starts sending 50 emails per day to strangers. Google will likely send your emails to spam.

Warming up means gradually increasing your sending volume while sending emails to other accounts that actively "engage" (open and reply). This teaches Google that your account is legitimate and builds your "sender reputation."

**The rule of thumb:** Warm up for at least 3–4 weeks before sending your first cold email campaign. The system does this automatically.

### How the System Warms Up Your Accounts

Every 30 minutes during US business hours (9am–5pm Eastern Time), the system picks a random set of your warmup accounts and has them send emails to each other. These emails look like natural business conversations — project updates, follow-ups, invoice discussions. The receiving account opens the email (building your open rate) and sometimes sends a reply (building your reply rate).

You don't need to do anything — this runs automatically once you've added your accounts.

### How to Generate Conversations

The system can automatically create warmup conversations. You can also trigger this manually:

1. Go to **Conversations** in the sidebar
2. Click **Generate Conversations**
3. The system picks two random accounts from your list and creates a realistic email thread for them to exchange
4. The conversation is queued and sent automatically

### Reading the Warmup Dashboard

Go to **Warmup Dashboard** to see today's warmup activity:

- **Emails Sent Today** — how many warmup emails went out today across all accounts
- **Active Accounts** — how many accounts are currently warming up
- **Health Score** — a 0–100 score per account showing how healthy the warmup is (higher is better, aim for 70+)

The table shows each account's daily progress. Green means on track. Yellow means below target. Red means there's a problem.

### What the Health Scores Mean

| Score | Meaning |
|---|---|
| 80–100 | Excellent. Account is ready for campaigns. |
| 60–79 | Good. Continue warming up for another week. |
| 40–59 | Fair. Check if the account is active and not paused. |
| 0–39 | Poor. Check if app password is correct and account isn't blocked. |

### Checking Readiness

Before launching a campaign, check if your accounts are ready:

1. Go to **Readiness Check** in the sidebar
2. The system runs 6 checks on each account:
   - Health score (is it above 60?)
   - Daily volume (is it sending enough?)
   - Days warmed up (has it been running for at least 14 days?)
   - Consecutive failures (has it been failing recently?)
   - Last verified (was IMAP working recently?)
   - Status (is it active, not paused?)
3. Green circle = ready to send campaigns. Red circle = not ready yet.

---

## Phase 3: Campaign Setup

### Step 1 — Add a Sending Account

The sending accounts are separate from warmup accounts — these are the accounts that will actually send your campaign emails. They should be the same Gmail addresses you warmed up.

1. Click **Sending Accounts** in the sidebar
2. Click **+ Add Account**
3. Enter email and app password (same process as warmup accounts)
4. Set a daily limit (start with 10–20 per day for a warmed-up account)

### Step 2 — Create Your First Campaign

1. Click **Campaigns** in the sidebar
2. Click **+ New Campaign**
3. Fill in:
   - **Campaign Name** — e.g., "Agency Outreach May 2026"
   - **Sending Account** — pick the Gmail account that will send these emails
   - **Daily Limit** — how many emails per day (recommend 20–30 for a warmed account)
   - **Send Days** — which days to send (default: Monday–Friday)
   - **Send Hours** — what time to send (default: 9am–5pm)
4. Click **Create Campaign**

### Step 3 — Write Your Email Sequence

A sequence is the series of emails your leads will receive, sent with delays between them.

1. Click on your campaign name
2. Click **Add Step**
3. Write your first email:
   - **Subject** — keep it short and personal, e.g., "quick question {{first_name}}"
   - **Body** — write your email. Use `{{first_name}}`, `{{company}}`, `{{personalized_line}}` to personalize
   - **Delay** — how many days before the next follow-up (the first step is always 0)
4. Add a follow-up step (Step 2) with a delay of 3–5 days
5. Add a final breakup email (Step 3) with a delay of 7 days

**Tips for subject lines:**
- Keep them under 40 characters
- Make them feel personal, not salesy
- Avoid all caps and exclamation marks

**Personalization variables:**
- `{{first_name}}` — lead's first name
- `{{last_name}}` — lead's last name
- `{{company}}` — company name
- `{{personalized_line}}` — custom one-liner from your CSV

### Step 4 — Import Leads from Apollo

1. Export your lead list from Apollo as a CSV
2. In your campaign, click **Import Leads**
3. Paste the CSV content into the text box
4. Click **Validate Before Import** — this checks each email address for validity
5. Review the validation results (invalid emails are flagged automatically)
6. Click **Import Leads** to add the valid ones

Each lead will start at Step 1 and progress through the sequence automatically.

### Understanding Lead Statuses

| Status | Meaning |
|---|---|
| **Active** | Currently in the sequence, will receive the next email on schedule |
| **Replied** | Has replied to one of your emails — take action! |
| **Finished** | Has received all steps in the sequence with no reply |
| **Bounced** | Email address doesn't exist or rejected delivery |
| **Unsubscribed** | Clicked the unsubscribe link — will never be emailed again |

---

## Phase 4: Launch and Monitor

### Activating Your Campaign

When you're ready to start sending:

1. Go to **Campaigns**
2. Click on your campaign
3. Change Status from **Draft** to **Active**
4. Click Save

The system will begin sending emails on its next scheduled run (every hour, Monday–Friday, 9am–5pm).

### Reading Campaign Analytics

Go to **Analytics** to see how your campaign is performing:

- **Sent** — total emails delivered
- **Open Rate** — percentage of recipients who opened your email (30%+ is good)
- **Reply Rate** — percentage who replied (3–8% is healthy for cold email)
- **Bounce Rate** — percentage that bounced (keep this below 5%)

The charts show trends over time. A dropping open rate might mean your emails are going to spam.

### What To Do When Someone Replies

When a lead replies, their status changes to **Replied** and you get a notification email. To follow up:

1. Go to **Leads**
2. Filter by status: **Replied**
3. See who replied and when
4. Reply directly from your Gmail account

If HubSpot is connected, the reply is automatically logged to the contact's timeline.

### A/B Testing Subject Lines

If you want to test which subject line works better:

1. Go to **A/B Tests** in the sidebar
2. Click **+ Create New Test**
3. Select your campaign and which step to test
4. Write two different subject lines (Version A and Version B)
5. Set a minimum sample size (50 is a good start)
6. Enable **Auto Declare Winner**
7. Click **Create A/B Test**

The system automatically splits your leads 50/50. Once both versions have been sent 50+ times, it compares the open rates and declares the better version the winner, then switches all remaining leads to that subject line.

---

## Troubleshooting

### App Password Not Working

**Symptom:** "Authentication failed" error when adding an account.

**Solutions:**
1. Make sure 2-Step Verification is enabled on the Gmail account
2. Generate a new app password from Google Account → Security → App passwords
3. Make sure you're copying the full 16-character password with no spaces
4. Check that the email address matches exactly (including capitalisation)

### Emails Not Sending

**Symptom:** Campaign is active but no emails are going out.

**Check these things:**
1. Is it Monday–Friday, between 9am and 5pm? The sequence runner only runs during business hours.
2. Does the sending account have a daily limit above 0?
3. Is the account status "Active" (not Paused or Flagged)?
4. Are there active leads in the campaign with status "Active"?
5. Go to **Health Check** and check if the system shows any errors.

### HubSpot Not Connecting

**Symptom:** HubSpot shows "Not Connected" on the dashboard.

**Solutions:**
1. Make sure you're using a **Private App token** from HubSpot, not an API key
2. The token needs at minimum: CRM contacts (read/write) and engagements (write) scopes
3. Go to your Client settings and re-paste the token
4. Click **Test Connection** to verify

### IMAP Errors in Error Log

**Symptom:** Error log shows "IMAP check failed" repeatedly.

**Solutions:**
1. Verify the Gmail account has IMAP enabled: Gmail Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP
2. Check that the app password is still valid (they can be revoked if 2FA is changed)
3. Make sure the account is not hitting Google's connection rate limits

### Emails Going to Spam

**Symptom:** Low open rates, or contacts report your emails are in spam.

**Check:**
1. Go to **DNS Checker** and verify your domain has valid SPF, DKIM, and DMARC records
2. Check your **Bounce Rate** — if it's above 5%, pause the campaign and clean your list
3. Use **Inbox Placement Test** to verify inbox delivery
4. Make sure your warmup has been running for at least 3–4 weeks

---

## Glossary

**App Password** — A special 16-character password that Google generates for third-party apps. It's different from your regular Gmail password and allows apps to access your Gmail without giving them your real password. Required because Google blocks regular password logins for third-party apps.

**Bounce Rate** — The percentage of emails you sent that could not be delivered. A "hard bounce" means the email address doesn't exist. High bounce rates damage your sender reputation and can get your account suspended. Keep it below 5%.

**DKIM** — DomainKeys Identified Mail. A digital signature in your email that proves it actually came from your domain and hasn't been tampered with. Email providers like Gmail use this to verify your emails are legitimate.

**DMARC** — Domain-based Message Authentication, Reporting and Conformance. A policy that tells receiving email servers what to do if an email fails SPF or DKIM checks. Essential for protecting your domain from being spoofed.

**IMAP** — Internet Message Access Protocol. The technology that allows an email app to read emails from a server. This system uses IMAP to check your Gmail inbox for replies from your leads.

**MX Record** — Mail Exchange record. A DNS setting that tells the internet which server receives emails for your domain. If someone has no MX record, their email address definitely doesn't work.

**Open Rate** — The percentage of recipients who opened your email. Calculated using a tiny invisible tracking image embedded in each email. A healthy cold email open rate is 30–50%.

**Reply Rate** — The percentage of recipients who replied to any email in your sequence. A healthy cold email reply rate is 3–10%.

**Sequence** — The series of emails in a campaign. Step 1 goes out first, then Step 2 after a delay (e.g., 3 days), then Step 3 after another delay. Each lead moves through the sequence automatically.

**SMTP** — Simple Mail Transfer Protocol. The standard technology for sending emails. This system uses Gmail's SMTP servers to send your emails from your Gmail accounts.

**SPF** — Sender Policy Framework. A DNS record that lists which servers are allowed to send email on behalf of your domain. Prevents spammers from forging your domain in their emails.

**Unsubscribe Link** — A link included at the bottom of every campaign email that lets the recipient stop receiving emails from you. Required by law in most countries. When clicked, the lead's status changes to "Unsubscribed" and they are permanently excluded from all future sends.

**Warmup** — The process of gradually increasing an email account's sending volume while generating engagement (opens and replies) to build its reputation with Google and other email providers. Without warmup, cold emails from a new account will likely land in spam.
