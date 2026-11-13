/** Calendar-date helpers. All business dates are `YYYY-MM-DD` strings in SAST. Pure, no Nest/Prisma. */

export const TIME_ZONE = 'Africa/Johannesburg';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date as `YYYY-MM-DD`. */
export type DateOnly = string;

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Today's date in SAST. */
export function todaySast(now: Date = new Date()): DateOnly {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Current hour (0-23) and weekday (0 = Sunday) in SAST. */
export function sastClock(now: Date = new Date()): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  return { hour, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd) };
}

/** `YYYY-MM-DD` → UTC-midnight Date, which is what Prisma uses for `@db.Date`. */
export function toDbDate(value: DateOnly): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function fromDbDate(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: DateOnly, days: number): DateOnly {
  const d = toDbDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: DateOnly, to: DateOnly): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);
}

/**
 * Adds months keeping the day of month where possible, clamping to the month's last day
 * (31 Jan + 1 month = 28/29 Feb). `anchorDay` keeps the original day across short months.
 */
export function addMonths(value: DateOnly, months: number, anchorDay?: number): DateOnly {
  const [y, m, d] = value.split('-').map(Number);
  const day = anchorDay ?? d;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function startOfMonth(value: DateOnly): DateOnly {
  return `${value.slice(0, 7)}-01`;
}

/** Monday of the week containing `value`. */
export function startOfWeek(value: DateOnly): DateOnly {
  const dow = toDbDate(value).getUTCDay();
  return addDays(value, dow === 0 ? -6 : 1 - dow);
}

export function minDate(a: DateOnly, b: DateOnly): DateOnly {
  return a < b ? a : b;
}
