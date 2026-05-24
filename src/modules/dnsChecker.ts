import dns from "dns";

const TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })), ms)
    ),
  ]);
}

function dnsError(code: string): string {
  if (code === "ENOTFOUND") return "Domain does not exist";
  if (code === "ENODATA") return "No records found";
  if (code === "ETIMEOUT") return "DNS lookup timed out";
  return `DNS error: ${code}`;
}

export interface SPFResult {
  found: boolean;
  record?: string;
  valid?: boolean;
  error?: string;
  recommendations: string[];
}

export interface DKIMResult {
  found: boolean;
  record?: string;
  selector?: string;
  selectors_tried?: string[];
  valid?: boolean;
  error?: string;
  recommendations: string[];
}

export interface DMARCResult {
  found: boolean;
  record?: string;
  policy?: string;
  valid?: boolean;
  error?: string;
  recommendations: string[];
}

export interface MXResult {
  found: boolean;
  records?: { exchange: string; priority: number }[];
  error?: string;
  recommendations: string[];
}

export interface DNSCheckResult {
  domain: string;
  checked_at: string;
  spf: SPFResult;
  dkim: DKIMResult;
  dmarc: DMARCResult;
  mx: MXResult;
  overall_score: number;
  overall_status: string;
  recommendations: string[];
}

export async function checkSPF(domain: string): Promise<SPFResult> {
  try {
    const records = await withTimeout(dns.promises.resolveTxt(domain), TIMEOUT_MS);
    const flat = records.map((r) => r.join(""));
    const spf = flat.find((r) => r.includes("v=spf1"));

    if (!spf) {
      return {
        found: false,
        valid: false,
        recommendations: ["Add an SPF record to your domain DNS settings."],
      };
    }

    const recommendations: string[] = [];
    const valid = /include:|ip4:|ip6:|all/.test(spf);

    if (spf.includes("+all")) {
      recommendations.push("Change +all to ~all or -all for better security.");
    }

    return { found: true, record: spf, valid, recommendations };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return { found: false, valid: false, error: dnsError(code), recommendations: [] };
  }
}

const DKIM_SELECTORS = ["google", "mail", "smtp", "dkim", "default", "s1", "s2"];

export async function checkDKIM(domain: string, selector?: string): Promise<DKIMResult> {
  const selectorsToTry = selector ? [selector] : DKIM_SELECTORS;
  const tried: string[] = [];

  for (const sel of selectorsToTry) {
    tried.push(sel);
    try {
      const records = await withTimeout(
        dns.promises.resolveTxt(`${sel}._domainkey.${domain}`),
        TIMEOUT_MS
      );
      const flat = records.map((r) => r.join(""));
      const dkim = flat[0];
      if (dkim) {
        const pMatch = dkim.match(/p=([^;]+)/);
        const valid = !!(pMatch && pMatch[1] && pMatch[1].trim().length > 0);
        return { found: true, record: dkim, selector: sel, valid, recommendations: [] };
      }
    } catch {
      // try next selector
    }
  }

  return {
    found: false,
    valid: false,
    selectors_tried: tried,
    recommendations: [
      "Add a DKIM record. Check your email provider for the correct DKIM selector and record value.",
    ],
  };
}

export async function checkDMARC(domain: string): Promise<DMARCResult> {
  try {
    const records = await withTimeout(
      dns.promises.resolveTxt(`_dmarc.${domain}`),
      TIMEOUT_MS
    );
    const flat = records.map((r) => r.join(""));
    const dmarc = flat.find((r) => r.includes("v=DMARC1"));

    if (!dmarc) {
      return {
        found: false,
        valid: false,
        recommendations: ["Add a DMARC record to your domain."],
      };
    }

    const pMatch = dmarc.match(/\bp=([^;]+)/);
    const policy = pMatch ? pMatch[1].trim().toLowerCase() : "none";
    const valid = policy === "quarantine" || policy === "reject";
    const recommendations: string[] = [];

    if (policy === "none") {
      recommendations.push(
        "Consider changing DMARC policy from none to quarantine after confirming legitimate emails pass."
      );
    }

    return { found: true, record: dmarc, policy, valid, recommendations };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
    if (code === "ENODATA" || code === "ENOTFOUND") {
      return {
        found: false,
        valid: false,
        recommendations: ["Add a DMARC record to your domain."],
      };
    }
    return { found: false, valid: false, error: dnsError(code), recommendations: [] };
  }
}

export async function checkMX(domain: string): Promise<MXResult> {
  try {
    const records = await withTimeout(dns.promises.resolveMx(domain), TIMEOUT_MS);
    if (!records || records.length === 0) {
      return {
        found: false,
        recommendations: ["Add MX records so email can be delivered to your domain."],
      };
    }
    const sorted = [...records].sort((a, b) => a.priority - b.priority);
    return {
      found: true,
      records: sorted.map((r) => ({ exchange: r.exchange, priority: r.priority })),
      recommendations: [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return {
      found: false,
      error: dnsError(code),
      recommendations: ["Add MX records so email can be delivered to your domain."],
    };
  }
}

export async function checkAllDNS(domain: string): Promise<DNSCheckResult> {
  const [spfR, dkimR, dmarcR, mxR] = await Promise.allSettled([
    checkSPF(domain),
    checkDKIM(domain),
    checkDMARC(domain),
    checkMX(domain),
  ]);

  const spf = spfR.status === "fulfilled" ? spfR.value : { found: false, valid: false, recommendations: [] };
  const dkim = dkimR.status === "fulfilled" ? dkimR.value : { found: false, valid: false, recommendations: [] };
  const dmarc = dmarcR.status === "fulfilled" ? dmarcR.value : { found: false, valid: false, recommendations: [] };
  const mx = mxR.status === "fulfilled" ? mxR.value : { found: false, recommendations: [] };

  let score = 0;
  if (spf.found && spf.valid) score += 30;
  if (dkim.found && dkim.valid) score += 35;
  if (dmarc.found && dmarc.valid) score += 25;
  if (mx.found) score += 10;

  const overall_status =
    score >= 90 ? "Excellent" :
    score >= 70 ? "Good" :
    score >= 50 ? "Fair" : "Poor";

  const recommendations = [
    ...spf.recommendations,
    ...dkim.recommendations,
    ...dmarc.recommendations,
    ...mx.recommendations,
  ];

  return {
    domain,
    checked_at: new Date().toISOString(),
    spf,
    dkim,
    dmarc,
    mx,
    overall_score: score,
    overall_status,
    recommendations,
  };
}
