"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, MessageCircle, Phone, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { FollowUpButton } from "@/components/follow-up-dialog";
import { RecordPaymentButton } from "@/components/record-payment";
import { EmptyState, ErrorState, LoadingRows, NativeSelect, PageHeader, StatCard, ToneBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, qs } from "@/lib/api";
import { formatDate, formatPhone, formatRand, OUTCOME_LABEL, openFile, plural, RECORDING_STATUS_COLOR, RECORDING_STATUS_LABEL, whatsappLink } from "@/lib/format";
import type { OverdueRow } from "@/lib/types";

const DURATIONS = [
  { key: "", label: "Any duration" },
  { key: "1-7", label: "1–7 days", min: 1, max: 7 },
  { key: "8-30", label: "8–30 days", min: 8, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "90+", label: "Over 90 days", min: 91 },
];

const STATUSES = [
  { key: "", label: "All statuses" },
  { key: "NOT_RECORDED", label: "No payment recorded" },
  { key: "AWAITING_VERIFICATION", label: "Payment awaiting verification" },
  { key: "PROMISE_TO_PAY", label: "Promise to pay" },
  { key: "CONFIRMED_MISSED", label: "Confirmed missed" },
  { key: "PART_PAID", label: "Part-paid" },
  { key: "UNPAID", label: "Nothing paid" },
];

function daysTone(days: number) {
  if (days > 60) return "text-rose-700 dark:text-rose-400 font-semibold";
  if (days > 30) return "text-rose-700 dark:text-rose-400";
  if (days > 7) return "text-amber-700 dark:text-amber-400";
  return "";
}

function Contact({ client }: { client: OverdueRow["loan"]["client"] }) {
  return (
    <div className="grid gap-0.5 text-xs">
      <span className="flex items-center gap-2">
        <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1 hover:underline">
          <Phone className="size-3" /> {formatPhone(client.phone)}
        </a>
        <a href={whatsappLink(client.phone)} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400" aria-label="WhatsApp">
          <MessageCircle className="size-3.5" />
        </a>
      </span>
      {client.email && (
        <a href={`mailto:${client.email}`} className="truncate text-muted-foreground hover:underline">
          {client.email}
        </a>
      )}
    </div>
  );
}

function LatestNote({ row }: { row: OverdueRow }) {
  const n = row.followUps[0];
  if (!n) return <span className="text-xs text-muted-foreground">No follow-up yet</span>;
  return (
    <div className="max-w-56 text-xs">
      <span className="font-medium">{OUTCOME_LABEL[n.outcome]}</span>
      <span className="text-muted-foreground"> · {formatDate(n.createdAt)}</span>
      <p className="line-clamp-2 text-muted-foreground">{n.note}</p>
    </div>
  );
}

function StatusCell({ row }: { row: OverdueRow }) {
  return (
    <div className="grid gap-1">
      <ToneBadge label={RECORDING_STATUS_LABEL[row.recordingStatus]} className={RECORDING_STATUS_COLOR[row.recordingStatus]} />
      {row.recordingStatus === "PROMISE_TO_PAY" && row.promiseDate && <span className="text-xs text-muted-foreground">Promised {formatDate(row.promiseDate)}</span>}
    </div>
  );
}

export default function OverduePage() {
  const params = useSearchParams();
  const [duration, setDuration] = useState(() => DURATIONS.find((x) => x.key === params.get("days"))?.key ?? "");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const d = DURATIONS.find((x) => x.key === duration)!;
  const filters = { minDays: d.min, maxDays: d.max, status: status || undefined, search: search.trim() || undefined };

  const q = useQuery({ queryKey: ["overdue", filters], queryFn: () => api.get<OverdueRow[]>(`/overdue${qs(filters)}`) });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + r.remainingCents, 0);
  const loans = new Set(rows.map((r) => r.loan.id)).size;
  const missed = rows.filter((r) => r.recordingStatus === "CONFIRMED_MISSED").length;
  const notRecorded = rows.filter((r) => r.recordingStatus === "NOT_RECORDED").length;

  return (
    <>
      <PageHeader
        title="Overdue payments"
        description="Instalments not fully paid by their due date. Check whether money arrived but wasn't recorded before marking a payment as missed."
        actions={
          <Button variant="outline" onClick={() => openFile(`/overdue${qs({ ...filters, format: "csv" })}`)}>
            <Download /> Export CSV
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Overdue instalments" value={rows.length} sub={plural(loans, "loan")} icon={AlertTriangle} tone={rows.length ? "bad" : "good"} />
        <StatCard label="Total overdue" value={formatRand(total)} tone={total ? "bad" : "good"} />
        <StatCard label="No payment recorded" value={notRecorded} sub="May have been paid: check the bank" tone={notRecorded ? "warn" : "default"} />
        <StatCard label="Confirmed missed" value={missed} sub="Checked: no money received" />
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Client or loan reference" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <NativeSelect value={duration} onChange={(e) => setDuration(e.target.value)} className="sm:w-44" aria-label="Overdue duration">
          {DURATIONS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-60" aria-label="Repayment status">
          {STATUSES.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <ErrorState error={q.error} />
      {q.isPending ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState>{duration || status || search ? "No overdue instalments match these filters." : "Nothing is overdue. Every active loan is up to date."}</EmptyState>
      ) : (
        <>
          {/* Desktop */}
          <Card className="hidden py-0 xl:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Loan</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="text-right">Instalment</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Last payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.instalmentId} className="align-top">
                    <TableCell>
                      <Link href={`/clients/${r.loan.client.id}`} className="font-medium hover:underline">
                        {r.loan.client.firstName} {r.loan.client.lastName}
                      </Link>
                      <Contact client={r.loan.client} />
                    </TableCell>
                    <TableCell>
                      <Link href={`/loans/${r.loan.id}`} className="font-medium hover:underline">
                        {r.loan.reference}
                      </Link>
                      <div className="text-xs text-muted-foreground">Instalment {r.seq}</div>
                    </TableCell>
                    <TableCell>{formatDate(r.dueDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(r.amountDueCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(r.paidCents)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatRand(r.remainingCents)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${daysTone(r.daysOverdue)}`}>{r.daysOverdue}</TableCell>
                    <TableCell>{formatDate(r.loan.lastPaymentDate)}</TableCell>
                    <TableCell>
                      <StatusCell row={r} />
                    </TableCell>
                    <TableCell>
                      <LatestNote row={r} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-end gap-1">
                        <RecordPaymentButton loanId={r.loan.id} size="sm" label="Record" />
                        <FollowUpButton loanId={r.loan.id} instalmentId={r.instalmentId} title={`${r.loan.client.firstName} ${r.loan.client.lastName} · ${r.loan.reference} · instalment ${r.seq}`} size="xs" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile / tablet */}
          <div className="grid gap-3 xl:hidden">
            {rows.map((r) => (
              <Card key={r.instalmentId}>
                <CardContent className="grid gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/clients/${r.loan.client.id}`} className="font-medium hover:underline">
                        {r.loan.client.firstName} {r.loan.client.lastName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        <Link href={`/loans/${r.loan.id}`} className="hover:underline">
                          {r.loan.reference}
                        </Link>{" "}
                        · instalment {r.seq} · due {formatDate(r.dueDate)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold tabular-nums">{formatRand(r.remainingCents)}</div>
                      <div className={`text-xs ${daysTone(r.daysOverdue)}`}>{plural(r.daysOverdue, "day")} overdue</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Instalment</div>
                      <div className="tabular-nums">{formatRand(r.amountDueCents)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Paid</div>
                      <div className="tabular-nums">{formatRand(r.paidCents)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last payment</div>
                      <div>{formatDate(r.loan.lastPaymentDate)}</div>
                    </div>
                  </div>
                  <Contact client={r.loan.client} />
                  <StatusCell row={r} />
                  <LatestNote row={r} />
                  <div className="flex flex-wrap gap-2">
                    <RecordPaymentButton loanId={r.loan.id} size="sm" />
                    <FollowUpButton loanId={r.loan.id} instalmentId={r.instalmentId} title={`${r.loan.client.firstName} ${r.loan.client.lastName} · ${r.loan.reference} · instalment ${r.seq}`} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
