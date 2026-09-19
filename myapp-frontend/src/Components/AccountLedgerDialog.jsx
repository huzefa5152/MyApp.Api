import { useState, useEffect } from "react";
import { MdClose, MdChevronLeft, MdChevronRight } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import useIsNarrow from "../hooks/useIsNarrow";
import { getAccountLedger } from "../api/accountingApi";

const PAGE_SIZE = 50;

const money = (n) => {
  const raw = Number(n) || 0;
  const v = raw === 0 ? 0 : raw;
  return v < 0
    ? `(${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
    : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * Ledger drill-down for one account: paged journal lines with a running
 * balance, an opening/closing summary, and an optional date window.
 *
 * Opened from the Chart of Accounts, which already gates on
 * accounting.coa.view, and the endpoint gates on it again.
 *
 * `account` = { id, name, code }.
 */
export default function AccountLedgerDialog({ account, onClose }) {
  const isNarrow = useIsNarrow(760);
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

  const rows = loading
    ? <div style={st.empty}>Loading…</div>
    : items.length === 0
      ? <div style={st.empty}>Nothing posted to this account{applied.from || applied.to ? " in this period" : " yet"}.</div>
      : isNarrow
        // A ledger is six columns wide; on a phone that becomes a card per
        // movement rather than a table the reader has to scroll sideways.
        ? (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {items.map((r) => (
              <div key={`${r.journalEntryId}-${r.entryNo}-${r.debit}-${r.credit}-${r.date}`} style={st.card}>
                <div style={st.cardTop}>
                  <span style={st.ref}>JE-{String(r.entryNo).padStart(4, "0")}</span>
                  <span style={st.cardDate}>{fmtDate(r.date)}</span>
                </div>
                {(r.description || r.narration) && (
                  <div style={st.cardDesc}>{r.description || r.narration}</div>
                )}
                <div style={st.cardAmounts}>
                  <span>{r.debit ? `Dr ${money(r.debit)}` : ""}</span>
                  <span>{r.credit ? `Cr ${money(r.credit)}` : ""}</span>
                  <strong>{money(r.runningBalance)}</strong>
                </div>
                <div style={st.cardSource}>{r.sourceDocType}</div>
              </div>
            ))}
          </div>
        )
        : (
          <div style={{ overflowX: "auto" }}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Entry</th>
                  <th style={st.th}>Source</th>
                  <th style={st.th}>Description</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Debit</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Credit</th>
                  <th style={{ ...st.th, textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={`${r.journalEntryId}-${r.entryNo}-${r.debit}-${r.credit}-${r.date}`}>
                    <td style={st.td}>{fmtDate(r.date)}</td>
                    <td style={st.td}><span style={st.ref}>JE-{String(r.entryNo).padStart(4, "0")}</span></td>
                    <td style={st.td}>{r.sourceDocType}</td>
                    <td style={{ ...st.td, overflowWrap: "anywhere" }}>{r.description || r.narration || "—"}</td>
                    <td style={{ ...st.td, textAlign: "right" }}>{r.debit ? money(r.debit) : ""}</td>
                    <td style={{ ...st.td, textAlign: "right" }}>{r.credit ? money(r.credit) : ""}</td>
                    <td style={{ ...st.td, textAlign: "right", fontWeight: 700 }}>{money(r.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={{ ...formStyles.title, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
            <span style={{ overflowWrap: "anywhere" }}>Ledger — {account.name}</span>
            {account.code && <span style={st.codeChip}>{account.code}</span>}
          </h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          <form onSubmit={applyFilter} style={st.filterRow}>
            <label style={st.filterLabel}>
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={formStyles.input} />
            </label>
            <label style={st.filterLabel}>
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={formStyles.input} />
            </label>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, minHeight: 44 }}>Apply</button>
            {(applied.from || applied.to) && (
              <button
                type="button"
                style={{ ...formStyles.button, ...formStyles.cancel, minHeight: 44 }}
                onClick={() => { setFrom(""); setTo(""); setPage(1); setApplied({ from: "", to: "" }); }}
              >
                Clear
              </button>
            )}
          </form>

          <div style={st.summary}>
            <div>
              <span style={st.summaryLabel}>Opening</span>
              <span style={st.summaryValue}>{money(data?.openingBalance)}</span>
            </div>
            <div>
              <span style={st.summaryLabel}>Movements</span>
              <span style={st.summaryValue}>{totalCount.toLocaleString()}</span>
            </div>
            <div>
              <span style={st.summaryLabel}>Closing</span>
              <span style={{ ...st.summaryValue, color: colors.blue }}>{money(data?.closingBalance)}</span>
            </div>
          </div>

          {rows}
        </div>

        <div style={{ ...formStyles.footer, justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: colors.textSecondary }}>
            {totalCount.toLocaleString()} movement{totalCount === 1 ? "" : "s"}
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </span>
          {totalPages > 1 && (
            <span style={{ display: "flex", gap: "0.4rem" }}>
              <button
                type="button" style={st.pageBtn} disabled={page <= 1} aria-label="Previous page"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <MdChevronLeft size={18} />
              </button>
              <button
                type="button" style={st.pageBtn} disabled={page >= totalPages} aria-label="Next page"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <MdChevronRight size={18} />
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const st = {
  codeChip: { fontFamily: "monospace", fontSize: "0.72rem", background: "rgba(255,255,255,0.22)", padding: "1px 6px", borderRadius: 4 },
  filterRow: { display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "0.6rem", marginBottom: "0.9rem" },
  filterLabel: { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", fontWeight: 600, color: colors.textSecondary, flex: "1 1 150px", minWidth: 0 },
  summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))", gap: "0.6rem", padding: "0.7rem 0.9rem", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 10, marginBottom: "0.9rem" },
  summaryLabel: { display: "block", fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary },
  summaryValue: { fontSize: "1rem", fontWeight: 800, color: colors.textPrimary },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 720 },
  th: { padding: "0.5rem", textAlign: "left", fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  td: { padding: "0.45rem 0.5rem", fontSize: "0.82rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "top" },
  ref: { fontFamily: "monospace", fontSize: "0.74rem", color: colors.blue, background: "#eef2ff", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" },
  card: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.6rem 0.7rem", background: colors.cardBg },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardDate: { fontSize: "0.78rem", color: colors.textSecondary },
  cardDesc: { fontSize: "0.84rem", color: colors.textPrimary, margin: "0.35rem 0", overflowWrap: "anywhere" },
  cardAmounts: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.82rem", color: colors.textSecondary },
  cardSource: { fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, marginTop: 4 },
  pageBtn: { display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, cursor: "pointer", boxShadow: "none" },
  empty: { padding: "1.5rem", textAlign: "center", color: colors.textSecondary, fontSize: "0.88rem" },
};
