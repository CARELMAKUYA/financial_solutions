"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DateField, Detail, Field, MoneyInput, NativeSelect, Spinner } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  ADJUSTMENT_LABEL,
  addDays,
  DOCUMENT_LABEL,
  formatDate,
  formatRand,
  FREQUENCY_LABEL,
  METHOD_LABEL,
  nextPayday,
  OUTCOME_LABEL,
  todaySast,
} from "@/lib/format";
import { StatementPeriodFields, suggestedPeriod } from "@/components/bank-statements";
import type { DocumentKind, FollowUpOutcome, Frequency, Instalment, LoanAdjustmentKind, LoanDetail, LoanPayment, PaymentMethod, Quote } from "@/lib/types";

type DialogProps = { open: boolean; onOpenChange: (o: boolean) => void };

function ReasonField({ value, onChange, label = "Reason", hint }: { value: string; onChange: (v: string) => void; label?: string; hint?: string }) {
  return (
    <Field label={label} htmlFor="reason" required hint={hint ?? "Recorded in the audit trail."}>
      <Textarea id="reason" rows={3} value={value} maxLength={1000} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

const validReason = (r: string) => r.trim().length >= 5;

/** Reverse a confirmed payment (authorised administrators). The original stays on record. */
export function ReversePaymentDialog({ payment, ...p }: DialogProps & { payment: LoanPayment }) {
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/payments/${payment.id}/reverse`, { reason }),
    onSuccess: () => {
      toast.success(`${payment.transactionNumber} reversed`);
      p.onOpenChange(false);
    },
  });
  return (
    <Dialog {...p}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reverse {payment.transactionNumber}</DialogTitle>
          <DialogDescription>
            The payment of {formatRand(payment.amountCents)} on {formatDate(payment.paymentDate)} will stop counting towards the loan. It stays in the history, marked reversed, and the balance and schedule are recalculated.
          </DialogDescription>
        </DialogHeader>
        <ReasonField value={reason} onChange={setReason} hint="Why is this payment being reversed? e.g. bounced, captured on the wrong loan." />
        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!validReason(reason) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Reverse payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Correct amount/date/method/reference: reverses the original and records a linked replacement. */
export function CorrectPaymentDialog({ payment, ...p }: DialogProps & { payment: LoanPayment }) {
  const [amountCents, setAmount] = useState<number | null>(payment.amountCents);
  const [paymentDate, setDate] = useState(payment.paymentDate.slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>(payment.method);
  const [reference, setReference] = useState(payment.reference ?? "");
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/payments/${payment.id}/correct`, { amountCents, paymentDate, method, reference: reference || undefined, reason }),
    onSuccess: () => {
      toast.success(`${payment.transactionNumber} corrected`);
      p.onOpenChange(false);
    },
  });
  const changed = amountCents !== payment.amountCents || paymentDate !== payment.paymentDate.slice(0, 10) || method !== payment.method || reference !== (payment.reference ?? "");
  return (
    <Dialog {...p}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct {payment.transactionNumber}</DialogTitle>
          <DialogDescription>The original is reversed (kept in the history) and a corrected payment linked to it is recorded in one step.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Correct amount" required>
            <MoneyInput value={amountCents} onChange={setAmount} />
          </Field>
          <Field label="Correct payment date" required>
            <DateField value={paymentDate} onChange={setDate} max={todaySast()} />
          </Field>
          <Field label="Method" required>
            <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {(["CASH", "EFT", "BANK_DEPOSIT"] as const).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Reference">
            <Input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <ReasonField value={reason} onChange={setReason} />
        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!changed || !amountCents || !paymentDate || !validReason(reason) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Verify (money confirmed received) or reject (never received) a payment awaiting verification. */
export function VerifyPaymentDialog({ payment, ...p }: DialogProps & { payment: LoanPayment }) {
  const [notes, setNotes] = useState("");
  const m = useMutation({
    mutationFn: (approve: boolean) => api.post(`/payments/${payment.id}/verify`, { approve, notes: notes || undefined }),
    onSuccess: (_d, approve) => {
      toast.success(approve ? `${payment.transactionNumber} verified and applied` : `${payment.transactionNumber} rejected`);
      p.onOpenChange(false);
    },
  });
  return (
    <Dialog {...p}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify {payment.transactionNumber}</DialogTitle>
          <DialogDescription>
            {formatRand(payment.amountCents)} by {METHOD_LABEL[payment.method]} on {formatDate(payment.paymentDate)}
            {payment.reference ? `, reference ${payment.reference}` : ""}. Check the bank statement or cash before verifying.
          </DialogDescription>
        </DialogHeader>
        <Field label="Notes" hint="Required when rejecting.">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="destructive" disabled={!validReason(notes) || m.isPending} onClick={() => m.mutate(false)}>
            Reject: not received
          </Button>
          <Button variant="gold" disabled={m.isPending} onClick={() => m.mutate(true)}>
            {m.isPending && <Spinner />} Verify: money received
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Attach proof of payment to an already recorded payment. */
export function UploadProofButton({ paymentId }: { paymentId: string }) {
  const m = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post(`/payments/${paymentId}/proof`, fd);
    },
    onSuccess: () => toast.success("Proof of payment attached"),
  });
  return (
    <label className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
      {m.isPending ? "Uploading…" : "Attach proof"}
      <input
        type="file"
        className="sr-only"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) m.mutate(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

const ADJ_HELP: Record<LoanAdjustmentKind, string> = {
  FEE_CHARGE: "Adds a permitted fee or charge to the loan (e.g. a default administration charge). It is added to the next instalment.",
  INTEREST_WAIVER: "Reduces interest owed. Counts towards the instalments like a payment.",
  FEE_WAIVER: "Reduces fees owed.",
  PRINCIPAL_WRITE_OFF: "Writes off principal. If nothing is left owing, the loan is marked written off.",
  OVERPAYMENT_REFUND: "Records money refunded to the client from an overpayment. Can't exceed the overpayment held.",
};

export function AdjustmentDialog({ loan, ...p }: DialogProps & { loan: LoanDetail }) {
  const [kind, setKind] = useState<LoanAdjustmentKind>("FEE_CHARGE");
  const [amountCents, setAmount] = useState<number | null>(null);
  const [effectiveDate, setDate] = useState(todaySast());
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.post<{ appliedCents: number }>(`/loans/${loan.id}/adjustments`, { kind, amountCents, effectiveDate, reason }),
    onSuccess: (r) => {
      toast.success(`${ADJUSTMENT_LABEL[kind]} of ${formatRand(r.appliedCents)} applied`);
      p.onOpenChange(false);
    },
  });
  return (
    <Dialog {...p}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Loan adjustment</DialogTitle>
          <DialogDescription>Authorised changes to what the client owes. Every adjustment is audited and can be reversed later.</DialogDescription>
        </DialogHeader>
        <Field label="Type" required hint={ADJ_HELP[kind]}>
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as LoanAdjustmentKind)}>
            {(Object.keys(ADJUSTMENT_LABEL) as LoanAdjustmentKind[]).map((k) => (
              <option key={k} value={k}>
                {ADJUSTMENT_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" required>
            <MoneyInput value={amountCents} onChange={setAmount} />
          </Field>
          <Field label="Effective date" required>
            <DateField value={effectiveDate} onChange={setDate} min={loan.disbursedOn.slice(0, 10)} max={todaySast()} />
          </Field>
        </div>
        <div className="rounded-lg border bg-muted/40 p-2 text-xs">
          Owed today: principal {formatRand(loan.settlementQuote.principalCents)}, interest {formatRand(loan.settlementQuote.interestCents)}, fees {formatRand(loan.settlementQuote.feesCents)}
          {loan.overpaymentCents > 0 ? `, overpayment held ${formatRand(loan.overpaymentCents)}` : ""}.
        </div>
        <ReasonField value={reason} onChange={setReason} />
        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!amountCents || !effectiveDate || !validReason(reason) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Apply adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReverseAdjustmentButton({ loanId, adjustmentId }: { loanId: string; adjustmentId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/loans/${loanId}/adjustments/${adjustmentId}/reverse`, { reason }),
    onSuccess: () => {
      toast.success("Adjustment reversed");
      setOpen(false);
    },
  });
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Reverse
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse adjustment</DialogTitle>
            <DialogDescription>The adjustment stays on record, marked reversed, and the loan is recalculated.</DialogDescription>
          </DialogHeader>
          <ReasonField value={reason} onChange={setReason} />
          <DialogFooter>
            <Button variant="destructive" disabled={!validReason(reason) || m.isPending} onClick={() => m.mutate()}>
              {m.isPending && <Spinner />} Reverse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** New repayment arrangement: replaces all unpaid instalments with a new schedule for the full balance. */
export function ArrangementDialog({ loan, ...p }: DialogProps & { loan: LoanDetail }) {
  const today = todaySast();
  const [frequency, setFrequency] = useState<Frequency>(loan.frequency);
  const [n, setN] = useState(Math.max(1, loan.instalments.filter((i) => !i.supersededOn && i.status !== "PAID").length));
  const [firstDueDate, setFirst] = useState(loan.client.payday ? nextPayday(addDays(today, 1), loan.client.payday) : addDays(today, 30));
  const [reason, setReason] = useState("");
  const valid = n >= 1 && n <= 120 && firstDueDate > today;
  const preview = useQuery({
    queryKey: ["arrangement-preview", loan.id, frequency, n, firstDueDate],
    queryFn: () => api.post<Quote & { balanceCents: number; arrearsCents: number }>(`/loans/${loan.id}/arrangements/preview`, { frequency, numberOfInstalments: n, firstDueDate }),
    enabled: p.open && valid,
    retry: false,
  });
  const m = useMutation({
    mutationFn: () => api.post(`/loans/${loan.id}/arrangements`, { frequency, numberOfInstalments: n, firstDueDate, reason }),
    onSuccess: () => {
      toast.success("New repayment arrangement saved");
      p.onOpenChange(false);
    },
  });
  return (
    <Dialog {...p}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New repayment arrangement</DialogTitle>
          <DialogDescription>
            Replaces every unpaid instalment with a new schedule for the full balance owed today, including arrears. Paid instalments and payment history are kept. Interest not yet due moves to the new dates; no extra interest is added.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Frequency">
            <NativeSelect value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Instalments">
            <Input type="number" min={1} max={120} value={n} onChange={(e) => setN(Number(e.target.value))} />
          </Field>
          <Field label="First due date">
            <DateField value={firstDueDate} onChange={setFirst} min={addDays(today, 1)} />
          </Field>
        </div>
        {preview.data && (
          <div className="rounded-lg border p-3">
            <Detail label="Balance being rescheduled">{formatRand(preview.data.balanceCents)}</Detail>
            <Detail label="of which in arrears">{formatRand(preview.data.arrearsCents)}</Detail>
            <Detail label="New instalment" className="text-base">
              {formatRand(preview.data.instalmentCents)} × {preview.data.instalments.length}
            </Detail>
            <Detail label="Projected total repayable">{formatRand(preview.data.totalRepayableCents)}</Detail>
            <Detail label="Last payment">{formatDate(preview.data.instalments.at(-1)?.dueDate)}</Detail>
          </div>
        )}
        {preview.error && (
          <Alert variant="destructive">
            <AlertDescription>{preview.error.message}</AlertDescription>
          </Alert>
        )}
        <ReasonField value={reason} onChange={setReason} label="Reason and what the client agreed to" />
        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="gold" disabled={!valid || !preview.data || !validReason(reason) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Save arrangement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FollowUpDialog({ loanId, instalment, ...p }: DialogProps & { loanId: string; instalment?: Instalment | null }) {
  const [outcome, setOutcome] = useState<FollowUpOutcome>(instalment ? "NO_ANSWER" : "NOTE");
  const [note, setNote] = useState("");
  const [promiseDate, setPromise] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/loans/${loanId}/follow-ups`, { instalmentId: instalment?.id, outcome, note, promiseDate: promiseDate || undefined }),
    onSuccess: () => {
      toast.success("Follow-up saved");
      p.onOpenChange(false);
    },
  });
  return (
    <Dialog {...p}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Follow-up{instalment ? ` · instalment ${instalment.seq}` : ""}</DialogTitle>
          <DialogDescription>
            {instalment
              ? `Due ${formatDate(instalment.dueDate)}, ${formatRand(instalment.remainingCents)} outstanding. Only mark it "confirmed missed" after checking that no payment was received.`
              : "Add a note to the loan's collection history."}
          </DialogDescription>
        </DialogHeader>
        <Field label="Outcome">
          <NativeSelect value={outcome} onChange={(e) => setOutcome(e.target.value as FollowUpOutcome)}>
            {(Object.keys(OUTCOME_LABEL) as FollowUpOutcome[])
              .filter((o) => instalment || (o !== "CONFIRMED_MISSED" && o !== "PROMISE_TO_PAY"))
              .map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
          </NativeSelect>
        </Field>
        {outcome === "PROMISE_TO_PAY" && (
          <Field label="Promised payment date" required>
            <DateField value={promiseDate} onChange={setPromise} min={todaySast()} />
          </Field>
        )}
        <Field label="Note" required>
          <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button disabled={!note.trim() || (outcome === "PROMISE_TO_PAY" && !promiseDate) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelLoanDialog({ loan, ...p }: DialogProps & { loan: LoanDetail }) {
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/loans/${loan.id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success(`${loan.reference} cancelled`);
      p.onOpenChange(false);
    },
  });
  return (
    <Dialog {...p}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {loan.reference}</DialogTitle>
          <DialogDescription>Only for a loan captured in error and never paid out. A loan with payments can&apos;t be cancelled.</DialogDescription>
        </DialogHeader>
        <ReasonField value={reason} onChange={setReason} />
        <DialogFooter>
          <Button variant="destructive" disabled={!validReason(reason) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Cancel loan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UploadLoanDocument({ loan }: { loan: LoanDetail }) {
  const [kind, setKind] = useState<DocumentKind>("CONTRACT");
  const [period, setPeriod] = useState(() => suggestedPeriod(null));
  const isStatement = kind === "BANK_STATEMENT";
  const m = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      fd.append("loanId", loan.id);
      if (isStatement) {
        if (!period.from || !period.to || period.from > period.to) throw new Error("Choose the months the statement covers");
        fd.append("periodFrom", period.from);
        fd.append("periodTo", period.to);
      }
      return api.post(`/clients/${loan.clientId}/documents`, fd);
    },
    onSuccess: () => toast.success("Document uploaded"),
  });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Document type" className="w-48">
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
          {(Object.keys(DOCUMENT_LABEL) as DocumentKind[]).map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_LABEL[k]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {isStatement && (
        <div className="w-full sm:w-80">
          <StatementPeriodFields idPrefix="ld-period" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
        </div>
      )}
      <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium hover:bg-muted">
        {m.isPending ? <Spinner /> : null} Upload file
        <input
          type="file"
          className="sr-only"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) m.mutate(f);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
