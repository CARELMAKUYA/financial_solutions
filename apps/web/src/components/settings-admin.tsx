"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, Field, LoadingRows, NativeSelect, Spinner, ToneBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, qs } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { AuditEntry, Role, StaffUser } from "@/lib/types";

function UserDialog({ user, open, onOpenChange }: { user: StaffUser | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useMe().data;
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "ADMIN");
  const [canCorrect, setCanCorrect] = useState(user?.canAuthoriseCorrections ?? false);
  const [receiveEmails, setReceiveEmails] = useState(user?.receiveEmails ?? true);
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");
  const isSelf = user?.id === me?.id;

  const m = useMutation({
    mutationFn: () =>
      user
        ? api.patch(`/users/${user.id}`, { name: name.trim(), role, canAuthoriseCorrections: canCorrect, receiveEmails, active, password: password || undefined })
        : api.post("/users", { name: name.trim(), email: email.trim(), role, canAuthoriseCorrections: canCorrect, receiveEmails, password }),
    onSuccess: () => {
      toast.success(user ? "Administrator updated" : "Administrator added");
      onOpenChange(false);
    },
  });
  const invalid = name.trim().length < 2 || (!user && (!email.includes("@") || password.length < 10)) || (password.length > 0 && password.length < 10);

  return (
    <Dialog open={open} onOpenChange={(o) => !m.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.name}` : "Add administrator"}</DialogTitle>
          <DialogDescription>{user ? "Changing permissions, deactivating or resetting the password signs them out everywhere." : "They can sign in with this email and password."}</DialogDescription>
        </DialogHeader>
        <form
          id="user-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) m.mutate();
          }}
        >
          <Field label="Name" htmlFor="u-name" required>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="u-email" required={!user}>
            <Input id="u-email" type="email" value={email} disabled={Boolean(user)} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role" htmlFor="u-role">
            <NativeSelect id="u-role" value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="ADMIN">Administrator</option>
              <option value="OWNER">Owner (all settings and staff)</option>
            </NativeSelect>
          </Field>
          <label className="flex items-start justify-between gap-4 text-sm">
            <span>
              Authorised for corrections
              <span className="block text-xs text-muted-foreground">Can reverse or correct payments, post adjustments and approve repayment arrangements. Owners always can.</span>
            </span>
            <Switch checked={role === "OWNER" || canCorrect} disabled={role === "OWNER"} onCheckedChange={(v) => setCanCorrect(v)} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            Receives reminder emails
            <Switch checked={receiveEmails} onCheckedChange={(v) => setReceiveEmails(v)} />
          </label>
          {user && (
            <label className="flex items-center justify-between gap-4 text-sm">
              Active (can sign in)
              <Switch checked={active} disabled={isSelf} onCheckedChange={(v) => setActive(v)} />
            </label>
          )}
          <Field label={user ? "Reset password" : "Password"} htmlFor="u-pw" required={!user} hint="At least 10 characters">
            <Input id="u-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={m.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" variant="gold" disabled={m.isPending || invalid}>
            {m.isPending && <Spinner />} {user ? "Save" : "Add administrator"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersSection() {
  const q = useQuery({ queryKey: ["users"], queryFn: () => api.get<StaffUser[]>("/users") });
  const [editing, setEditing] = useState<StaffUser | null | "new">(null);
  return (
    <Card className="py-0">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pt-4">
        <div>
          <CardTitle>Administrators</CardTitle>
          <CardDescription>Everyone who can sign in. Accounts are deactivated, never deleted, so the audit trail stays complete.</CardDescription>
        </div>
        <Button variant="gold" size="sm" onClick={() => setEditing("new")}>
          <UserPlus /> Add
        </Button>
      </CardHeader>
      <ErrorState error={q.error} />
      {q.isPending ? (
        <CardContent className="pb-4">
          <LoadingRows rows={3} />
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((u) => (
              <TableRow key={u.id} className={u.active ? "" : "opacity-60"}>
                <TableCell className="font-medium">
                  {u.name}
                  {!u.active && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{u.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <ToneBadge label={u.role === "OWNER" ? "Owner" : "Administrator"} className={u.role === "OWNER" ? "border-gold/50 bg-gold-soft" : ""} />
                    {u.role !== "OWNER" && u.canAuthoriseCorrections && <ToneBadge label="Corrections" className="" />}
                  </div>
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{formatDateTime(u.lastLoginAt)}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}>
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing !== null && <UserDialog key={editing === "new" ? "new" : editing.id} user={editing === "new" ? null : editing} open onOpenChange={(o) => !o && setEditing(null)} />}
    </Card>
  );
}

const ENTITIES = ["", "Loan", "Payment", "Client", "LoanApplication", "User", "Settings", "Reconciliation", "LoanDocument"];

export function AuditSection() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const params = { entity: entity || undefined, action: action.trim() || undefined };
  const q = useQuery({ queryKey: ["audit", params], queryFn: () => api.get<AuditEntry[]>(`/audit-log${qs(params)}`) });
  return (
    <Card className="py-0">
      <CardHeader className="pt-4">
        <CardTitle>Audit trail</CardTitle>
        <CardDescription>Every financial change, sign-in and settings change, newest first. Entries can&apos;t be edited or deleted.</CardDescription>
        <div className="flex flex-col gap-2 pt-2 sm:flex-row">
          <NativeSelect value={entity} onChange={(e) => setEntity(e.target.value)} className="sm:w-48" aria-label="Record type">
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {e || "All record types"}
              </option>
            ))}
          </NativeSelect>
          <Input placeholder="Action contains, e.g. REVERSED" value={action} onChange={(e) => setAction(e.target.value)} className="sm:w-64" />
        </div>
      </CardHeader>
      <ErrorState error={q.error} />
      {q.isPending ? (
        <CardContent className="pb-4">
          <LoadingRows />
        </CardContent>
      ) : !q.data?.length ? (
        <CardContent className="pb-4">
          <EmptyState>No entries match.</EmptyState>
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden md:table-cell">Record</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((a) => (
              <TableRow key={a.id} className="align-top">
                <TableCell className="text-xs whitespace-nowrap">{formatDateTime(a.createdAt)}</TableCell>
                <TableCell className="text-sm">{a.user?.name ?? "System"}</TableCell>
                <TableCell className="font-mono text-xs">{a.action}</TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{a.entity}</TableCell>
                <TableCell>
                  {a.details ? <code className="block max-w-md text-[11px] break-all whitespace-pre-wrap text-muted-foreground">{JSON.stringify(a.details)}</code> : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const m = useMutation({
    mutationFn: () => api.post("/auth/change-password", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success("Password changed. Other devices have been signed out.");
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });
  const mismatch = confirm.length > 0 && confirm !== next;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change your password</CardTitle>
        <CardDescription>Use at least 10 characters. Changing it signs you out on other devices.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-sm gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch && next.length >= 10) m.mutate();
          }}
        >
          <Field label="Current password" htmlFor="pw-cur">
            <Input id="pw-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" htmlFor="pw-new">
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-conf" error={mismatch ? "The passwords don't match" : null}>
            <Input id="pw-conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" variant="gold" disabled={m.isPending || !current || next.length < 10 || mismatch}>
            {m.isPending ? <Spinner /> : <KeyRound />} Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
