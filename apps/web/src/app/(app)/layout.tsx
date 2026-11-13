import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";

// Every page here is client-rendered behind a login and reads the URL, so nothing is prerendered past this boundary.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-muted/30" />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
