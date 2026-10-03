import { Suspense } from "react";
import { Outlet, useLocation, Link } from "react-router-dom";
import { MdLock } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { permissionForPath } from "../config/routePermissions";
import { useCompany } from "../contexts/CompanyContext";
import { colors } from "../theme";
import "../ui/kit.css";
import "../ui/shared-components.css";

/**
 * Route-level permission gate. Wraps every screen inside the dashboard layout:
 * the page does not mount at all unless the signed-in user holds the key
 * `config/routePermissions.js` records for that path.
 *
 * Why this exists. The sidebar already hid links an operator could not use,
 * but the URL still worked — so a role without `accounting.coa.view` could
 * type /chart-of-accounts, mount the page, fire its loads and get a screen of
 * failed requests. That reads as a broken product rather than a closed door,
 * and it is what makes an edition (Sales vs Complete) look leaky even though
 * every endpoint behind it refuses correctly.
 *
 * This is NOT the security boundary — the server is, via [HasPermission] on
 * every action. This makes the refusal honest, legible, and named, so the
 * operator can take the key to whoever administers their roles.
 *
 * Fails CLOSED. A path with no entry in the map is treated as undecided and
 * refused, so adding a screen without deciding who may see it is visible
 * immediately rather than shipping open.
 */
export default function RequirePermission() {
  const { pathname } = useLocation();
  const { selectedCompany, loading: companyLoading } = useCompany();
  const { has, loading, reload } = usePermissions();

  const required = permissionForPath(pathname);

  // Still fetching /permissions/me — deny nothing yet, or every screen would
  // flash its denial on a hard refresh.
  if (loading || companyLoading) return null;

  // null = open to every signed-in user (e.g. the operator's own profile).
  if (required === null) return <Suspense fallback={null}><Outlet key={selectedCompany?.id || "none"} /></Suspense>;
  if (required !== undefined && has(required)) return <Suspense fallback={null}><Outlet key={selectedCompany?.id || "none"} /></Suspense>;

  return <NoAccess permission={required} pathname={pathname} onRetry={reload} />;
}

function NoAccess({ permission, pathname, onRetry }) {
  const { has } = usePermissions();
  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.icon}><MdLock size={26} /></div>
        <h2 style={styles.title}>You don't have access to this screen</h2>
        <p style={styles.body}>
          Your role doesn't include{" "}
          {permission ? (
            <>the <code style={styles.code}>{permission}</code> permission, which is what</>
          ) : (
            <>a permission for</>
          )}{" "}
          <code style={styles.code}>{pathname}</code> requires.
        </p>
        <p style={styles.body}>
          Ask whoever administers your account to add it under{" "}
          <b>Administration &rarr; Roles &amp; Permissions</b>, or to move you
          onto a role that already has it.
        </p>
        <div style={styles.actions}>
          <Link to={has("dashboard.view") ? "/dashboard" : "/profile"} className="k-btn k-btn--primary">
            {has("dashboard.view") ? "Go to the dashboard" : "Go to my profile"}
          </Link>
          {/* /permissions/me failing leaves the set empty, which looks exactly
              like holding nothing. Rather than guess which it was, offer the
              re-read — a transient failure clears in one click, and a genuine
              refusal simply says the same thing again. */}
          <button type="button" onClick={onRetry} className="k-btn k-btn--secondary">
            Check again
          </button>
        </div>
      </div>
    </div>
  );
}

// Colours from the kit tokens (Classic values = the original palette); sizes from
// --sc-* tokens with the original values as the Classic fallback.
const styles = {
  wrap: {
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "2rem 1rem",
  },
  card: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: "var(--k-surface, #ffffff)",
    border: "1px solid var(--k-line, #e8edf3)",
    borderRadius: 12,
    padding: "var(--sc-panel-pad, 1.75rem 1.5rem)",
    textAlign: "center",
    boxShadow: "0 1px 3px rgba(10,22,40,0.06)",
  },
  icon: {
    display: "grid",
    placeItems: "center",
    width: 52,
    height: 52,
    margin: "0 auto 0.9rem",
    borderRadius: "50%",
    backgroundColor: "#fff8e1",
    color: "#e65100",
  },
  title: { margin: "0 0 0.6rem", fontSize: "var(--sc-panel-title, 1.15rem)", color: "var(--k-ink, #1a2332)" },
  body: { margin: "0 0 0.7rem", fontSize: "var(--k-font, 0.9rem)", lineHeight: 1.5, color: "var(--k-muted, #5f6d7e)" },
  code: {
    fontFamily: "monospace",
    padding: "0.1rem 0.3rem",
    borderRadius: 4,
    backgroundColor: colors.inputBg,
    border: "1px solid var(--k-line-strong, #d0d7e2)",
    fontSize: "0.82rem",
    color: "var(--k-ink, #1a2332)",
    wordBreak: "break-all",
  },
  actions: {
    marginTop: "1.1rem",
    display: "flex",
    gap: "0.6rem",
    justifyContent: "center",
    flexWrap: "wrap",
  },
};