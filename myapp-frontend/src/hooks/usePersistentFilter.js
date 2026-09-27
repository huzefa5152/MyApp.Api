import { useCallback, useState } from "react";

// A search box or filter that survives leaving the screen and coming back.
//
// Operators set a filter, open another screen from the sidebar, return, and
// found the list reset — the page unmounts, so plain useState starts over.
// This keeps the value in sessionStorage instead: it lives until the operator
// clears it themselves, or the browser tab is closed. sessionStorage (not
// localStorage) on purpose — a filter restored days later reads as missing
// data, and a tab is the natural end of "what I was looking at".
//
//   const [search, setSearch] = usePersistentFilter("invoices", "search", "");
//
// Values are JSON, so strings, numbers, booleans, arrays and plain objects all
// round-trip. Storage failures (private mode, quota) fall back to in-memory
// state, exactly like useUiPreference.
//
// Keys are namespaced "filter:<screen>:<name>" so logout can drop all of them
// (clearPersistentFilters) and the next person at the keyboard starts clean.

const PREFIX = "filter:";

const storageKey = (screen, name) => `${PREFIX}${screen}:${name}`;

function read(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export default function usePersistentFilter(screen, name, initialValue) {
  const key = storageKey(screen, name);
  const [value, setValue] = useState(() => read(key, initialValue));

  const update = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try {
        if (resolved === undefined) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(resolved));
      } catch { /* private mode — non-fatal */ }
      return resolved;
    });
  }, [key]);

  return [value, update];
}

/** True when this screen has a remembered value for `name` — lets a page skip
 *  a "reset on company change" effect on its very first run, which would
 *  otherwise wipe the filter it just restored. */
export function hasPersistentFilter(screen, name) {
  try { return sessionStorage.getItem(storageKey(screen, name)) != null; }
  catch { return false; }
}

/** Drop every remembered filter. Called on logout. */
export function clearPersistentFilters() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch { /* non-fatal */ }
}
