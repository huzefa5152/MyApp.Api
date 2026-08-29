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
 * Also carries per-company division restrictions
 * (`divisionRestrictions: { [companyId]: number[] }` — key present only when
 * the user is division-restricted in that company) with lookup helpers
 * `isDivisionRestricted`, `getAccessibleDivisions`, `canAccessDivision`.
 *
 * Refreshes whenever the authenticated user changes.
 */
export function PermissionsProvider({ children }) {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [permissions, setPermissions] = useState(new Set());
  const [isSeedAdmin, setIsSeedAdmin] = useState(false);
  const [divisionRestrictions, setDivisionRestrictions] = useState({});

  // Whose permission set is currently in state — the signed-in user's key, or
  // ANONYMOUS once we've settled that nobody is signed in.
  //
  // This replaces a plain `loading` flag, and it is the fix for the
  // hard-refresh bug (2026-08-30): opening /invoices directly, or ctrl-clicking
  // a sidebar link, used to land on /dashboard. On boot the provider ran once
  // while auth was still bootstrapping, took the not-authenticated branch and
  // set loading = false with an EMPTY permission set. Auth then resolved, and
  // for the render between that and the reload effect firing, RequirePermission
  // saw "loaded, and you have nothing" — so it redirected. Deriving loading
  // from *who* the loaded set belongs to closes that window: the moment the
  // user changes, loading is true again in the same render, with no effect
  // needing to run first.
  const ANONYMOUS = "anonymous";
  const [loadedFor, setLoadedFor] = useState(null);

  const userKey = user?.id ?? user?.username ?? null;

  const load = useCallback(async () => {
    // Auth hasn't finished restoring the session yet — decide nothing.
    if (authLoading) return;

    if (!isAuthenticated) {
      setPermissions(new Set());
      setIsSeedAdmin(false);
      setDivisionRestrictions({});
      setLoadedFor(ANONYMOUS);
      return;
    }
    try {
      const res = await getMyPermissions();
      setPermissions(new Set(res.data.permissions || []));
      setIsSeedAdmin(res.data.isSeedAdmin === true);
      setDivisionRestrictions(res.data.divisionRestrictions || {});
    } catch {
      setPermissions(new Set());
      setIsSeedAdmin(false);
      setDivisionRestrictions({});
    } finally {
      setLoadedFor(userKey ?? ANONYMOUS);
    }
  }, [authLoading, isAuthenticated, userKey]);

  useEffect(() => { load(); }, [load]);

  // Derived, never stale: true until the set in state belongs to the user we
  // currently have. Consumers (RequirePermission, sidebar gates) must not act
  // on an empty set while this is true.
  const loading = authLoading || (isAuthenticated
    ? loadedFor !== (userKey ?? ANONYMOUS)
    : loadedFor !== ANONYMOUS);

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

  // A company key is present only when the user is division-restricted there.
  // JSON object keys arrive as strings, so coerce the caller's companyId.
  const isDivisionRestricted = useCallback(
    (companyId) => {
      if (isSeedAdmin || companyId == null || companyId === "") return false;
      return Object.prototype.hasOwnProperty.call(divisionRestrictions, String(companyId));
    },
    [divisionRestrictions, isSeedAdmin]
  );

  // Returns the allowed division ids for the company, or null when unrestricted.
  const getAccessibleDivisions = useCallback(
    (companyId) => {
      if (isSeedAdmin || companyId == null || companyId === "") return null;
      const list = divisionRestrictions[String(companyId)];
      return Array.isArray(list) ? list : null;
    },
    [divisionRestrictions, isSeedAdmin]
  );

  const canAccessDivision = useCallback(
    (companyId, divisionId) => {
      const list = getAccessibleDivisions(companyId);
      if (list == null) return true;
      return list.some((id) => Number(id) === Number(divisionId));
    },
    [getAccessibleDivisions]
  );

  const value = useMemo(
    () => ({
      permissions, isSeedAdmin, loading, has, hasAny, hasAll,
      divisionRestrictions, isDivisionRestricted, getAccessibleDivisions, canAccessDivision,
      reload: load,
    }),
    [permissions, isSeedAdmin, loading, has, hasAny, hasAll,
     divisionRestrictions, isDivisionRestricted, getAccessibleDivisions, canAccessDivision, load]
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
