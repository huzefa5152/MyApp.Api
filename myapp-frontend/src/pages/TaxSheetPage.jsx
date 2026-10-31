import ListFilters from "../Components/ListFilters";
import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useCallback } from "react";
import { MdFactCheck, MdBusiness, MdRefresh, MdDownload, MdPerson, MdEventRepeat, MdClose, MdUpload } from "react-icons/md";
import { getTaxSheet, getTaxSheetExcel, transferTaxSheet } from "../api/reportApi";
import { getClientsByCompany } from "../api/clientApi";
import { dropdownStyles } from "../theme";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { excelBrandParams } from "../utils/reportExcelBrand";
import useIsNarrow from "../hooks/useIsNarrow";
import ColumnPicker, { useHiddenColumns } from "../Components/reports/ColumnPicker";
import { CompanyPicker, Dot, PrintPdfButtons, ReportBar, ReportKpis } from "../Components/reports/ReportChrome";
import TaxSheetImportDialog from "../Components/TaxSheetImportDialog";
import { fileSlug, pdfReport, printReport } from "../utils/reportPrintKit";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
  rowAlt: "#fafbfd",
  totalBg: "#eef4ff",
  pill: "#fff4e5",
  pillText: "#a15c00",
};

// Columns of the on-screen sheet, in the consultant's order. `total` marks a
// column with a grand total; the user can hide any of them.
const TS_COLS = [
  { key: "ntn", label: "NTN Number" },
  { key: "party", label: "Party Name" },
  { key: "doc", label: "Inv Number" },
  { key: "date", label: "Inv Date" },
  { key: "qty", label: "Item Total QTY" },
  { key: "desc", label: "Bill Item", lineOnly: true },
  { key: "hs", label: "HS Code" },
  { key: "excl", label: "Excluding Amount", format: "money", total: true },
  { key: "tax", label: "Sales Tax", format: "money", total: true },
  { key: "total", label: "Total", format: "money", total: true },
];

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
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.taxsheet.view");
  const canExport = has("reports.taxsheet.export");
  const canTransfer = has("reports.taxsheet.transfer");
  const canImport = has("reports.taxsheet.import")
    && (has("invoices.manage.update.itemtype") || has("invoices.manage.update.itemtype.qty"));
  const isNarrow = useIsNarrow();
  const [hiddenCols, setHiddenCols] = useHiddenColumns("tax-sheet");
  const [printBusy, setPrintBusy] = useState(null);

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

  const [importOpen, setImportOpen] = useState(false);

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
      // The workbook carries the company's letterhead and template colours.
      const { data } = await getTaxSheetExcel(selectedCompany.id, { ...buildParams(), ...(await excelBrandParams(selectedCompany)) });
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
    return <div style={{ padding: 24, color: colors.textSecondary }}>You don't have permission to view reports.</div>;
  }

  const visibleCols = TS_COLS.filter((c) => !hiddenCols.has(c.key) && (!c.lineOnly || report?.originalLines));
  const cols = visibleCols.length ? visibleCols : TS_COLS;
  const clientName = clientId ? clients.find((c) => String(c.id) === String(clientId))?.name : "";

  // The tax sheet as printed: the rows on screen, in the chosen columns, on
  // the company's own letterhead.
  const envelope = () => ({
    title: "Tax Sheet",
    companyName: report.companyName,
    periodLabel,
    generatedAt: new Date().toISOString(),
    filtersApplied: [clientName && `Client: ${clientName}`].filter(Boolean),
    sourceLabel: "Invoice lines whose item type still has no HS code",
    columns: cols.map((c) => ({ key: c.key, label: c.label, format: c.format || "text", totalled: !!c.total })),
    rows: report.rows.map((row) => ({
      ntn: row.ntn, party: row.partyName, doc: row.documentNumber,
      date: new Date(row.documentDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      qty: row.quantityLabel, desc: row.description, hs: row.itemTypeName,
      excl: row.excludingAmount, tax: row.salesTax, total: row.total,
    })),
    totals: { excl: report.grandExcluding, tax: report.grandTax, total: report.grandTotal },
  });
  const doPrint = async () => {
    setPrintBusy("print");
    try { await printReport(envelope(), selectedCompany); }
    catch { notify("Could not prepare the report. Allow print pop-ups and try again.", "error"); }
    finally { setPrintBusy(null); }
  };
  const doPdf = async () => {
    setPrintBusy("pdf");
    try { await pdfReport(envelope(), selectedCompany, fileSlug(`Tax-Sheet-${periodLabel}`)); }
    catch { notify("Could not build the PDF.", "error"); }
    finally { setPrintBusy(null); }
  };

  const cell = (row, key) => {
    switch (key) {
      case "ntn": return <td key={key} className="rw-code">{row.ntn}</td>;
      case "party": return <td key={key} className="rw-text"><span className="rw-clamp">{row.partyName}</span></td>;
      case "doc": return <td key={key} className="rw-nowrap" style={{ fontWeight: 700, color: colors.blue }}>{row.documentNumber}</td>;
      case "date": return <td key={key} className="rw-nowrap">{new Date(row.documentDate).toLocaleDateString()}</td>;
      case "qty": return <td key={key} className="rw-nowrap">{row.quantityLabel}</td>;
      case "desc": return (
        <td key={key} className="rw-text"><span className="rw-clamp">{row.description}</span>
          {row.currentHsCode && <div style={{ fontSize: "0.72rem", color: colors.textSecondary }}>Filed HS: {row.currentHsCode}</div>}
        </td>
      );
      case "hs": return (
        <td key={key}>
          <span style={{ background: colors.pill, color: colors.pillText, padding: "2px 8px", borderRadius: 6, fontSize: "0.78rem", fontWeight: 600, display: "inline-block", lineHeight: 1.3 }}>
            {row.itemTypeName}
          </span>
        </td>
      );
      case "excl": return <td key={key} className="rw-num">{money(row.excludingAmount)}</td>;
      case "tax": return <td key={key} className="rw-num">{money(row.salesTax)}</td>;
      case "total": return <td key={key} className="rw-num rw-strong">{money(row.total)}</td>;
      default: return <td key={key} />;
    }
  };
  const totalCell = (key, idx) => {
    const v = { excl: report.grandExcluding, tax: report.grandTax, total: report.grandTotal }[key];
    if (v !== undefined) return <td key={key} className="rw-num">{money(v)}</td>;
    return <td key={key}>{idx === 0 ? "Total" : ""}</td>;
  };

  return (
    <div className="rw">
      <ReportBar
        icon={<MdFactCheck size={20} />}
        crumb="Reports"
        title="Tax Sheet"
        meta={<>
          {report?.companyName && <strong>{report.companyName}</strong>}
          <Dot>{periodLabel}</Dot>
          <Dot>Lines whose item type still has no HS code — for the tax consultant to classify</Dot>
        </>}
        actions={<>
          <CompanyPicker icon={<MdBusiness size={18} />} companies={companies} selectedCompany={selectedCompany} onChange={setSelectedCompany} />
          <button type="button" className="rw-btn" onClick={fetchReport} disabled={loading || rangeInvalid}>
            <MdRefresh size={17} /><span>{loading ? "Loading…" : "Refresh"}</span>
          </button>
          {report && <ColumnPicker columns={TS_COLS} hidden={hiddenCols} onChange={setHiddenCols} />}
          {canExport && (
            <button type="button" className="rw-btn" onClick={exportExcel} disabled={!report || loading || exporting || rangeInvalid}>
              <MdDownload size={17} /><span>{exporting ? "Exporting…" : "Excel"}</span>
            </button>
          )}
          {canImport && (
            <button type="button" className="rw-btn" onClick={() => setImportOpen(true)} disabled={!selectedCompany}
              title="Upload the Excel sheet with Real Hscode filled in to adjust many invoices at once">
              <MdUpload size={17} /><span>Import adjusted sheet</span>
            </button>
          )}
          <PrintPdfButtons onPrint={doPrint} onPdf={doPdf} busy={printBusy} disabled={!report || loading || !report.rows.length} />
        </>}
      />

      {/* Controls */}
      <ListFilters><div className="rw-filters" style={{
        display: "flex", flexWrap: "wrap", gap: "8px 10px", alignItems: "flex-end",
        background: "#fff", border: `1px solid ${colors.cardBorder}`,
      }}>
        <Field label="Client" icon={<MdPerson size={15} />}>
          <SearchableClientSelect
            clients={clients}
            value={clientId}
            onChange={(id) => setClientId(id)}
            placeholder="All clients"
            style={{ minWidth: 180, maxWidth: 240 }}
          />
        </Field>

        <Field label="Period">
          <div style={{ display: "inline-flex", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
            <button type="button" onClick={() => setMode("period")} style={segBtn(mode === "period")}>Month / Year</button>
            <button type="button" onClick={() => setMode("custom")} style={segBtn(mode === "custom")}>Custom range</button>
          </div>
        </Field>

        {mode === "period" ? (
          <>
            <Field label="Year">
              <select style={dropdownStyles.base} value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Month">
              <select
                style={{ ...dropdownStyles.base, opacity: fullYear ? 0.5 : 1 }}
                value={month}
                disabled={fullYear}
                onChange={(e) => setMonth(parseInt(e.target.value))}
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: colors.textPrimary, paddingBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={fullYear} onChange={(e) => setFullYear(e.target.checked)} />
              Full year
            </label>
          </>
        ) : (
          <>
            <Field label="From">
              <input type="date" style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }}
                value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input type="date" style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }}
                value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
            </Field>
          </>
        )}

        {canTransfer && (
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <button
              type="button"
              className="rw-btn"
              onClick={openTransfer}
              disabled={!report || loading || rangeInvalid || (report?.rows?.length || 0) === 0}
              style={{ color: "#e65100", borderColor: "#ffcc80" }}
              title="Move the remaining (unclassified) invoices to a new date so you can file them next period"
            >
              <MdEventRepeat size={17} style={{ color: "#e65100" }} /><span>Transfer → next month</span>
            </button>
          </div>
        )}
      </div></ListFilters>

      {error && <div className="rw-notice rw-notice--warn" role="alert">{error}</div>}

      {report && !loading && (
        <ReportKpis items={[
          { label: "Invoices", value: report.invoiceCount },
          { label: "Lines pending HS code", value: report.rowCount },
          { label: "Excluding amount", value: money(report.grandExcluding) },
          { label: "Sales tax", value: money(report.grandTax) },
          { label: "Total", value: money(report.grandTotal), tone: "lead" },
        ]} />
      )}

      <RecordsViewport label="Tax Sheet records" enabled={!isNarrow}>{loading ? (
        <div className="rw-state" role="status">Loading tax sheet…</div>
      ) : report && (
        report.rows.length === 0 ? (
          <div className="rw-state">No invoices pending HS classification for {periodLabel}.</div>
        ) : isNarrow ? (
          <div className="rw-cards">
            {report.rows.map((row, idx) => (
              <div key={idx} className="rw-card" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={tsCardTop}>
                  <span style={{ fontWeight: 700, color: colors.blue }}>{row.documentNumber}</span>
                  <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>{new Date(row.documentDate).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: "0.88rem", fontWeight: 600, color: colors.textPrimary, ...clamp2 }}>{row.partyName}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "2px 0 2px" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.74rem", color: colors.textSecondary }}>{row.ntn}</span>
                  <span style={{ background: colors.pill, color: colors.pillText, padding: "2px 8px", borderRadius: 6, fontSize: "0.74rem", fontWeight: 600 }}>{row.itemTypeName}</span>
                </div>
                <div style={tsCardMeta}>
                  <div><span style={tsLbl}>Qty</span><span style={tsVal}>{row.quantityLabel}</span></div>
                  <div><span style={tsLbl}>Excl. Amount</span><span style={tsVal}>{money(row.excludingAmount)}</span></div>
                  <div><span style={tsLbl}>Sales Tax</span><span style={tsVal}>{money(row.salesTax)}</span></div>
                  <div><span style={tsLbl}>Total</span><span style={{ ...tsVal, fontWeight: 700, color: colors.blue }}>{money(row.total)}</span></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div data-admin-table-region="" className="rw-table-wrap">
            <table className="rw-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>{cols.map((c) => <th key={c.key} className={c.total ? "rw-num" : undefined}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {report.rows.map((row, idx) => <tr key={idx}>{cols.map((c) => cell(row, c.key))}</tr>)}
              </tbody>
              <tfoot>
                <tr>{cols.map((c, i) => totalCell(c.key, i))}</tr>
              </tfoot>
            </table>
          </div>
        )
      )}</RecordsViewport>


      {importOpen && <TaxSheetImportDialog companyId={selectedCompany.id} onClose={() => setImportOpen(false)} onApplied={fetchReport} />}

      {transferOpen && (
        <div data-admin-backdrop="" style={overlay} onClick={() => !transferring && setTransferOpen(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem", color: colors.textPrimary }}>Transfer remaining invoices</h3>
              <button onClick={() => setTransferOpen(false)} style={{ border: "none", background: "none", cursor: "pointer", color: colors.textSecondary, display: "flex" }}>
                <MdClose size={20} />
              </button>
            </div>
            <p style={{ margin: "0 0 14px", fontSize: "0.88rem", color: colors.textSecondary, lineHeight: 1.55 }}>
              Move the <strong>{report?.invoiceCount || 0}</strong> still-unclassified invoice(s){clientId ? " for the selected client" : ""} off <strong>{periodLabel}</strong> onto a new date, so they roll into that month's tax sheet for the consultant to classify next. This updates each bill's date; invoices already submitted to FBR are skipped.
            </p>
            <Field label="Transfer to date">
              <input
                type="date"
                style={{ ...dropdownStyles.base, minWidth: 200 }}
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
              />
            </Field>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button data-admin-close="" onClick={() => setTransferOpen(false)} disabled={transferring}
                style={{ ...btn("#eef1f6"), color: colors.textPrimary }}>
                Cancel
              </button>
              <button onClick={handleTransfer} disabled={transferring || !transferDate} style={btn("#e65100")}>
                {transferring ? "Transferring…" : `Transfer to ${prettyDate(transferDate)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
  overflowY: "auto",
};
const modalBox = {
  background: "#fff", borderRadius: 12, padding: 20, width: "min(460px, 100%)",
  maxHeight: "94vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};

// Mobile card styles (phones get stacked cards instead of the wide table).
const tsCardTop = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
const tsCardMeta = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "0.35rem 0.8rem", marginTop: 4 };
const tsLbl = { display: "block", fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary };
const tsVal = { display: "block", fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary };

function Field({ label, icon, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: "0.72rem", fontWeight: 600, color: colors.textSecondary, display: "flex", alignItems: "center", gap: 4 }}>
        {icon} {label}
      </label>
      {children}
    </div>
  );
}

const th = { padding: "6px 10px", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.02em", color: colors.textSecondary, whiteSpace: "nowrap" };
const td = { padding: "6px 10px", color: colors.textPrimary, verticalAlign: "top" };
const tdR = { ...td, textAlign: "right", whiteSpace: "nowrap" };
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

const btn = (bg) => ({
  display: "inline-flex", alignItems: "center", gap: 6, background: bg, color: "#fff",
  border: "none", borderRadius: 8, padding: "9px 14px", fontSize: "0.85rem", fontWeight: 600,
  cursor: "pointer", minHeight: 40,
});

const segBtn = (active) => ({
  border: "none",
  background: active ? colors.blue : "transparent",
  color: active ? "#fff" : colors.textSecondary,
  padding: "9px 14px", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", minHeight: 40, whiteSpace: "nowrap",
});
