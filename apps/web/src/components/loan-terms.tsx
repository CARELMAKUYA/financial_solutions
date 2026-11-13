"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField, Field, MoneyInput, NativeSelect } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { addMonths, FREQUENCY_LABEL, todaySast } from "@/lib/format";
import type { Frequency, Quote, Settings } from "@/lib/types";

export interface LoanTerms {
  loanAmountCents: number | null;
  initiationFeeCents: number | null;
  /** Percent per year as typed, e.g. "60" or "27.5". */
  ratePercent: string;
  serviceFeeCents: number | null;
  numberOfInstalments: string;
  frequency: Frequency;
  disbursedOn: string;
  firstDueDate: string;
}

export function defaultTerms(): LoanTerms {
  const today = todaySast();
  return {
    loanAmountCents: null,
    initiationFeeCents: null,
    ratePercent: "",
    serviceFeeCents: null,
    numberOfInstalments: "3",
    frequency: "MONTHLY",
    disbursedOn: today,
    firstDueDate: addMonths(today, 1),
  };
}

/** Fills empty rate/fee fields with the business defaults from Settings (once they load). */
export function useSettingsDefaults(setTerms: (fn: (t: LoanTerms) => LoanTerms) => void) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const s = settings.data;
  useEffect(() => {
    if (!s) return;
    setTerms((t) => ({
      ...t,
      ratePercent: t.ratePercent || String(s.defaultAnnualRateBps / 100),
      serviceFeeCents: t.serviceFeeCents ?? s.defaultServiceFeeCents,
      initiationFeeCents: t.initiationFeeCents ?? s.defaultInitiationFeeCents,
    }));
  }, [s, setTerms]);
  return settings;
}

/** Validates terms and turns them into the API's QuoteDto shape, or returns the first problem. */
export function toQuoteDto(t: LoanTerms): { dto: Record<string, unknown> | null; error: string | null } {
  const rate = Number(t.ratePercent);
  const n = Number(t.numberOfInstalments);
  if (!t.loanAmountCents || t.loanAmountCents < 10_000) return { dto: null, error: "Enter a loan amount of at least R 100" };
  if (t.initiationFeeCents === null) return { dto: null, error: "Enter the initiation fee (0 if none)" };
  if (t.ratePercent.trim() === "" || !Number.isFinite(rate) || rate < 0 || rate > 1000) return { dto: null, error: "Enter the interest rate as a percentage per year" };
  if (t.serviceFeeCents === null) return { dto: null, error: "Enter the service fee per instalment (0 if none)" };
  if (!Number.isInteger(n) || n < 1 || n > 120) return { dto: null, error: "Number of instalments must be between 1 and 120" };
  if (!t.disbursedOn) return { dto: null, error: "Enter the disbursement date" };
  if (!t.firstDueDate) return { dto: null, error: "Enter the first due date" };
  if (t.firstDueDate <= t.disbursedOn) return { dto: null, error: "The first due date must be after the disbursement date" };
  return {
    error: null,
    dto: {
      loanAmountCents: t.loanAmountCents,
      initiationFeeCents: t.initiationFeeCents,
      annualRateBps: Math.round(rate * 100),
      serviceFeeCents: t.serviceFeeCents,
      numberOfInstalments: n,
      frequency: t.frequency,
      disbursedOn: t.disbursedOn,
      firstDueDate: t.firstDueDate,
    },
  };
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Live quote from the backend (same schedule engine the loan will use), debounced. */
export function useQuote(terms: LoanTerms) {
  const { dto, error } = toQuoteDto(terms);
  const key = useDebounced(dto ? JSON.stringify(dto) : null, 300);
  const quote = useQuery({
    queryKey: ["quote", key],
    queryFn: () => api.post<Quote>("/loans/quote", JSON.parse(key!)),
    enabled: key !== null,
    placeholderData: (prev) => prev,
    retry: false,
  });
  return { quote, dto, validationError: error };
}

export function LoanTermsFields({
  terms,
  onChange,
  maxDisbursedOn,
  firstDueHint,
}: {
  terms: LoanTerms;
  onChange: (t: LoanTerms) => void;
  maxDisbursedOn?: string;
  firstDueHint?: React.ReactNode;
}) {
  const set = <K extends keyof LoanTerms>(k: K) => (v: LoanTerms[K]) => onChange({ ...terms, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Loan amount" htmlFor="t-amount" required hint="Cash paid out to the client">
        <MoneyInput id="t-amount" value={terms.loanAmountCents} onChange={set("loanAmountCents")} />
      </Field>
      <Field label="Initiation fee" htmlFor="t-init" required hint="Added to the principal debt">
        <MoneyInput id="t-init" value={terms.initiationFeeCents} onChange={set("initiationFeeCents")} />
      </Field>
      <Field label="Interest rate (% per year)" htmlFor="t-rate" required>
        <div className="relative">
          <Input id="t-rate" inputMode="decimal" className="pr-8 tabular-nums" value={terms.ratePercent} onChange={(e) => set("ratePercent")(e.target.value.replace(",", "."))} />
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">%</span>
        </div>
      </Field>
      <Field label="Service fee per instalment" htmlFor="t-fee" required>
        <MoneyInput id="t-fee" value={terms.serviceFeeCents} onChange={set("serviceFeeCents")} />
      </Field>
      <Field label="Number of instalments" htmlFor="t-n" required>
        <Input id="t-n" inputMode="numeric" value={terms.numberOfInstalments} onChange={(e) => set("numberOfInstalments")(e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="Repayment frequency" htmlFor="t-freq">
        <NativeSelect id="t-freq" value={terms.frequency} onChange={(e) => set("frequency")(e.target.value as Frequency)}>
          {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Disbursement date" htmlFor="t-disb" required>
        <DateField id="t-disb" value={terms.disbursedOn} onChange={set("disbursedOn")} max={maxDisbursedOn} />
      </Field>
      <Field label="First due date" htmlFor="t-first" required hint={firstDueHint}>
        <DateField id="t-first" value={terms.firstDueDate} onChange={set("firstDueDate")} min={terms.disbursedOn} />
      </Field>
    </div>
  );
}
