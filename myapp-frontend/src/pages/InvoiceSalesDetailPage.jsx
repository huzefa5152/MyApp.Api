import { useEffect, useState } from "react";
import { getInvoiceSalesDetail, getInvoiceSalesDetailExcel } from "../api/reportApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { dropdownStyles } from "../theme";
import { notify } from "../utils/notify";
import useIsNarrow from "../hooks/useIsNarrow";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const money = (value) => Number(value || 0).toLocaleString(undefined,
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InvoiceSalesDetailPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.invoicedetail.view");
  const canExport = has("reports.invoicedetail.export");
  const narrow = useIsNarrow();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const validYear = Number.isInteger(year) && year >= 2000 && year <= 2100;

  useEffect(() => {
    if (!selectedCompany || !canView) return;
    if (!validYear) { setReport(null); return; }
    let live = true;
    setReport(null);
    setLoading(true);
    setError("");
    getInvoiceSalesDetail(selectedCompany.id, year, month)
      .then(({ data }) => { if (live) setReport(data); })
      .catch((e) => { if (live) setError(e?.response?.data?.message || "Could not load invoice sales detail."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [selectedCompany, year, month, canView, validYear]);

  const download = async () => {
    if (!selectedCompany || !canExport || !validYear) return;
    setExporting(true);
    try {
      const { data } = await getInvoiceSalesDetailExcel(selectedCompany.id, year, month);
      const url = URL.createObjectURL(new Blob([data],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Invoice-Sales-Detail-${year}-${String(month).padStart(2, "0")}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { notify.error("Could not export invoice sales detail."); }
    finally { setExporting(false); }
  };

  if (!canView) return <div style={{ padding: 24 }}>You don't have permission to view this report.</div>;
  const columns = ["Date", "DC No", "Inv No", "Party Name", "Address", "NTN", "HS Code", "Description",
    "Unit", "Qty", "Rate", "Excl", "Tax Rate", "G. S. T", "Incl", "236-G / 236-H Tax",
    "Further Tax", "Total", "FBR Status", "FBR Invoice No", "Bill Status"];
  const cells = (r) => [r.date?.slice(0, 10), r.deliveryChallanNumbers, r.invoiceNumber, r.buyer,
    r.buyerAddress, r.buyerNtn, r.hsCode, r.description, r.unit, r.quantity,
    money(r.rate), money(r.excludingTax), `${r.taxRate}%`, money(r.salesTax),
    money(r.includingTax), money(r.advanceTax), money(r.furtherTax), money(r.total),
    r.fbrStatus, r.fbrInvoiceNumber, r.billStatus];

  return <div style={{ padding: "clamp(12px, 3vw, 24px)" }}>
    <h1 style={{ fontSize: "clamp(1.3rem, 3vw, 1.65rem)", margin: "0 0 6px" }}>Invoice Sales Detail</h1>
    <p style={{ color: "#5f6d7e", margin: "0 0 16px" }}>
      All bills dated in the selected month, including those not submitted to FBR. Amounts are the saved bill values;
      cancelled bills remain visible and are included in the listed totals. Buyer address and NTN come from the current buyer record.
    </p>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12, marginBottom: 18 }}>
      <label>Company<br /><select style={dropdownStyles.base} value={selectedCompany?.id || ""}
        onChange={(e) => setSelectedCompany(companies.find((c) => String(c.id) === e.target.value))}>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
      </select></label>
      <label>Month<br /><select style={dropdownStyles.base} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
        {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select></label>
      <label>Year<br /><input type="number" min="2000" max="2100" step="1"
        style={{ ...dropdownStyles.base, width: 110 }} value={year}
        onChange={(e) => setYear(Number(e.target.value))} /></label>
      {canExport && <button type="button" onClick={download} disabled={exporting || !selectedCompany || !validYear}
        style={{ minHeight: 44, padding: "0 18px", border: 0, borderRadius: 8, background: "#0d47a1", color: "#fff", cursor: "pointer" }}>
        {exporting ? "Exporting…" : "Export Excel"}
      </button>}
    </div>
    {loading && <p>Loading report…</p>}
    {!validYear && <p role="alert" style={{ color: "#b91c1c" }}>Choose a year from 2000 to 2100.</p>}
    {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    {report && <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        {[["Bills", report.invoiceCount], ["Submitted", report.submittedCount],
          ["Not submitted", report.notSubmittedCount], ["Excl", money(report.excludingTax)],
          ["G. S. T", money(report.salesTax)], ["Total incl taxes", money(report.total)]].map(([label, value]) =>
          <div key={label} style={{ background: "#f3f7fc", border: "1px solid #e0e8f1", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ color: "#5f6d7e", fontSize: 12 }}>{label}</div><strong>{value}</strong>
          </div>)}
      </div>
      {report.rows.length === 0 ? <p>No bills in {months[month - 1]} {year}.</p> : narrow ?
        <div style={{ display: "grid", gap: 10 }}>{report.rows.map((r) =>
          <div key={`${r.invoiceId}-${r.lineNumber}`} style={{ background: "#fff", border: "1px solid #dce5ee", borderRadius: 8, padding: 12 }}>
            <strong>Inv {r.invoiceNumber} · {r.buyer}</strong>
            <div>{r.date?.slice(0, 10)} · {r.description} · {r.quantity} {r.unit}</div>
            <div>DC {r.deliveryChallanNumbers || "—"} · HS {r.hsCode || "—"} · {r.taxRate}% tax</div>
            <div>{r.buyerNtn ? `NTN ${r.buyerNtn}` : "NTN —"}{r.buyerAddress ? ` · ${r.buyerAddress}` : ""}</div>
            <div>Excl {money(r.excludingTax)} · GST {money(r.salesTax)} · Total {money(r.total)}</div>
            {(r.advanceTax || r.furtherTax) ? <div>Advance {money(r.advanceTax)} · Further {money(r.furtherTax)}</div> : null}
            <div>FBR: {r.fbrStatus}{r.fbrInvoiceNumber ? ` · ${r.fbrInvoiceNumber}` : ""}</div>
            {r.billStatus === "Cancelled" && <div>Bill cancelled</div>}
          </div>)}</div> :
        <div style={{ overflowX: "auto", border: "1px solid #dce5ee", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%", fontSize: 13 }}>
            <thead><tr>{columns.map((c) => <th key={c} style={{ textAlign: "left", padding: 8, background: "#eaf2fc", borderBottom: "1px solid #dce5ee" }}>{c}</th>)}</tr></thead>
            <tbody>{report.rows.map((r) => <tr key={`${r.invoiceId}-${r.lineNumber}`}>
              {cells(r).map((v, i) => <td key={i} style={{ padding: 8, borderBottom: "1px solid #edf1f5", maxWidth: i === 3 || i === 7 ? 240 : undefined, overflowWrap: "anywhere", textAlign: i >= 9 && i <= 17 ? "right" : "left" }}>{v}</td>)}
            </tr>)}</tbody>
          </table>
        </div>}
    </>}
  </div>;
}
