import { QueryClient } from "@tanstack/react-query";

// React Query client tuned for Tauri IPC rather than HTTP. The IPC layer
// itself enforces no caching at the wire — we control that here.
//
// Refetch on window focus is off because a Tauri desktop app's window-focus
// behavior is different from a browser tab; we'll let the bus drive
// invalidations explicitly when data needs to be re-fetched.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, _error) => failureCount < 2,
      staleTime: 30_000,
    },
    mutations: {
      retry: 0,
    },
  },
});
