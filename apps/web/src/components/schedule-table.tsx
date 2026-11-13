"use client";

import { Detail } from "@/components/shared";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatRand } from "@/lib/format";
import type { Quote, ScheduleRow } from "@/lib/types";

/** Projected repayment schedule (from POST /loans/quote). */
export function ScheduleTable({ rows }: { rows: ScheduleRow[] }) {
  const sum = (k: keyof ScheduleRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead className="text-right">Instalment</TableHead>
          <TableHead className="text-right">Interest</TableHead>
          <TableHead className="text-right">Fees</TableHead>
          <TableHead className="text-right">Principal</TableHead>
          <TableHead className="text-right">Principal after</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.seq}>
            <TableCell className="text-muted-foreground">{r.seq}</TableCell>
            <TableCell className="tabular-nums">{formatDate(r.dueDate)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatRand(r.amountCents)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatRand(r.interestCents)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatRand(r.feeCents)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatRand(r.principalCents)}</TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">{formatRand(r.closingPrincipalCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>Total</TableCell>
          <TableCell className="text-right tabular-nums">{formatRand(sum("amountCents"))}</TableCell>
          <TableCell className="text-right tabular-nums">{formatRand(sum("interestCents"))}</TableCell>
          <TableCell className="text-right tabular-nums">{formatRand(sum("feeCents"))}</TableCell>
          <TableCell className="text-right tabular-nums">{formatRand(sum("principalCents"))}</TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** Key figures of a quote. */
export function QuoteSummary({ quote, instalmentLabel = "Instalment" }: { quote: Quote; instalmentLabel?: string }) {
  return (
    <div>
      <div className="mb-3 rounded-xl border border-gold/50 bg-gold-soft/60 p-4">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{instalmentLabel}</p>
        <p className="font-display text-3xl font-semibold tabular-nums">{formatRand(quote.instalmentCents)}</p>
        <p className="text-xs text-muted-foreground">
          {quote.instalments.length} instalment{quote.instalments.length === 1 ? "" : "s"}, first due {formatDate(quote.instalments[0]?.dueDate)}
        </p>
      </div>
      <Detail label="Loan amount (paid to client)">{formatRand(quote.loanAmountCents)}</Detail>
      <Detail label="Initiation fee">{formatRand(quote.initiationFeeCents)}</Detail>
      <Detail label="Principal debt">{formatRand(quote.principalDebtCents)}</Detail>
      <Detail label="Total interest">{formatRand(quote.totalInterestCents)}</Detail>
      <Detail label="Total service fees">{formatRand(quote.totalFeesCents)}</Detail>
      <Detail label="Cost of credit">{formatRand(quote.totalCostOfCreditCents)}</Detail>
      <Detail label="Total repayable" className="border-t pt-2 text-base">
        {formatRand(quote.totalRepayableCents)}
      </Detail>
    </div>
  );
}
