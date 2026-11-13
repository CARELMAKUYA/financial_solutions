"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, FileDown, Landmark, Paperclip, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DateField, Detail, Field, MoneyInput, Spinner } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime, formatRand, METHOD_LABEL, openFile, todaySast } from "@/lib/format";
import type { LoanDetail, Payment, PaymentMethod, PaymentPreview } from "@/lib/types";
import { cn } from "@/lib/utils";

const METHODS: { value: PaymentMethod; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "CASH", icon: Banknote },
  { value: "EFT", icon: Wallet },
  { value: "BANK_DEPOSIT", icon: Landmark },
];

const MAX_FILE = 10 * 1024 * 1024;

type Step = "form" | "confirm" | "done";

/**
 * Prominent "Record payment" button + dialog. Usable anywhere a loan id is known
 * (loan profile, calendar, overdue list).
 */
export function RecordPaymentButton({
  loanId,
  size = "lg",
  label = "Record payment",
  className,
  variant = "gold",
}: {
  loanId: string;
  size?: "sm" | "default" | "lg";
  label?: string;
  className?: string;
  variant?: "gold" | "outline" | "default";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        <Banknote /> {label}
      </Button>
      {open && <RecordPaymentDialog loanId={loanId} open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function RecordPaymentDialog({ loanId, open, onOpenChange }: { loanId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  // One key per opening of the form: retries and double-clicks can't record the payment twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [openedAt] = useState(() => new Date().toISOString());
  const today = todaySast();

  const loan = useQuery({ queryKey: ["loan", loanId], queryFn: () => api.get<LoanDetail>(`/loans/${loanId}`) });

  const [step, setStep] = useState<Step>("form");
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [paymentDate, setPaymentDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [requireVerification, setRequireVerification] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [saved, setSaved] = useState<{ payment: Payment; proofFailed?: string } | null>(null);

  const formError = (() => {
    if (!amountCents || amountCents <= 0) return "Enter the amount received";
    if (!paymentDate) return "Enter the date the money was received";
    if (paymentDate > today) return "The payment date can't be in the future";
    if (!method) return "Choose how the client paid";
    if (file && file.size > MAX_FILE) return "The proof of payment must be 10 MB or smaller";
    return null;
  })();

  const previewM = useMutation({
    mutationFn: () => api.post<PaymentPreview>(`/loans/${loanId}/payments/preview`, { amountCents, paymentDate, method, requireVerification }),
    meta: { silent: true },
    onSuccess: (p) => {
      setPreview(p);
      setConfirmDuplicate(false);
      setStep("confirm");
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const recordM = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ payment: Payment; alreadyRecorded: boolean }>(`/loans/${loanId}/payments`, {
        amountCents,
        paymentDate,
        method,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        idempotencyKey,
        confirmDuplicate: confirmDuplicate || undefined,
        requireVerification: requireVerification || undefined,
      });
      let proofFailed: string | undefined;
      if (file && !r.alreadyRecorded) {
        const fd = new FormData();
        fd.append("file", file);
        try {
          await api.post(`/payments/${r.payment.id}/proof`, fd);
        } catch (e) {
          proofFailed = e instanceof Error ? e.message : "Upload failed";
        }
      }
      return { ...r, proofFailed };
    },
    meta: { silent: true },
    onSuccess: (r) => {
      setSaved({ payment: r.payment, proofFailed: r.proofFailed });
      setStep("done");
      setError(null);
      if (r.alreadyRecorded) toast.info(`This payment was already recorded as ${r.payment.transactionNumber}.`);
      else toast.success(`Payment ${r.payment.transactionNumber} recorded`);
      void queryClient.invalidateQueries();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.body.code === "POSSIBLE_DUPLICATE") {
        setConfirmDuplicate(false);
        void previewM.mutateAsync();
      }
      setError(e.message);
    },
  });

  const l = loan.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !recordM.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {step === "form" ? "Record payment" : step === "confirm" ? "Confirm payment" : "Payment recorded"}
          </DialogTitle>
          <DialogDescription>
            {step === "form"
              ? "Only record money that has actually been received. Balances and statuses update automatically."
              : step === "confirm"
                ? "Check the details and how the payment will be applied before saving."
                : "The loan, schedule, calendar and reports have been updated."}
          </DialogDescription>
        </DialogHeader>

        {!l ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Spinner className="size-5" />
          </div>
        ) : step === "form" ? (
          <form
            id="record-payment-form"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (formError) return setError(formError);
              previewM.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-x-6 rounded-lg border bg-muted/40 p-3">
              <Detail label="Client">{`${l.client.firstName} ${l.client.lastName}`}</Detail>
              <Detail label="Loan">{l.reference}</Detail>
              <Detail label="Outstanding balance">{formatRand(l.settlementQuote.totalCents)}</Detail>
              <Detail label="Scheduled instalment">{formatRand(l.nextDueCents || l.instalmentCents)}</Detail>
              {l.arrearsCents > 0 && (
                <Detail label="In arrears" className="text-rose-700 dark:text-rose-400">
                  {formatRand(l.arrearsCents)}
                </Detail>
              )}
              <Detail label="Recorded at">{formatDateTime(openedAt)}</Detail>
            </div>
            {l.status !== "ACTIVE" && (
              <Alert>
                <AlertTriangle />
                <AlertTitle>This loan is {l.status === "SETTLED" ? "already fully paid" : l.status.toLowerCase().replace("_", " ")}</AlertTitle>
                <AlertDescription>Any payment recorded now will be held as an overpayment for review.</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount received" htmlFor="pay-amount" required>
                <MoneyInput id="pay-amount" value={amountCents} onChange={setAmountCents} />
              </Field>
              <Field label="Actual payment date" htmlFor="pay-date" required hint={paymentDate < today ? "Backdated: balances will be recalculated from this date" : undefined}>
                <DateField id="pay-date" value={paymentDate} onChange={setPaymentDate} max={today} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              {[l.nextDueCents, l.arrearsCents, l.settlementQuote.totalCents]
                .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
                .map((v) => (
                  <Button key={v} type="button" size="xs" variant="outline" onClick={() => setAmountCents(v)}>
                    {v === l.settlementQuote.totalCents ? "Settle in full" : v === l.arrearsCents ? "Arrears" : "Next instalment"} · {formatRand(v)}
                  </Button>
                ))}
            </div>

            <div className="grid gap-1.5">
              <Label>
                Payment method<span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-3 gap-2" role="radiogroup">
                {METHODS.map(({ value, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={method === value}
                    onClick={() => setMethod(value)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-sm font-medium transition-colors",
                      method === value ? "border-gold bg-gold-soft text-foreground ring-2 ring-gold/40" : "hover:bg-muted",
                    )}
                  >
                    <Icon className="size-5" />
                    {METHOD_LABEL[value]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Payment reference" htmlFor="pay-ref" hint="Optional: bank or deposit slip reference">
                <Input id="pay-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Field label="Proof of payment" htmlFor="pay-proof" hint="Optional: PDF or photo, up to 10 MB">
                <label
                  htmlFor="pay-proof"
                  className="flex h-8 cursor-pointer items-center gap-2 truncate rounded-lg border border-input px-2.5 text-sm text-muted-foreground hover:bg-muted"
                >
                  <Paperclip className="size-4 shrink-0" />
                  <span className="truncate">{file ? file.name : "Attach file"}</span>
                </label>
                <input
                  id="pay-proof"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Field>
            </div>
            <Field label="Notes" htmlFor="pay-notes">
              <Textarea id="pay-notes" rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={requireVerification} onCheckedChange={(v) => setRequireVerification(v === true)} className="mt-0.5" />
              <span>
                Needs verification before it counts
                <span className="block text-xs text-muted-foreground">e.g. an EFT you haven&apos;t seen on the bank statement yet. It won&apos;t reduce the balance until verified.</span>
              </span>
            </label>
          </form>
        ) : step === "confirm" && preview ? (
          <div className="grid gap-4">
            <div className="rounded-lg border p-3">
              <Detail label="Client">{preview.clientName}</Detail>
              <Detail label="Loan">{preview.loanReference}</Detail>
              <Detail label="Amount received" className="text-base">
                {formatRand(amountCents)}
              </Detail>
              <Detail label="Payment date">{formatDate(paymentDate)}</Detail>
              <Detail label="Method">{method && METHOD_LABEL[method]}</Detail>
              {reference && <Detail label="Reference">{reference}</Detail>}
              {file && <Detail label="Proof of payment">{file.name}</Detail>}
            </div>

            <div className="rounded-lg border border-gold/50 bg-gold-soft/50 p-3">
              <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">How it will be applied</p>
              {preview.needsVerification ? (
                <p className="text-sm">Saved as awaiting verification. It will be applied when verified.</p>
              ) : (
                <>
                  <Detail label="Interest">{formatRand(preview.allocation.interestCents)}</Detail>
                  <Detail label="Fees and charges">{formatRand(preview.allocation.feesCents)}</Detail>
                  <Detail label="Principal">{formatRand(preview.allocation.principalCents)}</Detail>
                  {preview.allocation.overpaymentCents > 0 && (
                    <Detail label="Overpayment (held for review)" className="text-amber-700 dark:text-amber-400">
                      {formatRand(preview.allocation.overpaymentCents)}
                    </Detail>
                  )}
                  {preview.allocation.instalments.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Towards instalment{preview.allocation.instalments.length > 1 ? "s" : ""}{" "}
                      {preview.allocation.instalments.map((i) => `#${i.seq} (${formatRand(i.amountCents)})`).join(", ")}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-6 rounded-lg border p-3">
              <Detail label="Balance now">{formatRand(preview.currentBalanceCents)}</Detail>
              <Detail label="Balance after">{formatRand(preview.needsVerification ? preview.currentBalanceCents : preview.balanceAfterCents)}</Detail>
              <Detail label="Arrears now">{formatRand(preview.arrearsCents)}</Detail>
              <Detail label="Arrears after">{formatRand(preview.needsVerification ? preview.arrearsCents : preview.arrearsAfterCents)}</Detail>
            </div>
            {preview.settles && !preview.needsVerification && (
              <Alert className="border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                <CheckCircle2 />
                <AlertTitle>This payment settles the loan</AlertTitle>
                <AlertDescription>The loan will be marked Fully Paid and its reminders will stop.</AlertDescription>
              </Alert>
            )}
            {preview.warnings.map((w) => (
              <Alert key={w}>
                <AlertTriangle />
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}
            {preview.duplicates.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
                <p className="font-medium">Already recorded on this date:</p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {preview.duplicates.map((d) => (
                    <li key={d.id}>
                      {d.transactionNumber}: {formatRand(d.amountCents)} by {METHOD_LABEL[d.method]}
                      {d.reference ? `, ref ${d.reference}` : ""}, recorded {formatDateTime(d.recordedAt)}
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex items-center gap-2 font-medium">
                  <Checkbox checked={confirmDuplicate} onCheckedChange={(v) => setConfirmDuplicate(v === true)} />
                  This is a separate payment, not a duplicate
                </label>
              </div>
            )}
          </div>
        ) : saved ? (
          <div className="grid gap-4">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="size-10 text-emerald-600" />
              <p className="text-lg font-semibold">{formatRand(saved.payment.amountCents)} recorded</p>
              <p className="text-sm text-muted-foreground">
                {saved.payment.transactionNumber}
                {saved.payment.status === "PENDING_VERIFICATION" ? " · awaiting verification" : ""}
              </p>
            </div>
            {saved.proofFailed && (
              <Alert variant="destructive">
                <AlertTitle>The payment was saved, but the proof of payment didn&apos;t upload</AlertTitle>
                <AlertDescription>{saved.proofFailed}. You can attach it again from the loan&apos;s payment history.</AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          {step === "form" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" form="record-payment-form" variant="gold" disabled={previewM.isPending || !l}>
                {previewM.isPending && <Spinner />} Review payment
              </Button>
            </>
          )}
          {step === "confirm" && (
            <>
              <Button variant="outline" onClick={() => setStep("form")} disabled={recordM.isPending}>
                <ArrowLeft /> Edit
              </Button>
              <Button variant="gold" onClick={() => recordM.mutate()} disabled={recordM.isPending || (preview!.duplicates.length > 0 && !confirmDuplicate)}>
                {recordM.isPending && <Spinner />} Confirm and save
              </Button>
            </>
          )}
          {step === "done" && saved && (
            <>
              <Button variant="outline" onClick={() => openFile(`/payments/${saved.payment.id}/receipt.pdf`)}>
                <FileDown /> Receipt
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
