import { useState, useEffect } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import { getAccountLedger } from "../api/accountingApi";

const PAGE_SIZE = 50;

const money = (n) => {
  const v = Number(n) || 0;
  return v < 0 ? `(${Math.abs(v).toLocaleString()})` : v.toLocaleString();
};

/**
 * Ledger drill-down for a single account: paged journal lines with running
 * balance, opening/closing summary and optional From/To date filtering.
 * Opened from the Chart of Accounts tree (that page already asserts
 * accounting.coa.view, so no extra permission gate here).
 * `account` = { id, name, code }.
 */
export default function AccountLedgerDialog({ account, onClose }) {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { page, pageSize: PAGE_SIZE };
    if (applied.from) params.from = applied.from;
    if (applied.to) params.to = applied.to;
    getAccountLedger(account.id, params)
      .then(({ data: d }) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [account.id, page, applied]);

  const items = data?.items || [];
  const totalCount = data?.totalCount || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const applyFilter = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied({ from, to });
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={{ ...formStyles.title, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            Ledger — {account.name}
            {account.code && <span style={codeChip}>{account.code}</span>}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>

        <div style={formStyles.body}>
          {/* From / To period filter (optional) */}
          <form onSubmit={applyFilter} style={filterRow}>
            <label style={filterLabel}>
              From
              <input type="date" style={dateInput} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label style={filterLabel}>
              To
              <input type="date" style={dateInput} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button type="submit" style={applyBtn} disabled={loading}>Apply</button>
          </form>

          <div style={balanceRow}>
            <span style={balanceLabel}>Opening balance</span>
            <span style={balanceValue}>{loading ? "…" : money(data?.openingBalance)}</span>
          </div>

          {loading ? (
            <div style={hintBox}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={hintBox}>
              No ledger entries for this account{applied.from || applied.to ? " in the selected period" : ""}.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tbl}>
                <thead>
                  <tr>
                    <th style={th}>Date</th>
                    <th style={th}>Entry</th>
                    <th style={th}>Narration / Description</th>
                    <th style={{ ...th, textAlign: "right" }}>Debit</th>
                    <th style={{ ...th, textAlign: "right" }}>Credit</th>
                    <th style={{ ...th, textAlign: "right" }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={`${it.journalEntryId}-${i}`}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{it.date ? new Date(it.date).toLocaleDateString() : "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <strong>JE-{it.entryNo}</strong>
                        {it.sourceDocType && <span style={srcBadge}>{it.sourceDocType}</span>}
                      </td>
                      <td style={td}>
                        {it.narration || it.description || "—"}
                        {it.description && it.narration && it.description !== it.narration && (
                          <div style={{ fontSize: "0.75rem", color: colors.textSecondary }}>{it.description}</div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>{it.debit ? money(it.debit) : ""}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.credit ? money(it.credit) : ""}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(it.runningBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ ...balanceRow, marginTop: "0.5rem", marginBottom: 0 }}>
            <span style={balanceLabel}>Closing balance</span>
            <span style={balanceValue}>{loading ? "…" : money(data?.closingBalance)}</span>
          </div>

          <div style={pagerRow}>
            <button
              type="button"
              style={{ ...pagerBtn, opacity: page <= 1 || loading ? 0.4 : 1 }}
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span style={pagerInfo}>Page {page} of {totalPages} · {totalCount.toLocaleString()} entries</span>
            <button
              type="button"
              style={{ ...pagerBtn, opacity: page >= totalPages || loading ? 0.4 : 1 }}
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>

        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Code chip sits on the gradient header — semi-transparent white so it reads on dark.
const codeChip = { fontFamily: "monospace", fontSize: "0.72rem", fontWeight: 400, color: "#fff", background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.35)", padding: "1px 7px", borderRadius: 4 };
const filterRow = { display: "flex", alignItems: "flex-end", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" };
const filterLabel = { display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, flex: "1 1 130px", minWidth: 0 };
const dateInput = { padding: "0.35rem 0.5rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 6, fontSize: "0.85rem", minHeight: 40, width: "100%", boxSizing: "border-box", background: "#fff", color: colors.textPrimary };
const applyBtn = { padding: "0.35rem 0.9rem", minHeight: 40, borderRadius: 6, border: `1px solid ${colors.blue}`, background: "#fff", color: colors.blue, fontWeight: 700, cursor: "pointer" };
const balanceRow = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 8, marginBottom: "0.5rem" };
const balanceLabel = { fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary };
const balanceValue = { fontWeight: 800, color: colors.textPrimary };
const srcBadge = { marginLeft: 6, fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#e3f2fd", color: "#0d47a1", padding: "1px 5px", borderRadius: 10 };
const hintBox = { padding: "0.9rem", background: colors.inputBg, border: `1px dashed ${colors.inputBorder}`, borderRadius: 8, color: colors.textSecondary, fontSize: "0.85rem" };
const tbl = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 560 };
const th = { textAlign: "left", padding: "0.4rem 0.5rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textSecondary, fontWeight: 700, whiteSpace: "nowrap" };
const td = { padding: "0.4rem 0.5rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary, verticalAlign: "top" };
const pagerRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap" };
const pagerBtn = { padding: "0.35rem 1rem", minHeight: 40, borderRadius: 6, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textPrimary, fontWeight: 700, cursor: "pointer" };
const pagerInfo = { fontSize: "0.78rem", color: colors.textSecondary };
