// Determine whether DST is currently active (US rules: 2nd Sun Mar → 1st Sun Nov)
function isDSTActive(): boolean {
  const now = new Date();
  const year = now.getFullYear();

  // Second Sunday of March
  const mar = new Date(year, 2, 1);
  const dstStart = new Date(year, 2, 8 + ((7 - mar.getDay()) % 7));

  // First Sunday of November
  const nov = new Date(year, 10, 1);
  const dstEnd = new Date(year, 10, (7 - nov.getDay()) % 7 + 1);

  return now >= dstStart && now < dstEnd;
}

// Maps US state names and abbreviations to base UTC offset (winter / standard time)
const US_STATE_TIMEZONES: Record<string, number> = {
  // Eastern UTC-5 (winter)
  Maine: -5, "New Hampshire": -5, Vermont: -5, Massachusetts: -5,
  "Rhode Island": -5, Connecticut: -5, "New York": -5, "New Jersey": -5,
  Pennsylvania: -5, Delaware: -5, Maryland: -5, Virginia: -5,
  "West Virginia": -5, "North Carolina": -5, "South Carolina": -5,
  Georgia: -5, Florida: -5, Ohio: -5, Michigan: -5, Indiana: -5,
  Kentucky: -5, Tennessee: -5,
  ME: -5, NH: -5, VT: -5, MA: -5, RI: -5, CT: -5, NY: -5, NJ: -5,
  PA: -5, DE: -5, MD: -5, VA: -5, WV: -5, NC: -5, SC: -5,
  GA: -5, FL: -5, OH: -5, MI: -5, IN: -5, KY: -5, TN: -5,

  // Central UTC-6 (winter)
  Wisconsin: -6, Illinois: -6, Minnesota: -6, Iowa: -6, Missouri: -6,
  Arkansas: -6, Louisiana: -6, Mississippi: -6, Alabama: -6,
  "North Dakota": -6, "South Dakota": -6, Nebraska: -6, Kansas: -6,
  Oklahoma: -6, Texas: -6,
  WI: -6, IL: -6, MN: -6, IA: -6, MO: -6, AR: -6, LA: -6, MS: -6, AL: -6,
  ND: -6, SD: -6, NE: -6, KS: -6, OK: -6, TX: -6,

  // Mountain UTC-7 (winter)
  Montana: -7, Idaho: -7, Wyoming: -7, Colorado: -7, "New Mexico": -7,
  Utah: -7,
  MT: -7, ID: -7, WY: -7, CO: -7, NM: -7, UT: -7,

  // Pacific UTC-8 (winter)
  Washington: -8, Oregon: -8, California: -8, Nevada: -8,
  WA: -8, OR: -8, CA: -8, NV: -8,

  // Alaska UTC-9 (winter)
  Alaska: -9, AK: -9,

  // Hawaii UTC-10 (no DST)
  Hawaii: -10, HI: -10,

  // Arizona UTC-7 (no DST)
  Arizona: -7, AZ: -7,
};

// States that do NOT observe DST
const NO_DST_STATES = new Set(["Hawaii", "HI", "Arizona", "AZ"]);

// Base UTC offsets for countries (winter / standard time)
const COUNTRY_TIMEZONES: Record<string, number> = {
  "United States": -5,   // State lookup fallback
  "United States of America": -5,
  USA: -5,
  US: -5,
  "United Kingdom": 0,
  UK: 0,
  England: 0,
  "Great Britain": 0,
  Canada: -5,            // Eastern as default
  Australia: 10,
  Germany: 1,
  France: 1,
  Netherlands: 1,
  India: 5.5,
  Pakistan: 5,
  UAE: 4,
  "United Arab Emirates": 4,
  Singapore: 8,
  China: 8,
  Japan: 9,
  "South Korea": 9,
  Brazil: -3,
  Mexico: -6,
  "New Zealand": 12,
  "South Africa": 2,
  Sweden: 1,
  Norway: 1,
  Denmark: 1,
  Finland: 2,
  Italy: 1,
  Spain: 1,
  Portugal: 0,
  Poland: 1,
  Switzerland: 1,
  Belgium: 1,
  Austria: 1,
  Turkey: 3,
  Israel: 2,
  "Saudi Arabia": 3,
  Egypt: 2,
  Nigeria: 1,
  Kenya: 3,
  "Hong Kong": 8,
  Taiwan: 8,
  Indonesia: 7,
  Philippines: 8,
  Vietnam: 7,
  Thailand: 7,
  Malaysia: 8,
};

// Countries that observe DST (European Summer Time, etc.)
const DST_COUNTRIES = new Set([
  "United Kingdom", "UK", "England", "Great Britain",
  "Germany", "France", "Netherlands", "Sweden", "Norway", "Denmark",
  "Italy", "Spain", "Belgium", "Austria", "Switzerland", "Poland", "Finland",
  "Canada",
]);

const US_COUNTRY_NAMES = new Set(["United States", "United States of America", "USA", "US", "U.S.A.", "U.S."]);

function isUSDST(): boolean { return isDSTActive(); }
function isEuropeanDST(): boolean { return isDSTActive(); } // close enough for scheduling

export function getTimezoneOffset(state: string, country: string): number {
  const stateTrimmed  = (state  ?? "").trim();
  const countryTrimmed = (country ?? "").trim();

  const isUS = !countryTrimmed || US_COUNTRY_NAMES.has(countryTrimmed);

  if (isUS && stateTrimmed) {
    const baseOffset = US_STATE_TIMEZONES[stateTrimmed];
    if (baseOffset !== undefined) {
      if (NO_DST_STATES.has(stateTrimmed)) return baseOffset;
      return isUSDST() ? baseOffset + 1 : baseOffset;
    }
  }

  if (isUS) return isUSDST() ? -4 : -5; // Default Eastern

  const countryBase = COUNTRY_TIMEZONES[countryTrimmed];
  if (countryBase !== undefined) {
    if (DST_COUNTRIES.has(countryTrimmed)) {
      return isEuropeanDST() ? countryBase + 1 : countryBase;
    }
    return countryBase;
  }

  return isUSDST() ? -4 : -5; // Ultimate fallback: Eastern
}

export function getTimezoneLabel(state: string, country: string): string {
  const stateTrimmed   = (state  ?? "").trim();
  const countryTrimmed = (country ?? "").trim();
  const offset = getTimezoneOffset(stateTrimmed, countryTrimmed);

  const isUS = !countryTrimmed || US_COUNTRY_NAMES.has(countryTrimmed);
  if (isUS && stateTrimmed) {
    const base = US_STATE_TIMEZONES[stateTrimmed];
    if (base === -5 || base === -4) return `US Eastern (UTC${offset >= 0 ? "+" : ""}${offset})`;
    if (base === -6 || base === -5) return `US Central (UTC${offset >= 0 ? "+" : ""}${offset})`;
    if (base === -7) {
      if (NO_DST_STATES.has(stateTrimmed)) return `US Arizona (UTC-7)`;
      return `US Mountain (UTC${offset >= 0 ? "+" : ""}${offset})`;
    }
    if (base === -8 || base === -7) return `US Pacific (UTC${offset >= 0 ? "+" : ""}${offset})`;
    if (base === -9 || base === -8) return `US Alaska (UTC${offset >= 0 ? "+" : ""}${offset})`;
    if (base === -10) return `US Hawaii (UTC-10)`;
  }

  const sign = offset >= 0 ? "+" : "";
  if (!countryTrimmed || isUS) return `US Eastern (UTC${sign}${offset})`;
  return `${countryTrimmed} (UTC${sign}${offset})`;
}

// Returns the next UTC datetime when target_hour occurs in the given timezone on a weekday
export function getOptimalSendTime(
  state: string,
  country: string,
  target_hour = 9
): string {
  const offset = getTimezoneOffset(state, country);
  const now = new Date();

  // What UTC hour corresponds to target_hour local?
  // local = UTC + offset  →  UTC = local - offset
  const targetUtcHour = target_hour - offset;

  const candidate = new Date(now);
  candidate.setUTCHours(targetUtcHour, 0, 0, 0);

  // If that time has already passed today, move to tomorrow
  if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);

  // Skip weekends (UTC date)
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate.toISOString();
}

export interface LeadTimezoneInput {
  city?: string | null;
  state?: string | null;
  company?: string | null;
  country?: string | null;
}

export interface LeadTimezoneResult {
  timezone_offset: number;
  timezone_label: string;
  timezone_detected: number; // 1 if we found a real match, 0 if default
}

export function detectLeadTimezone(lead: LeadTimezoneInput): LeadTimezoneResult {
  const state   = lead.state   ?? "";
  const country = lead.country ?? "";

  const isUS = !country || US_COUNTRY_NAMES.has(country.trim());

  // If we have a US state, we have a reliable match
  if (isUS && state.trim() && US_STATE_TIMEZONES[state.trim()] !== undefined) {
    return {
      timezone_offset: getTimezoneOffset(state, country),
      timezone_label: getTimezoneLabel(state, country),
      timezone_detected: 1,
    };
  }

  // If we have a non-US country with a known mapping
  if (!isUS && country.trim() && COUNTRY_TIMEZONES[country.trim()] !== undefined) {
    return {
      timezone_offset: getTimezoneOffset(state, country),
      timezone_label: getTimezoneLabel(state, country),
      timezone_detected: 1,
    };
  }

  // If country says US but no state → default Eastern, mark as not detected
  if (isUS) {
    const offset = isUSDST() ? -4 : -5;
    return {
      timezone_offset: offset,
      timezone_label: `US Eastern (UTC${offset})`,
      timezone_detected: 0,
    };
  }

  // Unknown country
  const offset = isUSDST() ? -4 : -5;
  return {
    timezone_offset: offset,
    timezone_label: `US Eastern (UTC${offset})`,
    timezone_detected: 0,
  };
}

export function batchDetectTimezones(leads: LeadTimezoneInput[]): (LeadTimezoneInput & LeadTimezoneResult)[] {
  return leads.map((lead) => ({ ...lead, ...detectLeadTimezone(lead) }));
}

// Returns next send Date for a lead given delay_days, timezone offset, and target hour
export function calculateTimezoneAwareSendDate(
  delay_days: number,
  timezone_offset: number,
  optimal_send_hour: number
): Date {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + delay_days);
  base.setUTCHours(0, 0, 0, 0);

  // UTC hour that = optimal_send_hour in their timezone
  const targetUtcHour = optimal_send_hour - timezone_offset;

  const candidate = new Date(base);
  candidate.setUTCHours(targetUtcHour, 0, 0, 0);

  // If that time is already past on base date, push one more day
  if (candidate <= new Date()) candidate.setUTCDate(candidate.getUTCDate() + 1);

  // Skip weekends
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate;
}
