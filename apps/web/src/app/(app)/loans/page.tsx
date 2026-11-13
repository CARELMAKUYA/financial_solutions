"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { RecordPaymentButton } from "@/components/record-payment";
import { EmptyState, ErrorState, LoadingRows, LoanStatusBadge, PageHeader } from "@/components/shared";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, qs } from "@/lib/api";
import { formatDate, formatRand, PRODUCT_LABEL } from "@/lib/format";
import type { Loan } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "active", label: "Active", params: { status: "ACTIVE" } },
  { key: "arrears", label: "In arrears", params: { status: "ACTIVE", arrears: "true" } },
  { key: "settled", label: "Fully paid", params: { status: "SETTLED" } },
  { key: "all", label: "All", params: {} },
] as const;

export default function LoansPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("active");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search);
  const params = TABS.find((t) => t.key === tab)!.params;
  const loans = useQuery({
    queryKey: ["loans", tab, q],
    queryFn: () => api.get<Loan[]>(`/loans${qs({ ...params, search: q })}`),
  });
  const totals = (loans.data ?? []).reduce((s, l) => ({ outstanding: s.outstanding + l.totalOutstandingCents, arrears: s.arrears + l.arrearsCents }), { outstanding: 0, arrears: 0 });

  return (
    <>
      <PageHeader
        title="Loans"
        description="Every loan issued, with live balances from the recorded repayments."
        actions={
          <Link href="/loans/new" className={buttonVariants({ variant: "gold" })}>
            <Plus /> Issue loan
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex w-fit gap-1 rounded-lg border bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={cn("rounded-md px-3 py-1 text-sm font-medium", tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search reference, client name or ID number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {loans.data && loans.data.length > 0 && (
          <p className="text-sm text-muted-foreground sm:ml-auto">
            {loans.data.length} loan{loans.data.length === 1 ? "" : "s"} · {formatRand(totals.outstanding)} outstanding
            {totals.arrears > 0 && <span className="text-rose-700 dark:text-rose-400"> · {formatRand(totals.arrears)} in arrears</span>}
          </p>
        )}
      </div>
      <ErrorState error={loans.error} />
      <Card className="py-0">
        <CardContent className="px-0">
          {loans.isPending ? (
            <div className="p-4">
              <LoadingRows />
            </div>
          ) : !loans.data?.length ? (
            <div className="p-4">
              <EmptyState>No loans to show.</EmptyState>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Reference</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Disbursed</TableHead>
                  <TableHead className="text-right">Loan amount</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Arrears</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.data.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/loans/${l.id}`} className="hover:underline">
                        {l.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {l.client && (
                        <Link href={`/clients/${l.client.id}`} className="hover:underline">
                          {l.client.firstName} {l.client.lastName}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{PRODUCT_LABEL[l.product]}</TableCell>
                    <TableCell className="tabular-nums">{formatDate(l.disbursedOn)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(l.loanAmountCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(l.totalOutstandingCents)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", l.arrearsCents > 0 && "font-semibold text-rose-700 dark:text-rose-400")}>
                      {l.arrearsCents > 0 ? formatRand(l.arrearsCents) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {l.nextDueDate ? (
                        <>
                          {formatDate(l.nextDueDate)}
                          <div className="text-xs text-muted-foreground">{formatRand(l.nextDueCents)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <LoanStatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">{l.status === "ACTIVE" && <RecordPaymentButton loanId={l.id} size="sm" variant="outline" label="Record" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
