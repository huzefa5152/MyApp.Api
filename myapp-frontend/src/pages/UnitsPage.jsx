import { useState, useEffect, useMemo } from "react";
import { MdStraighten, MdSearch, MdCheck, MdInfo } from "react-icons/md";
import { getAllUnits, updateUnit } from "../api/unitsApi";
import { notify } from "../utils/notify";
import { usePermissions } from "../contexts/PermissionsContext";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  successBg: "#e8f5e9",
  successFg: "#2e7d32",
  successBorder: "#a5d6a7",
};

/**
 * Units configuration — admin grid for the AllowsDecimalQuantity flag on
 * each unit of measure. Drives whether the bill / challan / PO-import
 * forms render the Quantity input as `step="0.0001"` (decimal) or
 * `step="1"` (integer-only).
 *
 * Source of units (assembled by the backend Program.cs backfill):
 *   • FBR master /uom list (44 entries, deduped)
 *   • Every UOM string already in use on ItemType / InvoiceItem / DeliveryItem
 *
 * Defaults flipped on for KG / Liter / Carat / Square Foot / etc. Operators
 * can flip the rest from this page.
 *
 * Permission: config.units.manage gates the toggle. Users without it see
 * the read-only grid but the Save call would fail — the toggle is
 * disabled in the UI in that case.
 */
export default function UnitsPage() {
  const { has } = usePermissions();
  const canManage = has("config.units.manage");

  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState(null); // id currently saving

  useEffect(() => {
    loadUnits();
  }, []);

  const loadUnits = async () => {
    setLoading(true);
    try {
      const { data } = await getAllUnits();
      setUnits(data);
    } catch {
      notify("Failed to load units", "error");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) => (u.name || "").toLowerCase().includes(q));
  }, [units, search]);

  const decimalCount = useMemo(
    () => units.filter((u) => u.allowsDecimalQuantity).length,
    [units]
  );

  const handleToggle = async (unit) => {
    if (!canManage) return;
    const next = !unit.allowsDecimalQuantity;
    setPendingId(unit.id);
    try {
      const { data } = await updateUnit(unit.id, next);
      setUnits((prev) => prev.map((u) => (u.id === unit.id ? data : u)));
      notify(
        `${data.name} → ${
          data.allowsDecimalQuantity ? "decimal allowed" : "integer only"
        }`,
        "success"
      );
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to update unit";
      notify(msg, "error");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>
            <MdStraighten style={{ fontSize: "1.5rem", color: "#fff" }} />
          </div>
          <div>
            <h2 style={styles.headerTitle}>Units of Measure</h2>
            <p style={styles.headerSub}>
              Configure which UOMs allow fractional quantities (KG, Liter, Carat) vs whole numbers only (Pcs, Pair, SET)
            </p>
          </div>
        </div>
      </div>

      {/* Info banner */}
      <div style={styles.infoBanner}>
        <MdInfo style={{ fontSize: "1.1rem", flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            How this drives the bill / challan forms
          </div>
          <div style={{ fontSize: "0.85rem", lineHeight: 1.5 }}>
            When an operator picks a UOM on a bill or challan line, the Quantity
            input switches to decimal mode (up to 4 decimal places, e.g. 12.5 KG
            or 0.0004 Carat) for any unit toggled on here. Units toggled off
            accept whole numbers only — the server rejects 2.5 Pcs with an
            HTTP 400.
            {!canManage && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: "0.82rem",
                  color: colors.textSecondary,
                }}
              >
                Read-only access — you don't have <code>config.units.manage</code>.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary + Search */}
      <div style={styles.toolbar}>
        <div style={styles.summary}>
          <strong>{units.length}</strong> total units ·{" "}
          <strong>{decimalCount}</strong> allow decimals ·{" "}
          <strong>{units.length - decimalCount}</strong> integer-only
        </div>
        <div style={styles.searchWrap}>
          <MdSearch style={{ color: colors.textSecondary, fontSize: "1.1rem" }} />
          <input
            type="text"
            style={styles.searchInput}
            placeholder="Search units…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <p style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary }}>
          Loading units…
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary }}>
          {search ? "No units match your search" : "No units yet"}
        </p>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Unit Name</th>
                <th style={{ ...styles.th, textAlign: "center", width: 220 }}>
                  Allow Decimal Quantity
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const checked = !!u.allowsDecimalQuantity;
                const saving = pendingId === u.id;
                return (
                  <tr key={u.id}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600, color: colors.textPrimary }}>
                        {u.name}
                      </div>
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={() => handleToggle(u)}
                        disabled={!canManage || saving}
                        style={{
                          ...styles.toggleBtn,
                          backgroundColor: checked
                            ? colors.successBg
                            : colors.inputBg,
                          color: checked ? colors.successFg : colors.textSecondary,
                          border: `1px solid ${
                            checked ? colors.successBorder : colors.inputBorder
                          }`,
                          cursor: canManage ? "pointer" : "not-allowed",
                          opacity: saving ? 0.6 : 1,
                        }}
                        title={
                          canManage
                            ? checked
                              ? `Click to lock ${u.name} to whole numbers only`
                              : `Click to allow up to 4 decimal places for ${u.name}`
                            : "You don't have permission to change this"
                        }
                      >
                        {checked ? (
                          <>
                            <MdCheck style={{ fontSize: "1rem" }} /> Decimal allowed
                          </>
                        ) : (
                          "Integer only"
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- styles ---------- */
const styles = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    margin: 0,
    fontSize: "1.4rem",
    fontWeight: 700,
    color: colors.textPrimary,
  },
  headerSub: {
    margin: "0.2rem 0 0",
    fontSize: "0.88rem",
    color: colors.textSecondary,
    maxWidth: 700,
  },
  infoBanner: {
    display: "flex",
    gap: "0.75rem",
    background: "#eef4fb",
    border: "1px solid #b7d4f0",
    color: "#0d47a1",
    padding: "0.85rem 1rem",
    borderRadius: 10,
    marginBottom: "1.25rem",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  summary: {
    fontSize: "0.9rem",
    color: colors.textSecondary,
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    background: colors.inputBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    padding: "0.45rem 0.75rem",
    minWidth: 240,
  },
  searchInput: {
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: "0.9rem",
    color: colors.textPrimary,
    flex: 1,
  },
  tableWrap: {
    background: "#fff",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12,
    // Was overflow:hidden which clipped content on mobile. overflowX
    // lets the wrapper scroll horizontally when the units table
    // (Name / Allows Decimal / Used By) is wider than the viewport.
    overflowX: "auto",
    overflowY: "hidden",
    WebkitOverflowScrolling: "touch",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    padding: "0.75rem 1rem",
    fontSize: "0.78rem",
    fontWeight: 700,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    background: "#f8fafc",
    borderBottom: `1px solid ${colors.cardBorder}`,
  },
  td: {
    padding: "0.75rem 1rem",
    fontSize: "0.92rem",
    color: colors.textPrimary,
    borderBottom: `1px solid ${colors.cardBorder}`,
  },
  toggleBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.4rem 0.85rem",
    borderRadius: 999,
    fontSize: "0.82rem",
    fontWeight: 600,
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
    minWidth: 150,
    justifyContent: "center",
  },
};
