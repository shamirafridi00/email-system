import { db } from "../database";
import { logError, logWarning } from "./logger";

interface Lead {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
}

interface UnpushedReply extends Lead {
  reply_id: number;
  hubspot_token?: string | null;
}

const BASE = "https://api.hubapi.com";

function getToken(): string | null {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    console.warn("HUBSPOT_TOKEN is not set — skipping HubSpot operation.");
    return null;
  }
  return token;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function pushToHubspot(lead: Lead, overrideToken?: string | null): Promise<void> {
  const token = overrideToken ?? getToken();
  if (!token) return;

  // Step 1: Create or retrieve contact
  let contactId: string | null = null;

  try {
    const res = await fetch(`${BASE}/crm/v3/objects/contacts`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        properties: {
          email: lead.email,
          firstname: lead.first_name,
          lastname: lead.last_name,
          company: lead.company,
        },
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { id: string };
      contactId = data.id;
      console.log(`HubSpot: contact created (id=${contactId}) for ${lead.email}`);
    } else if (res.status === 409) {
      // Contact already exists — extract id from the error body
      const err = (await res.json()) as {
        message?: string;
        id?: string;
        extra?: { additionalInfo?: string; id?: string };
      };

      // HubSpot 409 body has the existing id in different places depending on API version
      contactId =
        err.id ??
        err.extra?.id ??
        (err.message?.match(/existing ID:\s*(\d+)/)?.[1] ?? null);

      if (!contactId) {
        // Fallback: search by email
        const search = await fetch(
          `${BASE}/crm/v3/objects/contacts/search`,
          {
            method: "POST",
            headers: authHeaders(token),
            body: JSON.stringify({
              filterGroups: [
                {
                  filters: [
                    { propertyName: "email", operator: "EQ", value: lead.email },
                  ],
                },
              ],
              properties: ["email"],
              limit: 1,
            }),
          }
        );
        if (search.ok) {
          const sd = (await search.json()) as { results?: { id: string }[] };
          contactId = sd.results?.[0]?.id ?? null;
        }
      }

      console.log(
        `HubSpot: contact already exists (id=${contactId}) for ${lead.email}`
      );
    } else {
      const msg = await parseError(res);
      console.error(`HubSpot: contact create failed (${res.status}): ${msg}`);
      logError({ error_type: "hubspot", severity: "error", message: `Contact create failed (${res.status}): ${msg}`, context: { email: lead.email } }).catch(() => {});
      return;
    }
  } catch (err) {
    console.error("HubSpot: contact create threw:", err);
    logError({ error_type: "hubspot", severity: "error", message: err instanceof Error ? err.message : String(err), stack_trace: err instanceof Error ? err.stack : undefined, context: { email: lead.email } }).catch(() => {});
    return;
  }

  if (!contactId) {
    console.error(`HubSpot: could not resolve contact id for ${lead.email} — aborting.`);
    return;
  }

  // Step 2: Create deal
  let dealId: string | null = null;
  const dealName = `${lead.first_name} ${lead.company} Replied`.trim();

  try {
    const res = await fetch(`${BASE}/crm/v3/objects/deals`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        properties: {
          dealname: dealName,
          pipeline: "default",
          dealstage: "appointmentscheduled",
          amount: "",
        },
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { id: string };
      dealId = data.id;
      console.log(`HubSpot: deal created (id=${dealId}) "${dealName}"`);
    } else {
      const msg = await parseError(res);
      console.error(`HubSpot: deal create failed (${res.status}): ${msg}`);
      logWarning("hubspot", `Deal create failed (${res.status}): ${msg}`, { email: lead.email }).catch(() => {});
    }
  } catch (err) {
    console.error("HubSpot: deal create threw:", err);
    logWarning("hubspot", err instanceof Error ? err.message : String(err), { email: lead.email, step: "deal_create" }).catch(() => {});
  }

  // Step 3: Associate deal → contact
  if (dealId && contactId) {
    try {
      const res = await fetch(
        `${BASE}/crm/v3/associations/deals/contacts/batch/create`,
        {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({
            inputs: [
              {
                from: { id: dealId },
                to: { id: contactId },
                type: "deal_to_contact",
              },
            ],
          }),
        }
      );

      if (res.ok) {
        console.log(
          `HubSpot: deal ${dealId} associated with contact ${contactId}`
        );
      } else {
        const msg = await parseError(res);
        console.error(`HubSpot: association failed (${res.status}): ${msg}`);
        logWarning("hubspot", `Association failed (${res.status}): ${msg}`, { deal_id: dealId, contact_id: contactId }).catch(() => {});
      }
    } catch (err) {
      console.error("HubSpot: association threw:", err);
      logWarning("hubspot", err instanceof Error ? err.message : String(err), { deal_id: dealId, contact_id: contactId, step: "association" }).catch(() => {});
    }
  }

  // Step 4: Mark reply as pushed regardless of deal/association outcome —
  // contact was created, which is the critical step
  db.run(
    "UPDATE replies SET pushed_to_hubspot = 1 WHERE lead_id = ?",
    [lead.id]
  );
  console.log(`HubSpot: replies table updated for lead ${lead.id}`);
}

export async function testHubspotConnection(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  try {
    const res = await fetch(
      `${BASE}/crm/v3/objects/contacts?limit=1`,
      { headers: authHeaders(token) }
    );

    if (res.ok) {
      console.log("HubSpot: connection test passed.");
      return true;
    }

    const msg = await parseError(res);
    console.error(`HubSpot: connection test failed (${res.status}): ${msg}`);
    return false;
  } catch (err) {
    console.error("HubSpot: connection test threw:", err);
    return false;
  }
}

export function getUnpushedReplies(): UnpushedReply[] {
  return db
    .query<UnpushedReply, []>(
      `SELECT
         r.id AS reply_id,
         l.id, l.first_name, l.last_name, l.email, l.company,
         cl.hubspot_token
       FROM replies r
       JOIN leads l ON l.id = r.lead_id
       LEFT JOIN campaigns c ON c.id = l.campaign_id
       LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE r.pushed_to_hubspot = 0`
    )
    .all();
}
