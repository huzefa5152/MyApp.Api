import { Link } from "react-router-dom";
import { MdBusiness, MdLockOutline } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import "../ui/kit.css";
import "../ui/shared-components.css";

/**
 * Shown in place of any company-dependent screen when the signed-in
 * user has no accessible company. Two causes, one screen:
 *   - nothing has been created yet (fresh installation, or an
 *     Administrator whose first act is to create a company), or
 *   - every grant was revoked by whoever manages this account.
 *
 * The server already refuses every companyId-scoped call for a company
 * the user cannot access, so this page is UX only — it is never what
 * protects the data. DashboardLayout renders it for every route that
 * needs a company; company-free screens (Companies, Users, Roles,
 * Tenant Access, Administrators, Profile, Audit Logs) stay reachable so
 * the situation can actually be fixed from inside the app.
 */
export default function NoCompanyConfigured() {
  const { has } = usePermissions();
  const canCreate = has("companies.manage.create");

  return (
    <div style={styles.wrap} data-testid="no-company-configured">
      <div style={styles.card}>
        <div style={styles.iconWrap} className="sc-hero-icon">
          {canCreate ? <MdBusiness size={40} /> : <MdLockOutline size={40} />}
        </div>
        <h2 style={styles.title}>No Company Configured</h2>
        <p style={styles.text}>
          {canCreate
            ? "This account has no company to work in yet. Create one to start recording challans, bills and invoices."
            : "This account currently has access to no company. Ask your administrator to assign a company to your account."}
        </p>
        {canCreate && (
          <Link to="/companies/list" className="k-btn k-btn--primary">
            <MdBusiness size={18} />
            Go to Companies
          </Link>
        )}
      </div>
    </div>
  );
}

// Colours from the kit tokens (Classic values = the original palette); sizes from
// --sc-* tokens with the original values as the Classic fallback. The button is the
// kit primary button (ui/kit.css).
const styles = {
  wrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    padding: "1rem",
  },
  card: {
    width: "100%",
    maxWidth: 480,
    textAlign: "center",
    background: "var(--k-surface, #ffffff)",
    border: "1px solid var(--k-line, #e8edf3)",
    borderRadius: 16,
    padding: "var(--sc-panel-pad, clamp(1.5rem, 4vw, 2.5rem))",
    boxShadow: "var(--k-card-shadow, 0 1px 3px rgba(16,32,64,0.04), 0 6px 18px rgba(16,32,64,0.06))",
  },
  iconWrap: {
    width: "var(--sc-hero-icon, 72px)",
    height: "var(--sc-hero-icon, 72px)",
    margin: "0 auto 1rem",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: "#e8f0fe",
    color: "var(--k-blue, #0d47a1)",
  },
  title: {
    margin: "0 0 0.5rem",
    fontSize: "var(--sc-hero-title, 1.35rem)",
    color: "var(--k-ink, #1a2332)",
  },
  text: {
    margin: "0 0 1.25rem",
    color: "var(--k-muted, #5f6d7e)",
    fontSize: "var(--sc-text, inherit)",
    lineHeight: 1.5,
  },
};