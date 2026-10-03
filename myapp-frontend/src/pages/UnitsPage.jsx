import { useState, useEffect, useMemo } from "react";
import { MdStraighten, MdCheck, MdInfo } from "react-icons/md";
import { getAllUnits, updateUnit } from "../api/unitsApi";
import { notify } from "../utils/notify";
import { usePermissions } from "../contexts/PermissionsContext";
import { PageHeader, CompanyPicker, Alert, Toolbar, ToolbarSpacer, SearchBox, TableWrap, EmptyState, Loading } from "../ui/Kit";

import { useCompany } from "../contexts/CompanyContext";

const colors = {
  textSecondary: "#5f6d7e",
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
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const canManage = has("config.units.manage");

  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState(null); // id currently saving

  useEffect(() => {
    if (selectedCompany?.id) loadUnits();
    else setUnits([]);
  }, [selectedCompany?.id]);

  const loadUnits = async () => {
    setLoading(true);
    try {
      const { data } = await getAllUnits(selectedCompany?.id);
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
      <PageHeader
        icon={MdStraighten}
        tone="brand"
        title="Units of Measure"
        subtitle="Configure which UOMs allow fractional quantities (KG, Liter, Carat) vs whole numbers only (Pcs, Pair, SET)"
      />

      <CompanyPicker label="Catalog company" />

      {/* Info banner */}
      <Alert tone="info" icon={MdInfo}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          How this drives the bill / challan forms
        </div>
        <div style={{ lineHeight: 1.5 }}>
          When an operator picks a UOM on a bill or challan line, the Quantity
          input switches to decimal mode (up to 4 decimal places, e.g. 12.5 KG
          or 0.0004 Carat) for any unit toggled on here. Units toggled off
          accept whole numbers only — the server rejects 2.5 Pcs with an
          HTTP 400.
          {!canManage && (
            <div style={{ marginTop: 6, fontSize: "var(--k-font-sm)", color: "var(--k-muted)" }}>
              Read-only access — you don't have <code>config.units.manage</code>.
            </div>
          )}
        </div>
      </Alert>

      {/* Summary + Search */}
      <Toolbar>
        <div style={styles.summary}>
          <strong>{units.length}</strong> total units ·{" "}
          <strong>{decimalCount}</strong> allow decimals ·{" "}
          <strong>{units.length - decimalCount}</strong> integer-only
        </div>
        <ToolbarSpacer />
        <SearchBox value={search} onChange={setSearch} placeholder="Search units…" />
      </Toolbar>

      {/* Grid */}
      {loading ? (
        <Loading>Loading units…</Loading>
      ) : filtered.length === 0 ? (
        <EmptyState icon={MdStraighten}>
          {search ? "No units match your search" : "No units yet"}
        </EmptyState>
      ) : (
        <TableWrap>
          <table className="k-table">
            <thead>
              <tr>
                <th>Unit Name</th>
                <th className="is-center" style={{ width: 220 }}>
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
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--k-ink)", overflowWrap: "anywhere" }}>
                        {u.name}
                      </div>
                    </td>
                    <td className="is-center">
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
        </TableWrap>
      )}
    </div>
  );
}

/* ---------- styles ---------- */
const styles = {
  summary: {
    fontSize: "var(--k-font)",
    color: "var(--k-muted)",
  },
  // Pill toggle — global `button` rule in index.css is overridden (boxShadow / minHeight)
  // so the pill keeps its shape; height follows the theme's control height.
  toggleBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    minHeight: "calc(var(--k-h) - 6px)",
    padding: "0 0.85rem",
    borderRadius: 999,
    fontSize: "var(--k-font-sm)",
    fontWeight: 600,
    boxShadow: "none",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
    minWidth: 150,
    justifyContent: "center",
  },
};
