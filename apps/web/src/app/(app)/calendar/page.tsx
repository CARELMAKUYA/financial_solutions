"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, List } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RecordPaymentDialog } from "@/components/record-payment";
import { Detail, EmptyState, ErrorState, InstalmentStatusBadge, LoadingRows, NativeSelect, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, qs } from "@/lib/api";
import { addDays, addMonths, endOfMonth, formatDate, formatRand, INSTALMENT_STATUS_COLOR, INSTALMENT_STATUS_LABEL, monthName, startOfMonth, startOfWeek, todaySast } from "@/lib/format";
import type { CalendarEvent, InstalmentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEGEND: InstalmentStatus[] = ["UPCOMING", "DUE_TODAY", "PARTIALLY_PAID", "PAID", "OVERDUE"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarPage() {
  const router = useRouter();
  const today = todaySast();
  const [month, setMonth] = useState(startOfMonth(today));
  const [status, setStatus] = useState<InstalmentStatus | "">("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);

  // The visible grid: Monday on/before the 1st through the Sunday on/after month end (≤ 42 days).
  const gridStart = startOfWeek(month);
  const gridEnd = addDays(startOfWeek(endOfMonth(month)), 6);
  const days: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const q = useQuery({
    queryKey: ["calendar", gridStart, gridEnd],
    queryFn: () => api.get<CalendarEvent[]>(`/calendar${qs({ from: gridStart, to: gridEnd })}`),
  });
  const events = (q.data ?? []).filter((e) => !status || e.status === status);
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(e.dueDate, [...(byDay.get(e.dueDate) ?? []), e]);

  const monthEvents = events.filter((e) => e.dueDate.startsWith(month.slice(0, 7)));
  const monthDue = monthEvents.reduce((s, e) => s + e.amountDueCents, 0);
  const monthRemaining = monthEvents.reduce((s, e) => s + e.remainingCents, 0);

  return (
    <>
      <PageHeader
        title="Repayment calendar"
        description={`${monthEvents.length} instalments in ${monthName(month)} · ${formatRand(monthDue)} scheduled · ${formatRand(monthRemaining)} still to collect`}
        actions={
          <>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as InstalmentStatus | "")} className="w-40" aria-label="Filter by status">
              <option value="">All statuses</option>
              {LEGEND.map((s) => (
                <option key={s} value={s}>
                  {INSTALMENT_STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" size="icon" aria-label={view === "grid" ? "List view" : "Month view"} onClick={() => setView(view === "grid" ? "list" : "grid")}>
              {view === "grid" ? <List /> : <CalendarDays />}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight />
        </Button>
        <Button variant="outline" onClick={() => setMonth(startOfMonth(today))}>
          Today
        </Button>
        <h2 className="ml-2 font-display text-xl font-semibold">{monthName(month)}</h2>
        <div className="flex w-full flex-wrap gap-1.5 sm:ml-auto sm:w-auto">
          {LEGEND.map((s) => (
            <span key={s} className={cn("rounded border px-1.5 py-0.5 text-[11px] font-medium", INSTALMENT_STATUS_COLOR[s])}>
              {INSTALMENT_STATUS_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      <ErrorState error={q.error} />
      {q.isPending ? (
        <LoadingRows rows={8} />
      ) : view === "list" ? (
        monthEvents.length === 0 ? (
          <EmptyState>No repayments scheduled in {monthName(month)}.</EmptyState>
        ) : (
          <div className="grid gap-4">
            {[...new Set(monthEvents.map((e) => e.dueDate))].map((d) => (
              <div key={d}>
                <h3 className={cn("mb-1.5 text-sm font-semibold", d === today && "text-gold")}>
                  {formatDate(d)}
                  {d === today ? " · today" : ""}
                </h3>
                <Card className="divide-y py-0">
                  {byDay.get(d)!.map((e) => (
                    <button key={e.instalmentId} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => setSelected(e)}>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{e.clientName}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.loanReference} · instalment {e.seq}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-semibold tabular-nums">{formatRand(e.status === "PAID" ? e.amountDueCents : e.remainingCents)}</span>
                        <InstalmentStatusBadge status={e.status} partPaid={e.paidCents > 0} />
                      </div>
                    </button>
                  ))}
                </Card>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-xl border bg-card">
            {WEEKDAYS.map((w) => (
              <div key={w} className="border-b bg-muted/50 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                {w}
              </div>
            ))}
            {days.map((d, i) => {
              const list = byDay.get(d) ?? [];
              const inMonth = d.startsWith(month.slice(0, 7));
              const outstanding = list.reduce((s, e) => s + e.remainingCents, 0);
              return (
                <div
                  key={d}
                  className={cn("min-h-28 border-b p-1.5", i % 7 !== 6 && "border-r", !inMonth && "bg-muted/30 text-muted-foreground", d === today && "bg-gold-soft/60")}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-1">
                    <span className={cn("text-xs font-medium", d === today && "flex size-5 items-center justify-center rounded-full bg-gold text-gold-foreground")}>{Number(d.slice(8, 10))}</span>
                    {outstanding > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{formatRand(outstanding, { whole: true })} due</span>}
                  </div>
                  <div className="grid gap-1">
                    {list.slice(0, 4).map((e) => (
                      <button
                        key={e.instalmentId}
                        onClick={() => setSelected(e)}
                        title={`${e.clientName} · ${e.loanReference} · ${INSTALMENT_STATUS_LABEL[e.status]}`}
                        className={cn("truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-medium hover:brightness-95", INSTALMENT_STATUS_COLOR[e.status])}
                      >
                        {e.clientName.split(" ").slice(1).join(" ") || e.clientName} · {formatRand(e.status === "PAID" ? e.amountDueCents : e.remainingCents, { whole: true })}
                      </button>
                    ))}
                    {list.length > 4 && (
                      <button
                        className="text-left text-[11px] text-muted-foreground hover:underline"
                        onClick={() => {
                          setView("list");
                          setMonth(startOfMonth(d));
                        }}
                      >
                        +{list.length - 4} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.clientName}</DialogTitle>
                <DialogDescription>
                  {selected.loanReference} · instalment {selected.seq}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border p-3">
                <Detail label="Due date">{formatDate(selected.dueDate)}</Detail>
                <Detail label="Status">
                  <InstalmentStatusBadge status={selected.status} partPaid={selected.paidCents > 0} />
                </Detail>
                <Detail label="Amount due">{formatRand(selected.amountDueCents)}</Detail>
                <Detail label="Paid">{formatRand(selected.paidCents)}</Detail>
                <Detail label="Remaining">{formatRand(selected.remainingCents)}</Detail>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => router.push(`/loans/${selected.loanId}`)}>
                  <ExternalLink /> Open loan
                </Button>
                {selected.status !== "PAID" && (
                  <Button
                    variant="gold"
                    onClick={() => {
                      setPayFor(selected.loanId);
                      setSelected(null);
                    }}
                  >
                    Record payment
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {payFor && <RecordPaymentDialog loanId={payFor} open onOpenChange={(o) => !o && setPayFor(null)} />}
    </>
  );
}
