"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field, MoneyInput, NativeSelect, Spinner } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { METHOD_LABEL } from "@/lib/format";
import type { PaymentMethod, Settings } from "@/lib/types";

const COMPONENT_LABEL = { INTEREST: "Interest", FEES: "Fees and charges", PRINCIPAL: "Principal" } as const;
const NCA_ORDER = ["INTEREST", "FEES", "PRINCIPAL"] as const;

export type SettingsSection = "business" | "payments" | "reminders";

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={(v) => onChange(v)} disabled={disabled} />
    </label>
  );
}

/** Business details, payment rules and reminders. Owners edit; everyone else sees them read-only. */
export function SettingsForm({ settings, section, canEdit }: { settings: Settings; section: SettingsSection; canEdit: boolean }) {
  const [s, setS] = useState<Settings>(settings);
  const [rateText, setRateText] = useState((settings.defaultMonthlyRateBps / 100).toString());
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const disabled = !canEdit;

  const save = useMutation({
    mutationFn: () => {
      const rate = Math.round(parseFloat(rateText.replace(",", ".")) * 100);
      if (Number.isNaN(rate) || rate < 0) throw new Error("Enter a valid interest rate");
      const body: Partial<Settings> =
        section === "business"
          ? { companyName: s.companyName, tagline: s.tagline, ncrRegistrationNumber: s.ncrRegistrationNumber, address: s.address, phone: s.phone, email: s.email, bankDetails: s.bankDetails }
          : section === "payments"
            ? {
                allocationOrder: s.allocationOrder,
                inDuplum: s.inDuplum,
                verifyMethods: s.verifyMethods,
                defaultMonthlyRateBps: rate,
                chargeFullTermInterest: s.chargeFullTermInterest,
                defaultServiceFeeCents: s.defaultServiceFeeCents,
                defaultInitiationFeeCents: s.defaultInitiationFeeCents,
                requiredStatementMonths: s.requiredStatementMonths,
              }
            : {
                reminderDaysBefore: s.reminderDaysBefore,
                remindDueSoon: s.remindDueSoon,
                remindDueToday: s.remindDueToday,
                remindDayAfter: s.remindDayAfter,
                overdueRepeatDays: s.overdueRepeatDays,
                dailySummary: s.dailySummary,
                weeklySummary: s.weeklySummary,
                reminderHour: s.reminderHour,
                emailEnabled: s.emailEnabled,
              };
      return api.put<Settings>("/settings", body);
    },
    onSuccess: () => toast.success("Settings saved"),
  });

  const move = (i: number, dir: -1 | 1) => {
    const next = [...s.allocationOrder];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    set("allocationOrder", next);
  };
  const isNca = s.allocationOrder.join() === NCA_ORDER.join();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canEdit) save.mutate();
      }}
    >
      <Card>
        {section === "business" && (
          <>
            <CardHeader>
              <CardTitle>Business details</CardTitle>
              <CardDescription>Shown on receipts, statements and settlement letters.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" htmlFor="s-name">
                <Input id="s-name" value={s.companyName} disabled={disabled} onChange={(e) => set("companyName", e.target.value)} />
              </Field>
              <Field label="Tagline" htmlFor="s-tag">
                <Input id="s-tag" value={s.tagline} disabled={disabled} onChange={(e) => set("tagline", e.target.value)} />
              </Field>
              <Field label="NCR registration number" htmlFor="s-ncr" hint="Printed on statements and letters">
                <Input id="s-ncr" value={s.ncrRegistrationNumber} disabled={disabled} onChange={(e) => set("ncrRegistrationNumber", e.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="s-phone">
                <Input id="s-phone" value={s.phone} disabled={disabled} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="s-email">
                <Input id="s-email" type="email" value={s.email} disabled={disabled} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Address" htmlFor="s-addr" className="sm:col-span-2">
                <Textarea id="s-addr" rows={2} value={s.address} disabled={disabled} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="Bank details for repayments" htmlFor="s-bank" className="sm:col-span-2" hint="Bank, account number, branch code and the reference clients should use">
                <Textarea id="s-bank" rows={3} value={s.bankDetails} disabled={disabled} onChange={(e) => set("bankDetails", e.target.value)} />
              </Field>
            </CardContent>
          </>
        )}

        {section === "payments" && (
          <>
            <CardHeader>
              <CardTitle>Payment rules</CardTitle>
              <CardDescription>How recorded payments are applied. Changes apply when each loan is next recalculated.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-2">
                <p className="text-sm font-medium">Payment allocation order</p>
                <p className="text-xs text-muted-foreground">
                  The National Credit Act (s126(3)) requires each payment to be credited first to interest, then to fees and charges, then to principal. Only change this if your loan
                  agreements and legal advice say otherwise.
                </p>
                <ol className="grid max-w-sm gap-1.5">
                  {s.allocationOrder.map((c, i) => (
                    <li key={c} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                      <span className="flex size-5 items-center justify-center rounded-full bg-gold text-[11px] font-semibold text-gold-foreground">{i + 1}</span>
                      <span className="flex-1">{COMPONENT_LABEL[c]}</span>
                      <Button type="button" size="icon-xs" variant="ghost" aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button type="button" size="icon-xs" variant="ghost" aria-label="Move down" disabled={disabled || i === s.allocationOrder.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </Button>
                    </li>
                  ))}
                </ol>
                {!isNca && (
                  <Alert className="max-w-xl">
                    <AlertTitle>This differs from the National Credit Act default</AlertTitle>
                    <AlertDescription>
                      <button type="button" className="underline" disabled={disabled} onClick={() => set("allocationOrder", [...NCA_ORDER])}>
                        Restore interest → fees → principal
                      </button>
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <Toggle
                label="In duplum limit"
                hint="While a loan is in arrears, unpaid interest and fees stop growing once they equal the unpaid principal (NCA s103(5))."
                checked={s.inDuplum}
                onChange={(v) => set("inDuplum", v)}
                disabled={disabled}
              />

              <Toggle
                label="Charge the full term's interest on early settlement"
                hint="On: a client who settles early still pays interest for every month of the term. Off: they pay only the interest of instalments already due. NCA s125 generally limits early settlement to interest up to the settlement date, so check this with your compliance adviser."
                checked={s.chargeFullTermInterest}
                onChange={(v) => set("chargeFullTermInterest", v)}
                disabled={disabled}
              />

              <div className="grid gap-2">
                <p className="text-sm font-medium">Require verification for</p>
                <p className="text-xs text-muted-foreground">Payments by these methods are saved as &quot;awaiting verification&quot; and don&apos;t reduce the balance until someone verifies them.</p>
                <div className="flex flex-wrap gap-4">
                  {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--gold)]"
                        disabled={disabled}
                        checked={s.verifyMethods.includes(m)}
                        onChange={(e) => set("verifyMethods", e.target.checked ? [...s.verifyMethods, m] : s.verifyMethods.filter((x) => x !== m))}
                      />
                      {METHOD_LABEL[m]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Default interest rate (% per month)" htmlFor="s-rate">
                  <Input id="s-rate" inputMode="decimal" value={rateText} disabled={disabled} onChange={(e) => setRateText(e.target.value)} />
                </Field>
                <Field label="Default service fee (per instalment)" htmlFor="s-fee">
                  <MoneyInput id="s-fee" value={s.defaultServiceFeeCents} disabled={disabled} onChange={(v) => set("defaultServiceFeeCents", v ?? 0)} />
                </Field>
                <Field label="Default initiation fee" htmlFor="s-init">
                  <MoneyInput id="s-init" value={s.defaultInitiationFeeCents} disabled={disabled} onChange={(v) => set("defaultInitiationFeeCents", v ?? 0)} />
                </Field>
              </div>
              <p className="-mt-3 text-xs text-muted-foreground">Defaults pre-fill new loans and the calculator. Check them against the current NCA limits on interest and fees.</p>

              <Field
                label="Bank statements required"
                htmlFor="s-statements"
                className="sm:max-w-xs"
                hint="Full calendar months of bank statements a client must supply before an application is approved or a loan issued."
              >
                <NativeSelect id="s-statements" value={s.requiredStatementMonths} disabled={disabled} onChange={(e) => set("requiredStatementMonths", Number(e.target.value))}>
                  <option value={0}>Not required</option>
                  {[1, 2, 3, 4, 5, 6, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} month{n === 1 ? "" : "s"}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </CardContent>
          </>
        )}

        {section === "reminders" && (
          <>
            <CardHeader>
              <CardTitle>Reminders</CardTitle>
              <CardDescription>Created automatically by the server each morning, even when nobody is signed in. Each reminder is created only once.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Send reminders from" htmlFor="s-hour" hint="South African time">
                  <NativeSelect id="s-hour" value={s.reminderHour} disabled={disabled} onChange={(e) => set("reminderHour", Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Remind this many days before" htmlFor="s-before">
                  <Input id="s-before" type="number" min={1} max={14} value={s.reminderDaysBefore} disabled={disabled} onChange={(e) => set("reminderDaysBefore", Number(e.target.value))} />
                </Field>
                <Field label="Repeat overdue reminder every" htmlFor="s-repeat" hint="Days; 0 = only the day after">
                  <Input id="s-repeat" type="number" min={0} max={60} value={s.overdueRepeatDays} disabled={disabled} onChange={(e) => set("overdueRepeatDays", Number(e.target.value))} />
                </Field>
              </div>
              <div className="mt-2 divide-y">
                <Toggle label={`${s.reminderDaysBefore} days before a payment is due`} checked={s.remindDueSoon} onChange={(v) => set("remindDueSoon", v)} disabled={disabled} />
                <Toggle label="On the due date" checked={s.remindDueToday} onChange={(v) => set("remindDueToday", v)} disabled={disabled} />
                <Toggle label="The day after an unpaid due date" hint="Then repeated at the interval above until paid" checked={s.remindDayAfter} onChange={(v) => set("remindDayAfter", v)} disabled={disabled} />
                <Toggle label="Daily overdue summary" hint="Every morning" checked={s.dailySummary} onChange={(v) => set("dailySummary", v)} disabled={disabled} />
                <Toggle label="Weekly collection summary" hint="Every Monday" checked={s.weeklySummary} onChange={(v) => set("weeklySummary", v)} disabled={disabled} />
                <Toggle label="Also send by email" hint="One digest email per run to administrators who have emails switched on" checked={s.emailEnabled} onChange={(v) => set("emailEnabled", v)} disabled={disabled} />
              </div>
              {s.emailEnabled && !settings.smtpConfigured && (
                <Alert variant="destructive">
                  <AlertTitle>Email isn&apos;t set up on the server</AlertTitle>
                  <AlertDescription>Set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM in the API&apos;s environment, or reminders will only appear in the dashboard.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </>
        )}

        {canEdit ? (
          <div className="flex justify-end border-t px-4 pt-4">
            <Button type="submit" variant="gold" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Save />} Save changes
            </Button>
          </div>
        ) : (
          <p className="border-t px-4 pt-4 text-sm text-muted-foreground">Only the owner can change these settings.</p>
        )}
      </Card>
    </form>
  );
}
