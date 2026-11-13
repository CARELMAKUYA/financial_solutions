"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Bell, CalendarClock, CalendarDays, CheckCircle2, Clock, HandCoins, Hourglass, Wallet } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { EmptyState, ErrorState, LoadingRows, PageHeader, PaymentStatusBadge, StatCard } from "@/components/shared";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDate, formatDateTime, formatRand, METHOD_LABEL, plural } from "@/lib/format";
import type { Dashboard, Notification } from "@/lib/types";
import { cn } from "@/lib/utils";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/reports/dashboard"), refetchInterval: 60_000 });
  const notes = useQuery({ queryKey: ["notifications", "unread"], queryFn: () => api.get<Notification[]>("/notifications?unread=true") });

  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data;
  const maxAging = Math.max(1, ...(d?.aging.map((a) => a.arrearsCents) ?? [1]));

  return (
    <>
      <PageHeader
        title={`${greeting()}${me.data ? `, ${me.data.name.split(" ")[0]}` : ""}`}
        description={d ? `Here is where repayments stand on ${formatDate(d.today)}.` : " "}
        actions={
          <>
            <Link href="/overdue" className={buttonVariants({ variant: "outline" })}>
              <AlertTriangle /> Overdue
            </Link>
            <Link href="/loans" className={buttonVariants({ variant: "gold" })}>
              <HandCoins /> Record a payment
            </Link>
          </>
        }
      />

      {!d ? (
        <LoadingRows rows={6} />
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total outstanding" icon={Wallet} value={formatRand(d.totalOutstandingCents, { whole: true })} sub={`${plural(d.activeLoans, "active loan")} · principal ${formatRand(d.principalOutstandingCents, { whole: true })}`} />
            <StatCard
              label="In arrears"
              icon={AlertTriangle}
              tone={d.arrearsCents > 0 ? "bad" : "good"}
              value={formatRand(d.arrearsCents, { whole: true })}
              sub={d.loansInArrears ? <Link href="/overdue" className="underline-offset-2 hover:underline">{plural(d.loansInArrears, "loan")} overdue →</Link> : "Every loan is up to date"}
            />
            <StatCard label="Collected today" icon={HandCoins} tone="good" value={formatRand(d.collectedTodayCents, { whole: true })} sub={plural(d.collectedTodayCount, "payment")} />
            <StatCard label="Collected this month" icon={CheckCircle2} value={formatRand(d.collectedMonthCents, { whole: true })} sub={`${plural(d.collectedMonthCount, "payment")} · ${plural(d.settledThisMonth, "loan")} settled`} />
            <StatCard
              label="Due today"
              icon={Clock}
              tone={d.dueTodayCount ? "warn" : "default"}
              value={formatRand(d.dueTodayCents, { whole: true })}
              sub={<Link href="/calendar" className="underline-offset-2 hover:underline">{plural(d.dueTodayCount, "instalment")} →</Link>}
            />
            <StatCard label="Due in the next 7 days" icon={CalendarClock} value={formatRand(d.dueWeekCents, { whole: true })} sub={plural(d.dueWeekCount, "instalment")} />
            <StatCard
              label="Awaiting verification"
              icon={Hourglass}
              tone={d.pendingVerificationCount ? "warn" : "default"}
              value={formatRand(d.pendingVerificationCents, { whole: true })}
              sub={d.pendingVerificationCount ? <Link href="/payments?tab=verify" className="underline-offset-2 hover:underline">{plural(d.pendingVerificationCount, "payment")} to verify →</Link> : "Nothing to verify"}
            />
            <StatCard
              label="Needs attention"
              icon={Bell}
              tone={d.overpaymentsToReview || d.unreadNotifications ? "warn" : "default"}
              value={String(d.overpaymentsToReview + d.openApplications)}
              sub={`${plural(d.overpaymentsToReview, "overpayment")} to review · ${plural(d.openApplications, "open application")}`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Recent payments</CardTitle>
                <Link href="/payments" className="text-sm text-muted-foreground hover:text-foreground">
                  All payments <ArrowRight className="inline size-3.5" />
                </Link>
              </CardHeader>
              <CardContent>
                {d.recentPayments.length === 0 ? (
                  <EmptyState>No payments recorded yet.</EmptyState>
                ) : (
                  <ul className="divide-y">
                    {d.recentPayments.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <Link href={`/loans/${p.loan.id}`} className="font-medium hover:underline">
                            {p.loan.client.firstName} {p.loan.client.lastName}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.loan.reference} · {METHOD_LABEL[p.method]} · paid {formatDate(p.paymentDate)} · recorded {formatDateTime(p.recordedAt)}
                          </p>
                        </div>
                        {p.status !== "CONFIRMED" && <PaymentStatusBadge status={p.status} />}
                        <span className={cn("font-semibold tabular-nums", p.status === "REVERSED" || p.status === "REJECTED" ? "text-muted-foreground line-through" : "")}>
                          {formatRand(p.amountCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Arrears by age</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2.5">
                  {d.aging.map((a) => (
                    <Link key={a.bucket} href={`/overdue?days=${encodeURIComponent(a.bucket)}`} className="group grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm">
                      <span className="text-muted-foreground">{a.bucket} days</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn("block h-full rounded-full transition-all group-hover:opacity-80", a.bucket === "90+" || a.bucket === "61-90" ? "bg-rose-500" : a.bucket === "31-60" ? "bg-amber-500" : "bg-gold")}
                          style={{ width: `${(a.arrearsCents / maxAging) * 100}%` }}
                        />
                      </span>
                      <span className="text-right tabular-nums">
                        {formatRand(a.arrearsCents, { whole: true })} <span className="text-xs text-muted-foreground">({a.loans})</span>
                      </span>
                    </Link>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Reminders</CardTitle>
                  <Link href="/notifications" className="text-sm text-muted-foreground hover:text-foreground">
                    All <ArrowRight className="inline size-3.5" />
                  </Link>
                </CardHeader>
                <CardContent>
                  {!notes.data ? (
                    <LoadingRows rows={3} />
                  ) : notes.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
                  ) : (
                    <ul className="grid gap-3">
                      {notes.data.slice(0, 5).map((n) => (
                        <li key={n.id} className="text-sm">
                          <p className="font-medium">{n.title}</p>
                          <p className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{n.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Link href="/calendar" className="flex items-center gap-3 rounded-xl border bg-sidebar p-4 text-sidebar-foreground transition-opacity hover:opacity-95">
                <CalendarDays className="size-5 text-gold" />
                <span className="flex-1 text-sm">Open the repayment calendar</span>
                <ArrowRight className="size-4 text-gold" />
              </Link>
            </div>
          </div>

          <div className="flex justify-center pt-4 opacity-60">
            <Brand compact />
          </div>
        </div>
      )}
    </>
  );
}
