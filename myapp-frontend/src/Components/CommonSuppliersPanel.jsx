import { useEffect, useState } from "react";
import { MdGroups, MdBusiness, MdEdit } from "react-icons/md";
import { getCommonSuppliers } from "../api/supplierApi";
import { Card, Alert } from "../ui/Kit";

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
    <Card
      tone="blue"
      icon={MdGroups}
      title={(
        <>
          Common Suppliers
          <span style={styles.subtitle}>
            {loading ? "loading…"
              : `${common.length} supplier${common.length !== 1 ? "s" : ""} shared across companies`}
          </span>
        </>
      )}
      style={styles.panel}
    >
      {error && <Alert tone="error">{error}</Alert>}

      {!loading && common.length > 0 && (
        <div style={styles.grid}>
          {common.map((c) => (
            <button
              key={c.groupId}
              type="button"
              style={styles.card}
              onClick={() => onEdit?.(c)}
              title="Edit common supplier (changes apply to every company)"
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
    </Card>
  );
}

// Panel-specific layout; colours and sizes come from the kit tokens so the panel follows the theme.
const styles = {
  panel: { marginBottom: "var(--k-gap)", background: "var(--k-tone-soft)" },
  subtitle: { fontSize: "var(--k-font-sm)", fontWeight: 400, color: "var(--k-muted)", marginLeft: "0.4rem" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
    gap: "0.75rem",
  },
  card: {
    textAlign: "left",
    background: "var(--k-surface)",
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
    padding: "0.7rem 0.85rem",
    margin: 0,
    cursor: "pointer",
    boxShadow: "none",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    fontFamily: "inherit",
    fontWeight: 400,
    color: "var(--k-ink)",
    minWidth: 0,
  },
  cardName: { fontSize: "calc(var(--k-font) + 0.05rem)", fontWeight: 700, color: "var(--k-ink)", overflowWrap: "anywhere" },
  cardMeta: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  // Two-line clamp (not nowrap + ellipsis) so similar company lists stay distinguishable.
  cardCompanies: {
    fontSize: "0.74rem",
    color: "var(--k-muted)",
    fontStyle: "italic",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  cardEdit: {
    marginTop: "0.35rem",
    fontSize: "0.74rem",
    color: "var(--k-blue)",
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
  },
};
