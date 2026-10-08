import { useState, useEffect, useCallback } from "react";
import { MdFactCheck, MdRefresh, MdDownload, MdPerson, MdEventRepeat, MdClose } from "react-icons/md";
import { getTaxSheet, getTaxSheetExcel, transferTaxSheet } from "../api/reportApi";
import { getClientsByCompany } from "../api/clientApi";
import { formStyles } from "../theme";
import { PageHeader, CompanyPicker, Button, Card, Field, TableWrap, EmptyState, Loading, Alert } from "../ui/Kit";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import useIsNarrow from "../hooks/useIsNarrow";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NOW = new Date();
const YEARS = Array.from({ length: 6 }, (_, i) => NOW.getFullYear() - i);

const money = (n) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prettyDate = (s) => {
  const [y, m, d] = (s || "").split("-");
  return d ? `${d}-${m}-${y}` : s;
};

export default function TaxSheetPage() {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.taxsheet.view");
  const canExport = has("reports.taxsheet.export");
  const canTransfer = has("reports.taxsheet.transfer");
  const isNarrow = useIsNarrow();

  const [mode, setMode] = useState("period"); // "period" | "custom"
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState(NOW.getMonth() + 1);
  const [fullYear, setFullYear] = useState(false);
  const [dateFrom, setDateFrom] = useState(ymd(new Date(NOW.getFullYear(), NOW.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(ymd(NOW));
  const [clientId, setClientId] = useState(""); // "" = all clients
  const [clients, setClients] = useState([]);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDate, setTransferDate] = useState("");
  const [transferring, setTransferring] = useState(false);

  // Load the company's clients for the filter; reset the filter on switch.
  useEffect(() => {
    if (!selectedCompany) { setClients([]); return; }
    setClientId("");
    getClientsByCompany(selectedCompany.id)
      .then((res) => setClients(res.data || []))
      .catch(() => setClients([]));
  }, [selectedCompany?.id]);

  // Period + client params, shared by the report, the Excel export, AND the
  // transfer — so the client filter applies to all three consistently.
  const buildParams = useCallback(() => {
    const p = mode === "custom"
      ? { dateFrom, dateTo }
      : { year, ...(fullYear ? {} : { month }) };
    if (clientId) p.clientId = clientId;
    return p;
  }, [mode, dateFrom, dateTo, year, month, fullYear, clientId]);

  const rangeInvalid = mode === "custom" && dateFrom && dateTo && dateFrom > dateTo;

  const fetchReport = useCallback(async () => {
    if (!selectedCompany || !canView) return;
    if (mode === "custom" && (!dateFrom || !dateTo)) return;
    if (rangeInvalid) {
      setError("Start date must be on or before the end date.");
      setReport(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data } = await getTaxSheet(selectedCompany.id, buildParams());
      setReport(data);
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to load the tax sheet.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, canView, mode, dateFrom, dateTo, rangeInvalid, buildParams]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const periodLabel = mode === "custom"
    ? `${prettyDate(dateFrom)} – ${prettyDate(dateTo)}`
    : fullYear ? `Year ${year}` : `${MONTHS[month - 1]} ${year}`;

  const exportExcel = async () => {
    if (!selectedCompany || rangeInvalid) return;
    setExporting(true);
    try {
      const { data } = await getTaxSheetExcel(selectedCompany.id, buildParams());
      const url = URL.createObjectURL(new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Tax-Sheet-${(report?.companyName || "company")}-${periodLabel}.xlsx`.replace(/\s+/g, "_");
      a.click();
      URL.revokeObjectURL(url);
      notify("Tax sheet exported.", "success");
    } catch {
      notify("Failed to export the tax sheet.", "error");
    } finally {
      setExporting(false);
    }
  };

  // Default transfer target = the 1st of the month AFTER the sheet's period.
  const nextMonthFirst = () => {
    let base;
    if (mode === "custom" && dateTo) {
      const d = new Date(dateTo);
      base = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    } else if (fullYear) {
      base = new Date(year + 1, 0, 1);
    } else {
      base = new Date(year, month, 1); // month is 1-indexed → JS month arg = next month
    }
    return ymd(base);
  };

  const openTransfer = () => { setTransferDate(nextMonthFirst()); setTransferOpen(true); };

  const handleTransfer = async () => {
    if (!selectedCompany || !transferDate) return;
    setTransferring(true);
    try {
      const { data } = await transferTaxSheet(selectedCompany.id, { ...buildParams(), targetDate: transferDate });
      setTransferOpen(false);
      const skippedMsg = data.skipped ? ` · ${data.skipped} skipped (already submitted)` : "";
      notify(`Moved ${data.transferred} invoice(s) to ${prettyDate(transferDate)}${skippedMsg}.`, "success");
      fetchReport();
    } catch (e) {
      notify(e?.response?.data?.message || "Failed to transfer invoices.", "error");
    } finally {
      setTransferring(false);
    }
  };

  if (!canView) {
    return <EmptyState icon={MdFactCheck}>You don't have permission to view reports.</EmptyState>;
  }

  return (
    <div>
      <PageHeader
        icon={MdFactCheck}
        tone="blue"
        title="Tax Sheet"
        subtitle={(
          <>
            Invoice lines whose item type still has <strong>no HS code</strong> — send to the tax consultant to classify.
            The <strong>HS Code</strong> column shows the item-type name that needs a real HS code.
          </>
        )}
      />

      <CompanyPicker />

      {/* Controls */}
      <Card style={{ marginBottom: "var(--k-gap)" }}>
        <div style={controlsRow}>
          <Field label={<><MdPerson size={15} aria-hidden="true" style={{ verticalAlign: "-3px" }} /> Client</>}>
            <SearchableClientSelect
              clients={clients}
              value={clientId}
              onChange={(id) => setClientId(id)}
              placeholder="All clients"
              style={{ minWidth: 180, maxWidth: 240 }}
            />
          </Field>

          <Field label="Period">
            <div role="group" aria-label="Period mode" style={segWrap}>
              <button type="button" onClick={() => setMode("period")} aria-pressed={mode === "period"} style={segBtn(mode === "period")}>Month / Year</button>
              <button type="button" onClick={() => setMode("custom")} aria-pressed={mode === "custom"} style={segBtn(mode === "custom")}>Custom range</button>
            </div>
          </Field>

          {mode === "period" ? (
            <>
              <Field label="Year">
                <select className="k-select" style={ctlAuto} value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
              <Field label="Month">
                <select
                  className="k-select"
                  style={{ ...ctlAuto, opacity: fullYear ? 0.5 : 1 }}
                  value={month}
                  disabled={fullYear}
                  onChange={(e) => setMonth(parseInt(e.target.value))}
                >
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <label style={checkLabel}>
                <input type="checkbox" checked={fullYear} onChange={(e) => setFullYear(e.target.checked)} />
                Full year
              </label>
            </>
          ) : (
            <>
              <Field label="From">
                <input type="date" className="k-input" style={{ ...ctlAuto, ...(rangeInvalid ? { borderColor: "var(--k-danger)" } : {}) }}
                  value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" className="k-input" style={{ ...ctlAuto, ...(rangeInvalid ? { borderColor: "var(--k-danger)" } : {}) }}
                  value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
              </Field>
            </>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto", flexWrap: "wrap" }}>
            <Button variant="primary" icon={MdRefresh} onClick={fetchReport} disabled={loading || rangeInvalid}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
            {canExport && (
              <Button variant="teal" icon={MdDownload} onClick={exportExcel} disabled={!report || loading || exporting || rangeInvalid}>
                {exporting ? "Exporting…" : "Export Excel"}
              </Button>
            )}
            {canTransfer && (
              <Button
                variant="secondary"
                icon={MdEventRepeat}
                onClick={openTransfer}
                disabled={!report || loading || rangeInvalid || (report?.rows?.length || 0) === 0}
                title="Move the remaining (unclassified) invoices to a new date so you can file them next period"
                style={{ color: transferOrange }}
              >
                Transfer → next month
              </Button>
            )}
          </div>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      {report && !loading && (
        <Card flush style={{ overflow: "hidden" }} title={report.companyName}>
          <div style={reportMeta}>
            Tax Sheet · {periodLabel} · {report.invoiceCount} invoice(s), {report.rowCount} line(s) pending HS code
          </div>

          {report.rows.length === 0 ? (
            <EmptyState boxed={false}>
              No invoices pending HS classification for {periodLabel}. 🎉
            </EmptyState>
          ) : isNarrow ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: "0.6rem" }}>
              {report.rows.map((row, idx) => (
                <div key={idx} style={tsCard}>
                  <div style={tsCardTop}>
                    <span style={{ fontWeight: 700, color: "var(--k-blue)" }}>{row.documentNumber}</span>
                    <span style={{ fontSize: "0.78rem", color: "var(--k-muted)" }}>{new Date(row.documentDate).toLocaleDateString()}</span>
                  </div>
                  <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--k-ink)", ...clamp2 }}>{row.partyName}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "2px 0 2px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "0.74rem", color: "var(--k-muted)" }}>{row.ntn}</span>
                    <span style={{ ...pill, fontSize: "0.74rem" }}>{row.itemTypeName}</span>
                  </div>
                  <div style={tsCardMeta}>
                    <div><span style={tsLbl}>Qty</span><span style={tsVal}>{row.quantityLabel}</span></div>
                    <div><span style={tsLbl}>Excl. Amount</span><span style={tsVal}>{money(row.excludingAmount)}</span></div>
                    <div><span style={tsLbl}>Sales Tax</span><span style={tsVal}>{money(row.salesTax)}</span></div>
                    <div><span style={tsLbl}>Total</span><span style={{ ...tsVal, fontWeight: 700, color: "var(--k-blue)" }}>{money(row.total)}</span></div>
                  </div>
                </div>
              ))}
              <div style={{ ...tsCard, background: totalBg, borderColor: "var(--k-blue)" }}>
                <div style={{ fontWeight: 800, color: "var(--k-blue)", marginBottom: 4 }}>TOTAL</div>
                <div style={tsCardMeta}>
                  <div><span style={tsLbl}>Excl. Amount</span><span style={{ ...tsVal, fontWeight: 800 }}>{money(report.grandExcluding)}</span></div>
                  <div><span style={tsLbl}>Sales Tax</span><span style={{ ...tsVal, fontWeight: 800 }}>{money(report.grandTax)}</span></div>
                  <div><span style={tsLbl}>Total</span><span style={{ ...tsVal, fontWeight: 800, color: "var(--k-blue)" }}>{money(report.grandTotal)}</span></div>
                </div>
              </div>
            </div>
          ) : (
            <TableWrap data-admin-table-region="">
              <table className="k-table" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    {["NTN Number", "Party Name", "Inv Number", "Inv Date", "Item Total QTY", "HS Code", "Excluding Amount", "Sales Tax", "Total"].map((h, i) => (
                      <th key={i} className={i >= 6 ? "k-num" : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, idx) => (
                    <tr key={idx}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{row.ntn}</td>
                      <td style={{ maxWidth: 220 }}><div style={clamp2}>{row.partyName}</div></td>
                      <td style={{ fontWeight: 600, color: "var(--k-blue)" }}>{row.documentNumber}</td>
                      <td>{new Date(row.documentDate).toLocaleDateString()}</td>
                      <td>{row.quantityLabel}</td>
                      <td>
                        <span style={{ ...pill, fontSize: "0.78rem" }}>
                          {row.itemTypeName}
                        </span>
                      </td>
                      <td className="k-num" style={nowrap}>{money(row.excludingAmount)}</td>
                      <td className="k-num" style={nowrap}>{money(row.salesTax)}</td>
                      <td className="k-num" style={{ ...nowrap, fontWeight: 600 }}>{money(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ ...totalCell, fontWeight: 800, color: "var(--k-blue)" }} colSpan={6}>TOTAL</td>
                    <td className="k-num" style={{ ...totalCell, ...nowrap, fontWeight: 800 }}>{money(report.grandExcluding)}</td>
                    <td className="k-num" style={{ ...totalCell, ...nowrap, fontWeight: 800 }}>{money(report.grandTax)}</td>
                    <td className="k-num" style={{ ...totalCell, ...nowrap, fontWeight: 800, color: "var(--k-blue)" }}>{money(report.grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {loading && <Loading>Loading tax sheet…</Loading>}

      {transferOpen && (
        <div data-admin-backdrop="" style={formStyles.backdrop} onClick={() => !transferring && setTransferOpen(false)}>
          <div
            style={{ ...formStyles.modal, maxWidth: 460 }}
            role="dialog"
            aria-modal="true"
            aria-label="Transfer remaining invoices"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={formStyles.header}>
              <h3 style={formStyles.title}>Transfer remaining invoices</h3>
              <button data-admin-close="" type="button" onClick={() => setTransferOpen(false)} style={formStyles.closeButton} aria-label="Close">
                <MdClose size={20} />
              </button>
            </div>
            <div style={formStyles.body}>
              <p style={{ margin: "0 0 14px", fontSize: "var(--k-font)", color: "var(--k-muted)", lineHeight: 1.55 }}>
                Move the <strong>{report?.invoiceCount || 0}</strong> still-unclassified invoice(s){clientId ? " for the selected client" : ""} off <strong>{periodLabel}</strong> onto a new date, so they roll into that month's tax sheet for the consultant to classify next. This updates each bill's date; invoices already submitted to FBR are skipped.
              </p>
              <Field label="Transfer to date">
                <input
                  type="date"
                  className="k-input"
                  style={{ width: "auto", minWidth: "min(200px, 100%)" }}
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                />
              </Field>
            </div>
            <div style={formStyles.footer}>
              <button type="button" onClick={() => setTransferOpen(false)} disabled={transferring}
                style={{ ...formStyles.button, ...formStyles.cancel }}>
                Cancel
              </button>
              <button type="button" onClick={handleTransfer} disabled={transferring || !transferDate}
                style={{ ...formStyles.button, ...formStyles.submit, opacity: transferring || !transferDate ? 0.6 : 1 }}>
                {transferring ? "Transferring…" : `Transfer to ${prettyDate(transferDate)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Page-specific tints (HS-code pill, grand-total band, transfer accent).
const totalBg = "#eef4ff";
const transferOrange = "#e65100";
const pill = { background: "#fff4e5", color: "#a15c00", padding: "2px 8px", borderRadius: 6, fontWeight: 600 };
const totalCell = { background: totalBg, borderTop: "2px solid var(--k-blue)" };
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };
const nowrap = { whiteSpace: "nowrap" };

// Filter row inside the controls card — wraps on narrow screens.
const controlsRow = { display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" };
const ctlAuto = { width: "auto", maxWidth: "100%" };
const checkLabel = { display: "flex", alignItems: "center", gap: 6, fontSize: "var(--k-font)", color: "var(--k-ink)", minHeight: "var(--k-h)", cursor: "pointer" };
const reportMeta = { padding: "0.6rem var(--k-td-pad-x)", color: "var(--k-muted)", fontSize: "var(--k-font-sm)", borderBottom: "1px solid var(--k-line)" };

// Mobile card styles (phones get stacked cards instead of the wide table).
const tsCard = { border: "1px solid var(--k-line)", borderRadius: "var(--k-radius)", padding: "0.7rem 0.8rem", background: "var(--k-surface)", display: "flex", flexDirection: "column", gap: 3 };
const tsCardTop = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
const tsCardMeta = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "0.35rem 0.8rem", marginTop: 4 };
const tsLbl = { display: "block", fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--k-muted)" };
const tsVal = { display: "block", fontSize: "0.85rem", fontWeight: 600, color: "var(--k-ink)" };

// Segmented control (Month / Year vs Custom range) — kit has no segmented
// control, so it is built locally from the --k-* tokens.
const segWrap = { display: "inline-flex", border: "1px solid var(--k-line-strong)", borderRadius: "var(--k-radius)", overflow: "hidden", background: "var(--k-surface)" };
const segBtn = (active) => ({
  border: "none",
  borderRadius: 0,
  background: active ? "var(--k-blue)" : "transparent",
  color: active ? "#fff" : "var(--k-muted)",
  padding: "0 0.85rem",
  fontSize: "var(--k-font-sm)",
  fontWeight: 600,
  cursor: "pointer",
  minHeight: "var(--k-h)",
  whiteSpace: "nowrap",
  boxShadow: "none",
  transform: "none",
});
