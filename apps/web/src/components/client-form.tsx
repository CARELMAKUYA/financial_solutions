"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Field, MoneyInput, Spinner } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { Client } from "@/lib/types";

/** Client-side check of a South African ID number (13 digits, valid date, Luhn check digit). */
export function isSaId(id: string) {
  if (!/^\d{13}$/.test(id)) return false;
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

type FormState = {
  firstName: string;
  lastName: string;
  idNumber: string;
  phone: string;
  altPhone: string;
  email: string;
  address: string;
  employer: string;
  employerPhone: string;
  monthlyIncomeCents: number | null;
  payday: string;
  bankName: string;
  bankAccountNumber: string;
  notes: string;
};

function initial(c?: Client): FormState {
  return {
    firstName: c?.firstName ?? "",
    lastName: c?.lastName ?? "",
    idNumber: c?.idNumber ?? "",
    phone: c?.phone ?? "",
    altPhone: c?.altPhone ?? "",
    email: c?.email ?? "",
    address: c?.address ?? "",
    employer: c?.employer ?? "",
    employerPhone: c?.employerPhone ?? "",
    monthlyIncomeCents: c?.monthlyIncomeCents ?? null,
    payday: c?.payday ? String(c.payday) : "",
    bankName: c?.bankName ?? "",
    bankAccountNumber: c?.bankAccountNumber ?? "",
    notes: c?.notes ?? "",
  };
}

/** Create (no `client`) or edit a client. */
export function ClientForm({ client, onSaved, onCancel }: { client?: Client; onSaved: (c: Client) => void; onCancel?: () => void }) {
  const [f, setF] = useState<FormState>(() => initial(client));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const idInvalid = f.idNumber.length > 0 && !isSaId(f.idNumber);
  const paydayNum = f.payday ? Number(f.payday) : null;
  const paydayInvalid = paydayNum !== null && (!Number.isInteger(paydayNum) || paydayNum < 1 || paydayNum > 31);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim(),
        idNumber: f.idNumber.trim(),
        phone: f.phone.trim(),
        altPhone: f.altPhone.trim() || (client ? "" : undefined),
        email: f.email.trim() || (client ? "" : undefined),
        address: f.address.trim() || (client ? "" : undefined),
        employer: f.employer.trim() || (client ? "" : undefined),
        employerPhone: f.employerPhone.trim() || (client ? "" : undefined),
        monthlyIncomeCents: f.monthlyIncomeCents ?? (client ? null : undefined),
        payday: paydayNum ?? (client ? null : undefined),
        bankName: f.bankName.trim() || (client ? "" : undefined),
        bankAccountNumber: f.bankAccountNumber.trim() || (client ? "" : undefined),
        notes: f.notes.trim() || (client ? "" : undefined),
      };
      return client ? api.patch<Client>(`/clients/${client.id}`, body) : api.post<Client>("/clients", body);
    },
    meta: { silent: true },
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.firstName.trim() || !f.lastName.trim()) return setError("Enter the client's first and last name");
        if (!isSaId(f.idNumber)) return setError("Enter a valid 13-digit South African ID number");
        if (!f.phone.trim()) return setError("Enter a phone number");
        if (paydayInvalid) return setError("Payday must be a day of the month from 1 to 31");
        setError(null);
        save.mutate();
      }}
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="c-first" required>
          <Input id="c-first" value={f.firstName} maxLength={80} onChange={(e) => set("firstName")(e.target.value)} />
        </Field>
        <Field label="Last name" htmlFor="c-last" required>
          <Input id="c-last" value={f.lastName} maxLength={80} onChange={(e) => set("lastName")(e.target.value)} />
        </Field>
        <Field label="SA ID number" htmlFor="c-id" required error={idInvalid ? "This is not a valid South African ID number" : null}>
          <Input id="c-id" value={f.idNumber} inputMode="numeric" maxLength={13} onChange={(e) => set("idNumber")(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Phone" htmlFor="c-phone" required hint="e.g. 082 123 4567">
          <Input id="c-phone" type="tel" value={f.phone} maxLength={20} onChange={(e) => set("phone")(e.target.value)} />
        </Field>
        <Field label="Alternative phone" htmlFor="c-alt">
          <Input id="c-alt" type="tel" value={f.altPhone} maxLength={20} onChange={(e) => set("altPhone")(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="c-email">
          <Input id="c-email" type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} />
        </Field>
        <Field label="Address" htmlFor="c-address" className="sm:col-span-2">
          <Input id="c-address" value={f.address} maxLength={300} onChange={(e) => set("address")(e.target.value)} />
        </Field>
      </section>

      <section className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <Field label="Employer" htmlFor="c-employer">
          <Input id="c-employer" value={f.employer} maxLength={120} onChange={(e) => set("employer")(e.target.value)} />
        </Field>
        <Field label="Employer phone" htmlFor="c-emp-phone">
          <Input id="c-emp-phone" type="tel" value={f.employerPhone} maxLength={20} onChange={(e) => set("employerPhone")(e.target.value)} />
        </Field>
        <Field label="Monthly income" htmlFor="c-income">
          <MoneyInput id="c-income" value={f.monthlyIncomeCents} onChange={set("monthlyIncomeCents")} />
        </Field>
        <Field label="Payday (day of month)" htmlFor="c-payday" hint="Used to suggest due dates" error={paydayInvalid ? "Enter a day from 1 to 31" : null}>
          <Input id="c-payday" inputMode="numeric" value={f.payday} maxLength={2} onChange={(e) => set("payday")(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Bank" htmlFor="c-bank">
          <Input id="c-bank" value={f.bankName} maxLength={60} onChange={(e) => set("bankName")(e.target.value)} />
        </Field>
        <Field label="Account number" htmlFor="c-acc">
          <Input id="c-acc" value={f.bankAccountNumber} maxLength={30} onChange={(e) => set("bankAccountNumber")(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="c-notes" className="sm:col-span-2">
          <Textarea id="c-notes" rows={3} value={f.notes} maxLength={2000} onChange={(e) => set("notes")(e.target.value)} />
        </Field>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="gold" disabled={save.isPending}>
          {save.isPending && <Spinner />} {client ? "Save changes" : "Create client"}
        </Button>
      </div>
    </form>
  );
}
