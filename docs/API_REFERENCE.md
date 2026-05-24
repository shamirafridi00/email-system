# API Reference

**GTM Email System** — Complete endpoint reference.

Base URL: `http://localhost:3000` (or your deployment URL)

All authenticated endpoints require a valid session cookie (`session=<token>`). Obtain it via `POST /auth/login`.

---

## Auth

### POST /auth/login

Authenticate and receive a session cookie.

**Authentication:** Not required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `username` | string | Yes | Admin username |
| `password` | string | Yes | Admin password |

**Example Request:**
```bash
curl -c cookies.txt -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

**Example Response:**
```json
{ "ok": true }
```

The response sets a `session` cookie valid for 7 days. Pass `-b cookies.txt` on subsequent requests.

**Error Response (401):**
```json
{ "error": "Invalid credentials" }
```

---

### POST /auth/logout

Invalidate the current session.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/auth/logout
```

**Example Response:**
```json
{ "ok": true }
```

---

## Dashboard

### GET /dashboard/stats

Aggregate campaign and warmup stats for the current client.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/dashboard/stats
```

**Example Response:**
```json
{
  "campaigns": {
    "total": 3,
    "active": 2,
    "totalLeads": 847,
    "activeLeads": 412,
    "repliedLeads": 38,
    "emailsSentToday": 45
  },
  "warmup": {
    "totalAccounts": 6,
    "activeAccounts": 5,
    "emailsSentToday": 82,
    "avgHealthScore": 74
  }
}
```

---

### GET /dashboard/warmup

Warmup-specific dashboard data including per-account progress.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/dashboard/warmup
```

**Example Response:**
```json
{
  "accounts": [
    {
      "id": 1,
      "email": "john@agency.com",
      "status": "active",
      "health_score": 82,
      "emails_today": 18,
      "daily_target": 20,
      "days_warming": 21
    }
  ],
  "totalSentToday": 82,
  "activeAccounts": 5
}
```

---

### POST /dashboard/run-now

Manually trigger all scheduler jobs immediately (for testing or recovery).

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/dashboard/run-now
```

**Example Response:**
```json
{ "ok": true, "message": "All jobs triggered" }
```

---

## Campaigns

### GET /campaigns

List all campaigns for the current client.

**Authentication:** Required

**Query Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `status` | string | No | Filter by status: `draft`, `active`, `paused`, `completed` |

**Example Request:**
```bash
curl -b cookies.txt "http://localhost:3000/campaigns?status=active"
```

**Example Response:**
```json
[
  {
    "id": 1,
    "name": "Agency Outreach May 2026",
    "status": "active",
    "account_id": 2,
    "account_email": "john@agency.com",
    "daily_limit": 25,
    "send_days": "1,2,3,4,5",
    "send_hour_start": 9,
    "send_hour_end": 17,
    "client_id": 1,
    "created_at": "2026-05-01T10:00:00Z",
    "lead_count": 412,
    "active_lead_count": 310
  }
]
```

---

### POST /campaigns

Create a new campaign.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Campaign display name |
| `account_id` | number | Yes | Sending account ID |
| `daily_limit` | number | Yes | Max emails per day |
| `send_days` | string | No | Comma-separated weekday numbers (default: `"1,2,3,4,5"`) |
| `send_hour_start` | number | No | Start hour 0–23 (default: 9) |
| `send_hour_end` | number | No | End hour 0–23 (default: 17) |
| `status` | string | No | `draft` or `active` (default: `draft`) |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agency Outreach May 2026",
    "account_id": 2,
    "daily_limit": 25,
    "send_days": "1,2,3,4,5",
    "send_hour_start": 9,
    "send_hour_end": 17,
    "status": "draft"
  }'
```

**Example Response:**
```json
{ "ok": true, "id": 4 }
```

---

### PUT /campaigns/:id

Update campaign settings.

**Authentication:** Required

**Request Body:** Same fields as POST — include only fields to update.

**Example Request:**
```bash
curl -b cookies.txt -X PUT http://localhost:3000/campaigns/4 \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

**Example Response:**
```json
{ "ok": true }
```

---

### DELETE /campaigns/:id

Delete a campaign and all its leads and sent log entries.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X DELETE http://localhost:3000/campaigns/4
```

**Example Response:**
```json
{ "ok": true }
```

---

### GET /campaigns/:id/steps

Get all sequence steps for a campaign.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/campaigns/1/steps
```

**Example Response:**
```json
[
  {
    "id": 1,
    "campaign_id": 1,
    "step_number": 1,
    "subject": "quick question {{first_name}}",
    "body": "Hi {{first_name}},\n\nI came across {{company}} and noticed...",
    "delay_days": 0
  },
  {
    "id": 2,
    "campaign_id": 1,
    "step_number": 2,
    "subject": "Re: quick question {{first_name}}",
    "body": "Hey {{first_name}}, just wanted to follow up...",
    "delay_days": 4
  }
]
```

---

### POST /campaigns/:id/steps

Add a sequence step to a campaign.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `subject` | string | Yes | Email subject line. Use `{{first_name}}`, `{{company}}`, etc. |
| `body` | string | Yes | Email body (plain text or HTML) |
| `delay_days` | number | Yes | Days to wait after previous step (0 for step 1) |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/campaigns/1/steps \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "quick question {{first_name}}",
    "body": "Hi {{first_name}},\n\nI saw you are at {{company}}...",
    "delay_days": 0
  }'
```

**Example Response:**
```json
{ "ok": true, "id": 5, "step_number": 1 }
```

---

### PUT /campaigns/:id/steps/:stepId

Update a sequence step.

**Authentication:** Required

**Request Body:** Same fields as POST — include only fields to update.

**Example Request:**
```bash
curl -b cookies.txt -X PUT http://localhost:3000/campaigns/1/steps/5 \
  -H "Content-Type: application/json" \
  -d '{"subject": "a quick question for you, {{first_name}}"}'
```

**Example Response:**
```json
{ "ok": true }
```

---

### DELETE /campaigns/:id/steps/:stepId

Delete a sequence step.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X DELETE http://localhost:3000/campaigns/1/steps/5
```

**Example Response:**
```json
{ "ok": true }
```

---

### GET /campaigns/:id/stats

Get open, reply, and bounce stats for a campaign.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/campaigns/1/stats
```

**Example Response:**
```json
{
  "sent": 284,
  "opened": 97,
  "replied": 18,
  "bounced": 8,
  "open_rate": 34.2,
  "reply_rate": 6.3,
  "bounce_rate": 2.8,
  "by_step": [
    { "step_number": 1, "sent": 180, "opened": 72, "replied": 14 },
    { "step_number": 2, "sent": 104, "opened": 25, "replied": 4 }
  ]
}
```

---

## Leads

### GET /leads

List leads with optional filters.

**Authentication:** Required

**Query Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `campaign_id` | number | No | Filter by campaign |
| `status` | string | No | Filter by status: `active`, `replied`, `finished`, `bounced`, `unsubscribed` |
| `search` | string | No | Search by email or name |
| `limit` | number | No | Results per page (default: 100) |
| `offset` | number | No | Pagination offset (default: 0) |

**Example Request:**
```bash
curl -b cookies.txt "http://localhost:3000/leads?campaign_id=1&status=replied"
```

**Example Response:**
```json
{
  "leads": [
    {
      "id": 42,
      "email": "sarah@techcorp.com",
      "first_name": "Sarah",
      "last_name": "Chen",
      "company": "TechCorp",
      "campaign_id": 1,
      "status": "replied",
      "current_step": 1,
      "personalized_line": "Love what TechCorp is building in the dev tools space",
      "timezone": "America/New_York",
      "created_at": "2026-05-10T09:00:00Z"
    }
  ],
  "total": 18
}
```

---

### POST /leads/validate-csv

Validate a CSV before import. Checks email format and MX records.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `csv` | string | Yes | Raw CSV content as a string |
| `campaign_id` | number | Yes | Target campaign ID |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/leads/validate-csv \
  -H "Content-Type: application/json" \
  -d '{"campaign_id": 1, "csv": "first_name,last_name,email,company\nSarah,Chen,sarah@techcorp.com,TechCorp"}'
```

**Example Response:**
```json
{
  "valid": [
    { "email": "sarah@techcorp.com", "first_name": "Sarah", "last_name": "Chen", "company": "TechCorp" }
  ],
  "invalid": [
    { "email": "bademail@nodomain.xyz", "reason": "No MX record found" }
  ],
  "total": 2,
  "valid_count": 1,
  "invalid_count": 1
}
```

---

### POST /leads/import

Import validated leads into a campaign.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `campaign_id` | number | Yes | Target campaign ID |
| `leads` | array | Yes | Array of lead objects from validate-csv response |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/leads/import \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_id": 1,
    "leads": [
      { "email": "sarah@techcorp.com", "first_name": "Sarah", "last_name": "Chen", "company": "TechCorp" }
    ]
  }'
```

**Example Response:**
```json
{ "ok": true, "imported": 1, "skipped_duplicates": 0 }
```

---

### PUT /leads/:id

Update a lead's status or data.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | No | New status: `active`, `replied`, `finished`, `bounced`, `unsubscribed` |
| `first_name` | string | No | Update first name |
| `last_name` | string | No | Update last name |
| `company` | string | No | Update company |
| `personalized_line` | string | No | Update personalized line |

**Example Request:**
```bash
curl -b cookies.txt -X PUT http://localhost:3000/leads/42 \
  -H "Content-Type: application/json" \
  -d '{"status": "finished"}'
```

**Example Response:**
```json
{ "ok": true }
```

---

### DELETE /leads/:id

Delete a lead and their sent log entries.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X DELETE http://localhost:3000/leads/42
```

**Example Response:**
```json
{ "ok": true }
```

---

## Accounts (Sending)

### GET /accounts

List all sending accounts.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/accounts
```

**Example Response:**
```json
[
  {
    "id": 1,
    "email": "john@agency.com",
    "status": "active",
    "daily_limit": 25,
    "emails_sent_today": 18,
    "bounce_rate_7d": 1.2,
    "created_at": "2026-04-15T08:00:00Z"
  }
]
```

---

### POST /accounts

Add a sending account.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | Gmail address |
| `app_password` | string | Yes | 16-character Gmail App Password |
| `daily_limit` | number | Yes | Max emails per day |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"email": "john@agency.com", "app_password": "abcd efgh ijkl mnop", "daily_limit": 25}'
```

**Example Response:**
```json
{ "ok": true, "id": 3 }
```

---

### PUT /accounts/:id

Update a sending account.

**Authentication:** Required

**Request Body:** Same fields as POST — include only fields to update.

**Example Request:**
```bash
curl -b cookies.txt -X PUT http://localhost:3000/accounts/3 \
  -H "Content-Type: application/json" \
  -d '{"daily_limit": 30, "status": "paused"}'
```

**Example Response:**
```json
{ "ok": true }
```

---

### DELETE /accounts/:id

Delete a sending account.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X DELETE http://localhost:3000/accounts/3
```

**Example Response:**
```json
{ "ok": true }
```

---

## Warmup

### GET /warmup/accounts

List all warmup accounts with status.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/warmup/accounts
```

**Example Response:**
```json
[
  {
    "id": 1,
    "email": "warm1@agency.com",
    "status": "active",
    "daily_target": 20,
    "health_score": 78,
    "created_at": "2026-04-01T00:00:00Z"
  }
]
```

---

### POST /warmup/accounts

Add a warmup account.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | Gmail address |
| `app_password` | string | Yes | 16-character Gmail App Password |
| `daily_target` | number | No | Target warmup emails per day (default: 5) |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/warmup/accounts \
  -H "Content-Type: application/json" \
  -d '{"email": "warm1@agency.com", "app_password": "abcd efgh ijkl mnop", "daily_target": 5}'
```

**Example Response:**
```json
{ "ok": true, "id": 2 }
```

---

### PUT /warmup/accounts/:id

Update a warmup account.

**Authentication:** Required

**Request Body:** Same fields as POST — include only fields to update. Also accepts `status` (`active`/`paused`).

**Example Request:**
```bash
curl -b cookies.txt -X PUT http://localhost:3000/warmup/accounts/2 \
  -H "Content-Type: application/json" \
  -d '{"daily_target": 15}'
```

**Example Response:**
```json
{ "ok": true }
```

---

### DELETE /warmup/accounts/:id

Delete a warmup account.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X DELETE http://localhost:3000/warmup/accounts/2
```

**Example Response:**
```json
{ "ok": true }
```

---

### GET /warmup/accounts/progress

Health scores and today's progress for all warmup accounts.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/warmup/accounts/progress
```

**Example Response:**
```json
[
  {
    "id": 1,
    "email": "warm1@agency.com",
    "status": "active",
    "health_score": 78,
    "daily_target": 20,
    "sent_today": 16,
    "days_warming": 21,
    "consecutive_failures": 0,
    "last_verified_at": "2026-05-24T14:00:00Z"
  }
]
```

---

### GET /warmup/accounts/readiness-all

Run 6-factor readiness check for all warmup accounts.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/warmup/accounts/readiness-all
```

**Example Response:**
```json
[
  {
    "email": "warm1@agency.com",
    "ready": true,
    "checks": {
      "health_score": { "pass": true, "value": 78, "threshold": 60 },
      "daily_volume": { "pass": true, "value": 16, "threshold": 5 },
      "days_warming": { "pass": true, "value": 21, "threshold": 14 },
      "consecutive_failures": { "pass": true, "value": 0, "threshold": 3 },
      "last_verified": { "pass": true, "hours_ago": 2 },
      "status": { "pass": true, "status": "active" }
    }
  }
]
```

---

### GET /warmup/accounts/groups

List account groups.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/warmup/accounts/groups
```

**Example Response:**
```json
[
  { "id": 1, "name": "Group A", "account_ids": [1, 2, 3] },
  { "id": 2, "name": "Group B", "account_ids": [4, 5] }
]
```

---

### POST /warmup/accounts/groups/run

Manually trigger warmup for a specific group.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `group_id` | number | Yes | Group ID to run warmup for |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/warmup/accounts/groups/run \
  -H "Content-Type: application/json" \
  -d '{"group_id": 1}'
```

**Example Response:**
```json
{ "ok": true, "emails_queued": 12 }
```

---

### GET /warmup/schedule

Schedule planner data — weekly ramp-up targets per account.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/warmup/schedule
```

**Example Response:**
```json
[
  {
    "account_id": 1,
    "email": "warm1@agency.com",
    "week_1_target": 5,
    "week_2_target": 10,
    "week_3_target": 15,
    "week_4_target": 20,
    "current_week": 3,
    "current_target": 15
  }
]
```

---

### POST /warmup/conversations/upload

Upload a conversation JSON file for processing.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `filename` | string | Yes | File name |
| `content` | string | Yes | JSON file contents as a string |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/warmup/conversations/upload \
  -H "Content-Type: application/json" \
  -d '{"filename": "thread1.json", "content": "[{\"from\":\"a@b.com\",\"to\":\"c@d.com\",\"subject\":\"Project update\",\"body\":\"Hi...\"}]"}'
```

**Example Response:**
```json
{ "ok": true, "message": "File queued for processing" }
```

---

### POST /warmup/conversations/generate

Trigger immediate warmup conversation generation.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/warmup/conversations/generate
```

**Example Response:**
```json
{ "ok": true, "conversations_created": 3 }
```

---

### GET /warmup/log

Warmup email log with optional filters.

**Authentication:** Required

**Query Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `account_id` | number | No | Filter by warmup account |
| `limit` | number | No | Results per page (default: 100) |
| `offset` | number | No | Pagination offset |

**Example Request:**
```bash
curl -b cookies.txt "http://localhost:3000/warmup/log?limit=20"
```

**Example Response:**
```json
[
  {
    "id": 1,
    "from_email": "warm1@agency.com",
    "to_email": "warm2@agency.com",
    "subject": "Following up on the proposal",
    "sent_at": "2026-05-24T14:30:00Z",
    "opened": 1,
    "replied": 0
  }
]
```

---

## Templates

### GET /templates

List all campaign templates.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/templates
```

**Example Response:**
```json
[
  {
    "id": 1,
    "name": "Agency Cold Outreach",
    "description": "3-step sequence for agency prospecting",
    "is_system": 1,
    "step_count": 3,
    "created_at": "2026-05-01T00:00:00Z"
  }
]
```

---

### GET /templates/:id

Get a template with all its steps.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/templates/1
```

**Example Response:**
```json
{
  "id": 1,
  "name": "Agency Cold Outreach",
  "description": "3-step sequence for agency prospecting",
  "is_system": 1,
  "steps": [
    { "step_number": 1, "subject": "quick question {{first_name}}", "body": "Hi {{first_name}}...", "delay_days": 0 },
    { "step_number": 2, "subject": "Re: quick question {{first_name}}", "body": "Hey {{first_name}}...", "delay_days": 4 },
    { "step_number": 3, "subject": "last note {{first_name}}", "body": "Hi {{first_name}}, I'll leave you alone after this...", "delay_days": 7 }
  ]
}
```

---

### POST /templates

Create a new template.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Template name |
| `description` | string | No | Short description |
| `steps` | array | Yes | Array of step objects: `{step_number, subject, body, delay_days}` |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/templates \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SaaS Outreach",
    "description": "2-step SaaS prospecting",
    "steps": [
      {"step_number": 1, "subject": "{{company}} + our tool", "body": "Hi {{first_name}}...", "delay_days": 0},
      {"step_number": 2, "subject": "quick follow-up", "body": "Hey {{first_name}}...", "delay_days": 5}
    ]
  }'
```

**Example Response:**
```json
{ "ok": true, "id": 4 }
```

---

### PUT /templates/:id

Update a template (non-system templates only).

**Authentication:** Required

**Request Body:** Same fields as POST — include only fields to update.

**Example Request:**
```bash
curl -b cookies.txt -X PUT http://localhost:3000/templates/4 \
  -H "Content-Type: application/json" \
  -d '{"name": "SaaS Outreach v2"}'
```

**Example Response:**
```json
{ "ok": true }
```

---

### DELETE /templates/:id

Delete a template. System templates cannot be deleted.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X DELETE http://localhost:3000/templates/4
```

**Example Response:**
```json
{ "ok": true }
```

---

### POST /templates/:id/use

Create a campaign from a template.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Campaign name |
| `account_id` | number | Yes | Sending account ID |
| `daily_limit` | number | Yes | Max emails per day |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/templates/1/use \
  -H "Content-Type: application/json" \
  -d '{"name": "Agency May 2026", "account_id": 2, "daily_limit": 20}'
```

**Example Response:**
```json
{ "ok": true, "campaign_id": 7 }
```

---

### POST /templates/save-from-campaign

Save an existing campaign's steps as a new template.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `campaign_id` | number | Yes | Source campaign ID |
| `name` | string | Yes | Template name |
| `description` | string | No | Template description |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/templates/save-from-campaign \
  -H "Content-Type: application/json" \
  -d '{"campaign_id": 1, "name": "My Best Sequence", "description": "Proven 3-step agency outreach"}'
```

**Example Response:**
```json
{ "ok": true, "id": 5 }
```

---

## A/B Tests

### GET /abtests

List all A/B tests.

**Authentication:** Required

**Query Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `campaign_id` | number | No | Filter by campaign |
| `status` | string | No | Filter by status: `running`, `winner_declared`, `stopped` |

**Example Request:**
```bash
curl -b cookies.txt "http://localhost:3000/abtests?status=running"
```

**Example Response:**
```json
[
  {
    "id": 1,
    "name": "Subject line test May",
    "campaign_id": 1,
    "step_number": 1,
    "status": "running",
    "variant_a_subject": "quick question {{first_name}}",
    "variant_b_subject": "I had a thought about {{company}}",
    "variant_a_sent": 62,
    "variant_b_sent": 61,
    "variant_a_opened": 24,
    "variant_b_opened": 28,
    "variant_a_open_rate": 38.7,
    "variant_b_open_rate": 45.9,
    "winner": null,
    "min_sample_size": 50,
    "auto_declare": 1,
    "created_at": "2026-05-15T00:00:00Z"
  }
]
```

---

### GET /abtests/:id

Get a single test with full stats.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/abtests/1
```

**Example Response:**
```json
{
  "id": 1,
  "name": "Subject line test May",
  "campaign_id": 1,
  "campaign_name": "Agency Outreach May 2026",
  "step_number": 1,
  "status": "running",
  "variant_a_subject": "quick question {{first_name}}",
  "variant_b_subject": "I had a thought about {{company}}",
  "variant_a_sent": 62,
  "variant_b_sent": 61,
  "variant_a_opened": 24,
  "variant_b_opened": 28,
  "variant_a_replied": 4,
  "variant_b_replied": 6,
  "variant_a_open_rate": 38.7,
  "variant_b_open_rate": 45.9,
  "winner": null,
  "winner_declared_at": null,
  "min_sample_size": 50,
  "confidence_threshold": 0.1,
  "auto_declare": 1
}
```

---

### POST /abtests

Create a new A/B test.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Test display name |
| `campaign_id` | number | Yes | Campaign to test on |
| `step_number` | number | Yes | Which step to A/B test (must exist) |
| `variant_a_subject` | string | Yes | Version A subject line |
| `variant_b_subject` | string | Yes | Version B subject line |
| `min_sample_size` | number | No | Minimum sends per variant before declaring winner (default: 50) |
| `confidence_threshold` | number | No | Minimum open rate difference to declare a winner, 0–1 (default: 0.1 = 10%) |
| `auto_declare` | number | No | 1 to auto-declare winner, 0 for manual (default: 1) |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/abtests \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Subject test May",
    "campaign_id": 1,
    "step_number": 1,
    "variant_a_subject": "quick question {{first_name}}",
    "variant_b_subject": "I had a thought about {{company}}",
    "min_sample_size": 50,
    "confidence_threshold": 0.1,
    "auto_declare": 1
  }'
```

**Example Response:**
```json
{ "ok": true, "id": 2 }
```

---

### PUT /abtests/:id

Update A/B test settings (only while `running`).

**Authentication:** Required

**Request Body:** Same optional fields as POST (except `campaign_id`, `step_number`).

**Example Request:**
```bash
curl -b cookies.txt -X PUT http://localhost:3000/abtests/2 \
  -H "Content-Type: application/json" \
  -d '{"min_sample_size": 75}'
```

**Example Response:**
```json
{ "ok": true }
```

---

### POST /abtests/:id/declare-winner

Manually declare a winner and apply it to the sequence step.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `winner` | string | Yes | `"a"` or `"b"` |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/abtests/2/declare-winner \
  -H "Content-Type: application/json" \
  -d '{"winner": "b"}'
```

**Example Response:**
```json
{ "ok": true, "applied_subject": "I had a thought about {{company}}" }
```

---

### POST /abtests/:id/stop

Stop a running test without declaring a winner.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/abtests/2/stop
```

**Example Response:**
```json
{ "ok": true }
```

---

### POST /abtests/:id/check-winner

Trigger an immediate winner check (same logic as auto-check on open).

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/abtests/2/check-winner
```

**Example Response:**
```json
{ "ok": true, "winner_declared": false }
```

---

### DELETE /abtests/:id

Delete a stopped test.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X DELETE http://localhost:3000/abtests/2
```

**Example Response:**
```json
{ "ok": true }
```

---

## Clients

### GET /clients

List all clients.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/clients
```

**Example Response:**
```json
[
  {
    "id": 1,
    "name": "Default Client",
    "color": "#6366f1",
    "hubspot_token": null,
    "is_current": 1,
    "campaign_count": 3
  }
]
```

---

### GET /clients/current

Get the active client.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt http://localhost:3000/clients/current
```

**Example Response:**
```json
{ "id": 1, "name": "Default Client", "color": "#6366f1", "hubspot_token": null }
```

---

### POST /clients

Create a new client.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Client display name |
| `color` | string | No | Hex color for client badge (default: `#6366f1`) |
| `hubspot_token` | string | No | HubSpot Private App token for this client |

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/clients \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "color": "#22c55e"}'
```

**Example Response:**
```json
{ "ok": true, "id": 2 }
```

---

### PUT /clients/:id

Update client settings.

**Authentication:** Required

**Request Body:** Same fields as POST — include only fields to update.

**Example Request:**
```bash
curl -b cookies.txt -X PUT http://localhost:3000/clients/2 \
  -H "Content-Type: application/json" \
  -d '{"hubspot_token": "pat-na1-xxxxxxxx"}'
```

**Example Response:**
```json
{ "ok": true }
```

---

### DELETE /clients/:id

Delete a client. All campaigns/leads are reassigned to Default Client.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X DELETE http://localhost:3000/clients/2
```

**Example Response:**
```json
{ "ok": true }
```

---

### POST /clients/:id/switch

Switch the active client context.

**Authentication:** Required

**Example Request:**
```bash
curl -b cookies.txt -X POST http://localhost:3000/clients/2/switch
```

**Example Response:**
```json
{ "ok": true }
```

---

## Tracking (Public)

### GET /track/open/:token

Open tracking pixel. Returns a 1×1 transparent GIF and records the open event.

**Authentication:** Not required (public endpoint)

**Path Parameters:**
| Name | Type | Description |
|---|---|---|
| `token` | string | Unique tracking token from `sent_log` |

**Example Request:**
```bash
curl http://localhost:3000/track/open/abc123def456
```

**Response:** 1×1 GIF image (`image/gif`). Records open in `email_opens`. On first open only: marks `sent_log.opened = 1`, triggers A/B open recording and winner check.

---

### GET /leads/unsubscribe

Unsubscribe landing page. Marks lead as unsubscribed permanently.

**Authentication:** Not required (public endpoint)

**Query Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `token` | string | Yes | Unique unsubscribe token |

**Example Request:**
```bash
curl "http://localhost:3000/leads/unsubscribe?token=xyz789"
```

**Response:** HTML page confirming unsubscribe. Updates `leads.status = 'unsubscribed'` and inserts into `unsubscribe_log`.

---

## System Settings

Settings are managed via the `/settings` UI page. They are stored as key-value pairs in the `system_settings` table. There is no dedicated REST API for settings — they are read and written through the dashboard and settings page endpoints.

Key settings values:
| Key | Description |
|---|---|
| `notification_email` | Where daily summaries and alerts are sent |
| `send_warmup_summary` | `1` to enable daily warmup summary email |
| `system_name` | Display name shown in the app header |
| `current_client_id` | Active client ID |
| `admin_username` | Login username (hashed in DB) |
| `admin_password` | Login password (hashed in DB) |

---

## Error Responses

All endpoints return errors in this format:

```json
{ "error": "Description of what went wrong" }
```

Common HTTP status codes:
| Code | Meaning |
|---|---|
| 200 | Success |
| 400 | Bad request — missing or invalid parameters |
| 401 | Unauthorized — no valid session cookie |
| 404 | Resource not found |
| 409 | Conflict — e.g., duplicate email, test already running |
| 500 | Internal server error — check the error log |
