import { useState, useEffect, useCallback, Fragment } from "react";
import { MdAssessment, MdBusiness, MdRefresh, MdDownload, MdChevronRight, MdExpandMore, MdUnfoldMore, MdUnfoldLess, MdPerson } from "react-icons/md";
import { getSalesReport, getSalesReportExcel } from "../api/reportApi";
import { getClientsByCompany } from "../api/clientApi";
import { dropdownStyles } from "../theme";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import useIsNarrow from "../hooks/useIsNarrow";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  rowAlt: "#fafbfd",
  bandBg: "#f0f7ff",
  totalBg: "#eef4ff",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BUYER_TYPES = [
  { value: "unregistered", label: "Walk-in / Unregistered" },
  { value: "registered", label: "Registered" },
  { value: "all", label: "All buyers" },
];

// A tax year's worth of picker years around "now" (client clock is fine —
// this is just the selector range, the server does the real filtering).
const NOW = new Date();
const YEARS = Array.from({ length: 6 }, (_, i) => NOW.getFullYear() - i);

const money = (n) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prettyDate = (s) => {
  const [y, m, d] = (s || "").split("-");
  return d ? `${d}-${m}-${y}` : s;
};

export default function SalesReportPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.sales.view");
  const canExport = has("reports.sales.export");
  const isNarrow = useIsNarrow();

  // Period mode: "period" (month / year) or "custom" (date range).
  const [mode, setMode] = useState("period");
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState(NOW.getMonth() + 1); // 1–12
  const [fullYear, setFullYear] = useState(false);
  const [dateFrom, setDateFrom] = useState(ymd(new Date(NOW.getFullYear(), NOW.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(ymd(NOW));
  const [buyerType, setBuyerType] = useState("all");
  const [clientId, setClientId] = useState(""); // "" = all clients
  const [clients, setClients] = useState([]);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load the company's clients for the filter; reset the filter on switch.
  useEffect(() => {
    if (!selectedCompany) { setClients([]); return; }
    setClientId("");
    getClientsByCompany(selectedCompany.id)
      .then((res) => setClients(res.data || []))
      .catch(() => setClients([]));
  }, [selectedCompany?.id]);

  // Single source of truth for the query params — used by both the on-screen
  // fetch and the Excel export so they always agree (client filter included).
  const buildParams = useCallback(() => {
    const p = { buyerType };
    if (mode === "custom") {
      p.dateFrom = dateFrom;
      p.dateTo = dateTo;
    } else {
      p.year = year;
      if (!fullYear) p.month = month;
    }
    if (clientId) p.clientId = clientId;
    return p;
  }, [mode, buyerType, dateFrom, dateTo, year, month, fullYear, clientId]);

  const rangeInvalid = mode === "custom" && dateFrom && dateTo && dateFrom > dateTo;

  const fetchReport = useCallback(async () => {
    if (!selectedCompany || !canView) return;
    if (mode === "custom" && (!dateFrom || !dateTo)) return;
    if (mode === "custom" && dateFrom > dateTo) {
      setError("Start date must be on or before the end date.");
      setReport(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data } = await getSalesReport(selectedCompany.id, buildParams());
      setReport(data);
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to load the sales report.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, canView, mode, dateFrom, dateTo, buildParams]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const periodLabel = mode === "custom"
    ? `${prettyDate(dateFrom)} – ${prettyDate(dateTo)}`
    : fullYear ? `Year ${year}` : `${MONTHS[month - 1]} ${year}`;

  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    if (!selectedCompany || rangeInvalid) return;
    setExporting(true);
    try {
      const { data } = await getSalesReportExcel(selectedCompany.id, buildParams());
      const url = URL.createObjectURL(new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Sale-Report-${(report?.companyName || "company")}-${periodLabel}.xlsx`.replace(/\s+/g, "_");
      a.click();
      URL.revokeObjectURL(url);
      notify("Excel exported.", "success");
    } catch {
      notify("Failed to export the Excel file.", "error");
    } finally {
      setExporting(false);
    }
  };

  // Which invoices (by Doc No) are expanded to show their line items.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleInv = (key) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  const expandAll = () => setExpanded(new Set((report?.invoices || []).map((i) => i.documentNumber)));
  const collapseAll = () => setExpanded(new Set());

  if (!canView) {
    return <div style={{ padding: 24, color: colors.textSecondary }}>You don't have permission to view reports.</div>;
  }

  return (
    <div style={{ padding: "clamp(12px, 3vw, 24px)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <MdAssessment size={26} color={colors.blue} />
        <h1 style={{ margin: 0, fontSize: "clamp(1.2rem, 3vw, 1.6rem)", color: colors.textPrimary }}>Sales Report</h1>
      </div>
      <p style={{ margin: "0 0 16px", color: colors.textSecondary, fontSize: "0.9rem" }}>
        FBR-submitted invoices, grouped by document date. Quantities shown are what was <strong>filed to FBR</strong>.
      </p>

      {/* Controls */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end",
        background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: 14, marginBottom: 16,
      }}>
        <Field label="Company" icon={<MdBusiness size={15} />}>
          <select
            style={{ ...dropdownStyles.base, minWidth: 180 }}
            value={selectedCompany?.id || ""}
            onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select>
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
              <input
                type="date"
                style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }}
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }}
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </Field>
          </>
        )}

        <Field label="Buyer type">
          <select style={dropdownStyles.base} value={buyerType} onChange={(e) => setBuyerType(e.target.value)}>
            {BUYER_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </Field>

        <Field label="Client" icon={<MdPerson size={15} />}>
          <SearchableClientSelect
            clients={clients}
            value={clientId}
            onChange={(id) => setClientId(id)}
            placeholder="All clients"
            style={{ minWidth: 180, maxWidth: 240 }}
          />
        </Field>

        <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
          <button onClick={fetchReport} disabled={loading || rangeInvalid} style={btn(colors.blue)}>
            <MdRefresh size={16} /> {loading ? "Loading…" : "Refresh"}
          </button>
          {canExport && (
            <button onClick={exportExcel} disabled={!report || loading || exporting || rangeInvalid} style={btn(colors.teal)}>
              <MdDownload size={16} /> {exporting ? "Exporting…" : "Export Excel"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Report body */}
      {report && !loading && (
        <div style={{ background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.cardBorder}`, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, color: colors.textPrimary }}>{report.companyName}</div>
              <div style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
                Sale Report · {periodLabel} · {BUYER_TYPES.find((b) => b.value === report.buyerType)?.label || report.buyerType}
                {" · "}{report.invoiceCount} invoice(s), {report.lineCount} line(s)
              </div>
            </div>
            {report.invoices.length > 0 && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={expandAll} style={ghostBtn}><MdUnfoldMore size={15} /> Expand all</button>
                <button onClick={collapseAll} style={ghostBtn}><MdUnfoldLess size={15} /> Collapse all</button>
              </div>
            )}
          </div>

          {report.invoices.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: colors.textSecondary }}>
              No FBR-submitted sales for {periodLabel}.
            </div>
          ) : isNarrow ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
              {report.invoices.map((inv) => {
                const open = expanded.has(inv.documentNumber);
                const hsCodes = [...new Set(inv.lines.map((l) => l.hsCode).filter(Boolean))].join(", ");
                return (
                  <div key={inv.documentNumber} style={srCard}>
                    <button type="button" onClick={() => toggleInv(inv.documentNumber)} style={srCardHead}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: colors.blue }}>
                        {open ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                        {inv.documentNumber}
                      </span>
                      <span style={{ fontSize: "0.76rem", color: colors.textSecondary }}>{new Date(inv.documentDate).toLocaleDateString()}</span>
                    </button>
                    <div style={{ fontSize: "0.86rem", fontWeight: 600, color: colors.textPrimary, ...clamp2 }}>{inv.customer}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: colors.textSecondary, ...clamp2 }}>FBR {inv.fbrInvoiceNumber || "—"}{hsCodes ? ` · HS ${hsCodes}` : ""}</div>
                    <div style={srMeta}>
                      <div><span style={srLbl}>Items</span><span style={srVal}>{inv.lineCount}</span></div>
                      <div><span style={srLbl}>Qty</span><span style={srVal}>{qty(inv.totalQuantity)}</span></div>
                      <div><span style={srLbl}>Amount</span><span style={srVal}>{money(inv.totalAmount)}</span></div>
                      <div><span style={srLbl}>Tax</span><span style={srVal}>{money(inv.totalTax)}</span></div>
                      <div><span style={srLbl}>Total</span><span style={{ ...srVal, fontWeight: 700, color: colors.blue }}>{money(inv.totalGross)}</span></div>
                    </div>
                    {open && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${colors.cardBorder}` }}>
                        {inv.lines.map((l, idx) => (
                          <div key={idx} style={srLine}>
                            <div style={{ fontSize: "0.82rem", fontWeight: 600, ...clamp2 }}>{l.sr}. {l.product}</div>
                            <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: colors.textSecondary }}>HS {l.hsCode || "—"}</div>
                            <div style={srLineMeta}>
                              <span>{qty(l.quantity)} {l.unit}</span>
                              <span>@ {money(l.rate)}</span>
                              <span>Tax {money(l.taxAmount)}</span>
                              <span style={{ fontWeight: 700, color: colors.blue }}>{money(l.totalAmount)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ ...srCard, background: colors.totalBg, borderColor: colors.blue }}>
                <div style={{ fontWeight: 800, color: colors.blue, marginBottom: 4 }}>TOTAL ({report.lineCount} lines)</div>
                <div style={srMeta}>
                  <div><span style={srLbl}>Qty</span><span style={{ ...srVal, fontWeight: 800 }}>{qty(report.grandQuantity)}</span></div>
                  <div><span style={srLbl}>Amount</span><span style={{ ...srVal, fontWeight: 800 }}>{money(report.grandAmount)}</span></div>
                  <div><span style={srLbl}>Tax</span><span style={{ ...srVal, fontWeight: 800 }}>{money(report.grandTax)}</span></div>
                  <div><span style={srLbl}>Total</span><span style={{ ...srVal, fontWeight: 800, color: colors.blue }}>{money(report.grandTotal)}</span></div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 820, fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: colors.rowAlt }}>
                    {["", "Doc. No", "Date", "FBR Inv. No.", "Customer", "HS Code", "Items", "Qty", "Amount", "Tax", "Total"].map((h, i) => (
                      <th key={i} style={{ ...th, textAlign: i >= 6 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.invoices.map((inv) => {
                    const open = expanded.has(inv.documentNumber);
                    // Distinct HS codes on this invoice: one if all lines share
                    // it, otherwise comma-separated.
                    const hsCodes = [...new Set(inv.lines.map((l) => l.hsCode).filter(Boolean))].join(", ");
                    return (
                      <Fragment key={inv.documentNumber}>
                        {/* Invoice summary row — click to expand its items */}
                        <tr
                          onClick={() => toggleInv(inv.documentNumber)}
                          style={{ cursor: "pointer", borderTop: `1px solid ${colors.cardBorder}`, background: open ? colors.bandBg : "#fff" }}
                        >
                          <td style={{ ...td, width: 30, color: colors.blue }}>
                            {open ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                          </td>
                          <td style={{ ...td, fontWeight: 700, color: colors.blue }}>{inv.documentNumber}</td>
                          <td style={td}>{new Date(inv.documentDate).toLocaleDateString()}</td>
                          <td style={{ ...td, fontFamily: "monospace", fontSize: "0.75rem" }}>{inv.fbrInvoiceNumber}</td>
                          <td style={{ ...td, maxWidth: 220 }}><div style={clamp2}>{inv.customer}</div></td>
                          <td style={{ ...td, fontFamily: "monospace", fontSize: "0.75rem", maxWidth: 160 }}><div style={clamp2}>{hsCodes}</div></td>
                          <td style={tdR}>{inv.lineCount}</td>
                          <td style={tdR}>{qty(inv.totalQuantity)}</td>
                          <td style={tdR}>{money(inv.totalAmount)}</td>
                          <td style={tdR}>{money(inv.totalTax)}</td>
                          <td style={{ ...tdR, fontWeight: 700 }}>{money(inv.totalGross)}</td>
                        </tr>
                        {/* Expanded line items */}
                        {open && (
                          <tr>
                            <td colSpan={11} style={{ padding: 0, background: colors.rowAlt }}>
                              <div style={{ overflowX: "auto", padding: "4px 8px 10px 38px" }}>
                                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: "0.8rem" }}>
                                  <thead>
                                    <tr>
                                      {["Sr.", "HS Code", "Product", "Qty", "Unit", "Rate", "Amount", "Dis Amt", "Tax Amt", "Total"].map((h, i) => (
                                        <th key={i} style={{ ...th, textAlign: i >= 3 && i !== 4 ? "right" : "left" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {inv.lines.map((l, idx) => (
                                      <tr key={idx} style={{ borderTop: `1px solid ${colors.cardBorder}` }}>
                                        <td style={td}>{l.sr}</td>
                                        <td style={{ ...td, fontFamily: "monospace" }}>{l.hsCode}</td>
                                        <td style={{ ...td, maxWidth: 280 }}><div style={clamp2}>{l.product}</div></td>
                                        <td style={tdR}>{qty(l.quantity)}</td>
                                        <td style={td}>{l.unit}</td>
                                        <td style={tdR}>{money(l.rate)}</td>
                                        <td style={tdR}>{money(l.amount)}</td>
                                        <td style={tdR}>{money(l.discountAmount)}</td>
                                        <td style={tdR}>{money(l.taxAmount)}</td>
                                        <td style={{ ...tdR, fontWeight: 600 }}>{money(l.totalAmount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {/* Grand total across all invoices */}
                  <tr style={{ background: colors.totalBg, borderTop: `2px solid ${colors.blue}` }}>
                    <td style={{ ...td, fontWeight: 800, color: colors.blue }} colSpan={6}>TOTAL (all invoices)</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{report.lineCount}</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{qty(report.grandQuantity)}</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{money(report.grandAmount)}</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{money(report.grandTax)}</td>
                    <td style={{ ...tdR, fontWeight: 800, color: colors.blue }}>{money(report.grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ padding: 32, textAlign: "center", color: colors.textSecondary }}>Loading report…</div>}
    </div>
  );
}

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

// Mobile card styles — phones get stacked, tappable invoice cards (no
// horizontal scroll) instead of the wide table.
const srCard = { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem 0.8rem", background: "#fff", display: "flex", flexDirection: "column", gap: 3 };
const srCardHead = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, boxShadow: "none", cursor: "pointer", width: "100%", textAlign: "left" };
const srMeta = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(90px, 100%), 1fr))", gap: "0.35rem 0.7rem", marginTop: 4 };
const srLbl = { display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary };
const srVal = { display: "block", fontSize: "0.84rem", fontWeight: 600, color: colors.textPrimary };
const srLine = { background: colors.rowAlt, borderRadius: 8, padding: "0.5rem 0.6rem", display: "flex", flexDirection: "column", gap: 2 };
const srLineMeta = { display: "flex", flexWrap: "wrap", gap: "0.3rem 0.7rem", fontSize: "0.78rem", color: colors.textSecondary, marginTop: 2 };

const btn = (bg) => ({
  display: "inline-flex", alignItems: "center", gap: 6, background: bg, color: "#fff",
  border: "none", borderRadius: 8, padding: "9px 14px", fontSize: "0.85rem", fontWeight: 600,
  cursor: "pointer", minHeight: 40,
});

// Small outline button for expand/collapse-all.
const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 4,
  background: "#fff", color: colors.textSecondary,
  border: `1px solid ${colors.inputBorder}`, borderRadius: 8,
  padding: "6px 10px", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
};

// Segmented-control button — active segment filled blue, inactive plain.
const segBtn = (active) => ({
  border: "none",
  background: active ? colors.blue : "transparent",
  color: active ? "#fff" : colors.textSecondary,
  padding: "9px 14px",
  fontSize: "0.82rem",
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 40,
  whiteSpace: "nowrap",
});
