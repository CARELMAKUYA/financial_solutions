"use client";

import { useState } from "react";
import { defaultTerms, LoanTermsFields, useQuote, useSettingsDefaults, type LoanTerms } from "@/components/loan-terms";
import { QuoteSummary, ScheduleTable } from "@/components/schedule-table";
import { EmptyState, ErrorState, PageHeader, Spinner } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CalculatorPage() {
  const [terms, setTerms] = useState<LoanTerms>(defaultTerms);
  useSettingsDefaults(setTerms);
  const { quote, validationError } = useQuote(terms);

  return (
    <>
      <PageHeader title="Loan calculator" description="Work out instalments and the cost of credit. It uses the same calculation as issued loans." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Loan terms</CardTitle>
          </CardHeader>
          <CardContent>
            <LoanTermsFields terms={terms} onChange={setTerms} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Quote {quote.isFetching && <Spinner />}</CardTitle>
            <CardDescription>Interest is charged daily on the outstanding principal. Paying early reduces it.</CardDescription>
          </CardHeader>
          <CardContent>
            {validationError ? <EmptyState>{validationError}</EmptyState> : quote.data ? <QuoteSummary quote={quote.data} /> : <ErrorState error={quote.error} />}
          </CardContent>
        </Card>
      </div>
      {!validationError && quote.data && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Repayment schedule</CardTitle>
            <CardDescription>Projected, assuming each instalment is paid on its due date.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-4">
            <ScheduleTable rows={quote.data.instalments} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
