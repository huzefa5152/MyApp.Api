import { useState, useEffect } from "react";
import { MdClose, MdExpandMore, MdChevronRight, MdRequestQuote, MdAssignment, MdReceipt, MdUndo, MdLocalShipping, MdFactCheck } from "react-icons/md";
import { getClientDrilldown, getClientStatement } from "../api/clientApi";
import { formStyles, modalSizes } from "../theme";

const colors = { blue: "#0d47a1", green: "#2e7d32", red: "#c62828", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3" };
const money = (n) => "Rs. " + (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

const SECTIONS = [
  { key: "quotes",       dataKey: "quotes",              label: "Sales Quotes",   icon: MdRequestQuote, prefix: "SQ",  cols: ["number", "date", "amount", "status"] },
  { key: "orders",       dataKey: "orders",              label: "Sales Orders",   icon: MdAssignment,   prefix: "SO",  cols: ["number", "date", "status"] },
  { key: "invoices",     dataKey: "invoices",            label: "Sales Invoices", icon: MdReceipt,      prefix: "INV", cols: ["number", "date", "amount", "balance", "status"] },
  { key: "creditNotes",  dataKey: "creditNotes",         label: "Credit Notes",   icon: MdUndo,         prefix: "CN",  cols: ["number", "date", "amount", "status"] },
  { key: "challans",     dataKey: "challans",            label: "Delivery Notes", icon: MdLocalShipping,prefix: "DC",  cols: ["number", "date", "status"] },
  { key: "wht",          dataKey: "withholdingReceipts", label: "Withholding Tax",icon: MdFactCheck,    prefix: "WHT", cols: ["number", "date", "amount"] },
];
const SECTION_KEYS = new Set(SECTIONS.map((s) => s.key));
const COL_LABEL = { number: "#", date: "Date", amount: "Amount", balance: "Balance", status: "Status" };
const STATUS_TONE = {
  Paid: "#2e7d32", Unpaid: "#b26a00", Partial: "#0277bd", Overpaid: "#0d47a1", Billed: "#2e7d32",
  Submitted: "#2e7d32", Validated: "#0277bd", Pending: "#b26a00", Failed: "#c62828",
  Accepted: "#2e7d32", Converted: "#0d47a1", Rejected: "#c62828", Expired: "#8a6d3b",
};

export default function ClientDetailModal({ clientId, clientName, initialSection, onClose }) {
  // The A/R cell passes "statement"; every other cell passes a section key.
  const [tab, setTab] = useState(initialSection === "statement" ? "statement" : "documents");

  // Documents tab (drill-down) — lazy loaded on first view.
  const [docs, setDocs] = useState(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [open, setOpen] = useState(() => new Set(SECTION_KEYS.has(initialSection) ? [initialSection] : []));

  // Statement tab (A/R ledger) — lazy loaded on first view.
  const [stmt, setStmt] = useState(null);
  const [stmtLoading, setStmtLoading] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    if (tab !== "documents" || docs || docsLoading) return;
    let cancelled = false;
    setDocsLoading(true);
    getClientDrilldown(clientId)
      .then(({ data }) => { if (!cancelled) { setDocs(data); if (!SECTION_KEYS.has(initialSection)) autoExpandFirst(data); } })
      .catch(() => { if (!cancelled) setError("Could not load this customer's documents."); })
      .finally(() => { if (!cancelled) setDocsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "statement" || stmt || stmtLoading) return;
    let cancelled = false;
    setStmtLoading(true);
    getClientStatement(clientId)
      .then(({ data }) => { if (!cancelled) setStmt(data); })
      .catch(() => { if (!cancelled) setError("Could not load this customer's statement."); })
      .finally(() => { if (!cancelled) setStmtLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const autoExpandFirst = (data) => {
    const first = SECTIONS.find((s) => (data[s.dataKey]?.total || 0) > 0);
    if (first) setOpen(new Set([first.key]));
  };
  const toggle = (key) =>
    setOpen((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{clientName}</h5>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>

        {/* Tab bar */}
        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(tab === "statement" ? s.tabOn : {}) }} onClick={() => setTab("statement")}>Statement</button>
          <button style={{ ...s.tab, ...(tab === "documents" ? s.tabOn : {}) }} onClick={() => setTab("documents")}>Documents</button>
        </div>

        <div style={{ ...formStyles.body, padding: "0.75rem 1rem 1rem" }}>
          {error && <div style={s.error}>{error}</div>}

          {tab === "statement" ? (
            stmtLoading || !stmt ? (
              <div style={s.centre}><div style={s.spinner} /></div>
            ) : (
              <StatementView stmt={stmt} />
            )
          ) : docsLoading || !docs ? (
            <div style={s.centre}><div style={s.spinner} /></div>
          ) : (
            SECTIONS.map((sec) => {
              const section = docs[sec.dataKey] || { total: 0, rows: [] };
              const isOpen = open.has(sec.key);
              const Icon = sec.icon;
              return (
                <div key={sec.key} style={s.section}>
                  <button style={s.secHeader} onClick={() => toggle(sec.key)} aria-expanded={isOpen}>
                    {isOpen ? <MdExpandMore size={20} color={colors.textSecondary} /> : <MdChevronRight size={20} color={colors.textSecondary} />}
                    <Icon size={18} color={colors.blue} />
                    <span style={s.secLabel}>{sec.label}</span>
                    <span style={s.count}>{section.total}</span>
                  </button>
                  {isOpen && (
                    <div style={s.secBody}>
                      {section.total === 0 ? (
                        <div style={s.empty}>No {sec.label.toLowerCase()} for this customer.</div>
                      ) : (
                        <>
                          <div style={{ overflowX: "auto" }}>
                            <table style={s.table}>
                              <thead>
                                <tr>
                                  {sec.cols.map((c) => (
                                    <th key={c} style={{ ...s.th, textAlign: c === "amount" || c === "balance" ? "right" : "left" }}>{COL_LABEL[c]}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {section.rows.map((r) => (
                                  <tr key={r.id} style={s.tr}>
                                    {sec.cols.map((c) => (
                                      <td key={c} style={{ ...s.td, textAlign: c === "amount" || c === "balance" ? "right" : "left", whiteSpace: c === "status" ? "normal" : "nowrap" }}>
                                        {c === "number" && <strong>{sec.prefix}-{r.number}</strong>}
                                        {c === "date" && fmtDate(r.date)}
                                        {c === "amount" && (r.amount != null ? money(r.amount) : "—")}
                                        {c === "balance" && (r.balance != null ? money(r.balance) : "—")}
                                        {c === "status" && (r.status ? <span style={{ color: STATUS_TONE[r.status] || colors.textSecondary, fontWeight: 600 }}>{r.status}</span> : "—")}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {section.total > section.rows.length && (
                            <div style={s.capNote}>Showing the {section.rows.length} most recent of {section.total}.</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** The A/R ledger — invoices (debit) and receipts (credit) with running balance. */
function StatementView({ stmt }) {
  const rows = stmt.entries || [];
  return (
    <>
      <div style={s.stmtHead}>
        <span style={s.stmtLbl}>Accounts Receivable balance</span>
        <span style={{ ...s.stmtVal, color: stmt.closingBalance < 0 ? colors.blue : colors.textPrimary }}>{money(stmt.closingBalance)}</span>
      </div>
      {rows.length === 0 ? (
        <div style={s.empty}>No invoices or receipts for this customer yet.</div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Date</th>
                  <th style={s.th}>Transaction</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Debit</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Credit</th>
                  <th style={{ ...s.th, textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <tr key={i} style={s.tr}>
                    <td style={{ ...s.td, whiteSpace: "nowrap" }}>{fmtDate(e.date)}</td>
                    <td style={s.td}>
                      <div><strong>{e.reference}</strong> <span style={{ color: colors.textSecondary, fontSize: "0.76rem" }}>· {e.type}</span></div>
                      {(e.bankAccount || e.description) && (
                        <div style={{ color: colors.textSecondary, fontSize: "0.74rem" }}>{[e.bankAccount, e.description].filter(Boolean).join(" — ")}</div>
                      )}
                    </td>
                    <td style={{ ...s.td, textAlign: "right", whiteSpace: "nowrap", color: colors.textPrimary }}>{e.debit ? money(e.debit) : ""}</td>
                    <td style={{ ...s.td, textAlign: "right", whiteSpace: "nowrap", color: colors.green }}>{e.credit ? money(e.credit) : ""}</td>
                    <td style={{ ...s.td, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{money(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stmt.capped && (
            <div style={s.capNote}>Showing the {rows.length} most recent of {stmt.total} entries — each balance is still the true running balance at that date.</div>
          )}
        </>
      )}
    </>
  );
}

const s = {
  tabs: { display: "flex", gap: 4, padding: "0 1rem", borderBottom: `1px solid ${colors.cardBorder}` },
  tab: { padding: "0.6rem 1rem", background: "none", border: "none", borderBottom: "2px solid transparent", marginBottom: -1, cursor: "pointer", fontWeight: 700, fontSize: "0.88rem", color: colors.textSecondary },
  tabOn: { color: colors.blue, borderBottomColor: colors.blue },
  centre: { display: "flex", justifyContent: "center", padding: "2.5rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  error: { padding: "1rem", color: "#c62828", background: "#ffebee", borderRadius: 8, fontSize: "0.88rem" },
  stmtHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", background: "#f8f9fb", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem 0.9rem", marginBottom: "0.8rem" },
  stmtLbl: { fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.02em", color: colors.textSecondary, fontWeight: 700 },
  stmtVal: { fontSize: "1.25rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  section: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, marginBottom: "0.6rem", overflow: "hidden" },
  secHeader: { width: "100%", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 0.75rem", background: "#fff", border: "none", cursor: "pointer", textAlign: "left" },
  secLabel: { flex: 1, fontWeight: 700, fontSize: "0.9rem", color: colors.textPrimary },
  count: { minWidth: 26, textAlign: "center", padding: "0.1rem 0.5rem", borderRadius: 12, background: "#e3f2fd", color: colors.blue, fontSize: "0.78rem", fontWeight: 700 },
  secBody: { borderTop: `1px solid ${colors.cardBorder}`, background: "#fcfdfe", padding: "0.5rem 0.75rem 0.7rem" },
  empty: { color: colors.textSecondary, fontSize: "0.84rem", padding: "0.6rem 0" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 380 },
  th: { padding: "0.4rem 0.6rem", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.02em", fontWeight: 700, color: colors.textSecondary, borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #eef2f7" },
  td: { padding: "0.4rem 0.6rem", color: "#334155", fontVariantNumeric: "tabular-nums", verticalAlign: "top" },
  capNote: { marginTop: "0.5rem", fontSize: "0.74rem", color: colors.textSecondary, fontStyle: "italic" },
};
