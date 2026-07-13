import { useState, useEffect, useCallback } from "react";
import { MdClose, MdLock, MdFactCheck } from "react-icons/md";
import { colors, formStyles, modalSizes } from "../theme";
import { notify } from "../utils/notify";
import {
  getReconcileTransactions,
  setPaymentCleared,
  setTransferCleared,
  getBankReconSummary,
  lockReconciliation,
  getReconciliationHistory,
} from "../api/accountingApi";

// "PKR 1,234.00" — negatives keep their sign (styled red at the call site).
const pkr = (x) =>
  "PKR " + Number(x || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// Cleared vs. statement are "settled" when they agree to within half a paisa.
const ZERO = 0.005;

/**
 * Bank reconciliation — tick each transaction that has cleared the statement,
 * watch the difference between the running cleared balance and the statement's
 * ending balance close to zero, then lock the period. Locking freezes the
 * cleared flags for everything dated on/before the statement date (the server
 * enforces it — toggling a locked line 400s). Gated upstream by
 * accounting.reconciliation.* on the page.
 */
export default function ReconcileModal({ companyId, account, onClose, onLocked }) {
  const today = new Date().toISOString().slice(0, 10);
  const [statementDate, setStatementDate] = useState(today);
  const [statementBalance, setStatementBalance] = useState("");

  const [txns, setTxns] = useState([]);
  const [clearedBalance, setClearedBalance] = useState(0);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);   // doc currently toggling
  const [locking, setLocking] = useState(false);

  // Re-pull transactions, the live cleared balance and the lock history.
  const load = useCallback(async () => {
    if (!account?.id || !companyId) return;
    setLoading(true);
    try {
      const [txRes, sumRes, histRes] = await Promise.all([
        getReconcileTransactions(account.id),
        getBankReconSummary(companyId).catch(() => null),
        getReconciliationHistory(account.id).catch(() => null),
      ]);
      setTxns(txRes.data || []);
      const mine = (sumRes?.data || []).find((r) => r.accountId === account.id);
      setClearedBalance(Number(mine?.clearedBalance) || 0);
      setHistory(histRes?.data || []);
    } catch {
      setTxns([]);
    } finally {
      setLoading(false);
    }
  }, [account?.id, companyId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (txn) => {
    if (busyId) return;
    const next = !txn.cleared;
    setBusyId(`${txn.docType}-${txn.docId}`);
    try {
      if (txn.docType === "Transfer") await setTransferCleared(txn.docId, next);
      else await setPaymentCleared(txn.docId, next);
      await load();   // re-fetch txns + cleared balance (and history) after the change
    } catch (e) {
      notify(e?.response?.data?.error || "Locked — can't change.", "warning");
    } finally {
      setBusyId(null);
    }
  };

  const statementNum = parseFloat(statementBalance) || 0;
  const diff = clearedBalance - statementNum;
  const settled = Math.abs(diff) < ZERO;
  const canLock = !!statementDate && settled && !locking;
  const lockTitle = !statementDate
    ? "Set a statement date first"
    : !settled
      ? "Cleared balance must equal the statement balance (difference 0) before you can lock"
      : "Lock this reconciliation";

  const doLock = async () => {
    if (!canLock) return;
    setLocking(true);
    try {
      await lockReconciliation(companyId, {
        bankAccountId: account.id,
        statementDate,
        statementBalance: statementNum,
      });
      notify("Reconciliation locked.", "success");
      await load();          // refresh history (and cleared flags)
      onLocked?.();
    } catch (e) {
      notify(e?.response?.data?.error || "Could not lock.", "error");
    } finally {
      setLocking(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: modalSizes.lg }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h3 style={{ ...formStyles.title, display: "flex", alignItems: "center", gap: 8 }}>
            <MdFactCheck size={20} /> Reconcile — {account.name}
          </h3>
          <button style={formStyles.closeButton} onClick={onClose} title="Close"><MdClose size={18} /></button>
        </div>

        <div style={formStyles.body}>
          {/* (1) Statement inputs */}
          <div style={st.inputRow}>
            <div style={st.field}>
              <label style={formStyles.label}>Statement date</label>
              <input
                type="date"
                style={formStyles.input}
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
              />
            </div>
            <div style={st.field}>
              <label style={formStyles.label}>Statement ending balance</label>
              <input
                type="number"
                step="0.01"
                style={formStyles.input}
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* (2) Summary strip */}
          <div style={st.summaryStrip}>
            <div style={st.summaryCell}>
              <span style={st.summaryLabel}>Cleared balance</span>
              <span style={{ ...st.summaryValue, color: clearedBalance < 0 ? colors.danger : colors.textPrimary }}>
                {pkr(clearedBalance)}
              </span>
            </div>
            <div style={st.summaryCell}>
              <span style={st.summaryLabel}>Statement balance</span>
              <span style={st.summaryValue}>{pkr(statementNum)}</span>
            </div>
            <div style={st.summaryCell}>
              <span style={st.summaryLabel}>Difference</span>
              <span style={{ ...st.summaryValue, color: settled ? "#1b7a3d" : colors.danger }}>
                {pkr(diff)}
              </span>
            </div>
          </div>

          {/* (3) Transactions */}
          {loading ? (
            <div style={st.empty}>Loading…</div>
          ) : txns.length === 0 ? (
            <div style={st.empty}>No transactions to reconcile for this account.</div>
          ) : (
            <div style={st.tableWrap}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={{ ...st.th, width: 60, textAlign: "center" }}>Cleared</th>
                    <th style={{ ...st.th, width: 110 }}>Date</th>
                    <th style={st.th}>Reference</th>
                    <th style={st.th}>Description</th>
                    <th style={{ ...st.th, textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((txn) => {
                    const key = `${txn.docType}-${txn.docId}`;
                    const neg = Number(txn.amount) < 0;
                    return (
                      <tr key={key} style={st.tr}>
                        <td style={{ ...st.td, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            style={st.checkbox}
                            checked={!!txn.cleared}
                            disabled={busyId === key}
                            onChange={() => toggle(txn)}
                            title={txn.cleared ? "Mark as not cleared" : "Mark as cleared"}
                          />
                        </td>
                        <td style={{ ...st.td, whiteSpace: "nowrap" }}>{fmtDate(txn.date)}</td>
                        <td style={st.td}>{txn.reference || "—"}</td>
                        <td style={st.td}>{txn.description || "—"}</td>
                        <td style={{ ...st.td, textAlign: "right", whiteSpace: "nowrap", color: neg ? colors.danger : colors.textPrimary }}>
                          {pkr(txn.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* (4) History */}
          {history.length > 0 && (
            <div style={{ marginTop: "1.25rem" }}>
              <div style={st.historyHeading}>Reconciliation history</div>
              <div style={st.historyList}>
                {history.map((h) => (
                  <div key={h.id} style={st.historyItem}>
                    <span style={st.historyDate}>{fmtDate(h.statementDate)}</span>
                    <span style={st.historyMeta}>Statement {pkr(h.statementBalance)}</span>
                    <span style={st.historyMeta}>Cleared {pkr(h.clearedBalance)}</span>
                    <span style={{ ...st.historyMeta, color: Math.abs(Number(h.difference) || 0) < ZERO ? "#1b7a3d" : colors.danger }}>
                      Diff {pkr(h.difference)}
                    </span>
                    <span style={st.historyLocked}>Locked {fmtDate(h.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit, ...st.lockBtn, opacity: canLock ? 1 : 0.55, cursor: canLock ? "pointer" : "not-allowed" }}
            disabled={!canLock}
            title={lockTitle}
            onClick={doLock}
          >
            <MdLock size={16} /> {locking ? "Locking…" : "Lock reconciliation"}
          </button>
        </div>
      </div>
    </div>
  );
}

const st = {
  inputRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.85rem", marginBottom: "1rem" },
  field: {},

  summaryStrip: { display: "flex", flexWrap: "wrap", gap: "0.75rem", padding: "0.85rem 1rem", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, marginBottom: "1rem" },
  summaryCell: { display: "flex", flexDirection: "column", gap: 3, flex: "1 1 140px", minWidth: 0 },
  summaryLabel: { fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary },
  summaryValue: { fontSize: "1.05rem", fontWeight: 800, color: colors.textPrimary, whiteSpace: "nowrap" },

  tableWrap: { overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 12 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 520 },
  th: { textAlign: "left", fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, padding: "10px 12px", borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap", background: colors.inputBg },
  tr: { borderBottom: `1px solid ${colors.cardBorder}` },
  td: { padding: "10px 12px", fontSize: "0.86rem", color: colors.textPrimary, verticalAlign: "middle" },
  checkbox: { width: 18, height: 18, cursor: "pointer", accentColor: colors.blue },

  historyHeading: { fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, marginBottom: 8 },
  historyList: { display: "flex", flexDirection: "column", gap: 6 },
  historyItem: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", padding: "8px 12px", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  historyDate: { fontSize: "0.82rem", fontWeight: 700, color: colors.textPrimary, whiteSpace: "nowrap" },
  historyMeta: { fontSize: "0.78rem", color: colors.textSecondary, whiteSpace: "nowrap" },
  historyLocked: { fontSize: "0.72rem", color: colors.textSecondary, marginLeft: "auto", whiteSpace: "nowrap" },

  lockBtn: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 40 },
  empty: { padding: "2rem 1rem", textAlign: "center", color: colors.textSecondary, background: colors.inputBg, border: `1px dashed ${colors.inputBorder}`, borderRadius: 12 },
};
