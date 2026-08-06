import { useCallback } from "react";
import { useUiPreference } from "./useUiPreference";

// Canonical row-count options offered on every paginated screen.
// Kept in sync with the server clamp ceiling (PaginationHelper.DefaultMax = 200).
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];

// Per-screen page-size preference, persisted in localStorage (via
// useUiPreference — survives reloads + new sessions, syncs across tabs,
// degrades to in-memory in private mode).
//
//   const [pageSize, setPageSize] = usePageSize("invoices");
//
// `pageSize` is null until the user picks one on this screen. While null the
// caller should OMIT pageSize from the request so the backend default
// (appsettings Pagination:DefaultPageSize) applies — appsettings stays the
// single source of the default.
export default function usePageSize(storageKey) {
  const [raw, setRaw] = useUiPreference(`pageSize:${storageKey}`, null);

  const parsed = raw == null ? null : parseInt(raw, 10);
  // Ignore tampered / stale values that aren't a current option.
  const pageSize = PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : null;

  const setPageSize = useCallback(
    (n) => {
      if (!PAGE_SIZE_OPTIONS.includes(n)) return;
      setRaw(String(n));
    },
    [setRaw]
  );

  return [pageSize, setPageSize];
}
