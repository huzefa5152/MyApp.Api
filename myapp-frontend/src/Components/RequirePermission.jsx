import { Navigate } from "react-router-dom";
import { usePermissions } from "../contexts/PermissionsContext";

/**
 * Client-side route guard. Renders its children only when the current user has
 * the required permission(s); otherwise redirects to /dashboard (always
 * reachable). This is defence-in-depth for the "type the URL directly" gap —
 * the real enforcement is server-side [HasPermission] on every endpoint. It
 * mirrors what the sidebar nav already hides via <Can>, so a user never lands
 * on a page whose module they hold zero permissions for.
 *
 * Matching (any one satisfies; seed admin always passes):
 *   - permission   a single exact key             has(key)
 *   - anyOf        a list of exact keys           hasAny(keys)
 *   - anyPrefix    a module prefix or list of them — passes if the user holds
 *                  ANY permission key starting with a prefix (e.g. "clients.").
 *                  Prefix is the norm here so holding ANY capability in a
 *                  module (view OR create OR update …) grants page access — a
 *                  create-only role is never locked out of the screen it works on.
 *
 * With no constraint prop it renders children (open page).
 */
export default function RequirePermission({ permission, anyOf, anyPrefix, children }) {
  const { has, hasAny, isSeedAdmin, permissions, loading } = usePermissions();

  // Don't decide until the permission set has loaded, or we'd bounce the user
  // to /dashboard on a hard refresh before /permissions/me resolves.
  if (loading) return null;

  let allowed = isSeedAdmin;
  if (!allowed && permission) allowed = has(permission);
  if (!allowed && anyOf) allowed = hasAny(anyOf);
  if (!allowed && anyPrefix) {
    const prefixes = Array.isArray(anyPrefix) ? anyPrefix : [anyPrefix];
    for (const key of permissions) {
      if (prefixes.some((p) => key.startsWith(p))) { allowed = true; break; }
    }
  }
  // No constraint given → treat as open.
  if (!permission && !anyOf && !anyPrefix) allowed = true;

  return allowed ? children : <Navigate to="/dashboard" replace />;
}
