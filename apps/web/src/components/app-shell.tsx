"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  FileText,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Scale,
  Settings,
  Sun,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { Spinner } from "@/components/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/applications", label: "Applications", icon: ClipboardCheck },
  { href: "/loans", label: "Loans", icon: FileText },
  { href: "/overdue", label: "Overdue payments", icon: AlertTriangle, badge: "overdue" as const },
  { href: "/calendar", label: "Repayment calendar", icon: CalendarDays },
  { href: "/payments", label: "Payments", icon: HandCoins },
  { href: "/reconciliation", label: "Reconciliation", icon: Scale },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/calculator", label: "Loan calculator", icon: Calculator },
  { href: "/notifications", label: "Notifications", icon: Bell, badge: "unread" as const },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMe();
  const queryClient = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (o: boolean) => setOpenOn(o ? pathname : null);

  const unread = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: () => api.get<{ unread: number }>("/notifications/count"),
    refetchInterval: 60_000,
    enabled: me.isSuccess,
  });

  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: () => {
      queryClient.clear();
      window.location.href = "/login";
    },
  });

  if (me.isPending || me.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }
  const user = me.data;
  const unreadCount = unread.data?.unread ?? 0;

  const nav = (
    <nav className="grid gap-0.5">
      {NAV.map(({ href, label, icon: Icon, badge }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive(pathname, href)
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <Icon className={cn("size-4", isActive(pathname, href) && "text-sidebar-primary")} />
          {label}
          {badge === "unread" && unreadCount > 0 && (
            <span className="ml-auto rounded-full bg-sidebar-primary px-1.5 text-[11px] font-semibold text-sidebar-primary-foreground tabular-nums">{unreadCount > 99 ? "99+" : unreadCount}</span>
          )}
        </Link>
      ))}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <Link href="/" className="px-2 pt-2 pb-1">
        <Brand onDark />
      </Link>
      <div className="mx-2 h-px bg-gradient-to-r from-transparent via-sidebar-primary/60 to-transparent" />
      <Link href="/clients/new" className={cn(buttonVariants({ variant: "gold", size: "lg" }), "w-full")}>
        <Plus /> New client
      </Link>
      {nav}
      <div className="mt-auto grid gap-2 border-t border-sidebar-border pt-3">
        <div className="px-2">
          <p className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</p>
          <p className="text-xs text-sidebar-foreground/60">
            {user.role === "OWNER" ? "Owner" : "Administrator"}
            {user.role !== "OWNER" && user.canAuthoriseCorrections ? " · corrections" : ""}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />} Theme
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background print:bg-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-sidebar lg:block print:hidden">{sidebar}</aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-sidebar px-4 lg:hidden print:hidden">
        <Button variant="ghost" size="icon" aria-label="Open menu" className="text-sidebar-foreground hover:bg-sidebar-accent" onClick={() => setOpen(true)}>
          <Menu />
        </Button>
        <Brand onDark compact />
        <Link href="/notifications" className="relative ml-auto p-2 text-sidebar-foreground" aria-label="Notifications">
          <Bell className="size-5" />
          {unreadCount > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-sidebar-primary" />}
        </Link>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar shadow-xl">
            <Button variant="ghost" size="icon" className="absolute top-2 right-2 text-sidebar-foreground hover:bg-sidebar-accent" aria-label="Close menu" onClick={() => setOpen(false)}>
              <X />
            </Button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="lg:pl-64 print:pl-0">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
