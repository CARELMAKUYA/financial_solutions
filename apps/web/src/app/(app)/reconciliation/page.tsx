"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Banknote, CheckCircle2, FileDown, Landmark, Paperclip, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { DateField, Detail, EmptyState, ErrorState, Field, LoadingRows, MoneyInput, PageHeader, PaymentStatusBadge, Spinner } from "@/components/shared";
import { VerifyPaymentActions } from "@/components/verify-payment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, qs } from "@/lib/api";
import { formatDate, formatDateTime, formatRand, METHOD_LABEL, openFile, todaySast } from "@/lib/format";
import type { PaymentMethod, ReconciliationDay } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICON: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = { CASH: Banknote, EFT: Wallet, BANK_DEPOSIT: Landmark };
const ACTUAL_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash counted",
  EFT: "EFTs on bank statement",
  BANK_DEPOSIT: "Deposits on bank statement",
};

function Variance({ cents }: { cents: number }) {
  return (
    <span className={cn("font-semibold tabular-nums", cents === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
      {cents === 0 ? "Balanced" : `${cents > 0 ? "+" : ""}${formatRand(cents)}`}
    </span>
  );
}

function MethodCard({ date, m }: { date: string; m: ReconciliationDay["methods"][number] }) {
  const [actual, setActual] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const Icon = ICON[m.method];
  const save = useMutation({
    mutationFn: () => api.post(`/reconciliation`, { date, method: m.method, actualCents: actual, notes: notes.trim() || undefined }),
    onSuccess: () => {
      toast.success(`${METHOD_LABEL[m.method]} reconciled for ${formatDate(date)}`);
      setActual(null);
      setNotes("");
    },
  });
  const preview = actual === null ? null : actual - m.confirmedCents;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-gold" /> {METHOD_LABEL[m.method]}
        </CardTitle>
        <CardDescription>{m.count} payment{m.count === 1 ? "" : "s"} recorded</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="rounded-lg border p-3">
          <Detail label="Recorded (confirmed)">{formatRand(m.confirmedCents)}</Detail>
          {m.pendingCents > 0 && (
            <Detail label="Awaiting verification" className="text-amber-700 dark:text-amber-400">
              {formatRand(m.pendingCents)}
            </Detail>
          )}
          {m.latest ? (
            <>
              <Detail label="Last reconciled actual">{formatRand(m.latest.actualCents)}</Detail>
              <Detail label="Variance">
                <Variance cents={m.latest.varianceCents} />
              </Detail>
              <p className="pt-1 text-xs text-muted-foreground">
                By {m.latest.reconciledBy}, {formatDateTime(m.latest.createdAt)}
                {m.latest.recordedCents !== m.confirmedCents && " · recorded total has changed since; reconcile again"}
              </p>
            </>
          ) : (
            <p className="pt-1 text-xs text-muted-foreground">Not reconciled yet.</p>
          )}
        </div>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (actual !== null) save.mutate();
          }}
        >
          <Field label={ACTUAL_LABEL[m.method]} htmlFor={`act-${m.method}`}>
            <MoneyInput id={`act-${m.method}`} value={actual} onChange={setActual} />
          </Field>
          {preview !== null && (
            <p className="text-sm">
              Variance: <Variance cents={preview} />
            </p>
          )}
          <Input placeholder="Notes (optional)" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          <Button type="submit" variant="gold" disabled={actual === null || save.isPending}>
            {save.isPending ? <Spinner /> : <CheckCircle2 />} Save reconciliation
          </Button>
        </form>
        {m.history.length > 1 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Earlier entries ({m.history.length - 1})</summary>
            <ul className="mt-2 grid gap-1">
              {m.history.slice(1).map((h) => (
                <li key={h.id} className="flex justify-between gap-2">
                  <span>
                    {formatDateTime(h.createdAt)} · {h.reconciledBy}
                  </span>
                  <span>
                    {formatRand(h.actualCents)} (<Variance cents={h.varianceCents} />)
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReconciliationPage() {
  const today = todaySast();
  const [date, setDate] = useState(today);
  const q = useQuery({ queryKey: ["reconciliation", date], queryFn: () => api.get<ReconciliationDay>(`/reconciliation${qs({ date })}`) });
  const d = q.data;

  return (
    <>
      <PageHeader
        title="Daily reconciliation"
        description="Compare the payments recorded for a day with the cash counted and the bank statement."
        actions={<DateField value={date} onChange={(v) => v && setDate(v)} max={today} className="w-44" />}
      />
      <Alert className="mb-4">
        <AlertDescription>
          Payments marked &quot;awaiting verification&quot; do not affect any loan balance until they are verified. Verify them here once you see the money, or reject them if it never arrived.
        </AlertDescription>
      </Alert>

      <ErrorState error={q.error} />
      {q.isPending || !d ? (
        <LoadingRows />
      ) : (
        <>
          {d.backdatedRecordedToday > 0 && (
            <p className="mb-3 text-sm text-muted-foreground">
              {d.backdatedRecordedToday} payment{d.backdatedRecordedToday === 1 ? " was" : "s were"} recorded on this day for an earlier payment date; they appear under their own payment date.
            </p>
          )}
          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            {d.methods.map((m) => (
              <MethodCard key={`${date}-${m.method}`} date={date} m={m} />
            ))}
          </div>

          <h2 className="mb-2 font-display text-lg font-semibold">Payments dated {formatDate(date)}</h2>
          {d.payments.length === 0 ? (
            <EmptyState>No payments are dated {formatDate(date)}.</EmptyState>
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Client / loan</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="hidden md:table-cell">Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Recorded</TableHead>
                    <TableHead>Proof</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.transactionNumber}</TableCell>
                      <TableCell>
                        <div>
                          {p.loan.client.firstName} {p.loan.client.lastName}
                        </div>
                        <Link href={`/loans/${p.loan.id}`} className="text-xs text-muted-foreground hover:underline">
                          {p.loan.reference}
                        </Link>
                      </TableCell>
                      <TableCell>{METHOD_LABEL[p.method]}</TableCell>
                      <TableCell className="hidden md:table-cell">{p.reference ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatRand(p.amountCents)}</TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {formatDateTime(p.recordedAt)}
                        <br />
                        {p.recordedByName}
                      </TableCell>
                      <TableCell>{p.hasProof ? <Paperclip className="size-4 text-emerald-600" aria-label="Proof attached" /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {p.status === "PENDING_VERIFICATION" && <VerifyPaymentActions payment={p} clientName={`${p.loan.client.firstName} ${p.loan.client.lastName}`} />}
                          <Button size="icon-sm" variant="ghost" aria-label="Receipt" onClick={() => openFile(`/payments/${p.id}/receipt.pdf`)}>
                            <FileDown />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
