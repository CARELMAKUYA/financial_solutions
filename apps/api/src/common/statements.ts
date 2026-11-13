import { BadRequestException } from '@nestjs/common';
import type { Tx } from './audit.service';
import type { DateOnly } from './dates';

/** A calendar month, YYYY-MM. */
export type Month = string;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function shiftMonth(month: Month, by: number): Month {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Every month from `from` to `to`, inclusive. */
export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to && out.length < 240; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** The `count` full calendar months before the month of `asOf`, oldest first. */
export function requiredMonths(asOf: DateOnly, count: number): Month[] {
  const current = asOf.slice(0, 7);
  return Array.from({ length: count }, (_, i) => shiftMonth(current, i - count));
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (m: Month) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export interface StatementCheck {
  /** The date the requirement is measured from (application date, or disbursement date for a direct loan). */
  asOf: DateOnly;
  required: Month[];
  missing: Month[];
  complete: boolean;
}

export function checkCoverage(asOf: DateOnly, count: number, statements: { periodFrom: string | null; periodTo: string | null }[]): StatementCheck {
  const covered = new Set<Month>();
  for (const s of statements) if (s.periodFrom && s.periodTo) for (const m of monthsBetween(s.periodFrom, s.periodTo)) covered.add(m);
  const required = requiredMonths(asOf, count);
  const missing = required.filter((m) => !covered.has(m));
  return { asOf, required, missing, complete: missing.length === 0 };
}

export async function statementCheck(db: Tx, clientId: string, asOf: DateOnly, count: number): Promise<StatementCheck> {
  const statements = await db.loanDocument.findMany({
    where: { clientId, kind: 'BANK_STATEMENT', periodFrom: { not: null } },
    select: { periodFrom: true, periodTo: true },
  });
  return checkCoverage(asOf, count, statements);
}

export async function requireStatements(db: Tx, clientId: string, asOf: DateOnly, count: number, action: string) {
  if (count <= 0) return;
  const check = await statementCheck(db, clientId, asOf, count);
  if (!check.complete) {
    throw new BadRequestException(
      `Bank statements are needed before ${action}. Still missing: ${check.missing.map(monthLabel).join(', ')}. Upload them on the client's profile.`,
    );
  }
}

/** How many months of statements are required (Settings; 3 if settings haven't been created yet). */
export async function requiredStatementCount(db: Tx): Promise<number> {
  const s = await db.settings.findUnique({ where: { id: 1 }, select: { requiredStatementMonths: true } });
  return s?.requiredStatementMonths ?? 3;
}
