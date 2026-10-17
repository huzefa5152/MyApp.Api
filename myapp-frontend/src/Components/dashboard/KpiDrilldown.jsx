// Drill-down behind one KPI card: a right-hand side panel, two levels deep.
//
// The contract this exists to keep: the rows add up to the card. The server
// computes both from the same walk, and this panel shows the sum next to the
// card's own figure at EVERY level so a drift is visible rather than silent.
// (A level-2 group that was cut at 500 rows says so and does not warn: its
// total covers the whole group, the rows do not.)
//
// Layout follows the house modal rules (CLAUDE.md 3): the backdrop closes it,
// the panel is full-screen under 760px, only the body scrolls, and the header
// and reconciliation footer stay put. Rows are stacked full-width lines that
// work on a phone as-is (no wide table). State is mirrored into
// ?drill=&group= so Back from "Open bill" lands on the same level.
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MdClose, MdWarningAmber, MdChevronRight, MdFileDownload } from "react-icons/md";
import { colors } from "../../theme";
import { getDashboardBreakdown } from "../../api/dashboardApi";
import { usePermissions } from "../../contexts/PermissionsContext";
import { fbrStatusLabel } from "../../utils/fbrStatus";
import {
  drillToSearch, reconciles, exportRows, invoiceBreakdown, openBillPath,
} from "../../utils/dashboardDrill";

export { drillFromSearch } from "../../utils/dashboardDrill";

const NARROW = 760;

function money(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 });
}
function num(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-PK", { maximumFractionDigits: 4 });
}
function cell(col, v) {
  if (v == null || v === "") return "—";
  switch (col.kind) {
    case "money": return money(v);
    case "number": return num(v);
    case "date": return String(v).slice(0, 10);
    case "status": return col.key === "fbrStatus" ? fbrStatusLabel(v) : String(v);
    default: return String(v);
  }
}

async function downloadXlsx(data, filename) {
  const mod = await import("exceljs");
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Breakdown");
  exportRows(data.columns, data.rows).forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function KpiDrilldown({
  open, onClose, kind, period, from, to, companyId, cardValue, initialGroupKey = null,
}) {
  const { has } = usePermissions();
  const [, setSearchParams] = useSearchParams();
  const [groupKey, setGroupKey] = useState(initialGroupKey);
  const [data, setData] = useState(null);
  const [rootTitle, setRootTitle] = useState("");
  const [groupLabel, setGroupLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < NARROW : false);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // A new card (or reopening) starts at level 1 unless told where to resume.
  useEffect(() => { if (open) setGroupKey(initialGroupKey); }, [open, kind, initialGroupKey]);

  const closeAndClear = useCallback(() => {
    setSearchParams((p) => drillToSearch(p, null), { replace: true });
    onClose?.();
  }, [onClose, setSearchParams]);

  // A panel you cannot dismiss is the complaint this codebase already had once.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") closeAndClear(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeAndClear]);

  // Mirror {kind, groupKey} into the URL.
  useEffect(() => {
    if (!open || !kind) return;
    setSearchParams((p) => drillToSearch(p, { kind, groupKey }), { replace: true });
  }, [open, kind, groupKey, setSearchParams]);

  useEffect(() => {
    if (!open || !kind || !companyId) return;
    let cancelled = false;
    setLoading(true); setError(""); setData(null); setExpanded(null);
    getDashboardBreakdown(companyId, kind, { period, from, to, groupKey })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (!groupKey) setRootTitle(d?.title || "");
      })
      .catch((e) => {
        if (cancelled) return;
        const body = e?.response?.data;
        setError(e?.response?.status === 403
          ? (body?.message || body?.error || "You do not have access to this breakdown.")
          : "Could not load the breakdown.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, kind, companyId, period, from, to, groupKey]);

  if (!open) return null;

  const rows = data?.rows || [];
  const columns = data?.columns || [];
  const rowSum = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const level2 = !!groupKey;
  const headline = level2 || cardValue == null ? data?.total : cardValue;
  const truncated = !!data?.truncated;
  const ok = truncated || reconciles(rows, headline);
  const title = data?.title || "Breakdown";

  const rowClick = (r) => {
    if (!level2 && r.groupKey) { setGroupLabel(r.label); setGroupKey(r.groupKey); }
    else setExpanded((x) => (x === r.id ? null : r.id));
  };
  const clickable = (r) => (!level2 && !!r.groupKey) || (!!r.values && Object.keys(r.values).length > 0);

  const detail = (r) => {
    const lines = r.invoiceId != null && r.values
      ? invoiceBreakdown(r.values, fbrStatusLabel)
      : columns.filter((c) => r.values && r.values[c.key] != null)
        .map((c) => ({ label: c.label, value: cell(c, r.values[c.key]), money: false }));
    return (
      <div style={{ padding: "0.5rem 0.75rem 0.75rem", background: colors.inputBg }}>
        <div data-testid="drill-detail" style={{ display: "grid", gap: "0.35rem 1rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))" }}>
          {lines.map((l) => (
            <div key={l.label}>
              <div style={{ fontSize: "0.7rem", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l.label}</div>
              <div style={{ ...mono, fontSize: "0.88rem" }}>{l.money ? money(l.value) : l.value}</div>
            </div>
          ))}
        </div>
        {r.invoiceNumber != null && has("bills.list.view") && (
          <Link to={openBillPath(r.invoiceNumber)} style={{
            display: "inline-flex", alignItems: "center", minHeight: 44, marginTop: "0.4rem",
            color: colors.blue, fontWeight: 600, fontSize: "0.85rem",
          }}>Open bill {r.invoiceNumber}</Link>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1100, display: "flex", justifyContent: "flex-end",
        backgroundColor: "rgba(10,22,40,0.45)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeAndClear(); }}
      role="presentation"
    >
      <div
        role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: isNarrow ? "100%" : "min(760px, 100%)", height: "100%",
          background: colors.cardBg, color: colors.textPrimary, display: "flex", flexDirection: "column",
          boxShadow: "-12px 0 40px rgba(13,71,161,0.18)",
        }}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem",
          padding: "0.9rem 1.1rem", borderBottom: `1px solid ${colors.cardBorder}`, flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", fontSize: "0.82rem", color: colors.textSecondary }}>
              {level2 ? (
                <>
                  <button type="button" onClick={() => setGroupKey(null)} style={crumbBtn}>{rootTitle || "All"}</button>
                  <MdChevronRight size={16} aria-hidden="true" />
                  <span style={{ fontWeight: 600, color: colors.textPrimary }}>{groupLabel || groupKey}</span>
                </>
              ) : (
                <span style={{ fontWeight: 600, color: colors.textPrimary, fontSize: "1rem" }}>{title}</span>
              )}
            </nav>
            {data?.note && (
              <p style={{ margin: "0.3rem 0 0", color: colors.textSecondary, fontSize: "0.8rem", lineHeight: 1.45, maxWidth: "62ch" }}>{data.note}</p>
            )}
          </div>
          <div style={{ display: "flex", flexShrink: 0 }}>
            {rows.length > 0 && (
              <button type="button" aria-label="Export to Excel" title="Export to Excel"
                onClick={() => downloadXlsx(data, `${kind}${groupKey ? "-" + groupKey : ""}.xlsx`)}
                style={iconBtn}><MdFileDownload size={20} /></button>
            )}
            <button type="button" onClick={closeAndClear} aria-label="Close" style={iconBtn}><MdClose size={20} /></button>
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "0.5rem 1.1rem" }}>
          {loading && <p style={{ color: colors.textSecondary }}>Loading…</p>}
          {error && <p role="alert" style={{ color: colors.danger }}>{error}</p>}
          {!loading && !error && data && rows.length === 0 && (
            <p style={{ color: colors.textSecondary }}>Nothing to show for this period.</p>
          )}
          {!loading && !error && rows.map((r, i) => {
            const isOpen = r.id != null && expanded === r.id;
            const canClick = clickable(r);
            return (
              <div key={r.id ?? i} style={{ borderBottom: `1px solid ${colors.cardBorder}`, background: r.flagged ? colors.dangerLight : undefined }}>
                <button
                  type="button" disabled={!canClick} onClick={() => rowClick(r)}
                  aria-expanded={canClick && level2 ? isOpen : undefined}
                  style={{
                    all: "unset", boxSizing: "border-box", width: "100%", minHeight: 44, cursor: canClick ? "pointer" : "default",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.25rem",
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ ...clamp, fontWeight: 600, fontSize: "0.9rem" }}>{r.label}</span>
                    {r.sub && <span style={{ ...clamp, color: colors.textSecondary, fontSize: "0.78rem" }}>{r.sub}</span>}
                  </span>
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ ...mono, display: "block", fontWeight: 700, fontSize: "0.92rem", color: Number(r.amount) < 0 ? colors.danger : colors.textPrimary }}>Rs. {money(r.amount)}</span>
                    {r.secondary != null && (
                      <span style={{ ...mono, display: "block", color: colors.textSecondary, fontSize: "0.76rem" }}>
                        {r.secondaryLabel ? `${r.secondaryLabel} ` : ""}{money(r.secondary)}
                      </span>
                    )}
                  </span>
                  {!level2 && r.groupKey && <MdChevronRight size={18} aria-hidden="true" style={{ flexShrink: 0, color: colors.textSecondary }} />}
                </button>
                {isOpen && detail(r)}
              </div>
            );
          })}
        </div>

        {data && !loading && !error && rows.length > 0 && (
          <div style={{
            borderTop: `1px solid ${colors.cardBorder}`, padding: "0.7rem 1.1rem", flexShrink: 0,
            display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.4rem 1rem", alignItems: "center",
          }}>
            <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: ok ? colors.textSecondary : colors.danger }}>
              {!ok && <MdWarningAmber size={16} />}
              {truncated
                ? "Showing the newest 500 of this group — total covers all"
                : `Rows total Rs. ${money(rowSum)} · Card shows Rs. ${money(headline)}${ok ? "" : " — these do not add up, please report this"}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const mono = {
  fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};
// Names clamp to two lines; never nowrap + ellipsis (CLAUDE.md 3).
const clamp = {
  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere",
};
const iconBtn = {
  background: "none", border: "none", color: colors.textSecondary, cursor: "pointer",
  padding: 0, boxShadow: "none", display: "grid", placeItems: "center", width: 44, height: 44,
};
const crumbBtn = {
  background: "none", border: "none", boxShadow: "none", padding: 0, minHeight: 44, cursor: "pointer",
  color: colors.blue, fontWeight: 600, fontSize: "0.82rem",
};
