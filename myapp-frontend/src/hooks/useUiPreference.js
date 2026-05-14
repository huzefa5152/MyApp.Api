import { useCallback, useEffect, useState } from "react";

// localStorage-backed user preference. Survives reloads + new sessions.
// Falls back gracefully if storage is unavailable (private mode / locked-down
// browsers) — state still works, it just doesn't persist.
//
// Example:
//   const [viewMode, setViewMode] = useUiPreference("viewMode:challans", "card");
export function useUiPreference(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? defaultValue : raw;
    } catch {
      return defaultValue;
    }
  });

  const update = useCallback((next) => {
    setValue(next);
    try {
      if (next == null) localStorage.removeItem(key);
      else localStorage.setItem(key, next);
    } catch {
      /* private mode — non-fatal */
    }
  }, [key]);

  // Keep tabs in sync if the same key changes in another tab.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === key) setValue(e.newValue == null ? defaultValue : e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, defaultValue]);

  return [value, update];
}
