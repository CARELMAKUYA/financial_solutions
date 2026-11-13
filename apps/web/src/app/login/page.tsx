"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, ShieldCheck, Zap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Brand } from "@/components/brand";
import { Field, Spinner } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => api.post<{ user: User }>("/auth/login", { email, password }),
    meta: { silent: true },
    onSuccess: ({ user }) => {
      queryClient.setQueryData(["me"], user);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    },
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        login.mutate();
      }}
    >
      {login.error && (
        <Alert variant="destructive">
          <AlertDescription>{login.error.message}</AlertDescription>
        </Alert>
      )}
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" variant="gold" disabled={login.isPending}>
        {login.isPending && <Spinner />}
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[28rem] rounded-full border-[18px] border-gold/30" />
        <div className="pointer-events-none absolute -bottom-52 -left-24 size-[30rem] rounded-full border-[10px] border-gold/20" />
        <Brand onDark />
        <div className="relative max-w-md">
          <p className="font-display text-4xl leading-tight font-semibold">
            Helping you bridge the gap <span className="text-gold italic">with trusted financial solutions.</span>
          </p>
          <div className="mt-8 flex gap-6 text-sm text-sidebar-foreground/70">
            <span className="flex items-center gap-2"><Zap className="size-4 text-gold" /> Fast</span>
            <span className="flex items-center gap-2"><ShieldCheck className="size-4 text-gold" /> Trusted</span>
            <span className="flex items-center gap-2"><Lock className="size-4 text-gold" /> Confidential</span>
          </div>
        </div>
        <p className="relative text-xs text-sidebar-foreground/50">Your trusted financial partner</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Brand className="mb-8 lg:hidden" />
          <h1 className="font-display text-2xl font-semibold">Welcome back</h1>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">Sign in to manage clients, loans and repayments.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-8 text-xs text-muted-foreground">Client information is protected under POPIA. All access and changes are logged.</p>
        </div>
      </section>
    </main>
  );
}
