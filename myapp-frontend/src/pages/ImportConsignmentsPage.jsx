import { useState, useEffect, useCallback, Fragment } from "react";
import { MdExpandMore, MdChevronRight, MdDelete, MdWarning } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import { useCompany } from "../contexts/CompanyContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors } from "../theme";
import Pagination from "../Components/Pagination";
import { getImportConsignments, getImportConsignment, deleteImportConsignment } from "../api/importConsignmentApi";

/**
 * Purchases → Consignments.
 *
 * The read + correction side of the GD costing import (Task 21):
 * GdCostingImportPage writes a consignment; this is where an operator looks at
 * what was written and, if it was wrong, deletes it. A row expands to its
 * lines — the disposition note on each is the record of what the import
 * decided and why, and is the main reason to look at this screen at all.
 */

const MODE_LABEL = { backfill: "Backfill", "new-arrivals": "New Arrivals" };
const DISPOSITION_LABEL = {
  "cost-only": "Cost set", "stock-posted": "Stock created",
  "skipped": "Skipped", "ambiguous": "Ambiguous",
};
const DISPOSITION_TONE = {
  "cost-only": colors.success, "stock-posted": colors.success,
  "skipped": colors.textSecondary, "ambiguous": "#b26a00",
};

const money = (n) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const dt = (s) => (s ? new Date(s).toLocaleDateString() : "—");

const card = {
  background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
  borderRadius: 12, padding: "1rem 1.1rem", marginBottom: "1rem",
};
const grid = {
  display: "grid", gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
};
const input = {
  width: "100%", padding: "0.55rem 0.65rem", borderRadius: 8,
  border: `1px solid ${colors.inputBorder}`, background: colors.inputBg,
  color: colors.textPrimary, fontSize: 14, minHeight: 44, boxSizing: "border-box",
};
const th = {
  textAlign: "left", padding: "0.5rem 0.6rem", fontSize: 12,
  textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary,
  borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap",
};
const td = {
  padding: "0.55rem 0.6rem", fontSize: 13.5, borderBottom: `1px solid ${colors.cardBorder}`,
  verticalAlign: "top",
};
// User-supplied text (GD description, disposition note) must never use
// nowrap+ellipsis -- it visually collapses distinct values sharing a prefix.
const wrap2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

function Banner({ tone, icon: Icon, children }) {
  const tint = { error: colors.dangerLight, warn: "#fff8e6", ok: "#eefaf1" }[tone];
  const line = { error: colors.danger, warn: "#b26a00", ok: colors.success }[tone];
  return (
    <div style={{
      display: "flex", gap: 10, padding: "0.7rem 0.85rem", borderRadius: 9,
      background: tint, borderLeft: `3px solid ${line}`, marginBottom: "0.6rem",
      fontSize: 14, color: colors.textPrimary,
    }}>
      <Icon size={18} style={{ color: line, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function Badge({ tone, children }) {
  return (
    <span style={{
      display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: 999,
      fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em",
      color: "#fff", background: tone, whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

/** Row-level "iconBtn" — fixed-size, grid-centered per the house pattern, so
 * the delete icon is never a flex/SVG sizing gamble. */
function iconBtn(tone, disabled) {
  return {
    display: "grid", placeItems: "center", width: 40, height: 40,
    borderRadius: 8, border: "none", background: disabled ? "#c8d1de" : tone,
    color: "#fff", cursor: disabled ? "not-allowed" : "pointer", flexShrink: 0,
  };
}

/** What a delete would undo, phrased for the confirmation dialog — computed
 * from a loaded detail, never guessed. */
function describeUndo(detail) {
  const parts = [];
  const hasCostOnly = (detail.lines || []).some((l) => l.disposition === "cost-only");
  const hasStockPosted = (detail.lines || []).some((l) => l.disposition === "stock-posted");
  if (hasCostOnly) {
    parts.push(detail.mode === "new-arrivals"
      ? "subtract back out the quantity, cost and value it added to the opening balance(s) it matched"
      : "reset the actual cost it set on the opening balance(s) it matched to 0.00 (it SET the cost, so there is no prior figure to restore)");
  }
  if (hasStockPosted) parts.push("remove the opening balance(s) it created");
  if (detail.hasJournalEntry) parts.push("withdraw the journal entry it posted to the general ledger");
  if (parts.length === 0) return "This consignment did not write anything to stock or the ledger — there is nothing else to undo.";
  return `This will ${parts.join("; ")}.`;
}

function ConsignmentLines({ detail, loading }) {
  if (loading) return <p style={{ fontSize: 13, color: colors.textSecondary, margin: "0.6rem 0" }}>Loading lines…</p>;
  if (!detail) return null;
  return (
    <div style={{ overflowX: "auto", marginTop: "0.6rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
        <thead>
          <tr>
            <th style={th}>HS code</th>
            <th style={th}>Description</th>
            <th style={{ ...th, textAlign: "right" }}>Quantity</th>
            <th style={{ ...th, textAlign: "right" }}>Cost</th>
            <th style={{ ...th, textAlign: "right" }}>Selling value</th>
            <th style={th}>Item / balance</th>
            <th style={th}>Disposition</th>
            <th style={th}>Note</th>
          </tr>
        </thead>
        <tbody>
          {(detail.lines || []).map((l) => (
            <tr key={l.id}>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{l.hsCode || "—"}</td>
              <td style={td}><div style={wrap2}>{l.descriptionOnSheet || "—"}</div></td>
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {qty(l.quantity)}{l.unit ? ` ${l.unit}` : ""}
              </td>
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.costExcludingTax)}</td>
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(l.sellingValueExcludingTax)}</td>
              <td style={td}><div style={wrap2}>{l.itemTypeName || "—"}</div></td>
              <td style={td}>
                <span style={{
                  color: DISPOSITION_TONE[l.disposition] || colors.textSecondary,
                  fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.02em",
                }}>
                  {DISPOSITION_LABEL[l.disposition] || l.disposition}
                </span>
              </td>
              <td style={td}><div style={wrap2}>{l.dispositionNote || "—"}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ImportConsignmentsPage() {
  const { has } = usePermissions();
  const { companies, selectedCompany } = useCompany();
  const confirm = useConfirm();

  const [companyId, setCompanyId] = useState(selectedCompany?.id || "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const canView = has("importcosting.consignments.view");
  const canDelete = has("importcosting.sheet.run");

  useEffect(() => { if (selectedCompany?.id && !companyId) setCompanyId(selectedCompany.id); },
    [selectedCompany, companyId]);
  useEffect(() => { setPage(1); setExpandedId(null); setDetail(null); }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId || !canView) { setResult(null); return; }
    setLoading(true);
    try {
      const { data } = await getImportConsignments({ companyId, page, pageSize });
      setResult(data);
    } catch { /* httpClient surfaces it */ } finally { setLoading(false); }
  }, [companyId, page, pageSize, canView]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    try {
      const { data } = await getImportConsignment(id);
      setDetail(data);
      return data;
    } catch {
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const toggleRow = async (id) => {
    if (expandedId === id) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(id); setDetail(null);
    await loadDetail(id);
  };

  const onDelete = async (row) => {
    // The confirmation must state what will actually be undone -- load the
    // detail (unless this row is already expanded and loaded) rather than
    // guess from the list row alone.
    const d = expandedId === row.id && detail ? detail : await loadDetail(row.id);
    if (!d) { notify("Could not load this consignment's detail.", "error"); return; }

    const ok = await confirm({
      title: `Delete GD ${row.gdNumber}?`,
      message: `${describeUndo(d)} This cannot be undone.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;

    setDeletingId(row.id);
    try {
      const { data } = await deleteImportConsignment(row.id);
      notify((data.messages || []).join(" ") || `GD ${row.gdNumber} deleted.`, "success");
      if (expandedId === row.id) { setExpandedId(null); setDetail(null); }
      load();
    } catch {
      /* httpClient surfaces the refusal message (e.g. "Cannot delete: ...") */
    } finally {
      setDeletingId(null);
    }
  };

  if (!canView) {
    return <div style={{ padding: "1.5rem" }}>
      <Banner tone="warn" icon={MdWarning}>You do not have permission to view imported consignments.</Banner>
    </div>;
  }

  const items = result?.items || [];

  return (
    <div style={{ padding: "1.25rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 0.25rem", color: colors.textPrimary }}>Consignments</h1>
      <p style={{ margin: "0 0 1rem", color: colors.textSecondary, fontSize: 14, maxWidth: "62ch" }}>
        Every GD costing consignment imported into this company. Expand a row to see its lines and
        why each one was matched, skipped, or created as new stock.
      </p>

      <div style={card}>
        <div style={grid}>
          <label style={{ fontSize: 13, color: colors.textSecondary }}>
            Company
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={input}>
              <option value="">Choose a company…</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {!companyId ? (
        <div style={card}><p style={{ margin: 0, color: colors.textSecondary }}>Choose a company to see its consignments.</p></div>
      ) : loading && !result ? (
        <div style={card}><p style={{ margin: 0, color: colors.textSecondary }}>Loading…</p></div>
      ) : items.length === 0 ? (
        <div style={card}><p style={{ margin: 0, color: colors.textSecondary }}>
          Nothing has been imported into this company yet.
        </p></div>
      ) : (
        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th} />
                  <th style={th}>GD number</th>
                  <th style={th}>Date</th>
                  <th style={{ ...th, textAlign: "right" }}>Lines</th>
                  <th style={{ ...th, textAlign: "right" }}>Total cost</th>
                  <th style={{ ...th, textAlign: "right" }}>Selling value</th>
                  <th style={th}>Mode</th>
                  <th style={th}>Ledger</th>
                  <th style={th}>Imported</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const expanded = expandedId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr style={{ cursor: "pointer" }} onClick={() => toggleRow(row.id)}>
                        <td style={{ ...td, width: 32 }}>
                          {expanded ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                        </td>
                        <td style={td}><div style={wrap2}>{row.gdNumber}</div></td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{dt(row.gdDate)}</td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.lineCount}</td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(row.totalCostExcludingTax)}</td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(row.totalSellingValue)}</td>
                        <td style={td}>{MODE_LABEL[row.mode] || row.mode}</td>
                        <td style={td}>
                          {row.hasJournalEntry
                            ? <Badge tone={colors.success}>Posted</Badge>
                            : <span style={{ fontSize: 12, color: colors.textSecondary }}>—</span>}
                        </td>
                        <td style={td}>
                          <div style={{ fontSize: 12.5 }}>{dt(row.importedAt)}</div>
                          <div style={{ fontSize: 11.5, color: colors.textSecondary }}>{row.importedByUserName || "—"}</div>
                        </td>
                        <td style={td} onClick={(e) => e.stopPropagation()}>
                          {canDelete && (
                            <button
                              onClick={() => onDelete(row)}
                              disabled={deletingId === row.id}
                              title={`Delete GD ${row.gdNumber}`}
                              aria-label={`Delete GD ${row.gdNumber}`}
                              style={iconBtn(colors.danger, deletingId === row.id)}
                            >
                              <MdDelete size={18} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={10} style={{ ...td, background: colors.cardBg }}>
                            <ConsignmentLines detail={detail} loading={detailLoading} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={result?.totalPages || 1}
            total={result?.totalCount}
            onPage={setPage}
            pageSize={pageSize}
            onPageSize={(n) => { setPageSize(n); setPage(1); }}
            unit="consignments"
          />
        </div>
      )}
    </div>
  );
}
