"use client";

import { CalendarIcon, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  APPLICATION_STATUS_COLOR,
  APPLICATION_STATUS_LABEL,
  centsToInput,
  formatDate,
  INSTALMENT_STATUS_COLOR,
  INSTALMENT_STATUS_LABEL,
  LOAN_STATUS_COLOR,
  LOAN_STATUS_LABEL,
  parseDate,
  parseRand,
  PAYMENT_STATUS_COLOR,
  PAYMENT_STATUS_LABEL,
} from "@/lib/format";
import type { ApplicationStatus, InstalmentStatus, LoanStatus, PaymentStatus } from "@/lib/types";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", className)}>
      {label}
    </Badge>
  );
}

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  return <StatusBadge label={LOAN_STATUS_LABEL[status]} className={LOAN_STATUS_COLOR[status]} />;
}

export function InstalmentStatusBadge({ status, partPaid }: { status: InstalmentStatus; partPaid?: boolean }) {
  return <StatusBadge label={status === "OVERDUE" && partPaid ? "Overdue · part-paid" : INSTALMENT_STATUS_LABEL[status]} className={INSTALMENT_STATUS_COLOR[status]} />;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <StatusBadge label={PAYMENT_STATUS_LABEL[status]} className={PAYMENT_STATUS_COLOR[status]} />;
}

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <StatusBadge label={APPLICATION_STATUS_LABEL[status]} className={APPLICATION_STATUS_COLOR[status]} />;
}

export function ToneBadge({ label, className }: { label: string; className: string }) {
  return <StatusBadge label={label} className={className} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Native select styled to match the inputs. Reliable on tablets and phones at the front desk. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none transition-colors",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        "[&>option]:bg-popover [&>option]:text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Date input that always shows DD/MM/YYYY (native date inputs follow the browser's locale),
 * with a calendar button that opens the browser's picker. Value is `YYYY-MM-DD` or "".
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value ? formatDate(value) : "");
  const [invalid, setInvalid] = useState(false);
  const [shownValue, setShownValue] = useState(value);
  const picker = useRef<HTMLInputElement>(null);
  // Re-sync the text when the value changes from outside (e.g. the picker or a parent reset).
  if (value !== shownValue) {
    setShownValue(value);
    setText(value ? formatDate(value) : "");
    setInvalid(false);
  }

  const commit = (raw: string) => {
    if (!raw.trim()) {
      onChange("");
      setInvalid(false);
      return;
    }
    const parsed = parseDate(raw);
    setInvalid(!parsed);
    if (parsed) onChange(parsed);
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={text}
        placeholder="DD/MM/YYYY"
        inputMode="numeric"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (parseDate(e.target.value)) commit(e.target.value);
        }}
        onBlur={(e) => commit(e.target.value)}
        className="pr-9"
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Open calendar"
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50"
        onClick={() => picker.current?.showPicker?.()}
      >
        <CalendarIcon className="size-4" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        value={value}
        min={min}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    </div>
  );
}

/** Rand amount input. Value is in cents (null when empty/invalid). */
export function MoneyInput({
  id,
  value,
  onChange,
  disabled,
  placeholder = "0.00",
}: {
  id?: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? "" : centsToInput(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(value === null ? "" : centsToInput(value));
      last.current = value;
    }
  }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">R</span>
      <Input
        id={id}
        value={text}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
        className="pl-6 tabular-nums"
        onChange={(e) => {
          setText(e.target.value);
          const cents = parseRand(e.target.value);
          last.current = cents;
          onChange(cents);
        }}
      />
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "warn" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-muted-foreground" />}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
          tone === "good" && "text-emerald-700 dark:text-emerald-400",
          tone === "bad" && "text-rose-700 dark:text-rose-400",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function ErrorState({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

/** A label/value row for detail panels. */
export function Detail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-1.5 text-sm", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
