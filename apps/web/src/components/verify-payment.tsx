"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Detail, Field, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatDate, formatRand, METHOD_LABEL } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

interface PendingPayment {
  id: string;
  transactionNumber: string;
  amountCents: number;
  paymentDate: string;
  method: PaymentMethod;
  reference: string | null;
}

/** Verify / Reject buttons for a payment awaiting verification. Rejecting needs a reason. */
export function VerifyPaymentActions({ payment, clientName }: { payment: PendingPayment; clientName?: string }) {
  const [mode, setMode] = useState<"verify" | "reject" | null>(null);
  const [notes, setNotes] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/payments/${payment.id}/verify`, { approve: mode === "verify", notes: notes.trim() || undefined }),
    onSuccess: () => {
      toast.success(mode === "verify" ? `${payment.transactionNumber} verified and applied` : `${payment.transactionNumber} rejected`);
      setMode(null);
      setNotes("");
    },
  });
  const rejectInvalid = mode === "reject" && notes.trim().length < 5;
  return (
    <>
      <div className="flex gap-1">
        <Button size="xs" variant="outline" onClick={() => setMode("verify")}>
          <Check /> Verify
        </Button>
        <Button size="xs" variant="destructive" onClick={() => setMode("reject")}>
          <X /> Reject
        </Button>
      </div>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && !m.isPending && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "verify" ? "Verify payment" : "Reject payment"}</DialogTitle>
            <DialogDescription>
              {mode === "verify"
                ? "Confirm the money is in the bank or cash box. The payment will then reduce the loan balance."
                : "The payment will be marked as not received. It will never count towards the balance and can't be reinstated."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border p-3">
            <Detail label="Transaction">{payment.transactionNumber}</Detail>
            {clientName && <Detail label="Client">{clientName}</Detail>}
            <Detail label="Amount">{formatRand(payment.amountCents)}</Detail>
            <Detail label="Payment date">{formatDate(payment.paymentDate)}</Detail>
            <Detail label="Method">{METHOD_LABEL[payment.method]}</Detail>
            {payment.reference && <Detail label="Reference">{payment.reference}</Detail>}
          </div>
          <Field label={mode === "reject" ? "Reason" : "Notes"} htmlFor="verify-notes" required={mode === "reject"} hint={mode === "reject" ? "At least 5 characters" : "Optional, e.g. where you saw it"}>
            <Textarea id="verify-notes" rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={m.isPending}>
              Cancel
            </Button>
            <Button variant={mode === "verify" ? "gold" : "destructive"} onClick={() => m.mutate()} disabled={m.isPending || rejectInvalid}>
              {m.isPending && <Spinner />}
              {mode === "verify" ? "Verify payment" : "Reject payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
