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
  const { user, isAuthenticated } = useAuth();
  const [permissions, setPermissions] = useState(new Set());
  const [isSeedAdmin, setIsSeedAdmin] = useState(false);
  const [divisionRestrictions, setDivisionRestrictions] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setPermissions(new Set());
      setIsSeedAdmin(false);
      setDivisionRestrictions({});
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await getMyPermissions();
      setPermissions(new Set(res.data.permissions || []));
      setIsSeedAdmin(res.data.isSeedAdmin === true);
      setDivisionRestrictions(res.data.divisionRestrictions || {});
    } catch {
      setPermissions(new Set());
      setIsSeedAdmin(false);
      setDivisionRestrictions({});
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
