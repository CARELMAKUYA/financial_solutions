"use client";

import { CircleCheck, CircleDashed } from "lucide-react";
import { Field } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { formatDate, formatMonth } from "@/lib/format";
import type { StatementCheck } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The current month in SAST, YYYY-MM. */
export function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

/** The months a new upload most likely covers: what's still missing, else the last three full months. */
export function suggestedPeriod(check: StatementCheck | null | undefined): { from: string; to: string } {
  const months = check?.missing.length ? check.missing : check?.required.length ? check.required : null;
  if (months) return { from: months[0], to: months[months.length - 1] };
  const [y, m] = currentMonth().split("-").map(Number);
  const shift = (by: number) => {
    const i = y * 12 + (m - 1) + by;
    return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  };
  return { from: shift(-3), to: shift(-1) };
}

/** One chip per required month: ticked when a statement covers it. */
export function StatementChecklist({ check, label = true, className }: { check: StatementCheck; label?: boolean; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && (
        <p className="text-sm">
          <span className="font-medium">Bank statements: </span>
          {check.complete ? (
            <span className="text-emerald-700 dark:text-emerald-400">all {check.required.length} months received</span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">
              {check.required.length - check.missing.length} of {check.required.length} months received
            </span>
          )}
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {check.required.map((m) => {
          const have = !check.missing.includes(m);
          return (
            <li
              key={m}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                have
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "border-dashed text-muted-foreground",
              )}
            >
              {have ? <CircleCheck className="size-3.5" /> : <CircleDashed className="size-3.5" />}
              {formatMonth(m)}
              <span className="sr-only">{have ? "received" : "missing"}</span>
            </li>
          );
        })}
      </ul>
      {label && (
        <p className="text-xs text-muted-foreground">The {check.required.length} full months before {formatDate(check.asOf)}. Needed before an application is approved or a loan issued.</p>
      )}
    </div>
  );
}

/** First and last month a bank statement covers. One file covering all three months is fine. */
export function StatementPeriodFields({
  from,
  to,
  onChange,
  idPrefix,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  idPrefix: string;
}) {
  const max = currentMonth();
  const error = from && to && from > to ? "The first month must be before the last month" : null;
  return (
    <div className="grid grid-cols-2 items-start gap-3">
      <Field label="Statement from" htmlFor={`${idPrefix}-from`} error={error}>
        <Input id={`${idPrefix}-from`} type="month" max={max} value={from} required onChange={(e) => onChange(e.target.value, to)} />
      </Field>
      <Field label="Statement to" htmlFor={`${idPrefix}-to`} hint="One file covering several months is fine">
        <Input id={`${idPrefix}-to`} type="month" max={max} value={to} required onChange={(e) => onChange(from, e.target.value)} />
      </Field>
    </div>
  );
}
