"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, FilePlus2, FileText, Mail, MessageCircle, Pencil, Phone, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ClientForm } from "@/components/client-form";
import { RecordPaymentButton } from "@/components/record-payment";
import {
  ApplicationStatusBadge,
  Detail,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  LoanStatusBadge,
  MoneyInput,
  NativeSelect,
  PageHeader,
  Spinner,
  ToneBadge,
} from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  DOCUMENT_LABEL,
  formatDate,
  formatDateTime,
  formatPeriod,
  formatPhone,
  formatRand,
  FREQUENCY_LABEL,
  PRODUCT_LABEL,
  whatsappLink,
} from "@/lib/format";
import { StatementChecklist, StatementPeriodFields, suggestedPeriod } from "@/components/bank-statements";
import type { Client, ClientDetail, DocumentKind, Frequency, LoanApplication, ProductType } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQuery({ queryKey: ["client", id], queryFn: () => api.get<ClientDetail>(`/clients/${id}`) });
  const [editing, setEditing] = useState(false);
  const [applying, setApplying] = useState(false);

  const archive = useMutation({
    mutationFn: (status: "ACTIVE" | "ARCHIVED") => api.patch<Client>(`/clients/${id}`, { status }),
    onSuccess: (c) => toast.success(c.status === "ARCHIVED" ? "Client archived" : "Client reactivated"),
  });

  if (client.isPending) return <LoadingRows rows={8} />;
  if (client.error) return <ErrorState error={client.error} />;
  const c = client.data;
  const activeLoans = c.loans.filter((l) => l.status === "ACTIVE");
  const outstanding = activeLoans.reduce((s, l) => s + l.totalOutstandingCents, 0);
  const arrears = activeLoans.reduce((s, l) => s + l.arrearsCents, 0);

  return (
    <>
      <PageHeader
        title={`${c.firstName} ${c.lastName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{c.clientNumber}</span>
            <span>·</span>
            <span>ID {c.idNumber}</span>
            {c.status === "ARCHIVED" ? <ToneBadge label="Archived" className="bg-muted text-muted-foreground" /> : <ToneBadge label="Active" className="border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" />}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button variant="outline" onClick={() => archive.mutate(c.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED")} disabled={archive.isPending}>
              {c.status === "ARCHIVED" ? <ArchiveRestore /> : <Archive />}
              {c.status === "ARCHIVED" ? "Reactivate" : "Archive"}
            </Button>
            {c.status === "ACTIVE" && (
              <>
                <Button variant="outline" onClick={() => setApplying(true)}>
                  <FilePlus2 /> New application
                </Button>
                <Link href={`/loans/new?clientId=${c.id}`} className={buttonVariants({ variant: "gold" })}>
                  <Plus /> Issue loan
                </Link>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Phone className="size-4 text-muted-foreground" />
              <a href={`tel:${c.phone}`} className="font-medium hover:underline">
                {formatPhone(c.phone)}
              </a>
              <a href={whatsappLink(c.phone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline dark:text-emerald-400">
                <MessageCircle className="size-3.5" /> WhatsApp
              </a>
            </div>
            {c.altPhone && (
              <div className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" />
                <a href={`tel:${c.altPhone}`} className="hover:underline">
                  {formatPhone(c.altPhone)}
                </a>
                <span className="text-xs text-muted-foreground">(alternative)</span>
              </div>
            )}
            {c.email && (
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-muted-foreground" />
                <a href={`mailto:${c.email}`} className="hover:underline">
                  {c.email}
                </a>
              </div>
            )}
            {c.address && <p className="text-muted-foreground">{c.address}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Employment & bank</CardTitle>
          </CardHeader>
          <CardContent>
            <Detail label="Employer">{c.employer ?? "—"}</Detail>
            {c.employerPhone && <Detail label="Employer phone">{formatPhone(c.employerPhone)}</Detail>}
            <Detail label="Monthly income">{formatRand(c.monthlyIncomeCents)}</Detail>
            <Detail label="Payday">{c.payday ? `${c.payday} of each month` : "—"}</Detail>
            <Detail label="Bank">{c.bankName ? `${c.bankName}${c.bankAccountNumber ? ` · ${c.bankAccountNumber}` : ""}` : "—"}</Detail>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Account summary</CardTitle>
          </CardHeader>
          <CardContent>
            <Detail label="Active loans">{activeLoans.length}</Detail>
            <Detail label="Total outstanding">{formatRand(outstanding)}</Detail>
            <Detail label="In arrears" className={arrears > 0 ? "text-rose-700 dark:text-rose-400" : undefined}>
              {formatRand(arrears)}
            </Detail>
            <Detail label="Client since">{formatDate(c.createdAt)}</Detail>
            {c.notes && <p className="mt-2 border-t pt-2 text-sm whitespace-pre-line text-muted-foreground">{c.notes}</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Loans ({c.loans.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {!c.loans.length ? (
            <div className="px-4">
              <EmptyState>No loans yet.</EmptyState>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Reference</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Loan amount</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Arrears</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead className="pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.loans.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/loans/${l.id}`} className="hover:underline">
                        {l.reference}
                      </Link>
                      <div className="text-xs text-muted-foreground">Disbursed {formatDate(l.disbursedOn)}</div>
                    </TableCell>
                    <TableCell>{PRODUCT_LABEL[l.product]}</TableCell>
                    <TableCell>
                      <LoanStatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(l.loanAmountCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(l.totalOutstandingCents)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", l.arrearsCents > 0 && "font-semibold text-rose-700 dark:text-rose-400")}>
                      {l.arrearsCents > 0 ? formatRand(l.arrearsCents) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">{l.nextDueDate ? `${formatDate(l.nextDueDate)} · ${formatRand(l.nextDueCents)}` : "—"}</TableCell>
                    <TableCell className="pr-4 text-right">{l.status === "ACTIVE" && <RecordPaymentButton loanId={l.id} size="sm" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardAction>
              <Link href="/applications" className="text-sm text-muted-foreground hover:underline">
                All applications
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!c.applications.length ? (
              <EmptyState>No applications.</EmptyState>
            ) : (
              <ul className="divide-y">
                {c.applications.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <p className="font-medium">
                        {a.applicationNumber} · {formatRand(a.requestedAmountCents)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {PRODUCT_LABEL[a.product]} · {a.requestedInstalments} × {FREQUENCY_LABEL[a.frequency].toLowerCase()} · {formatDate(a.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ApplicationStatusBadge status={a.status} />
                      {a.status === "APPROVED" && (
                        <Link href={`/loans/new?clientId=${c.id}&applicationId=${a.id}`} className={buttonVariants({ size: "sm", variant: "gold" })}>
                          Issue loan
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <DocumentsCard client={c} />
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
          </DialogHeader>
          <ClientForm
            client={c}
            onSaved={() => {
              toast.success("Client updated");
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>
      {applying && <ApplicationDialog client={c} onClose={() => setApplying(false)} />}
    </>
  );
}

function ApplicationDialog({ client, onClose }: { client: ClientDetail; onClose: () => void }) {
  const [product, setProduct] = useState<ProductType>("SHORT_TERM");
  const [amount, setAmount] = useState<number | null>(null);
  const [instalments, setInstalments] = useState("3");
  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [purpose, setPurpose] = useState("");
  const [income, setIncome] = useState<number | null>(client.monthlyIncomeCents);
  const [expenses, setExpenses] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post<LoanApplication>(`/clients/${client.id}/applications`, {
        product,
        requestedAmountCents: amount,
        requestedInstalments: Number(instalments),
        frequency,
        purpose: purpose.trim() || undefined,
        monthlyIncomeCents: income ?? undefined,
        monthlyExpensesCents: expenses ?? undefined,
      }),
    meta: { silent: true },
    onSuccess: (a) => {
      toast.success(`Application ${a.applicationNumber} captured`);
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New loan application</DialogTitle>
          <DialogDescription>
            For {client.firstName} {client.lastName}. Approve it on the Applications page, then issue the loan.
          </DialogDescription>
        </DialogHeader>
        <form
          id="application-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(instalments);
            if (!amount || amount < 10_000) return setError("The requested amount must be at least R 100");
            if (!Number.isInteger(n) || n < 1 || n > 120) return setError("Number of instalments must be between 1 and 120");
            setError(null);
            save.mutate();
          }}
        >
          <Field label="Product" htmlFor="a-product" className="sm:col-span-2">
            <NativeSelect id="a-product" value={product} onChange={(e) => setProduct(e.target.value as ProductType)}>
              {Object.entries(PRODUCT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Amount requested" htmlFor="a-amount" required>
            <MoneyInput id="a-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Instalments" htmlFor="a-n" required>
            <Input id="a-n" inputMode="numeric" value={instalments} onChange={(e) => setInstalments(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Frequency" htmlFor="a-freq">
            <NativeSelect id="a-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Monthly income" htmlFor="a-income">
            <MoneyInput id="a-income" value={income} onChange={setIncome} />
          </Field>
          <Field label="Monthly expenses" htmlFor="a-exp">
            <MoneyInput id="a-exp" value={expenses} onChange={setExpenses} />
          </Field>
          <Field label="Purpose" htmlFor="a-purpose" className="sm:col-span-2">
            <Textarea id="a-purpose" rows={2} maxLength={500} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>
        </form>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="application-form" variant="gold" disabled={save.isPending}>
            {save.isPending && <Spinner />} Save application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentsCard({ client }: { client: ClientDetail }) {
  const [kind, setKind] = useState<DocumentKind>(client.statements && !client.statements.complete ? "BANK_STATEMENT" : "ID_DOCUMENT");
  const [loanId, setLoanId] = useState("");
  const [period, setPeriod] = useState(() => suggestedPeriod(client.statements));
  const isStatement = kind === "BANK_STATEMENT";
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("kind", kind);
      if (loanId) fd.append("loanId", loanId);
      if (isStatement) {
        fd.append("periodFrom", period.from);
        fd.append("periodTo", period.to);
      }
      return api.post(`/clients/${client.id}/documents`, fd);
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      setFile(null);
      setInputKey((k) => k + 1);
    },
  });

  // Once a statement is saved, point the form at whatever is still missing.
  const missingKey = client.statements?.missing.join() ?? "";
  const [seenMissing, setSeenMissing] = useState(missingKey);
  if (missingKey !== seenMissing) {
    setSeenMissing(missingKey);
    setPeriod(suggestedPeriod(client.statements));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {client.statements && <StatementChecklist check={client.statements} />}
        <form
          className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return toast.error("Choose a file to upload");
            if (file.size > 10 * 1024 * 1024) return toast.error("Files must be 10 MB or smaller");
            if (isStatement && (!period.from || !period.to || period.from > period.to)) return toast.error("Choose the months the statement covers");
            upload.mutate();
          }}
        >
          <Field label="Type" htmlFor="d-kind">
            <NativeSelect id="d-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              {Object.entries(DOCUMENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Loan" htmlFor="d-loan">
            <NativeSelect id="d-loan" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
              <option value="">Not loan-specific</option>
              {client.loans.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.reference}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {isStatement && (
            <div className="sm:col-span-2">
              <StatementPeriodFields idPrefix="d-period" from={period.from} to={period.to} onChange={(from, to) => setPeriod({ from, to })} />
            </div>
          )}
          <Field label="File" htmlFor="d-file" hint="PDF, JPG, PNG or WEBP, up to 10 MB" className="sm:col-span-2">
            <Input key={inputKey} id="d-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={upload.isPending || !file}>
              {upload.isPending ? <Spinner /> : <Upload />} Upload
            </Button>
          </div>
        </form>
        {!client.documents.length ? (
          <EmptyState>No documents uploaded.</EmptyState>
        ) : (
          <ul className="divide-y text-sm">
            {client.documents.map((d) => {
              const loan = client.loans.find((l) => l.id === d.loanId);
              return (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                  <button className="flex min-w-0 items-center gap-2 text-left hover:underline" onClick={() => window.open(`/api/documents/${d.id}`, "_blank", "noopener")}>
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{d.fileName}</span>
                  </button>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {DOCUMENT_LABEL[d.kind]}
                    {d.periodFrom && d.periodTo ? ` (${formatPeriod(d.periodFrom, d.periodTo)})` : ""}
                    {loan ? ` · ${loan.reference}` : ""} · {formatDateTime(d.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
