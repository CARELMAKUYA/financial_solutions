"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDown, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DateField, Detail, EmptyState, ErrorState, Field, LoadingRows, MoneyInput, NativeSelect, PageHeader, PaymentStatusBadge, Spinner } from "@/components/shared";
import { VerifyPaymentActions } from "@/components/verify-payment";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, qs } from "@/lib/api";
import { useCanCorrect } from "@/lib/auth";
import { formatDate, formatDateTime, formatRand, METHOD_LABEL, openFile, todaySast } from "@/lib/format";
import type { PaymentListItem, PaymentMethod } from "@/lib/types";

type Tab = "all" | "verify" | "overpayments" | "reversed";

function overpaidCents(p: PaymentListItem) {
  return p.allocations.filter((a) => a.component === "OVERPAYMENT").reduce((s, a) => s + a.amountCents, 0);
}

function ResolveOverpayment({ payment }: { payment: PaymentListItem }) {
  const [open, setOpen] = useState(false);
  const over = overpaidCents(payment);
  const [resolution, setResolution] = useState("");
  const [refundCents, setRefundCents] = useState<number | null>(over || null);
  const [refundDate, setRefundDate] = useState(todaySast());
  const [refund, setRefund] = useState(true);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/payments/${payment.id}/overpayment`, {
        resolution: resolution.trim(),
        refundCents: refund && refundCents ? refundCents : undefined,
        refundDate: refund && refundCents ? refundDate : undefined,
      }),
    onSuccess: () => {
      toast.success("Overpayment resolved");
      setOpen(false);
    },
  });
  const invalid = resolution.trim().length < 5 || (refund && (!refundCents || refundCents <= 0));
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Resolve
      </Button>
      <Dialog open={open} onOpenChange={(o) => !m.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve overpayment</DialogTitle>
            <DialogDescription>
              {payment.transactionNumber} on {payment.loan.reference} paid {formatRand(over)} more than was owed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} className="size-4 accent-[var(--gold)]" />
              The excess was refunded to the client
            </label>
            {refund && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Refund amount" htmlFor="ref-amt" required>
                  <MoneyInput id="ref-amt" value={refundCents} onChange={setRefundCents} />
                </Field>
                <Field label="Refund date" htmlFor="ref-date" required>
                  <DateField id="ref-date" value={refundDate} onChange={setRefundDate} max={todaySast()} />
                </Field>
              </div>
            )}
            <Field label="How it was resolved" htmlFor="ref-note" required hint="e.g. Refunded by EFT, ref 12345">
              <Textarea id="ref-note" rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={m.isPending}>
              Cancel
            </Button>
            <Button variant="gold" onClick={() => m.mutate()} disabled={m.isPending || invalid}>
              {m.isPending && <Spinner />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PaymentsPage() {
  const canCorrect = useCanCorrect();
  const urlParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (["all", "verify", "overpayments", "reversed"] as const).find((t) => t === urlParams.get("tab")) ?? "all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [search, setSearch] = useState("");

  const params = {
    from: from || undefined,
    to: to || undefined,
    method: method || undefined,
    search: search.trim() || undefined,
    status: tab === "verify" ? "PENDING_VERIFICATION" : tab === "reversed" ? "REVERSED" : undefined,
    overpayments: tab === "overpayments" ? "true" : undefined,
  };
  const q = useQuery({ queryKey: ["payments", params], queryFn: () => api.get<PaymentListItem[]>(`/payments${qs(params)}`) });
  const pendingCount = useQuery({
    queryKey: ["payments", "pending-count"],
    queryFn: () => api.get<PaymentListItem[]>(`/payments${qs({ status: "PENDING_VERIFICATION" })}`),
  }).data?.length;

  const rows = q.data ?? [];
  const counted = rows.filter((p) => p.status === "CONFIRMED");
  const total = counted.reduce((s, p) => s + p.amountCents, 0);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every repayment recorded, newest first. Payments are never edited or deleted: corrections are made by reversal on the loan."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="all">All payments</TabsTrigger>
          <TabsTrigger value="verify">Awaiting verification{pendingCount ? ` (${pendingCount})` : ""}</TabsTrigger>
          <TabsTrigger value="overpayments">Overpayments to review</TabsTrigger>
          <TabsTrigger value="reversed">Reversed</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_10rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Transaction, reference, loan or client" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <DateField value={from} onChange={setFrom} />
        <DateField value={to} onChange={setTo} />
        <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | "")} aria-label="Method">
          <option value="">All methods</option>
          {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {(from || to) && <p className="-mt-2 mb-3 text-xs text-muted-foreground">Filtering by payment date {from ? `from ${formatDate(from)}` : ""} {to ? `to ${formatDate(to)}` : ""}</p>}

      {tab === "verify" && (
        <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          These payments are recorded but do not reduce any balance until verified. Check each against the bank statement or cash box.
        </p>
      )}

      <ErrorState error={q.error} />
      {q.isPending ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState>{tab === "verify" ? "No payments are awaiting verification." : tab === "overpayments" ? "No overpayments need review." : "No payments match."}</EmptyState>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transaction</TableHead>
                <TableHead>Paid on</TableHead>
                <TableHead className="hidden lg:table-cell">Recorded</TableHead>
                <TableHead>Client / loan</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="hidden md:table-cell">Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Recorded by</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.transactionNumber}</TableCell>
                  <TableCell>{formatDate(p.paymentDate)}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatDateTime(p.recordedAt)}</TableCell>
                  <TableCell>
                    <div>
                      {p.loan.client.firstName} {p.loan.client.lastName}
                    </div>
                    <Link href={`/loans/${p.loan.id}`} className="text-xs text-muted-foreground hover:underline">
                      {p.loan.reference}
                    </Link>
                  </TableCell>
                  <TableCell>{METHOD_LABEL[p.method]}</TableCell>
                  <TableCell className="hidden max-w-32 truncate md:table-cell">{p.reference ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatRand(p.amountCents)}
                    {p.overpaymentFlag && overpaidCents(p) > 0 && <div className="text-xs text-amber-700 dark:text-amber-400">{formatRand(overpaidCents(p))} over</div>}
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{p.recordedByName}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {p.status === "PENDING_VERIFICATION" && <VerifyPaymentActions payment={p} clientName={`${p.loan.client.firstName} ${p.loan.client.lastName}`} />}
                      {tab === "overpayments" && canCorrect && <ResolveOverpayment payment={p} />}
                      <Button size="icon-sm" variant="ghost" aria-label="Receipt" onClick={() => openFile(`/payments/${p.id}/receipt.pdf`)}>
                        <FileDown />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {tab !== "reversed" && (
            <div className="border-t px-4 py-3">
              <Detail label={`Confirmed total (${counted.length} shown)`}>{formatRand(total)}</Detail>
            </div>
          )}
        </Card>
      )}
      {tab === "overpayments" && !canCorrect && rows.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">Only administrators authorised for corrections can resolve overpayments.</p>
      )}
    </>
  );
}
