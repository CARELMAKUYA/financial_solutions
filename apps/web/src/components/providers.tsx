"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

function makeQueryClient(): QueryClient {
  const mutationCache: MutationCache = new MutationCache({
    // Every mutation shows its error unless it handles it itself (meta.silent).
    onError: (error, _v, _c, mutation) => {
      if (!mutation.meta?.silent) toast.error(error.message);
    },
    // Writes can affect almost every screen (balances, room status, dashboard), so refresh everything.
    onSuccess: (): Promise<void> => client.invalidateQueries(),
  });
  const client: QueryClient = new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
    },
  });
  return client;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
