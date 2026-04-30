import { useEffect, useState } from "react";
import { MdGroups, MdBusiness, MdEdit } from "react-icons/md";
import { getCommonSuppliers } from "../api/supplierApi";

/**
 * "Common Suppliers" panel — mirror of <see cref="CommonClientsPanel"/>
 * for the purchase side. Sits above the per-company supplier list on
 * SuppliersPage; shows suppliers that exist in 2+ companies. Single-
 * company suppliers DO NOT appear here.
 *
 * Stable across the company dropdown — switching companies doesn't
 * change the panel content (Common Suppliers are cross-tenant by
 * definition).
 */
const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  groupBg: "#f0f7ff",
  groupBorder: "#b7d4f0",
};

export default function CommonSuppliersPanel({ companyId, onEdit, refreshKey }) {
  const [common, setCommon] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) {
      setCommon([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await getCommonSuppliers(companyId);
        if (!cancelled) setCommon(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) {
          setCommon([]);
          setError(e?.response?.data?.message || "Could not load common suppliers.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, refreshKey]);

  if (!loading && common.length === 0 && !error) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <MdGroups size={20} color={colors.blue} />
        <span style={styles.title}>Common Suppliers</span>
        <span style={styles.subtitle}>
          {loading ? "loading…"
            : `${common.length} supplier${common.length !== 1 ? "s" : ""} shared across companies`}
        </span>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {!loading && common.length > 0 && (
        <div style={styles.grid}>
          {common.map((c) => (
            <button
              key={c.groupId}
              type="button"
              style={styles.card}
              onClick={() => onEdit?.(c)}
              title="Edit common supplier (changes apply to every company)"
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
            >
              <div style={styles.cardName}>{c.displayName}</div>
              <div style={styles.cardMeta}>
                {c.ntn ? <span>NTN <strong>{c.ntn}</strong> · </span> : null}
                <MdBusiness size={13} style={{ verticalAlign: "-2px" }} />{" "}
                {c.companyCount} compan{c.companyCount === 1 ? "y" : "ies"}
              </div>
              {c.companyNames?.length > 0 && (
                <div style={styles.cardCompanies} title={c.companyNames.join(", ")}>
                  {c.companyNames.join(" · ")}
                </div>
              )}
              <div style={styles.cardEdit}>
                <MdEdit size={13} /> Edit (propagates to all)
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  panel: {
    background: colors.groupBg,
    border: `1px solid ${colors.groupBorder}`,
    borderRadius: 12,
    padding: "1rem 1.1rem",
    marginBottom: "1.25rem",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.75rem",
    flexWrap: "wrap",
  },
  title: { fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary },
  subtitle: { fontSize: "0.78rem", color: colors.textSecondary, marginLeft: "0.4rem" },
  error: {
    fontSize: "0.82rem",
    color: "#842029",
    background: "#fff0f1",
    border: "1px solid #f5c6cb",
    padding: "0.4rem 0.6rem",
    borderRadius: 8,
    marginBottom: "0.5rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "0.75rem",
  },
  card: {
    textAlign: "left",
    background: "#fff",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    padding: "0.7rem 0.85rem",
    cursor: "pointer",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
    boxShadow: "0 1px 4px rgba(13,71,161,0.06)",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    fontFamily: "inherit",
    color: colors.textPrimary,
  },
  cardName: { fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary },
  cardMeta: { fontSize: "0.78rem", color: colors.textSecondary },
  cardCompanies: {
    fontSize: "0.74rem",
    color: colors.textSecondary,
    fontStyle: "italic",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardEdit: {
    marginTop: "0.35rem",
    fontSize: "0.74rem",
    color: colors.blue,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
  },
};
