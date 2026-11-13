"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { StatementChecklist } from "@/components/bank-statements";
import { ApplicationStatusBadge, EmptyState, ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Spinner, ToneBadge } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, qs } from "@/lib/api";
import { APPLICATION_STATUS_LABEL, formatDate, formatMonth, formatRand, FREQUENCY_LABEL, PRODUCT_LABEL } from "@/lib/format";
import type { ApplicationStatus, LoanApplication } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS: { value: ApplicationStatus | ""; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "ISSUED", label: "Issued" },
  { value: "DECLINED", label: "Declined" },
  { value: "", label: "All" },
];

const STATEMENT_TONE = {
  complete: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  missing: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
};

type Decision = "APPROVED" | "DECLINED" | "WITHDRAWN";

export default function ApplicationsPage() {
  const [status, setStatus] = useState<ApplicationStatus | "">("PENDING");
  const [deciding, setDeciding] = useState<LoanApplication | null>(null);
  const apps = useQuery({
    queryKey: ["applications", status],
    queryFn: () => api.get<LoanApplication[]>(`/applications${qs({ status })}`),
  });

  return (
    <>
      <PageHeader title="Loan applications" description="Capture applications from a client's profile, then approve or decline them here before issuing the loan." />
      <div className="mb-4 flex w-fit flex-wrap gap-1 rounded-lg border bg-card p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            className={cn("rounded-md px-3 py-1 text-sm font-medium", status === f.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ErrorState error={apps.error} />
      <Card className="py-0">
        <CardContent className="px-0">
          {apps.isPending ? (
            <div className="p-4">
              <LoadingRows />
            </div>
          ) : !apps.data?.length ? (
            <div className="p-4">
              <EmptyState>No {status ? APPLICATION_STATUS_LABEL[status].toLowerCase() : ""} applications.</EmptyState>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Application</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Bank statements</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-4">
                      <div className="font-mono text-xs">{a.applicationNumber}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</div>
                    </TableCell>
                    <TableCell>
                      {a.client && (
                        <Link href={`/clients/${a.client.id}`} className="font-medium hover:underline">
                          {a.client.firstName} {a.client.lastName}
                        </Link>
                      )}
                      {a.purpose && <div className="max-w-56 truncate text-xs text-muted-foreground">{a.purpose}</div>}
                    </TableCell>
                    <TableCell>{PRODUCT_LABEL[a.product]}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(a.requestedAmountCents)}</TableCell>
                    <TableCell>
                      {a.requestedInstalments} × {FREQUENCY_LABEL[a.frequency].toLowerCase()}
                    </TableCell>
                    <TableCell>
                      {a.status === "ISSUED" || a.status === "DECLINED" || a.status === "WITHDRAWN" ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : !a.statements ? (
                        <span className="text-xs text-muted-foreground">Not required</span>
                      ) : a.statements.complete ? (
                        <ToneBadge label={`${a.statements.required.length} of ${a.statements.required.length} received`} className={STATEMENT_TONE.complete} />
                      ) : (
                        <Link href={`/clients/${a.clientId}`} className="grid gap-0.5" title="Upload them on the client's profile">
                          <ToneBadge label={`${a.statements.required.length - a.statements.missing.length} of ${a.statements.required.length} received`} className={STATEMENT_TONE.missing} />
                          <span className="text-xs text-muted-foreground">Missing {a.statements.missing.map(formatMonth).join(", ")}</span>
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <ApplicationStatusBadge status={a.status} />
                      {a.decisionNotes && <div className="mt-1 max-w-48 truncate text-xs text-muted-foreground" title={a.decisionNotes}>{a.decisionNotes}</div>}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <div className="flex justify-end gap-2">
                        {(a.status === "PENDING" || a.status === "APPROVED") && (
                          <Button size="sm" variant="outline" onClick={() => setDeciding(a)}>
                            {a.status === "PENDING" ? "Decide" : "Change"}
                          </Button>
                        )}
                        {a.status === "APPROVED" && (
                          <Link href={`/loans/new?clientId=${a.clientId}&applicationId=${a.id}`} className={buttonVariants({ size: "sm", variant: "gold" })}>
                            Issue loan
                          </Link>
                        )}
                        {a.status === "ISSUED" && a.loan && (
                          <Link href={`/loans/${a.loan.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                            {a.loan.reference}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {deciding && <DecisionDialog app={deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function DecisionDialog({ app, onClose }: { app: LoanApplication; onClose: () => void }) {
  const [decision, setDecision] = useState<Decision>(app.status === "APPROVED" ? "WITHDRAWN" : "APPROVED");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<LoanApplication>(`/applications/${app.id}/decision`, { status: decision, decisionNotes: notes.trim() || undefined }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success(`Application ${app.applicationNumber} ${APPLICATION_STATUS_LABEL[decision].toLowerCase()}`);
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decision on {app.applicationNumber}</DialogTitle>
          <DialogDescription>
            {app.client ? `${app.client.firstName} ${app.client.lastName}: ` : ""}
            {formatRand(app.requestedAmountCents)} over {app.requestedInstalments} {FREQUENCY_LABEL[app.frequency].toLowerCase()} instalment{app.requestedInstalments === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>
        {app.monthlyIncomeCents !== null && (
          <p className="text-sm text-muted-foreground">
            Income {formatRand(app.monthlyIncomeCents)}
            {app.monthlyExpensesCents !== null ? `, expenses ${formatRand(app.monthlyExpensesCents)}, available ${formatRand(app.monthlyIncomeCents - app.monthlyExpensesCents)}` : ""} per month
          </p>
        )}
        {app.statements && <StatementChecklist check={app.statements} />}
        {decision === "APPROVED" && app.statements && !app.statements.complete && (
          <Alert>
            <AlertDescription>
              Upload the missing bank statements on{" "}
              <Link href={`/clients/${app.clientId}`} className="font-medium underline">
                the client&apos;s profile
              </Link>{" "}
              before approving.
            </AlertDescription>
          </Alert>
        )}
        <Field label="Decision" htmlFor="dec">
          <NativeSelect id="dec" value={decision} onChange={(e) => setDecision(e.target.value as Decision)}>
            <option value="APPROVED">Approve</option>
            <option value="DECLINED">Decline</option>
            <option value="WITHDRAWN">Withdrawn by client</option>
          </NativeSelect>
        </Field>
        <Field label="Notes" htmlFor="dec-notes" hint="Recorded with the decision and in the audit trail">
          <Textarea id="dec-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" onClick={() => m.mutate()} disabled={m.isPending || (decision === "APPROVED" && !!app.statements && !app.statements.complete)}>
            {m.isPending && <Spinner />} Save decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
