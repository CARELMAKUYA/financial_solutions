"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, FileDown, FileText, Hourglass, MessageSquarePlus, Phone, Scale, SlidersHorizontal, XCircle } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import {
  AdjustmentDialog,
  ArrangementDialog,
  CancelLoanDialog,
  CorrectPaymentDialog,
  FollowUpDialog,
  ReverseAdjustmentButton,
  ReversePaymentDialog,
  UploadLoanDocument,
  UploadProofButton,
  VerifyPaymentDialog,
} from "@/components/loan-actions";
import { RecordPaymentButton } from "@/components/record-payment";
import { Detail, EmptyState, ErrorState, InstalmentStatusBadge, LoadingRows, LoanStatusBadge, PaymentStatusBadge, StatCard, ToneBadge } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useCanCorrect, useMe } from "@/lib/auth";
import {
  ADJUSTMENT_LABEL,
  DOCUMENT_LABEL,
  formatPeriod,
  formatDate,
  formatDateTime,
  formatPhone,
  formatRand,
  formatRate,
  FREQUENCY_LABEL,
  METHOD_LABEL,
  openFile,
  OUTCOME_LABEL,
  PRODUCT_LABEL,
  RECORDING_STATUS_COLOR,
  whatsappLink,
} from "@/lib/format";
import type { Instalment, LoanDetail, LoanPayment } from "@/lib/types";
import { cn } from "@/lib/utils";

type PaymentAction = { kind: "reverse" | "correct" | "verify"; payment: LoanPayment } | null;

export default function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["loan", id], queryFn: () => api.get<LoanDetail>(`/loans/${id}`) });
  const me = useMe();
  const canCorrect = useCanCorrect();
  const [paymentAction, setPaymentAction] = useState<PaymentAction>(null);
  const [dialog, setDialog] = useState<"adjust" | "arrange" | "cancel" | "followup" | null>(null);
  const [followUpFor, setFollowUpFor] = useState<Instalment | null>(null);

  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <LoadingRows rows={8} />;
  const loan = q.data;
  const name = (uid: string | null | undefined) => (uid ? (loan.userNames[uid] ?? "—") : "—");
  const active = loan.status === "ACTIVE";
  const current = loan.instalments.filter((i) => !i.supersededOn);
  const superseded = loan.instalments.filter((i) => i.supersededOn);
  const paidCount = current.filter((i) => i.status === "PAID").length;
  const pending = loan.payments.filter((p) => p.status === "PENDING_VERIFICATION");
  const openOverpayments = loan.payments.filter((p) => p.overpaymentFlag && !p.overpaymentResolvedAt);
  const balanceAfter = (p: LoanPayment) => p.allocations[0]?.balanceAfterCents;
  const alloc = (p: LoanPayment, c: string) => p.allocations.filter((a) => a.component === c).reduce((s, a) => s + a.amountCents, 0);

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{loan.reference}</h1>
            <LoanStatusBadge status={loan.status} />
            {loan.arrearsCents > 0 && <ToneBadge label={`${loan.daysInArrears} days in arrears`} className={RECORDING_STATUS_COLOR.CONFIRMED_MISSED} />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/clients/${loan.client.id}`} className="font-medium text-foreground hover:underline">
              {loan.client.firstName} {loan.client.lastName}
            </Link>{" "}
            · {loan.client.clientNumber} · {PRODUCT_LABEL[loan.product]} · disbursed {formatDate(loan.disbursedOn)}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <a href={`tel:${loan.client.phone}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <Phone className="size-3.5" /> {formatPhone(loan.client.phone)}
            </a>
            <a href={whatsappLink(loan.client.phone)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
              WhatsApp
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loan.status !== "CANCELLED" && <RecordPaymentButton loanId={loan.id} className="h-11 px-5 text-base" />}
          <Button variant="outline" onClick={() => openFile(`/loans/${loan.id}/statement.pdf`)}>
            <FileDown /> Statement
          </Button>
          {loan.status === "SETTLED" && (
            <Button variant="outline" onClick={() => openFile(`/loans/${loan.id}/settlement-letter.pdf`)}>
              <FileText /> Settlement letter
            </Button>
          )}
        </div>
      </div>

      {/* Alerts */}
      <div className="mb-6 grid gap-3">
        {loan.status === "SETTLED" && loan.settledOn && (
          <Alert className="border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            <CheckCircle2 />
            <AlertTitle>Fully paid on {formatDate(loan.settledOn)}</AlertTitle>
            <AlertDescription>Reminders have stopped. The full transaction history is kept below.</AlertDescription>
          </Alert>
        )}
        {pending.length > 0 && (
          <Alert>
            <Hourglass />
            <AlertTitle>{formatRand(loan.pendingVerificationCents)} awaiting verification</AlertTitle>
            <AlertDescription>
              {pending.length} payment{pending.length > 1 ? "s are" : " is"} recorded but not yet applied to the balance. Verify once the money is confirmed.
            </AlertDescription>
          </Alert>
        )}
        {openOverpayments.length > 0 && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Overpayment of {formatRand(loan.overpaymentCents)} to review</AlertTitle>
            <AlertDescription>
              The client paid more than they owed. <Link href="/payments?tab=overpayments" className="underline">Review and refund or resolve it</Link>.
            </AlertDescription>
          </Alert>
        )}
        {loan.inDuplumCapped && (
          <Alert>
            <Scale />
            <AlertTitle>In duplum limit reached</AlertTitle>
            <AlertDescription>Unpaid interest and fees have reached the unpaid principal, so no further interest or fees are being charged while the loan is in arrears.</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Balances */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Outstanding balance"
          value={formatRand(loan.settlementQuote.totalCents)}
          sub={`Principal ${formatRand(loan.settlementQuote.principalCents)} · interest ${formatRand(loan.settlementQuote.interestCents)}${loan.settlementQuote.futureInterestCents ? ` (${formatRand(loan.settlementQuote.futureInterestCents)} not yet due)` : ""} · fees ${formatRand(loan.settlementQuote.feesCents)}`}
        />
        <StatCard
          label="Arrears"
          tone={loan.arrearsCents > 0 ? "bad" : "good"}
          value={formatRand(loan.arrearsCents)}
          sub={loan.oldestArrearsDate ? `Oldest unpaid due ${formatDate(loan.oldestArrearsDate)}` : "Up to date"}
        />
        <StatCard
          label="Next due"
          icon={CalendarClock}
          value={loan.nextDueDate ? formatRand(loan.nextDueCents) : "—"}
          sub={loan.nextDueDate ? `on ${formatDate(loan.nextDueDate)}` : active ? "No further instalments" : "—"}
        />
        <StatCard
          label="Total paid"
          tone="good"
          value={formatRand(loan.totalPaidCents)}
          sub={`${paidCount} of ${current.length} instalments paid${loan.lastPaymentDate ? ` · last ${formatDate(loan.lastPaymentDate)}` : ""}`}
        />
      </div>

      <Tabs defaultValue="history">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="history">Payment history ({loan.payments.length})</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="followups">Follow-ups ({loan.followUps.length})</TabsTrigger>
            <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
            <TabsTrigger value="terms">Terms</TabsTrigger>
            <TabsTrigger value="documents">Documents ({loan.documents.length})</TabsTrigger>
            <TabsTrigger value="audit">Audit trail</TabsTrigger>
          </TabsList>
        </div>

        {/* Payment history */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {loan.payments.length === 0 ? (
                <EmptyState>No payments recorded yet.</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transaction</TableHead>
                        <TableHead>Payment date</TableHead>
                        <TableHead>Recorded</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method / reference</TableHead>
                        <TableHead>Allocation</TableHead>
                        <TableHead className="text-right">Balance after</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loan.payments.map((p) => {
                        const struck = p.status === "REVERSED" || p.status === "REJECTED";
                        const cover = loan.coverage[p.id];
                        return (
                          <TableRow key={p.id} className={cn(struck && "text-muted-foreground")}>
                            <TableCell className="align-top">
                              <div className="font-mono text-xs font-medium">{p.transactionNumber}</div>
                              {p.replacesPaymentId && <div className="text-xs text-muted-foreground">correction of {loan.payments.find((x) => x.id === p.replacesPaymentId)?.transactionNumber}</div>}
                              {p.adjustments.map((a) => (
                                <div key={a.id} className="mt-1 max-w-56 text-xs whitespace-normal text-muted-foreground">
                                  {a.kind === "REVERSAL" ? "Reversed" : "Corrected"} by {name(a.authorisedById)}: “{a.reason}”
                                </div>
                              ))}
                              {p.verifications
                                .filter((v) => v.action !== "FLAGGED")
                                .map((v) => (
                                  <div key={v.id} className="text-xs text-muted-foreground">
                                    {v.action === "VERIFIED" ? "Verified" : "Rejected"} by {name(v.userId)}
                                    {v.notes ? `: ${v.notes}` : ""}
                                  </div>
                                ))}
                            </TableCell>
                            <TableCell className="align-top">{formatDate(p.paymentDate)}</TableCell>
                            <TableCell className="align-top text-xs">
                              {formatDateTime(p.recordedAt)}
                              <div className="text-muted-foreground">{name(p.recordedById)}</div>
                            </TableCell>
                            <TableCell className={cn("text-right align-top font-semibold tabular-nums", struck && "line-through")}>{formatRand(p.amountCents)}</TableCell>
                            <TableCell className="align-top text-xs">
                              {METHOD_LABEL[p.method]}
                              {p.reference && <div className="text-muted-foreground">{p.reference}</div>}
                              {p.notes && <div className="max-w-48 whitespace-normal text-muted-foreground italic">{p.notes}</div>}
                            </TableCell>
                            <TableCell className="align-top text-xs tabular-nums">
                              {p.status === "CONFIRMED" ? (
                                <>
                                  <div>Interest {formatRand(alloc(p, "INTEREST"))}</div>
                                  <div>Fees {formatRand(alloc(p, "FEES"))}</div>
                                  <div>Principal {formatRand(alloc(p, "PRINCIPAL"))}</div>
                                  {alloc(p, "OVERPAYMENT") > 0 && <div className="text-amber-700 dark:text-amber-400">Overpaid {formatRand(alloc(p, "OVERPAYMENT"))}</div>}
                                  {cover?.length ? <div className="text-muted-foreground">→ instalment {cover.map((c) => `#${c.seq}`).join(", ")}</div> : null}
                                </>
                              ) : (
                                <span className="text-muted-foreground">Not applied</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right align-top tabular-nums">{p.status === "CONFIRMED" ? formatRand(balanceAfter(p)) : "—"}</TableCell>
                            <TableCell className="align-top">
                              <PaymentStatusBadge status={p.status} />
                            </TableCell>
                            <TableCell className="align-top">
                              <div className="flex flex-col items-end gap-1">
                                <Button size="xs" variant="outline" onClick={() => openFile(`/payments/${p.id}/receipt.pdf`)}>
                                  <FileDown /> Receipt
                                </Button>
                                {p.status === "PENDING_VERIFICATION" && (
                                  <Button size="xs" variant="gold" onClick={() => setPaymentAction({ kind: "verify", payment: p })}>
                                    Verify
                                  </Button>
                                )}
                                {p.status === "CONFIRMED" && canCorrect && (
                                  <div className="flex gap-1">
                                    <Button size="xs" variant="ghost" onClick={() => setPaymentAction({ kind: "correct", payment: p })}>
                                      Correct
                                    </Button>
                                    <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setPaymentAction({ kind: "reverse", payment: p })}>
                                      Reverse
                                    </Button>
                                  </div>
                                )}
                                {p.documents.map((d) => (
                                  <button key={d.id} className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => window.open(`/api/documents/${d.id}`, "_blank", "noopener")}>
                                    Proof: {d.fileName.slice(0, 18)}
                                  </button>
                                ))}
                                {!struck && p.documents.length === 0 && <UploadProofButton paymentId={p.id} />}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {!canCorrect && loan.payments.some((p) => p.status === "CONFIRMED") && (
                <p className="mt-3 text-xs text-muted-foreground">Only administrators authorised for corrections can reverse or correct payments.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Schedule */}
        <TabsContent value="schedule" className="mt-4 grid gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>
                Repayment schedule{loan.scheduleVersion > 1 ? ` (arrangement ${loan.scheduleVersion - 1})` : ""}
              </CardTitle>
              {active && canCorrect && (
                <Button size="sm" variant="outline" onClick={() => setDialog("arrange")}>
                  <CalendarClock /> New arrangement
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <ScheduleTable instalments={current} onFollowUp={active ? (i) => (setFollowUpFor(i), setDialog("followup")) : undefined} />
            </CardContent>
          </Card>
          {superseded.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Replaced by an arrangement</CardTitle>
              </CardHeader>
              <CardContent>
                <ScheduleTable instalments={superseded} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Follow-ups */}
        <TabsContent value="followups" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Collection notes</CardTitle>
              <Button size="sm" variant="outline" onClick={() => (setFollowUpFor(null), setDialog("followup"))}>
                <MessageSquarePlus /> Add note
              </Button>
            </CardHeader>
            <CardContent>
              {loan.followUps.length === 0 ? (
                <EmptyState>No follow-ups yet.</EmptyState>
              ) : (
                <ul className="divide-y">
                  {loan.followUps.map((f) => {
                    const inst = loan.instalments.find((i) => i.id === f.instalmentId);
                    return (
                      <li key={f.id} className="py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{OUTCOME_LABEL[f.outcome]}</span>
                          {inst && <span className="text-xs text-muted-foreground">instalment {inst.seq} due {formatDate(inst.dueDate)}</span>}
                          {f.promiseDate && <span className="text-xs text-muted-foreground">promised for {formatDate(f.promiseDate)}</span>}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {formatDateTime(f.createdAt)} · {name(f.createdById)}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-line text-muted-foreground">{f.note}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Adjustments & arrangements */}
        <TabsContent value="adjustments" className="mt-4 grid gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Loan adjustments</CardTitle>
              {canCorrect && loan.status !== "CANCELLED" && (
                <Button size="sm" variant="outline" onClick={() => setDialog("adjust")}>
                  <SlidersHorizontal /> New adjustment
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {loan.adjustments.length === 0 ? (
                <EmptyState>No adjustments. Fees, waivers, write-offs and refunds appear here.</EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Authorised</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loan.adjustments.map((a) => (
                      <TableRow key={a.id} className={cn(a.reversedAt && "text-muted-foreground")}>
                        <TableCell>
                          {ADJUSTMENT_LABEL[a.kind]}
                          {a.reversedAt && <div className="text-xs">Reversed by {name(a.reversedById)}: “{a.reversalReason}”</div>}
                        </TableCell>
                        <TableCell>{formatDate(a.effectiveDate)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", a.reversedAt && "line-through")}>{formatRand(a.amountCents)}</TableCell>
                        <TableCell className="max-w-64 whitespace-normal">{a.reason}</TableCell>
                        <TableCell className="text-xs">
                          {name(a.authorisedById)}
                          <div className="text-muted-foreground">{formatDateTime(a.createdAt)}</div>
                        </TableCell>
                        <TableCell>{!a.reversedAt && canCorrect && <ReverseAdjustmentButton loanId={loan.id} adjustmentId={a.id} />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Repayment arrangements</CardTitle>
            </CardHeader>
            <CardContent>
              {loan.arrangements.length === 0 ? (
                <EmptyState>The original schedule is in place.</EmptyState>
              ) : (
                <ul className="divide-y">
                  {loan.arrangements.map((a) => (
                    <li key={a.id} className="py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {formatDate(a.effectiveDate)}: {a.numberOfInstalments} × {formatRand(a.instalmentCents)} {FREQUENCY_LABEL[a.frequency].toLowerCase()} from {formatDate(a.firstDueDate)}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          Authorised by {name(a.authorisedById)} · balance then {formatRand(a.balanceAtArrangementCents)}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{a.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Terms */}
        <TabsContent value="terms" className="mt-4">
          <Card>
            <CardContent className="grid gap-x-10 pt-4 md:grid-cols-2">
              <div>
                <Detail label="Product">{PRODUCT_LABEL[loan.product]}</Detail>
                <Detail label="Loan amount (paid out)">{formatRand(loan.loanAmountCents)}</Detail>
                <Detail label="Initiation fee">{formatRand(loan.initiationFeeCents)}</Detail>
                <Detail label="Opening principal debt">{formatRand(loan.principalDebtCents)}</Detail>
                <Detail label="Interest rate">
                  {formatRate(loan.monthlyRateBps)} per month (flat, on {formatRand(loan.principalDebtCents)})
                </Detail>
                <Detail label="Service fee">{formatRand(loan.serviceFeeCents)} per instalment</Detail>
              </div>
              <div>
                <Detail label="Repayments">
                  {loan.numberOfInstalments} × {formatRand(loan.instalmentCents)} {FREQUENCY_LABEL[loan.frequency].toLowerCase()}
                </Detail>
                <Detail label="Disbursed">{formatDate(loan.disbursedOn)}</Detail>
                <Detail label="First due date">{formatDate(loan.firstDueDate)}</Detail>
                {loan.application && <Detail label="Application">{loan.application.applicationNumber}</Detail>}
                <Detail label="Issued">
                  {formatDateTime(loan.createdAt)} by {name(loan.audit.find((a) => a.action === "LOAN_ISSUED")?.userId)}
                </Detail>
                {loan.settledOn && <Detail label="Settled">{formatDate(loan.settledOn)}</Detail>}
              </div>
              {loan.notes && <p className="col-span-full mt-3 text-sm whitespace-pre-line text-muted-foreground">{loan.notes}</p>}
              {active && me.data?.role === "OWNER" && loan.payments.length === 0 && (
                <div className="col-span-full mt-4 border-t pt-4">
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDialog("cancel")}>
                    <XCircle /> Cancel loan (captured in error)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardContent className="grid gap-4 pt-4">
              <UploadLoanDocument loan={loan} />
              {loan.documents.length === 0 ? (
                <EmptyState>No documents for this loan yet.</EmptyState>
              ) : (
                <ul className="divide-y">
                  {loan.documents.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
                      <FileText className="size-4 text-muted-foreground" />
                      <button className="font-medium hover:underline" onClick={() => window.open(`/api/documents/${d.id}`, "_blank", "noopener")}>
                        {d.fileName}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {DOCUMENT_LABEL[d.kind]}
                        {d.periodFrom && d.periodTo ? ` (${formatPeriod(d.periodFrom, d.periodTo)})` : ""}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(d.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit */}
        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              <ul className="divide-y">
                {loan.audit.map((a) => (
                  <li key={a.id} className="grid gap-1 py-2 text-sm sm:grid-cols-[10rem_10rem_1fr]">
                    <span className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                    <span className="font-medium">{a.action.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground" title={JSON.stringify(a.details)}>
                      {a.user?.name ?? "System"} · {a.details ? JSON.stringify(a.details) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {paymentAction?.kind === "reverse" && <ReversePaymentDialog open onOpenChange={() => setPaymentAction(null)} payment={paymentAction.payment} />}
      {paymentAction?.kind === "correct" && <CorrectPaymentDialog open onOpenChange={() => setPaymentAction(null)} payment={paymentAction.payment} />}
      {paymentAction?.kind === "verify" && <VerifyPaymentDialog open onOpenChange={() => setPaymentAction(null)} payment={paymentAction.payment} />}
      {dialog === "adjust" && <AdjustmentDialog open onOpenChange={() => setDialog(null)} loan={loan} />}
      {dialog === "arrange" && <ArrangementDialog open onOpenChange={() => setDialog(null)} loan={loan} />}
      {dialog === "cancel" && <CancelLoanDialog open onOpenChange={() => setDialog(null)} loan={loan} />}
      {dialog === "followup" && <FollowUpDialog open onOpenChange={() => setDialog(null)} loanId={loan.id} instalment={followUpFor} />}
    </>
  );
}

function ScheduleTable({ instalments, onFollowUp }: { instalments: Instalment[]; onFollowUp?: (i: Instalment) => void }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead className="text-right">Amount due</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last payment</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {instalments.map((i) => (
            <TableRow key={i.id} className={cn(i.status === "OVERDUE" && "bg-rose-50/60 dark:bg-rose-950/30", i.status === "DUE_TODAY" && "bg-gold-soft/60")}>
              <TableCell>
                {i.seq}
                {i.version > 1 && <span className="ml-1 text-xs text-muted-foreground">v{i.version}</span>}
              </TableCell>
              <TableCell>{formatDate(i.dueDate)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRand(i.supersededOn ? i.amountCents : i.amountDueCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRand(i.paidCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{i.supersededOn ? "—" : formatRand(i.remainingCents)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <InstalmentStatusBadge status={i.status} partPaid={i.paidCents > 0} />
                  {i.collectionStatus === "CONFIRMED_MISSED" && <ToneBadge label="Confirmed missed" className={RECORDING_STATUS_COLOR.CONFIRMED_MISSED} />}
                  {i.collectionStatus === "PROMISE_TO_PAY" && <ToneBadge label={`Promise ${formatDate(i.promiseDate)}`} className={RECORDING_STATUS_COLOR.PROMISE_TO_PAY} />}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{i.lastPaymentDate ? formatDate(i.lastPaymentDate) : "—"}</TableCell>
              <TableCell>
                {onFollowUp && (i.status === "OVERDUE" || i.status === "DUE_TODAY") && (
                  <Button size="xs" variant="ghost" onClick={() => onFollowUp(i)}>
                    Follow up
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
