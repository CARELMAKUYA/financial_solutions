import type {
  ApplicationStatus,
  DocumentKind,
  FollowUpOutcome,
  Frequency,
  InstalmentStatus,
  LoanAdjustmentKind,
  LoanStatus,
  PaymentMethod,
  PaymentStatus,
  ProductType,
} from "./types";

export const TIME_ZONE = "Africa/Johannesburg";

/** R 1 234.50 */
export function formatRand(cents: number | null | undefined, opts: { whole?: boolean } = {}) {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "-" : "";
  const [whole, frac] = (Math.abs(cents) / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return opts.whole && frac === "00" ? `${sign}R ${grouped}` : `${sign}R ${grouped}.${frac}`;
}

/** Parses "1 234.50", "1234,50" or "R1234" into cents. Returns null if invalid. */
export function parseRand(input: string): number | null {
  const cleaned = input.replace(/[Rr\s]/g, "").replace(",", ".");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** "2750" basis points → "27.50%" */
export function formatRate(bps: number) {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
}

/** YYYY-MM-DD (or an ISO timestamp) → DD/MM/YYYY */
export function formatDate(date: string | null | undefined) {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** First 10 characters of a date or ISO timestamp. */
export function day(date: string | null | undefined) {
  return date ? date.slice(0, 10) : "";
}

/** DD/MM/YYYY → YYYY-MM-DD, or null if invalid. */
export function parseDate(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? iso : null;
}

/** ISO timestamp → "30/10/2026 14:05" in SAST */
export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

export function todaySast() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

export function startOfMonth(date: string) {
  return `${date.slice(0, 7)}-01`;
}

/** Adds months, clamping to month end (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function endOfMonth(date: string) {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

export function startOfWeek(date: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthName(date: string) {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** The next date on or after `from` that falls on the given day of the month (clamped to month end). */
export function nextPayday(from: string, payday: number) {
  for (let i = 0; i < 2; i++) {
    const month = addMonths(startOfMonth(from), i);
    const last = Number(endOfMonth(month).slice(8, 10));
    const candidate = `${month.slice(0, 8)}${String(Math.min(payday, last)).padStart(2, "0")}`;
    if (candidate >= from) return candidate;
  }
  return addMonths(from, 1);
}

/** +27821234567 → +27 82 123 4567 */
export function formatPhone(phone: string | null | undefined) {
  if (!phone) return "—";
  const m = phone.match(/^\+27(\d{2})(\d{3})(\d{4})$/);
  return m ? `+27 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

export function whatsappLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export const PRODUCT_LABEL: Record<ProductType, string> = {
  SHORT_TERM: "Short-term assistance",
  SALARY_ADVANCE: "Salary advance",
  EMERGENCY_CASH: "Emergency cash",
};

export const FREQUENCY_LABEL: Record<Frequency, string> = { MONTHLY: "Monthly", FORTNIGHTLY: "Fortnightly", WEEKLY: "Weekly" };

export const METHOD_LABEL: Record<PaymentMethod, string> = { CASH: "Cash", EFT: "EFT", BANK_DEPOSIT: "Bank deposit" };

export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  ACTIVE: "Active",
  SETTLED: "Fully paid",
  CANCELLED: "Cancelled",
  WRITTEN_OFF: "Written off",
};

export const INSTALMENT_STATUS_LABEL: Record<InstalmentStatus, string> = {
  UPCOMING: "Upcoming",
  DUE_TODAY: "Due today",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  RESCHEDULED: "Rescheduled",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING_VERIFICATION: "Awaiting verification",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  REVERSED: "Reversed",
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  ISSUED: "Loan issued",
};

export const ADJUSTMENT_LABEL: Record<LoanAdjustmentKind, string> = {
  FEE_CHARGE: "Fee or charge",
  INTEREST_WAIVER: "Interest waiver",
  FEE_WAIVER: "Fee waiver",
  PRINCIPAL_WRITE_OFF: "Principal write-off",
  OVERPAYMENT_REFUND: "Overpayment refund",
};

export const OUTCOME_LABEL: Record<FollowUpOutcome, string> = {
  NOTE: "Note",
  NO_ANSWER: "No answer",
  SPOKE_TO_CLIENT: "Spoke to client",
  PROMISE_TO_PAY: "Promise to pay",
  PAYMENT_CLAIMED: "Client says they paid",
  CONFIRMED_MISSED: "Confirmed missed",
};

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  CONTRACT: "Loan agreement",
  ID_DOCUMENT: "ID document",
  PAYSLIP: "Payslip",
  BANK_STATEMENT: "Bank statement",
  PROOF_OF_PAYMENT: "Proof of payment",
  OTHER: "Other",
};

export const RECORDING_STATUS_LABEL = {
  NOT_RECORDED: "No payment recorded",
  PROMISE_TO_PAY: "Promise to pay",
  CONFIRMED_MISSED: "Confirmed missed",
  AWAITING_VERIFICATION: "Payment awaiting verification",
} as const;

const tone = {
  gold: "bg-gold-soft text-amber-900 border-gold/50 dark:text-amber-200",
  green: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  amber: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  red: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
  blue: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  grey: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  violet: "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800",
};

/** Same colours everywhere: badges, calendar events, schedule rows. */
export const INSTALMENT_STATUS_COLOR: Record<InstalmentStatus, string> = {
  UPCOMING: tone.blue,
  DUE_TODAY: tone.gold,
  PARTIALLY_PAID: tone.amber,
  PAID: tone.green,
  OVERDUE: tone.red,
  RESCHEDULED: `${tone.grey} line-through`,
};

export const LOAN_STATUS_COLOR: Record<LoanStatus, string> = {
  ACTIVE: tone.blue,
  SETTLED: tone.green,
  CANCELLED: tone.grey,
  WRITTEN_OFF: tone.violet,
};

export const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  PENDING_VERIFICATION: tone.amber,
  CONFIRMED: tone.green,
  REJECTED: tone.red,
  REVERSED: `${tone.grey} line-through`,
};

export const APPLICATION_STATUS_COLOR: Record<ApplicationStatus, string> = {
  PENDING: tone.amber,
  APPROVED: tone.blue,
  DECLINED: tone.red,
  WITHDRAWN: tone.grey,
  ISSUED: tone.green,
};

export const RECORDING_STATUS_COLOR = {
  NOT_RECORDED: tone.grey,
  PROMISE_TO_PAY: tone.blue,
  CONFIRMED_MISSED: tone.red,
  AWAITING_VERIFICATION: tone.amber,
} as const;

/** Opens a PDF/CSV from the API in a new tab (same-origin, so the session cookie goes with it). */
export function openFile(path: string) {
  window.open(`/api${path}`, "_blank", "noopener");
}

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** "2026-08" → "Aug 2026" */
export function formatMonth(m: string): string {
  return `${SHORT_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

/** A statement period: "Aug 2026", "Aug – Oct 2026" or "Nov 2025 – Jan 2026". */
export function formatPeriod(from: string, to: string): string {
  if (from === to) return formatMonth(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${SHORT_MONTHS[Number(from.slice(5, 7)) - 1]} – ${formatMonth(to)}`;
  return `${formatMonth(from)} – ${formatMonth(to)}`;
}
