"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { EmptyState, ErrorState, LoadingRows, PageHeader, ToneBadge } from "@/components/shared";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, qs } from "@/lib/api";
import { formatPhone, formatRand } from "@/lib/format";
import type { ClientListItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
  { value: "", label: "All" },
];

export default function ClientsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const q = useDeferredValue(search);
  const clients = useQuery({
    queryKey: ["clients", q, status],
    queryFn: () => api.get<ClientListItem[]>(`/clients${qs({ search: q, status })}`),
  });

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone who has applied for or taken a loan."
        actions={
          <Link href="/clients/new" className={buttonVariants({ variant: "gold" })}>
            <Plus /> New client
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, ID number, phone or client no." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 rounded-lg border bg-card p-0.5">
          {STATUSES.map((s) => (
            <button
              key={s.label}
              className={cn("rounded-md px-3 py-1 text-sm font-medium", status === s.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setStatus(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <ErrorState error={clients.error} />
      <Card className="py-0">
        <CardContent className="px-0">
          {clients.isPending ? (
            <div className="p-4">
              <LoadingRows />
            </div>
          ) : !clients.data?.length ? (
            <div className="p-4">
              <EmptyState>{q ? "No clients match your search." : "No clients yet. Add your first client to get started."}</EmptyState>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Client no.</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>ID number</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Active loans</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="pr-4 text-right">Arrears</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.data.map((c) => {
                  const outstanding = c.loans.reduce((s, l) => s + l.totalOutstandingCents, 0);
                  const arrears = c.loans.reduce((s, l) => s + l.arrearsCents, 0);
                  return (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/clients/${c.id}`)}>
                      <TableCell className="pl-4 font-mono text-xs">{c.clientNumber}</TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/clients/${c.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                          {c.firstName} {c.lastName}
                        </Link>
                        {c.status === "ARCHIVED" && <ToneBadge label="Archived" className="ml-2 bg-muted text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="tabular-nums">{c.idNumber}</TableCell>
                      <TableCell>{formatPhone(c.phone)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.loans.length}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.loans.length ? formatRand(outstanding) : "—"}</TableCell>
                      <TableCell className={cn("pr-4 text-right tabular-nums", arrears > 0 && "font-semibold text-rose-700 dark:text-rose-400")}>
                        {arrears > 0 ? formatRand(arrears) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
