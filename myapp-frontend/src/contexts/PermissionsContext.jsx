// src/contexts/PermissionsContext.jsx
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { getMyPermissions } from "../api/rbacApi";
import { useAuth } from "./AuthContext";

const PermissionsContext = createContext(null);

/**
 * Loads the current user's permission set from /api/permissions/me and
 * exposes fast lookup helpers (`has`, `hasAny`, `hasAll`). Seed admin short-
 * circuits to a yes-to-everything answer because the backend grants them
 * every key anyway.
 *
 * Refreshes whenever the authenticated user changes.
 */
export function PermissionsProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [permissions, setPermissions] = useState(new Set());
  const [isSeedAdmin, setIsSeedAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setPermissions(new Set());
      setIsSeedAdmin(false);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await getMyPermissions();
      setPermissions(new Set(res.data.permissions || []));
      setIsSeedAdmin(res.data.isSeedAdmin === true);
    } catch {
      setPermissions(new Set());
      setIsSeedAdmin(false);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { load(); }, [load, user?.id, user?.username]);

  const has = useCallback(
    (key) => {
      if (!key) return true;
      if (isSeedAdmin) return true;
      return permissions.has(key);
    },
    [permissions, isSeedAdmin]
  );

  const hasAny = useCallback(
    (keys) => {
      if (!keys || keys.length === 0) return true;
      if (isSeedAdmin) return true;
      return keys.some((k) => permissions.has(k));
    },
    [permissions, isSeedAdmin]
  );

  const hasAll = useCallback(
    (keys) => {
      if (!keys || keys.length === 0) return true;
      if (isSeedAdmin) return true;
      return keys.every((k) => permissions.has(k));
    },
    [permissions, isSeedAdmin]
  );

  const value = useMemo(
    () => ({ permissions, isSeedAdmin, loading, has, hasAny, hasAll, reload: load }),
    [permissions, isSeedAdmin, loading, has, hasAny, hasAll, load]
  );

  return (
    <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be used inside <PermissionsProvider>");
  return ctx;
}

/**
 * Declarative gate. Renders children only when the caller has the permission
 * (or any/all of several). Renders `fallback` (defaults to nothing) otherwise.
 *
 * Examples:
 *   <Can permission="users.manage.create"><button>…</button></Can>
 *   <Can anyOf={["roles.view","rbac.roles.view"]}>…</Can>
 */
// eslint-disable-next-line react-refresh/only-export-components
export function Can({ permission, anyOf, allOf, fallback = null, children }) {
  const { has, hasAny, hasAll } = usePermissions();
  let allowed = true;
  if (permission) allowed = allowed && has(permission);
  if (anyOf) allowed = allowed && hasAny(anyOf);
  if (allOf) allowed = allowed && hasAll(allOf);
  return allowed ? children : fallback;
}

export default PermissionsContext;
