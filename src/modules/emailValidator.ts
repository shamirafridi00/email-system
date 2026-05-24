import dns from "dns";

const DISPOSABLE_DOMAINS = [
  "mailinator.com", "tempmail.com", "guerrillamail.com", "throwaway.email", "yopmail.com",
  "maildrop.cc", "sharklasers.com", "guerrillamailblock.com", "grr.la", "guerrillamail.info",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.net", "guerrillamail.org",
  "spam4.me", "trashmail.com", "trashmail.me", "trashmail.at", "trashmail.io", "trashmail.net",
  "dispostable.com", "mailnull.com", "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "spamgourmet.me", "spamex.com", "bccto.me", "chacuo.net", "discard.email",
  "discardmail.com", "discardmail.de", "spamfree24.org", "spamfree24.de", "spamfree24.eu",
  "spamfree24.info", "spamfree24.net", "tempr.email", "crazymailing.com", "pokemail.net",
  "spam.la", "unids.com", "veryrealemail.com", "chogmail.com", "tempe-mail.com",
  "spamherelots.com", "spamhereplease.com", "herp.in",
];

const FORMAT_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface ValidationResult {
  email: string;
  valid: boolean;
  reason: string;
  checks: {
    format_check?: "passed" | "failed";
    length_check?: "passed" | "failed";
    disposable_check?: "passed" | "failed";
    mx_check?: "passed" | "failed";
  };
}

export interface BatchSummary {
  total: number;
  valid_count: number;
  invalid_count: number;
  invalid_by_reason: Record<string, number>;
}

export interface BatchResult {
  results: ValidationResult[];
  summary: BatchSummary;
}

export function isValidFormat(email: string): boolean {
  return FORMAT_REGEX.test(email);
}

export function isDisposable(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return DISPOSABLE_DOMAINS.includes(domain);
}

export async function validateEmail(email: string): Promise<ValidationResult> {
  // Check 1: Format
  if (!FORMAT_REGEX.test(email)) {
    return { email, valid: false, reason: "Invalid email format", checks: { format_check: "failed" } };
  }

  // Check 2: Length
  const [local, domain] = email.split("@");
  if (email.length >= 254 || local.length >= 64) {
    return { email, valid: false, reason: "Email address too long", checks: { format_check: "passed", length_check: "failed" } };
  }

  // Check 3: Disposable domain
  if (DISPOSABLE_DOMAINS.includes(domain.toLowerCase())) {
    return {
      email, valid: false, reason: "Disposable email domain detected",
      checks: { format_check: "passed", length_check: "passed", disposable_check: "failed" },
    };
  }

  // Check 4: MX record (5s timeout)
  const mxLookup = dns.promises.resolveMx(domain);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(Object.assign(new Error("DNS timeout"), { code: "ETIMEOUT" })), 5000)
  );

  try {
    const records = await Promise.race([mxLookup, timeout]);
    if (!records || records.length === 0) {
      return {
        email, valid: false, reason: "No mail server found for this domain",
        checks: { format_check: "passed", length_check: "passed", disposable_check: "passed", mx_check: "failed" },
      };
    }
    return {
      email, valid: true, reason: "All checks passed",
      checks: { format_check: "passed", length_check: "passed", disposable_check: "passed", mx_check: "passed" },
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
    let reason: string;
    if (code === "ENOTFOUND") {
      reason = "Domain does not exist";
    } else if (code === "ENODATA" || code === "ESERVFAIL") {
      reason = "No mail server found for this domain";
    } else {
      reason = `DNS lookup failed: ${code}`;
    }
    return {
      email, valid: false, reason,
      checks: { format_check: "passed", length_check: "passed", disposable_check: "passed", mx_check: "failed" },
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function validateEmailBatch(emails: string[]): Promise<BatchResult> {
  const results: ValidationResult[] = new Array(emails.length);
  const BATCH_SIZE = 10;

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((e) => validateEmail(e)));
    settled.forEach((s, j) => {
      if (s.status === "fulfilled") {
        results[i + j] = s.value;
      } else {
        results[i + j] = {
          email: batch[j],
          valid: false,
          reason: "Validation error",
          checks: {},
        };
      }
    });
    if (i + BATCH_SIZE < emails.length) await delay(100);
  }

  const invalid_by_reason: Record<string, number> = {};
  let valid_count = 0;
  for (const r of results) {
    if (r.valid) {
      valid_count++;
    } else {
      invalid_by_reason[r.reason] = (invalid_by_reason[r.reason] ?? 0) + 1;
    }
  }

  return {
    results,
    summary: {
      total: emails.length,
      valid_count,
      invalid_count: emails.length - valid_count,
      invalid_by_reason,
    },
  };
}
