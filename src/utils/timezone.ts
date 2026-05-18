/**
 * US Eastern timezone utilities with automatic DST handling.
 *
 * DST in US Eastern: clocks spring forward on the second Sunday of March
 * and fall back on the first Sunday of November.
 * Eastern Standard Time = UTC-5, Eastern Daylight Time = UTC-4.
 */

function nthSundayOfMonth(year: number, month: number, n: number): Date {
  // month is 0-indexed (0=Jan, 2=Mar, 10=Nov)
  const first = new Date(Date.UTC(year, month, 1));
  const dayOfWeek = first.getUTCDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = 1 + daysUntilSunday;
  return new Date(Date.UTC(year, month, firstSunday + (n - 1) * 7));
}

function getEasternOffsetHours(utcDate: Date): number {
  const year = utcDate.getUTCFullYear();
  // DST starts: second Sunday of March at 2am local (7am UTC-5)
  const dstStart = nthSundayOfMonth(year, 2, 2); // March = month 2
  dstStart.setUTCHours(7, 0, 0, 0);
  // DST ends: first Sunday of November at 2am local (6am UTC-4)
  const dstEnd = nthSundayOfMonth(year, 10, 1); // November = month 10
  dstEnd.setUTCHours(6, 0, 0, 0);

  return utcDate >= dstStart && utcDate < dstEnd ? -4 : -5;
}

/** Convert a UTC Date to US Eastern hours and minutes. */
export function toUSEastern(date: Date): { hours: number; minutes: number; dayOfWeek: number } {
  const offsetHours = getEasternOffsetHours(date);
  const eastern = new Date(date.getTime() + offsetHours * 3_600_000);
  return {
    hours: eastern.getUTCHours(),
    minutes: eastern.getUTCMinutes(),
    dayOfWeek: eastern.getUTCDay(), // 0=Sun, 1=Mon … 6=Sat
  };
}

/** True if right now is Mon–Fri, 8am–6pm US Eastern. */
export function isUSBusinessHours(date: Date = new Date()): boolean {
  const { hours, dayOfWeek } = toUSEastern(date);
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hours >= 8 && hours < 18;
}

/**
 * Returns a Date for the next 8am US Eastern on a weekday.
 * If it is currently before 8am on a weekday, returns today's 8am.
 */
export function getNextUSBusinessStart(from: Date = new Date()): Date {
  const offsetHours = getEasternOffsetHours(from);
  const eastern = new Date(from.getTime() + offsetHours * 3_600_000);

  // Snap to 8am Eastern today (UTC)
  const candidate = new Date(Date.UTC(
    eastern.getUTCFullYear(),
    eastern.getUTCMonth(),
    eastern.getUTCDate(),
    8 - offsetHours, // convert 8am Eastern back to UTC hours
    0, 0, 0
  ));

  // If we're past 8am today, start from tomorrow
  if (from >= candidate) candidate.setUTCDate(candidate.getUTCDate() + 1);

  // Advance past weekends
  while (true) {
    const dow = new Date(candidate.getTime() + offsetHours * 3_600_000).getUTCDay();
    if (dow >= 1 && dow <= 5) break;
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate;
}

/**
 * Weighted random reply delay mimicking human email behaviour.
 * 40% → 5–15 min, 35% → 15–60 min, 25% → 1–4 hours.
 * Returns milliseconds.
 */
export function randomBusinessDelay(): number {
  const roll = Math.random();
  if (roll < 0.40) {
    // Quick check: 5–15 minutes
    return (5 + Math.random() * 10) * 60_000;
  } else if (roll < 0.75) {
    // Normal: 15–60 minutes
    return (15 + Math.random() * 45) * 60_000;
  } else {
    // Busy: 1–4 hours
    return (60 + Math.random() * 180) * 60_000;
  }
}
