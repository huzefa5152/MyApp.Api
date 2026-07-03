import { useState, useEffect, useCallback } from "react";
import { MdAssessment, MdBusiness, MdCheckCircle, MdWarning } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, dropdownStyles } from "../theme";
import { getTrialBalance, getAgedReceivables, getAgedPayables } from "../api/accountingApi";

// Money: "Rs." prefix lives in the column header context; cells show the bare
// figure with parens for credits/negatives (trial-balance amounts are signed
// debit-positive, so a net-credit value is negative → parens).
const fmtMoney = (n) => {
  const v = Number(n || 0);
  const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
};
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const TABS = [
  { key: "trial-balance", label: "Trial Balance" },
  { key: "receivables", label: "Aged Receivables" },
  { key: "payables", label: "Aged Payables" },
];

/**
 * Accounting → Reports. Trial Balance + AR/AP aging behind a tab strip.
 * Tables scroll horizontally inside their own wrapper (never the page) so
 * the 7–8 column layouts survive 375px phones. Gated by accounting.reports.view.
 */
export default function AccountingReportsPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("accounting.reports.view");

  const [tab, setTab] = useState("trial-balance");
  const companyId = selectedCompany?.id;

  if (!canView) {
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to view accounting reports.</div>;
  }

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <MdAssessment size={26} color={colors.blue} />
          <h2 style={st.h2}>Accounting Reports</h2>
        </div>
      </div>

      {companies.length > 0 && (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <MdBusiness size={20} color={colors.blue} />
          <select
            style={dropdownStyles.base}
            value={selectedCompany?.id || ""}
            onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select>
        </div>
      )}

      {/* Tab strip — scrolls sideways on narrow phones instead of wrapping awkwardly. */}
      <div style={st.tabStrip} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            style={{ ...st.tabBtn, ...(tab === t.key ? st.tabBtnActive : {}) }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!companyId ? (
        <div style={st.empty}>Select a company to view reports.</div>
      ) : tab === "trial-balance" ? (
        <TrialBalanceTab companyId={companyId} />
      ) : (
        <AgingTab key={tab} companyId={companyId} kind={tab} />
      )}
    </div>
  );
}

// ── Trial Balance ────────────────────────────────────────────────────────────
function TrialBalanceTab({ companyId }) {
  const [from, setFrom] = useState("");       // draft inputs
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" }); // what we last fetched with
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = {};
      if (applied.from) params.from = applied.from;
      if (applied.to) params.to = applied.to;
      const { data } = await getTrialBalance(companyId, params);
      setData(data);
    } catch {
      setData(null);
      setError("Could not load the trial balance.");
    } finally { setLoading(false); }
  }, [companyId, applied]);

  useEffect(() => { load(); }, [load]);

  const diff = Number(data?.totalDebit || 0) - Number(data?.totalCredit || 0);
  const balanced = Math.abs(diff) < 0.005;

  return (
    <div>
      {/* Filter bar — empty dates = all-time (server default). */}
      <div style={st.filterBar}>
        <label style={st.filterField}>
          <span style={st.filterLabel}>From</span>
          <input type="date" style={st.dateInput} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={st.filterField}>
          <span style={st.filterLabel}>To</span>
          <input type="date" style={st.dateInput} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button style={st.applyBtn} onClick={() => setApplied({ from, to })} disabled={loading}>
          Apply
        </button>
        {data && (
          balanced ? (
            <span style={st.balancedChip}><MdCheckCircle size={16} /> Debits = Credits ✓</span>
          ) : (
            <span style={st.imbalanceChip}><MdWarning size={16} /> Out of balance by Rs {fmtMoney(Math.abs(diff))}</span>
          )
        )}
      </div>

      {loading ? (
        <div style={st.empty}>Loading…</div>
      ) : error ? (
        <div style={st.empty}>{error}</div>
      ) : !data || (data.rows || []).length === 0 ? (
        <div style={st.empty}>No account activity {applied.from || applied.to ? "in this period" : "yet"}.</div>
      ) : (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Code</th>
                <th style={st.th}>Account</th>
                <th style={st.th}>Type</th>
                <th style={st.thNum}>Opening</th>
                <th style={st.thNum}>Debit</th>
                <th style={st.thNum}>Credit</th>
                <th style={st.thNum}>Closing</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.accountId} style={st.tr}>
                  <td style={st.tdCode}>{r.code || ""}</td>
                  <td style={st.tdName}><span style={st.clamp2}>{r.name}</span></td>
                  <td style={st.tdType}>{r.accountType}</td>
                  <td style={st.tdNum}>{fmtMoney(r.opening)}</td>
                  <td style={st.tdNum}>{fmtMoney(r.debit)}</td>
                  <td style={st.tdNum}>{fmtMoney(r.credit)}</td>
                  <td style={{ ...st.tdNum, fontWeight: 700 }}>{fmtMoney(r.closing)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={st.totalsRow}>
                <td style={st.tdCode} />
                <td style={st.tdName}>Total</td>
                <td style={st.tdType} />
                <td style={st.tdNum}>{fmtMoney(data.totalOpening)}</td>
                <td style={st.tdNum}>{fmtMoney(data.totalDebit)}</td>
                <td style={st.tdNum}>{fmtMoney(data.totalCredit)}</td>
                <td style={st.tdNum}>{fmtMoney(data.totalClosing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Aged Receivables / Payables ──────────────────────────────────────────────
function AgingTab({ companyId, kind }) {
  const isReceivables = kind === "receivables";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError("");
      try {
        const fn = isReceivables ? getAgedReceivables : getAgedPayables;
        const { data } = await fn(companyId);
        if (alive) setData(data);
      } catch {
        if (alive) { setData(null); setError(`Could not load aged ${kind}.`); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [companyId, kind, isReceivables]);

  // Amber tint on 61-90, red on 90+ — only when the bucket actually has money in it.
  const bucketCell = (v, tone) => {
    const has = Number(v || 0) > 0;
    const tint = !has ? {} : tone === "amber" ? st.cellAmber : st.cellRed;
    return <td style={{ ...st.tdNum, ...tint }}>{fmtMoney(v)}</td>;
  };

  if (loading) return <div style={st.empty}>Loading…</div>;
  if (error) return <div style={st.empty}>{error}</div>;
  if (!data) return null;

  const rows = data.rows || [];

  return (
    <div>
      <div style={st.asOf}>As of {fmtDate(data.asOf)}</div>

      {rows.length === 0 ? (
        <div style={st.empty}>No outstanding {isReceivables ? "invoices" : "bills"}. All settled.</div>
      ) : (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Party</th>
                <th style={st.thNum}>Open docs</th>
                <th style={st.thNum}>Current</th>
                <th style={st.thNum}>1-30</th>
                <th style={st.thNum}>31-60</th>
                <th style={st.thNum}>61-90</th>
                <th style={st.thNum}>90+</th>
                <th style={st.thNum}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partyId} style={st.tr}>
                  <td style={st.tdName}><span style={st.clamp2}>{r.name}</span></td>
                  <td style={st.tdNum}>{r.openDocuments}</td>
                  <td style={st.tdNum}>{fmtMoney(r.current)}</td>
                  <td style={st.tdNum}>{fmtMoney(r.days1To30)}</td>
                  <td style={st.tdNum}>{fmtMoney(r.days31To60)}</td>
                  {bucketCell(r.days61To90, "amber")}
                  {bucketCell(r.over90, "red")}
                  <td style={{ ...st.tdNum, fontWeight: 700 }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={st.totalsRow}>
                <td style={st.tdName}>Total</td>
                <td style={st.tdNum}>{rows.reduce((s, r) => s + Number(r.openDocuments || 0), 0)}</td>
                <td style={st.tdNum}>{fmtMoney(data.current)}</td>
                <td style={st.tdNum}>{fmtMoney(data.days1To30)}</td>
                <td style={st.tdNum}>{fmtMoney(data.days31To60)}</td>
                {bucketCell(data.days61To90, "amber")}
                {bucketCell(data.over90, "red")}
                <td style={st.tdNum}>{fmtMoney(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },

  // Tabs — 44px min height, sideways scroll on narrow phones.
  tabStrip: { display: "flex", gap: 4, borderBottom: `2px solid ${colors.cardBorder}`, marginBottom: "1rem", overflowX: "auto" },
  tabBtn: { padding: "0.6rem 1rem", minHeight: 44, border: "none", borderBottom: "3px solid transparent", background: "none", color: colors.textSecondary, fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", whiteSpace: "nowrap", marginBottom: -2 },
  tabBtnActive: { color: colors.blue, borderBottomColor: colors.blue, fontWeight: 800 },

  // Trial-balance filter bar.
  filterBar: { display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  filterField: { display: "flex", flexDirection: "column", gap: 3, flex: "1 1 140px", maxWidth: 200 },
  filterLabel: { fontSize: "0.72rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em" },
  dateInput: { ...dropdownStyles.base, minWidth: 0, width: "100%", minHeight: 44, cursor: "auto" },
  applyBtn: { padding: "0.55rem 1.2rem", minHeight: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer" },
  balancedChip: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 22, background: "#e8f5e9", color: colors.success, border: "1px solid #c8e6c9", fontSize: "0.82rem", fontWeight: 700 },
  imbalanceChip: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 22, background: colors.dangerLight, color: colors.danger, border: "1px solid #f5c6cb", fontSize: "0.82rem", fontWeight: 700 },

  asOf: { fontSize: "0.85rem", fontWeight: 700, color: colors.textSecondary, marginBottom: "0.75rem" },

  // Tables scroll inside this wrapper — the page itself never scrolls sideways.
  tableWrap: { overflowX: "auto", background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 640, fontSize: "0.84rem" },
  th: { textAlign: "left", padding: "0.65rem 0.75rem", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.blue, borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  thNum: { textAlign: "right", padding: "0.65rem 0.75rem", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.blue, borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  tr: { borderBottom: `1px solid ${colors.cardBorder}` },
  tdCode: { padding: "0.55rem 0.75rem", fontFamily: "monospace", fontSize: "0.76rem", color: colors.textSecondary, whiteSpace: "nowrap" },
  tdName: { padding: "0.55rem 0.75rem", color: colors.textPrimary, fontWeight: 600, minWidth: 160, maxWidth: 280 },
  tdType: { padding: "0.55rem 0.75rem", color: colors.textSecondary, whiteSpace: "nowrap" },
  tdNum: { padding: "0.55rem 0.75rem", textAlign: "right", color: colors.textPrimary, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  totalsRow: { fontWeight: 800, borderTop: `2px solid ${colors.cardBorder}`, background: colors.inputBg },

  // Long party/account names wrap to two lines max — never nowrap-ellipsis
  // (similar-prefix names must stay distinguishable).
  clamp2: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.35 },

  cellAmber: { background: "#fff8e1", color: "#b26a00", fontWeight: 700 },
  cellRed: { background: colors.dangerLight, color: colors.danger, fontWeight: 700 },
};
