"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, BellRing, CalendarClock, CalendarDays, CheckCheck, CircleDollarSign, ClipboardList, MailWarning, Play, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { Notification, NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE: Record<NotificationType, { icon: React.ComponentType<{ className?: string }>; label: string; className: string }> = {
  DUE_SOON: { icon: CalendarClock, label: "Due soon", className: "text-sky-700 dark:text-sky-400" },
  DUE_TODAY: { icon: BellRing, label: "Due today", className: "text-amber-700 dark:text-amber-400" },
  OVERDUE: { icon: AlertTriangle, label: "Overdue", className: "text-rose-700 dark:text-rose-400" },
  DAILY_OVERDUE_SUMMARY: { icon: ClipboardList, label: "Daily overdue summary", className: "text-gold" },
  WEEKLY_COLLECTION_SUMMARY: { icon: CalendarDays, label: "Weekly collection summary", className: "text-gold" },
  OVERPAYMENT: { icon: CircleDollarSign, label: "Overpayment", className: "text-violet-700 dark:text-violet-400" },
  VERIFICATION_NEEDED: { icon: ShieldQuestion, label: "Verification needed", className: "text-amber-700 dark:text-amber-400" },
  LOAN_SETTLED: { icon: BadgeCheck, label: "Loan settled", className: "text-emerald-700 dark:text-emerald-400" },
};

export default function NotificationsPage() {
  const me = useMe();
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const q = useQuery({
    queryKey: ["notifications", tab],
    queryFn: () => api.get<Notification[]>(`/notifications${tab === "unread" ? "?unread=true" : ""}`),
  });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`) });
  const readAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>("/notifications/read-all"),
    onSuccess: (r) => toast.success(`${r.updated} notification${r.updated === 1 ? "" : "s"} marked as read`),
  });
  const runNow = useMutation({
    mutationFn: () => api.post<{ skipped?: boolean; refreshed?: number; created?: number; emailed?: number }>("/notifications/run-now"),
    onSuccess: (r) =>
      r.skipped
        ? toast.info("Reminders are already running. Try again in a minute.")
        : toast.success(`Reminders checked: ${r.created ?? 0} new, ${r.emailed ?? 0} emailed, ${r.refreshed ?? 0} loans refreshed.`),
  });
  const rows = q.data ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Repayment reminders and summaries. They're created automatically every morning, even when nobody is signed in, and each reminder is sent only once."
        actions={
          <>
            {me.data?.role === "OWNER" && (
              <Button variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                {runNow.isPending ? <Spinner /> : <Play />} Run reminders now
              </Button>
            )}
            <Button variant="outline" onClick={() => readAll.mutate()} disabled={readAll.isPending || (tab === "unread" && rows.length === 0)}>
              <CheckCheck /> Mark all read
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "unread" | "all")} className="mb-4">
        <TabsList>
          <TabsTrigger value="unread">Unread</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <ErrorState error={q.error} />
      {q.isPending ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState>{tab === "unread" ? "You're all caught up." : "No notifications yet."}</EmptyState>
      ) : (
        <Card className="divide-y py-0">
          {rows.map((n) => {
            const t = TYPE[n.type];
            const Icon = t.icon;
            return (
              <div key={n.id} className={cn("flex gap-3 px-4 py-3", !n.readAt && "bg-gold-soft/40")}>
                <Icon className={cn("mt-0.5 size-5 shrink-0", t.className)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className={cn("font-medium", !n.readAt && "font-semibold")}>{n.title}</p>
                    <span className="text-xs text-muted-foreground">
                      {t.label} · {formatDateTime(n.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">{n.body}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                    {n.loan && (
                      <Link href={`/loans/${n.loan.id}`} className="font-medium text-foreground hover:underline" onClick={() => !n.readAt && read.mutate(n.id)}>
                        Open {n.loan.reference}
                      </Link>
                    )}
                    {n.emailStatus === "SENT" && <span className="text-muted-foreground">Emailed</span>}
                    {n.emailStatus === "FAILED" && (
                      <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400" title={n.emailError ?? undefined}>
                        <MailWarning className="size-3.5" /> Email failed{n.emailError ? `: ${n.emailError}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                {!n.readAt && (
                  <Button size="xs" variant="ghost" onClick={() => read.mutate(n.id)} disabled={read.isPending}>
                    Mark read
                  </Button>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
