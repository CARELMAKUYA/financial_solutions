"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AuditSection, PasswordSection, UsersSection } from "@/components/settings-admin";
import { SettingsForm, type SettingsSection } from "@/components/settings-form";
import { ErrorState, LoadingRows, PageHeader } from "@/components/shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { Settings } from "@/lib/types";

type Tab = SettingsSection | "users" | "audit" | "password";

export default function SettingsPage() {
  const me = useMe().data;
  const isOwner = me?.role === "OWNER";
  const [tab, setTab] = useState<Tab>("business");
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });

  return (
    <>
      <PageHeader title="Settings" description="Business details, payment rules, reminders and administrator accounts." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          {isOwner && <TabsTrigger value="users">Administrators</TabsTrigger>}
          {isOwner && <TabsTrigger value="audit">Audit trail</TabsTrigger>}
          <TabsTrigger value="password">My password</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "business" || tab === "payments" || tab === "reminders" ? (
        <>
          <ErrorState error={q.error} />
          {q.isPending || !q.data ? <LoadingRows /> : <SettingsForm key={`${tab}-${q.dataUpdatedAt}`} settings={q.data} section={tab} canEdit={isOwner} />}
        </>
      ) : tab === "users" && isOwner ? (
        <UsersSection />
      ) : tab === "audit" && isOwner ? (
        <AuditSection />
      ) : (
        <PasswordSection />
      )}
    </>
  );
}
