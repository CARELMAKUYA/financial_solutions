"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { defaultTerms, LoanTermsFields, toQuoteDto, useQuote, useSettingsDefaults, type LoanTerms } from "@/components/loan-terms";
import { QuoteSummary, ScheduleTable } from "@/components/schedule-table";
import { EmptyState, ErrorState, Field, NativeSelect, PageHeader, Spinner } from "@/components/shared";
import { StatementChecklist } from "@/components/bank-statements";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, qs } from "@/lib/api";
import { addDays, addMonths, formatPhone, formatRand, nextPayday, PRODUCT_LABEL, todaySast } from "@/lib/format";
import type { ClientDetail, ClientListItem, Loan, LoanApplication, ProductType } from "@/lib/types";

function suggestFirstDue(disbursedOn: string, payday: number | null | undefined) {
  if (!disbursedOn) return "";
  return payday ? nextPayday(addDays(disbursedOn, 7), payday) : addMonths(disbursedOn, 1);
}

export default function NewLoanPage() {
  const router = useRouter();
  const params = useSearchParams();
  const today = todaySast();
  const [clientId, setClientId] = useState(params.get("clientId") ?? "");
  const applicationId = params.get("applicationId") ?? "";
  const [product, setProduct] = useState<ProductType>("SHORT_TERM");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState<LoanTerms>(defaultTerms);
  const [error, setError] = useState<string | null>(null);
  const [firstDueTouched, setFirstDueTouched] = useState(false);
  const prefilled = useRef(false);

  useSettingsDefaults(setTerms);

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api.get<ClientDetail>(`/clients/${clientId}`),
    enabled: !!clientId,
  });
  const application = useQuery({
    queryKey: ["application", applicationId],
    queryFn: () => api.get<LoanApplication>(`/applications/${applicationId}`),
    enabled: !!applicationId,
  });

  // Suggest the first due date from the client's payday (until the user picks one).
  const payday = client.data?.payday;
  // (Adjusted during render rather than in an effect, so there's no extra render pass.)
  const suggestionFor = client.data ? `${client.data.id}:${payday ?? ""}` : null;
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);
  if (suggestionFor && suggestionFor !== appliedSuggestion && !firstDueTouched) {
    setAppliedSuggestion(suggestionFor);
    setTerms((t) => ({ ...t, firstDueDate: suggestFirstDue(t.disbursedOn, payday) }));
  }

  // Prefill from the approved application, once.
  useEffect(() => {
    const a = application.data;
    if (!a || prefilled.current) return;
    prefilled.current = true;
    setProduct(a.product);
    setTerms((t) => ({ ...t, loanAmountCents: a.requestedAmountCents, numberOfInstalments: String(a.requestedInstalments), frequency: a.frequency }));
  }, [application.data]);

  const { quote, validationError } = useQuote(terms);

  const create = useMutation({
    mutationFn: () => {
      const { dto } = toQuoteDto(terms);
      return api.post<Loan>("/loans", { ...dto, clientId, applicationId: applicationId || undefined, product, notes: notes.trim() || undefined });
    },
    meta: { silent: true },
    onSuccess: (loan) => {
      toast.success(`Loan ${loan.reference} issued`);
      router.push(`/loans/${loan.id}`);
    },
    onError: (e) => setError(e.message),
  });

  const onTermsChange = (t: LoanTerms) => {
    if (t.firstDueDate !== terms.firstDueDate) setFirstDueTouched(true);
    else if (t.disbursedOn !== terms.disbursedOn && !firstDueTouched) t = { ...t, firstDueDate: suggestFirstDue(t.disbursedOn, payday) };
    setTerms(t);
  };

  const submit = () => {
    if (!clientId) return setError("Choose the client");
    if (client.data?.status === "ARCHIVED") return setError("This client is archived. Reactivate them first.");
    const { error: v } = toQuoteDto(terms);
    if (v) return setError(v);
    if (terms.disbursedOn > today) return setError("The disbursement date cannot be in the future");
    setError(null);
    create.mutate();
  };

  const app = application.data;
  const appMismatch = app && clientId && app.clientId !== clientId;

  return (
    <>
      <PageHeader title="Issue a loan" description="The repayment schedule below is exactly what will be saved. Backdated disbursements are allowed for capturing existing loans." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {clientId ? (
                client.isPending ? (
                  <Spinner />
                ) : client.data ? (
                  <div className="flex items-start justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                    <div>
                      <Link href={`/clients/${client.data.id}`} className="font-medium hover:underline">
                        {client.data.firstName} {client.data.lastName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {client.data.clientNumber} · ID {client.data.idNumber} · {formatPhone(client.data.phone)}
                        {client.data.payday ? ` · paid on the ${client.data.payday}` : ""}
                      </p>
                      {client.data.loans.filter((l) => l.status === "ACTIVE").length > 0 && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          Already has {client.data.loans.filter((l) => l.status === "ACTIVE").length} active loan(s) totalling{" "}
                          {formatRand(client.data.loans.filter((l) => l.status === "ACTIVE").reduce((s, l) => s + l.totalOutstandingCents, 0))}
                        </p>
                      )}
                    </div>
                    {!applicationId && (
                      <Button variant="ghost" size="icon-sm" aria-label="Change client" onClick={() => setClientId("")}>
                        <X />
                      </Button>
                    )}
                  </div>
                ) : (
                  <ErrorState error={client.error} />
                )
              ) : (
                <ClientPicker onPick={setClientId} />
              )}
              {app && (
                <p className="text-sm text-muted-foreground">
                  From application <span className="font-mono">{app.applicationNumber}</span>
                  {app.status !== "APPROVED" && <span className="text-rose-700 dark:text-rose-400"> (status: {app.status.toLowerCase()}; only approved applications can be issued)</span>}
                </p>
              )}
              {(() => {
                // From an application: measured from its date. Otherwise from today (the server uses the disbursement date).
                const check = app ? app.statements : client.data?.statements;
                if (!check || check.complete) return null;
                return (
                  <Alert>
                    <AlertDescription className="grid gap-2">
                      <StatementChecklist check={check} />
                      {client.data && (
                        <Link href={`/clients/${client.data.id}`} className="text-sm font-medium underline">
                          Upload statements on the client&apos;s profile
                        </Link>
                      )}
                    </AlertDescription>
                  </Alert>
                );
              })()}
              {appMismatch && (
                <Alert variant="destructive">
                  <AlertDescription>The application belongs to a different client.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Loan terms</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Product" htmlFor="l-product">
                <NativeSelect id="l-product" value={product} onChange={(e) => setProduct(e.target.value as ProductType)}>
                  {Object.entries(PRODUCT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <LoanTermsFields
                terms={terms}
                onChange={onTermsChange}
                maxDisbursedOn={today}
                firstDueHint={payday && !firstDueTouched ? `Suggested from the client's payday (${payday})` : undefined}
              />
              <Field label="Notes" htmlFor="l-notes">
                <Textarea id="l-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Quote {quote.isFetching && <Spinner />}</CardTitle>
              <CardDescription>Calculated by the server with the loan&apos;s own schedule engine.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {validationError ? <EmptyState>{validationError}</EmptyState> : quote.data ? <QuoteSummary quote={quote.data} /> : <ErrorState error={quote.error} />}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button variant="gold" size="lg" onClick={submit} disabled={create.isPending || !!validationError || !clientId || !!appMismatch}>
                {create.isPending && <Spinner />} Issue loan
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {!validationError && quote.data && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Repayment schedule</CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-4">
            <ScheduleTable rows={quote.data.instalments} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ClientPicker({ onPick }: { onPick: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search);
  const results = useQuery({
    queryKey: ["clients", q, "ACTIVE"],
    queryFn: () => api.get<ClientListItem[]>(`/clients${qs({ search: q, status: "ACTIVE" })}`),
  });
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" autoFocus placeholder="Search by name, ID number or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
        {results.isPending ? (
          <li className="p-3">
            <Spinner />
          </li>
        ) : !results.data?.length ? (
          <li className="p-3 text-sm text-muted-foreground">
            No clients found.{" "}
            <Link href="/clients/new" className="underline">
              Add a new client
            </Link>
          </li>
        ) : (
          results.data.slice(0, 30).map((c) => (
            <li key={c.id}>
              <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onPick(c.id)}>
                <span className="font-medium">
                  {c.firstName} {c.lastName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {c.clientNumber} · {c.idNumber}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
