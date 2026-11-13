"use client";

import { useMutation } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DateField, Field, NativeSelect, Spinner } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { OUTCOME_LABEL, todaySast } from "@/lib/format";
import type { FollowUpOutcome } from "@/lib/types";

const OUTCOMES = Object.keys(OUTCOME_LABEL) as FollowUpOutcome[];

const HINT: Partial<Record<FollowUpOutcome, string>> = {
  CONFIRMED_MISSED: "Use this only after checking the bank statement and cash: it marks the instalment as confirmed missed, not just unrecorded.",
  PAYMENT_CLAIMED: "Check the bank statement before recording the payment. Don't record it until the money is confirmed.",
  PROMISE_TO_PAY: "Record the date the client promised to pay.",
};

/** Logs a collection follow-up against a loan (and optionally a specific instalment). */
export function FollowUpButton({ loanId, instalmentId, title, size = "sm" }: { loanId: string; instalmentId?: string; title?: string; size?: "xs" | "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<FollowUpOutcome>("SPOKE_TO_CLIENT");
  const [note, setNote] = useState("");
  const [promiseDate, setPromiseDate] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/loans/${loanId}/follow-ups`, { instalmentId, outcome, note: note.trim(), promiseDate: outcome === "PROMISE_TO_PAY" ? promiseDate : undefined }),
    onSuccess: () => {
      toast.success("Follow-up saved");
      setOpen(false);
      setNote("");
      setPromiseDate("");
    },
  });
  const invalid = !note.trim() || (outcome === "PROMISE_TO_PAY" && !promiseDate);
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus /> Follow up
      </Button>
      <Dialog open={open} onOpenChange={(o) => !m.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log a follow-up</DialogTitle>
            {title && <DialogDescription>{title}</DialogDescription>}
          </DialogHeader>
          <form
            id="follow-up-form"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid) m.mutate();
            }}
          >
            <Field label="Outcome" htmlFor="fu-outcome" required>
              <NativeSelect id="fu-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as FollowUpOutcome)}>
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_LABEL[o]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {HINT[outcome] && (
              <Alert>
                <AlertDescription>{HINT[outcome]}</AlertDescription>
              </Alert>
            )}
            {outcome === "PROMISE_TO_PAY" && (
              <Field label="Promised payment date" htmlFor="fu-date" required>
                <DateField id="fu-date" value={promiseDate} onChange={setPromiseDate} min={todaySast()} />
              </Field>
            )}
            <Field label="Note" htmlFor="fu-note" required>
              <Textarea id="fu-note" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={m.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="follow-up-form" variant="gold" disabled={m.isPending || invalid}>
              {m.isPending && <Spinner />} Save follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
