import { useState, useEffect } from "react";
import { MdClose, MdChevronLeft, MdChevronRight } from "react-icons/md";
import { formStyles, modalSizes } from "../theme";
import { Button, Field, Facts, TableWrap, Loading, EmptyState } from "../ui/Kit";
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
    ? <Loading>Loading…</Loading>
    : items.length === 0
      ? <EmptyState boxed={false}>Nothing posted to this account{applied.from || applied.to ? " in this period" : " yet"}.</EmptyState>
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
          <TableWrap>
            <table className="k-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Source</th>
                  <th>Description</th>
                  <th className="k-num">Debit</th>
                  <th className="k-num">Credit</th>
                  <th className="k-num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={`${r.journalEntryId}-${r.entryNo}-${r.debit}-${r.credit}-${r.date}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                    <td><span style={st.ref}>JE-{String(r.entryNo).padStart(4, "0")}</span></td>
                    <td>{r.sourceDocType}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{r.description || r.narration || "—"}</td>
                    <td className="k-num">{r.debit ? money(r.debit) : ""}</td>
                    <td className="k-num">{r.credit ? money(r.credit) : ""}</td>
                    <td className="k-num" style={{ fontWeight: 700 }}>{money(r.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
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
            <div style={st.filterCell}>
              <Field label="From">
                <input type="date" className="k-input" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
            </div>
            <div style={st.filterCell}>
              <Field label="To">
                <input type="date" className="k-input" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" variant="primary">Apply</Button>
            {(applied.from || applied.to) && (
              <Button onClick={() => { setFrom(""); setTo(""); setPage(1); setApplied({ from: "", to: "" }); }}>
                Clear
              </Button>
            )}
          </form>

          <div style={st.summary}>
            <Facts facts={[
              ["Opening", <span style={st.summaryValue}>{money(data?.openingBalance)}</span>],
              ["Movements", <span style={st.summaryValue}>{totalCount.toLocaleString()}</span>],
              ["Closing", <span style={{ ...st.summaryValue, color: "var(--k-blue)" }}>{money(data?.closingBalance)}</span>],
            ]} />
          </div>

          {rows}
        </div>

        <div style={{ ...formStyles.footer, justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)" }}>
            {totalCount.toLocaleString()} movement{totalCount === 1 ? "" : "s"}
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </span>
          {totalPages > 1 && (
            <span style={{ display: "flex", gap: "0.4rem" }}>
              <Button
                icon={MdChevronLeft} disabled={page <= 1} aria-label="Previous page" title="Previous page"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              />
              <Button
                icon={MdChevronRight} disabled={page >= totalPages} aria-label="Next page" title="Next page"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              />
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
  filterCell: { flex: "1 1 150px", minWidth: 0 },
  summary: { padding: "0.7rem 0.9rem", background: "var(--k-surface-2)", border: "1px solid var(--k-line)", borderRadius: "var(--k-radius)", marginBottom: "0.9rem" },
  summaryValue: { fontSize: "calc(var(--k-font) + 0.1rem)", fontWeight: 800, color: "var(--k-ink)", fontVariantNumeric: "tabular-nums" },
  ref: { fontFamily: "monospace", fontSize: "0.74rem", color: "var(--k-blue)", background: "#eef2ff", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" },
  card: { border: "1px solid var(--k-line)", borderRadius: "var(--k-radius)", padding: "0.6rem 0.7rem", background: "var(--k-surface)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardDate: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  cardDesc: { fontSize: "var(--k-font)", color: "var(--k-ink)", margin: "0.35rem 0", overflowWrap: "anywhere" },
  cardAmounts: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: "var(--k-font-sm)", color: "var(--k-muted)", fontVariantNumeric: "tabular-nums" },
  cardSource: { fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--k-muted)", marginTop: 4 },
};
