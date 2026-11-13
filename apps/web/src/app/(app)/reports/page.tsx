"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, HandCoins, Percent, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DailyBars, ShareBars } from "@/components/report-charts";
import { DateField, EmptyState, ErrorState, LoadingRows, PageHeader, StatCard } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, qs } from "@/lib/api";
import { addDays, addMonths, endOfMonth, formatDate, formatRand, METHOD_LABEL, openFile, PRODUCT_LABEL, startOfMonth, startOfWeek, todaySast } from "@/lib/format";
import type { CollectionsReport, PaymentMethod, PortfolioRow } from "@/lib/types";
import { cn } from "@/lib/utils";

type Preset = "month" | "last" | "week" | "custom";

function rangeFor(p: Preset, today: string): [string, string] {
  if (p === "week") return [startOfWeek(today), today];
  if (p === "last") {
    const s = addMonths(startOfMonth(today), -1);
    return [s, endOfMonth(s)];
  }
  return [startOfMonth(today), today];
}

function Collections() {
  const today = todaySast();
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState<[string, string]>([addDays(today, -30), today]);
  const [from, to] = preset === "custom" ? custom : rangeFor(preset, today);
  const valid = Boolean(from && to && from <= to);

  const q = useQuery({
    queryKey: ["reports", "collections", from, to],
    queryFn: () => api.get<CollectionsReport>(`/reports/collections${qs({ from, to })}`),
    enabled: valid,
  });
  const r = q.data;
  const rate = r && r.dueInPeriodCents > 0 ? Math.round((r.paidTowardsDueCents / r.dueInPeriodCents) * 1000) / 10 : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["month", "This month"],
            ["last", "Last month"],
            ["week", "This week"],
            ["custom", "Custom"],
          ] as [Preset, string][]
        ).map(([k, label]) => (
          <Button key={k} size="sm" variant={preset === k ? "default" : "outline"} onClick={() => setPreset(k)}>
            {label}
          </Button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <DateField value={custom[0]} onChange={(v) => setCustom([v, custom[1]])} max={today} className="w-40" />
            <span className="text-muted-foreground">to</span>
            <DateField value={custom[1]} onChange={(v) => setCustom([custom[0], v])} max={today} className="w-40" />
          </div>
        )}
        <Button size="sm" variant="outline" className="ml-auto" disabled={!valid} onClick={() => openFile(`/reports/collections${qs({ from, to, format: "csv" })}`)}>
          <Download /> CSV
        </Button>
      </div>
      {!valid && <p className="text-sm text-destructive">Choose a start date on or before the end date.</p>}
      <ErrorState error={q.error} />
      {valid && (q.isPending || !r) ? (
        <LoadingRows />
      ) : r ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Collected" value={formatRand(r.totalCents)} sub={`${r.count} payments · ${formatDate(r.from)} – ${formatDate(r.to)}`} icon={HandCoins} />
            <StatCard label="Fell due in period" value={formatRand(r.dueInPeriodCents)} sub="Scheduled instalments" icon={Wallet} />
            <StatCard label="Paid towards those" value={formatRand(r.paidTowardsDueCents)} />
            <StatCard
              label="Collection rate"
              value={rate === null ? "—" : `${rate}%`}
              sub="Paid ÷ due for instalments in the period"
              icon={Percent}
              tone={rate === null ? "default" : rate >= 90 ? "good" : rate >= 70 ? "warn" : "bad"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Collected per day</CardTitle>
              <CardDescription>Confirmed payments by payment date</CardDescription>
            </CardHeader>
            <CardContent>
              <DailyBars from={r.from} to={r.to} data={r.byDay} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>How payments were applied</CardTitle>
              </CardHeader>
              <CardContent>
                <ShareBars
                  rows={[
                    { label: "Interest", cents: r.components.INTEREST },
                    { label: "Fees and charges", cents: r.components.FEES },
                    { label: "Principal", cents: r.components.PRINCIPAL },
                    { label: "Overpayment", cents: r.components.OVERPAYMENT },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>By payment method</CardTitle>
              </CardHeader>
              <CardContent>
                <ShareBars
                  rows={(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => ({
                    label: METHOD_LABEL[m],
                    cents: r.byMethod[m]?.cents ?? 0,
                    sub: `${r.byMethod[m]?.count ?? 0} payments`,
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>By administrator</CardTitle>
              </CardHeader>
              <CardContent>
                {r.byAdmin.length ? (
                  <ShareBars rows={r.byAdmin.map((a) => ({ label: a.name, cents: a.cents, sub: `${a.count} payments` }))} />
                ) : (
                  <p className="text-sm text-muted-foreground">No payments recorded.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="py-0">
            <CardHeader className="pt-4">
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            {r.payments.length === 0 ? (
              <CardContent className="pb-4">
                <EmptyState>No confirmed payments in this period.</EmptyState>
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Client / loan</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Interest</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Fees</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Principal</TableHead>
                    <TableHead className="hidden lg:table-cell">Recorded by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{formatDate(p.paymentDate)}</TableCell>
                      <TableCell className="font-medium">{p.transactionNumber}</TableCell>
                      <TableCell>
                        {p.clientName}
                        <div className="text-xs text-muted-foreground">{p.loanReference}</div>
                      </TableCell>
                      <TableCell>{METHOD_LABEL[p.method]}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatRand(p.amountCents)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRand(p.interestCents)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRand(p.feesCents)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRand(p.principalCents + p.overpaymentCents)}</TableCell>
                      <TableCell className="hidden lg:table-cell">{p.recordedBy}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}

const BUCKETS = [
  { label: "Up to date", min: 0, max: 0 },
  { label: "1–30 days", min: 1, max: 30 },
  { label: "31–60 days", min: 31, max: 60 },
  { label: "61–90 days", min: 61, max: 90 },
  { label: "Over 90 days", min: 91, max: Infinity },
];

function Portfolio() {
  const q = useQuery({ queryKey: ["reports", "portfolio"], queryFn: () => api.get<PortfolioRow[]>("/reports/portfolio") });
  const rows = q.data ?? [];
  const sum = (k: keyof PortfolioRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const buckets = BUCKETS.map((b) => {
    const inB = rows.filter((r) => r.daysInArrears >= b.min && r.daysInArrears <= b.max);
    return { ...b, loans: inB.length, outstanding: inB.reduce((s, r) => s + r.totalOutstandingCents, 0), arrears: inB.reduce((s, r) => s + r.arrearsCents, 0) };
  });

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" variant="outline" onClick={() => openFile("/reports/portfolio?format=csv")}>
          <Download /> CSV
        </Button>
      </div>
      <ErrorState error={q.error} />
      {q.isPending ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState>No active loans.</EmptyState>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Active loans" value={rows.length} />
            <StatCard label="Total outstanding" value={formatRand(sum("totalOutstandingCents"))} />
            <StatCard label="Principal outstanding" value={formatRand(sum("principalOutstandingCents"))} />
            <StatCard label="In arrears" value={formatRand(sum("arrearsCents"))} tone={sum("arrearsCents") ? "bad" : "good"} />
          </div>

          <Card className="py-0">
            <CardHeader className="pt-4">
              <CardTitle>Arrears aging</CardTitle>
              <CardDescription>Active loans by how long their oldest unpaid instalment has been overdue</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="text-right">Loans</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">In arrears</TableHead>
                  <TableHead className="hidden w-1/3 sm:table-cell">Share of outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((b) => (
                  <TableRow key={b.label}>
                    <TableCell className="font-medium">{b.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.loans}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(b.outstanding)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", b.arrears > 0 && "text-rose-700 dark:text-rose-400")}>{formatRand(b.arrears)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="h-2 rounded-full bg-muted">
                        {b.outstanding > 0 && <div className="h-2 rounded-full bg-chart-1" style={{ width: `${(b.outstanding / Math.max(1, sum("totalOutstandingCents"))) * 100}%` }} />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="py-0">
            <CardHeader className="pt-4">
              <CardTitle>Active loans</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loan</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden lg:table-cell">Product</TableHead>
                  <TableHead className="hidden md:table-cell">Disbursed</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Loan amount</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Principal</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Interest</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Fees</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Arrears</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="hidden md:table-cell">Next due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link href={`/loans/${l.id}`} className="font-medium hover:underline">
                        {l.reference}
                      </Link>
                    </TableCell>
                    <TableCell>{l.clientName}</TableCell>
                    <TableCell className="hidden lg:table-cell">{PRODUCT_LABEL[l.product]}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatDate(l.disbursedOn)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatRand(l.loanAmountCents)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRand(l.principalOutstandingCents)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">{formatRand(l.interestOutstandingCents)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">{formatRand(l.feesOutstandingCents)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatRand(l.totalOutstandingCents)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", l.arrearsCents > 0 && "text-rose-700 dark:text-rose-400")}>{formatRand(l.arrearsCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.daysInArrears || "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {l.nextDueDate ? (
                        <>
                          {formatDate(l.nextDueDate)}
                          <div className="text-xs text-muted-foreground">{formatRand(l.nextDueCents)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-semibold">
                    Total ({rows.length})
                  </TableCell>
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatRand(sum("loanAmountCents"))}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRand(sum("principalOutstandingCents"))}</TableCell>
                  <TableCell className="hidden text-right tabular-nums xl:table-cell">{formatRand(sum("interestOutstandingCents"))}</TableCell>
                  <TableCell className="hidden text-right tabular-nums xl:table-cell">{formatRand(sum("feesOutstandingCents"))}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRand(sum("totalOutstandingCents"))}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRand(sum("arrearsCents"))}</TableCell>
                  <TableCell />
                  <TableCell className="hidden md:table-cell" />
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<"collections" | "portfolio">("collections");
  return (
    <>
      <PageHeader title="Reports" description="Collections and the loan book, calculated from recorded payments. Export to CSV for Excel." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "collections" | "portfolio")} className="mb-4">
        <TabsList>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio &amp; arrears</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "collections" ? <Collections /> : <Portfolio />}
    </>
  );
}
