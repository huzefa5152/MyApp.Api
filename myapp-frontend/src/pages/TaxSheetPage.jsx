import { useState, useEffect, useCallback } from "react";
import { MdFactCheck, MdBusiness, MdRefresh, MdDownload, MdPerson, MdEventRepeat, MdClose } from "react-icons/md";
import { getTaxSheet, getTaxSheetExcel, transferTaxSheet } from "../api/reportApi";
import { getClientsByCompany } from "../api/clientApi";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";

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
    return <div style={{ padding: 24, color: colors.textSecondary }}>You don't have permission to view reports.</div>;
  }

  return (
    <div style={{ padding: "clamp(12px, 3vw, 24px)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <MdFactCheck size={26} color={colors.blue} />
        <h1 style={{ margin: 0, fontSize: "clamp(1.2rem, 3vw, 1.6rem)", color: colors.textPrimary }}>Tax Sheet</h1>
      </div>
      <p style={{ margin: "0 0 16px", color: colors.textSecondary, fontSize: "0.9rem" }}>
        Invoice lines whose item type still has <strong>no HS code</strong> — send to the tax consultant to classify.
        The <strong>HS Code</strong> column shows the item-type name that needs a real HS code.
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

        <Field label="Client" icon={<MdPerson size={15} />}>
          <select
            style={{ ...dropdownStyles.base, minWidth: 180, maxWidth: 240 }}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
              <input type="date" style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }}
                value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input type="date" style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: "#dc2626" } : {}) }}
                value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
            </Field>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
          <button onClick={fetchReport} disabled={loading || rangeInvalid} style={btn(colors.blue)}>
            <MdRefresh size={16} /> {loading ? "Loading…" : "Refresh"}
          </button>
          {canExport && (
            <button onClick={exportExcel} disabled={!report || loading || exporting || rangeInvalid} style={btn(colors.teal)}>
              <MdDownload size={16} /> {exporting ? "Exporting…" : "Export Excel"}
            </button>
          )}
          {canTransfer && (
            <button
              onClick={openTransfer}
              disabled={!report || loading || rangeInvalid || (report?.rows?.length || 0) === 0}
              style={btn("#e65100")}
              title="Move the remaining (unclassified) invoices to a new date so you can file them next period"
            >
              <MdEventRepeat size={16} /> Transfer → next month
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {report && !loading && (
        <div style={{ background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.cardBorder}` }}>
            <div style={{ fontWeight: 700, color: colors.textPrimary }}>{report.companyName}</div>
            <div style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
              Tax Sheet · {periodLabel} · {report.invoiceCount} invoice(s), {report.rowCount} line(s) pending HS code
            </div>
          </div>

          {report.rows.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: colors.textSecondary }}>
              No invoices pending HS classification for {periodLabel}. 🎉
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860, fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: colors.rowAlt }}>
                    {["NTN Number", "Party Name", "Inv Number", "Inv Date", "Item Total QTY", "HS Code", "Excluding Amount", "Sales Tax", "Total"].map((h, i) => (
                      <th key={i} style={{ ...th, textAlign: i >= 6 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, idx) => (
                    <tr key={idx} style={{ borderTop: `1px solid ${colors.cardBorder}` }}>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: "0.75rem" }}>{row.ntn}</td>
                      <td style={{ ...td, maxWidth: 220 }}><div style={clamp2}>{row.partyName}</div></td>
                      <td style={{ ...td, fontWeight: 600, color: colors.blue }}>{row.documentNumber}</td>
                      <td style={td}>{new Date(row.documentDate).toLocaleDateString()}</td>
                      <td style={td}>{row.quantityLabel}</td>
                      <td style={td}>
                        <span style={{ background: colors.pill, color: colors.pillText, padding: "2px 8px", borderRadius: 6, fontSize: "0.78rem", fontWeight: 600 }}>
                          {row.itemTypeName}
                        </span>
                      </td>
                      <td style={tdR}>{money(row.excludingAmount)}</td>
                      <td style={tdR}>{money(row.salesTax)}</td>
                      <td style={{ ...tdR, fontWeight: 600 }}>{money(row.total)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: colors.totalBg, borderTop: `2px solid ${colors.blue}` }}>
                    <td style={{ ...td, fontWeight: 800, color: colors.blue }} colSpan={6}>TOTAL</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{money(report.grandExcluding)}</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{money(report.grandTax)}</td>
                    <td style={{ ...tdR, fontWeight: 800, color: colors.blue }}>{money(report.grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ padding: 32, textAlign: "center", color: colors.textSecondary }}>Loading tax sheet…</div>}

      {transferOpen && (
        <div style={overlay} onClick={() => !transferring && setTransferOpen(false)}>
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
              <button onClick={() => setTransferOpen(false)} disabled={transferring}
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
};
const modalBox = {
  background: "#fff", borderRadius: 12, padding: 20, width: "min(460px, 100%)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};

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
