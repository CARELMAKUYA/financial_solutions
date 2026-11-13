import { registerDecorator, ValidationOptions } from 'class-validator';
import { DateOnly, isDateOnly } from './dates';
import type { Tx } from './audit.service';

/** Validates a `YYYY-MM-DD` calendar date. */
export function IsDateOnly(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isDateOnly',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a date in YYYY-MM-DD format`, ...options },
      validator: { validate: (value: unknown) => isDateOnly(value) },
    });
}

/** South African ID number: 13 digits, valid date of birth and Luhn check digit. */
export function isSaIdNumber(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const yy = id.slice(0, 2);
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0 && yy.length === 2;
}

export function IsSaIdNumber(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isSaIdNumber',
      target: object.constructor,
      propertyName,
      options: { message: 'Enter a valid 13-digit South African ID number', ...options },
      validator: { validate: (value: unknown) => typeof value === 'string' && isSaIdNumber(value) },
    });
}

/** Normalises SA phone numbers to +27XXXXXXXXX. Returns null if it doesn't look like one. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`;
  if (/^\+27\d{9}$/.test(digits)) return digits;
  if (/^27\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

/**
 * Next number in a named sequence, e.g. nextNumber(tx, 'loan', 'TQL-2026-', 5) → TQL-2026-00042.
 * The UPSERT row lock serialises concurrent callers, so numbers are unique and gap-free per transaction.
 */
export async function nextNumber(tx: Tx, name: string, prefix: string, width: number): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters (name, value) VALUES (${name}, 1)
    ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  return `${prefix}${String(rows[0].value).padStart(width, '0')}`;
}

/** Locks a loan row for the rest of the transaction so concurrent writes to one loan queue up. */
export async function lockLoan(tx: Tx, loanId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM loans WHERE id = ${loanId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

/** R 1 234.50 */
export function formatRand(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const [whole, frac] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${sign}R ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`;
}

/** YYYY-MM-DD → DD/MM/YYYY */
export function formatDate(d: DateOnly | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

export function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d).replace(',', '');
}

export const METHOD_LABEL = { CASH: 'Cash', EFT: 'EFT', BANK_DEPOSIT: 'Bank deposit' } as const;
export const PRODUCT_LABEL = { SHORT_TERM: 'Short-term financial assistance', SALARY_ADVANCE: 'Salary advance', EMERGENCY_CASH: 'Emergency cash assistance' } as const;
export const FREQUENCY_LABEL = { MONTHLY: 'Monthly', FORTNIGHTLY: 'Fortnightly', WEEKLY: 'Weekly' } as const;
