import { useState, useEffect, useCallback, useMemo } from "react";
import {
  MdReceiptLong, MdBusiness, MdRefresh, MdDownload,
  MdChevronRight, MdExpandMore, MdUnfoldMore, MdUnfoldLess,
} from "react-icons/md";
import {
  getClientLedgerReport, getClientLedgerReportExcel, getClientLedgerCustomers,
} from "../api/reportApi";
import SearchableSelect from "../Components/SearchableSelect";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import useIsNarrow from "../hooks/useIsNarrow";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  red: "#b91c1c",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
  rowAlt: "#fafbfd",
  bandBg: "#f0f7ff",
  totalBg: "#eef4ff",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NOW = new Date();
const YEARS = Array.from({ length: 6 }, (_, i) => NOW.getFullYear() - i);

const money = (n) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Blank rather than "0.00" for the empty side of a Debit/Credit pair — the
// workbook leaves it empty, and it keeps the eye on the column that moved.
const moneyOrBlank = (n) => (Number(n) ? money(n) : "");
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const prettyDate = (s) => {
  const [y, m, d] = (s || "").split("-");
  return d ? `${d}-${m}-${y}` : s;
};

/**
 * Client Ledger report — the Reports-module, company-wide counterpart of the
 * Customer Ledger screen: every customer's statement for a period, in the
 * layout of the workbook the operator already keeps.
 *
 * COLUMN CONVENTION (the operator's workbook, the mirror of textbook A/R —
 * user decision 2026-08-30): invoices and DEBIT notes sit in the CREDIT column;
 * receipts, CREDIT notes and adjustments sit in the DEBIT column; balance =
 * Opening + Σ Credit − Σ Debit. A positive balance means the customer owes us,
 * negative means they hold an advance. The server sends the figures already in
 * this convention (CustomerLedgerService) — this page renders them as-is and
 * flips nothing.
 */
export default function ClientLedgerReportPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("reports.clientledger.view");
  const canExport = has("reports.clientledger.export");
  const isNarrow = useIsNarrow();

  // Period mode: "period" (month / year) or "custom" (date range) — the same
  // contract every other report on this module uses.
  const [mode, setMode] = useState("period");
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState(NOW.getMonth() + 1); // 1–12
  const [fullYear, setFullYear] = useState(true);
  const [dateFrom, setDateFrom] = useState(ymd(new Date(NOW.getFullYear(), 0, 1)));
  const [dateTo, setDateTo] = useState(ymd(NOW));
  const [clientId, setClientId] = useState("");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Customer options come from the report's OWN picker feed, which returns
  // { id, name } and nothing else. Not the report payload: that omits customers
  // with no carried-in balance and no activity, yet the server renders an empty
  // statement for them happily when asked by id, so sourcing the picker there
  // would make exactly those customers unreachable. And not /clients/company/{id}
  // either: that feed returns the full client record (address, phone, email,
  // NTN, STRN, CNIC), so using it would mean every report viewer had to be
  // granted the company's customer PII. If the feed fails, the report's own
  // customers stand in so the filter still works for everyone it can reach.
  const [clientOptions, setClientOptions] = useState([]);

  const buildParams = useCallback(() => {
    const p = {};
    if (mode === "custom") {
      p.dateFrom = dateFrom;
      p.dateTo = dateTo;
    } else {
      p.year = year;
      if (!fullYear) p.month = month;
    }
    if (clientId) p.clientId = clientId;
    return p;
  }, [mode, dateFrom, dateTo, year, month, fullYear, clientId]);

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
      const { data } = await getClientLedgerReport(selectedCompany.id, buildParams());
      setReport(data);
      // Fallback only — see the clientOptions note. Filled from an UNFILTERED
      // response (a filtered one holds one customer) and only while the real
      // client list has not arrived, so it never shrinks a full list.
      if (!clientId) {
        setClientOptions((prev) => (prev.length ? prev
          : (data.clients || []).map((c) => ({ id: c.clientId, name: c.clientName }))));
      }
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to load the client ledger report.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, canView, mode, dateFrom, dateTo, clientId, buildParams]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  // Every customer of the company, so the filter can reach the dormant ones the
  // report leaves out. Switching company invalidates the cached list.
  useEffect(() => {
    setClientOptions([]);
    setClientId("");
    const companyId = selectedCompany?.id;
    if (!companyId || !canView) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getClientLedgerCustomers(companyId);
        if (cancelled) return;
        setClientOptions((data || []).map((c) => ({ id: c.id, name: c.name })));
      } catch {
        // No picker access — the report's own customers stand in (set by fetchReport).
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCompany?.id, canView]);

  const periodLabel = mode === "custom"
    ? `${prettyDate(dateFrom)} – ${prettyDate(dateTo)}`
    : fullYear ? `Year ${year}` : `${MONTHS[month - 1]} ${year}`;

  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    if (!selectedCompany || rangeInvalid) return;
    setExporting(true);
    try {
      const { data } = await getClientLedgerReportExcel(selectedCompany.id, buildParams());
      const url = URL.createObjectURL(new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Client-Ledger-${(report?.companyName || "company")}-${periodLabel}.xlsx`.replace(/\s+/g, "_");
      a.click();
      URL.revokeObjectURL(url);
      notify.success("Excel exported.");
    } catch {
      notify.error("Failed to export the Excel file.");
    } finally {
      setExporting(false);
    }
  };

  // Which customer sections are expanded. A single-customer report opens on
  // its own; a company-wide one starts collapsed so the summary reads first.
  const [expanded, setExpanded] = useState(() => new Set());
  useEffect(() => {
    const list = report?.clients || [];
    setExpanded(list.length === 1 ? new Set([list[0].clientId]) : new Set());
  }, [report]);
  const toggle = (id) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const expandAll = () => setExpanded(new Set((report?.clients || []).map((c) => c.clientId)));
  const collapseAll = () => setExpanded(new Set());

  const selectedClientName = useMemo(
    () => clientOptions.find((c) => String(c.id) === String(clientId))?.name || "",
    [clientOptions, clientId],
  );

  if (!canView) {
    return <div style={{ padding: 24, color: colors.textSecondary }}>You don't have permission to view this report.</div>;
  }

  return (
    <div style={{ padding: "clamp(12px, 3vw, 24px)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <MdReceiptLong size={26} color={colors.blue} />
        <h1 style={{ margin: 0, fontSize: "clamp(1.2rem, 3vw, 1.6rem)", color: colors.textPrimary }}>Client Ledger</h1>
      </div>
      <p style={{ margin: "0 0 16px", color: colors.textSecondary, fontSize: "0.9rem" }}>
        Every customer's statement for the period — opening balance, the full trail, and the balance carried out.
        Invoices and debit notes sit in <strong>Credit</strong>; receipts, credit notes and adjustments in{" "}
        <strong>Debit</strong>. A positive balance means the customer owes.
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
                style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: colors.red } : {}) }}
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                style={{ ...dropdownStyles.base, ...(rangeInvalid ? { borderColor: colors.red } : {}) }}
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </Field>
          </>
        )}

        <Field label="Customer">
          <SearchableSelect
            items={clientOptions}
            value={clientId}
            onChange={(id) => setClientId(id || "")}
            placeholder="All customers"
            style={{ ...dropdownStyles.base, minWidth: isNarrow ? undefined : 220, maxWidth: 260 }}
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
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: colors.red, padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {report && !loading && (
        <div style={{ background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.cardBorder}`, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, color: colors.textPrimary }}>{report.companyName}</div>
              <div style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
                Ledger · {periodLabel}
                {report.clientName ? ` · ${report.clientName}` : selectedClientName ? ` · ${selectedClientName}` : ""}
                {" · "}{report.clientCount} customer(s), {report.entryCount} entry(s)
              </div>
            </div>
            {report.clients.length > 1 && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={expandAll} style={ghostBtn}><MdUnfoldMore size={15} /> Expand all</button>
                <button onClick={collapseAll} style={ghostBtn}><MdUnfoldLess size={15} /> Collapse all</button>
              </div>
            )}
          </div>

          {report.clients.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: colors.textSecondary }}>
              No customer activity or carried-in balance for {periodLabel}.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {report.clients.map((c) => {
                const open = expanded.has(c.clientId);
                return (
                  <div key={c.clientId} style={{ borderBottom: `1px solid ${colors.cardBorder}` }}>
                    {/* Customer band — the sheet header of the workbook */}
                    <button
                      type="button"
                      onClick={() => toggle(c.clientId)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                        background: open ? colors.bandBg : "#fff", border: "none", cursor: "pointer",
                        padding: "10px 14px", minHeight: 48, flexWrap: "wrap",
                      }}
                    >
                      <span style={{ color: colors.blue, display: "grid", placeItems: "center", width: 20, height: 20 }}>
                        {open ? <MdExpandMore size={20} /> : <MdChevronRight size={20} />}
                      </span>
                      <span style={{ fontWeight: 700, color: colors.textPrimary, flex: "1 1 160px", minWidth: 0, ...clamp2 }}>
                        {c.clientName}
                      </span>
                      <span style={bandStats}>
                        <Stat label="Opening" value={money(c.opening)} />
                        <Stat label="Debit" value={money(c.totalDebit)} />
                        <Stat label="Credit" value={money(c.totalCredit)} />
                        <Stat label="Balance" value={money(c.closing)} strong tone={c.closing < 0 ? colors.teal : colors.blue} />
                      </span>
                    </button>

                    {open && (isNarrow ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 10px 12px" }}>
                        <div style={{ ...entryCard, background: colors.rowAlt }}>
                          <div style={{ fontWeight: 700 }}>Opening Balance</div>
                          <div style={{ fontWeight: 700, color: colors.blue }}>{money(c.opening)}</div>
                        </div>
                        {c.entries.map((e) => (
                          <div key={`${e.sr}-${e.reference}`} style={entryCard}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span style={{ fontWeight: 700, color: colors.blue }}>{e.reference}</span>
                              <span style={{ fontSize: "0.76rem", color: colors.textSecondary }}>
                                {new Date(e.date).toLocaleDateString()}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.82rem", color: colors.textSecondary, ...clamp2 }}>{e.particulars}</div>
                            <div style={entryMeta}>
                              <div><span style={lbl}>Debit</span><span style={val}>{moneyOrBlank(e.debit) || "—"}</span></div>
                              <div><span style={lbl}>Credit</span><span style={val}>{moneyOrBlank(e.credit) || "—"}</span></div>
                              <div><span style={lbl}>Balance</span><span style={{ ...val, fontWeight: 700, color: colors.blue }}>{money(e.balance)}</span></div>
                            </div>
                          </div>
                        ))}
                        <div style={{ ...entryCard, background: colors.totalBg, borderColor: colors.blue }}>
                          <div style={{ fontWeight: 800, color: colors.blue }}>Closing Balance</div>
                          <div style={entryMeta}>
                            <div><span style={lbl}>Debit</span><span style={{ ...val, fontWeight: 800 }}>{money(c.totalDebit)}</span></div>
                            <div><span style={lbl}>Credit</span><span style={{ ...val, fontWeight: 800 }}>{money(c.totalCredit)}</span></div>
                            <div><span style={lbl}>Balance</span><span style={{ ...val, fontWeight: 800, color: colors.blue }}>{money(c.closing)}</span></div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 780, fontSize: "0.82rem" }}>
                          <thead>
                            <tr style={{ background: colors.rowAlt }}>
                              {["S.No", "Date", "Inv / Ref", "Particulars", "Opening", "Debit", "Credit", "Balance"].map((h, i) => (
                                <th key={h} style={{ ...th, textAlign: i >= 4 ? "right" : "left" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {/* Opening row — seeds the running balance, exactly as the workbook does */}
                            <tr style={{ borderTop: `1px solid ${colors.cardBorder}`, fontWeight: 700 }}>
                              <td style={td} />
                              <td style={td} />
                              <td style={td} />
                              <td style={td}>Opening Balance</td>
                              <td style={tdR}>{money(c.opening)}</td>
                              <td style={tdR} />
                              <td style={tdR} />
                              <td style={tdR}>{money(c.opening)}</td>
                            </tr>
                            {c.entries.map((e) => (
                              <tr key={`${e.sr}-${e.reference}`} style={{ borderTop: `1px solid ${colors.cardBorder}` }}>
                                <td style={td}>{e.sr}</td>
                                <td style={{ ...td, whiteSpace: "nowrap" }}>{new Date(e.date).toLocaleDateString()}</td>
                                <td style={{ ...td, fontFamily: "monospace", fontSize: "0.76rem" }}>{e.reference}</td>
                                <td style={{ ...td, maxWidth: 320 }}><div style={clamp2}>{e.particulars}</div></td>
                                <td style={tdR} />
                                <td style={tdR}>{moneyOrBlank(e.debit)}</td>
                                <td style={tdR}>{moneyOrBlank(e.credit)}</td>
                                <td style={{ ...tdR, fontWeight: 600 }}>{money(e.balance)}</td>
                              </tr>
                            ))}
                            <tr style={{ background: colors.totalBg, borderTop: `2px solid ${colors.blue}` }}>
                              <td style={{ ...td, fontWeight: 800, color: colors.blue }} colSpan={4}>Closing Balance</td>
                              <td style={tdR} />
                              <td style={{ ...tdR, fontWeight: 800 }}>{money(c.totalDebit)}</td>
                              <td style={{ ...tdR, fontWeight: 800 }}>{money(c.totalCredit)}</td>
                              <td style={{ ...tdR, fontWeight: 800, color: colors.blue }}>{money(c.closing)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Grand total across every customer in the report */}
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between",
                padding: "12px 14px", background: colors.totalBg, borderTop: `2px solid ${colors.blue}`,
              }}>
                <div style={{ fontWeight: 800, color: colors.blue }}>TOTAL ({report.clientCount} customers)</div>
                <span style={bandStats}>
                  <Stat label="Opening" value={money(report.grandOpening)} strong />
                  <Stat label="Debit" value={money(report.grandDebit)} strong />
                  <Stat label="Credit" value={money(report.grandCredit)} strong />
                  <Stat label="Balance" value={money(report.grandClosing)} strong tone={colors.blue} />
                </span>
              </div>
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

function Stat({ label, value, strong, tone }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", minWidth: 84 }}>
      <span style={lbl}>{label}</span>
      <span style={{ ...val, fontWeight: strong ? 800 : 600, color: tone || colors.textPrimary, textAlign: "right" }}>{value}</span>
    </span>
  );
}

const th = { padding: "6px 10px", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.02em", color: colors.textSecondary, whiteSpace: "nowrap" };
const td = { padding: "6px 10px", color: colors.textPrimary, verticalAlign: "top" };
const tdR = { ...td, textAlign: "right", whiteSpace: "nowrap" };
// Long customer names must wrap, never collapse to an ellipsis — "MEKO
// FABRICS" and "MEKO DENIM" looked identical when they did (2026-05-13).
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

const bandStats = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(84px, 100%), 1fr))", gap: "0.35rem 0.9rem", flex: "1 1 320px" };
const lbl = { display: "block", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary };
const val = { display: "block", fontSize: "0.84rem", fontWeight: 600, color: colors.textPrimary };
const entryCard = { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.6rem 0.7rem", background: "#fff", display: "flex", flexDirection: "column", gap: 3 };
const entryMeta = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(90px, 100%), 1fr))", gap: "0.35rem 0.7rem", marginTop: 4 };

const btn = (bg) => ({
  display: "inline-flex", alignItems: "center", gap: 6, background: bg, color: "#fff",
  border: "none", borderRadius: 8, padding: "9px 14px", fontSize: "0.85rem", fontWeight: 600,
  cursor: "pointer", minHeight: 40,
});

const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 4,
  background: "#fff", color: colors.textSecondary,
  border: `1px solid ${colors.inputBorder}`, borderRadius: 8,
  padding: "6px 10px", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
};

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
