import { useState, useEffect, useCallback, useMemo } from "react";
import {
  MdAssessment, MdBusiness, MdDownload, MdWarning, MdCheckCircle, MdRefresh,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, formStyles, dropdownStyles } from "../theme";
import { todayYmd } from "../utils/dateInput";
import useIsNarrow from "../hooks/useIsNarrow";
import { downloadCsv } from "../utils/csvExport";
import {
  getBalanceSheet, getProfitAndLoss, getAgedReceivables, getAgedPayables,
  getCashBook, getExpenseReport, getTaxControl,
} from "../api/accountingReportApi";

const money = (n) => {
  const raw = Number(n) || 0;
  const v = raw === 0 ? 0 : raw;
  return v < 0
    ? `(${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
    : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const isoYearStart = () => `${new Date().getFullYear()}-01-01`;

const TABS = [
  { key: "balance-sheet", label: "Balance Sheet", period: "asOf" },
  { key: "profit-and-loss", label: "Profit & Loss", period: "range" },
  { key: "aged-receivables", label: "Aged Receivables", period: "asOf" },
  { key: "aged-payables", label: "Aged Payables", period: "asOf" },
  { key: "cash-book", label: "Cash Book", period: "range" },
  { key: "expenses", label: "Expenses", period: "range" },
  { key: "tax-control", label: "Tax Control", period: "range" },
];

/**
 * Accounting → Reports. One page, one period control, a tab per report.
 *
 * Every figure comes from the ledger, so the reports agree with each other and
 * with the Chart of Accounts by construction. The Tax Control tab is the
 * exception that proves it: it shows the ledger figure BESIDE the same figure
 * re-derived from the documents, so a disagreement is visible rather than
 * discovered after a return is filed.
 */
export default function AccountingReportsPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const isNarrow = useIsNarrow(860);
  const canView = has("accounting.reports.view");

  const [tab, setTab] = useState("balance-sheet");
  const [from, setFrom] = useState(isoYearStart());
  const [to, setTo] = useState(todayYmd());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const companyId = selectedCompany?.id;
  const current = TABS.find((t) => t.key === tab);

  const load = useCallback(async () => {
    if (!companyId) { setData(null); return; }
    setLoading(true); setError("");
    try {
      const fetchers = {
        "balance-sheet": () => getBalanceSheet(companyId, to),
        "profit-and-loss": () => getProfitAndLoss(companyId, from, to),
        "aged-receivables": () => getAgedReceivables(companyId, to),
        "aged-payables": () => getAgedPayables(companyId, to),
        "cash-book": () => getCashBook(companyId, from, to),
        "expenses": () => getExpenseReport(companyId, from, to),
        "tax-control": () => getTaxControl(companyId, from, to),
      };
      const { data: d } = await fetchers[tab]();
      setData(d);
    } catch (err) {
      setData(null);
      setError(err.response?.data?.error || "Could not load this report.");
    } finally { setLoading(false); }
  }, [companyId, tab, from, to]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const name = `${current.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${to}`;
    if (tab === "balance-sheet") {
      const rows = [];
      [["Assets", data.assets], ["Liabilities", data.liabilities], ["Equity", data.equity]]
        .forEach(([side, sections]) => (sections || []).forEach((s) =>
          s.lines.forEach((l) => rows.push([side, s.name, l.code || "", l.name, l.amount]))));
      rows.push(["Equity", "", "", "Current-Year Earnings", data.currentEarnings]);
      downloadCsv(name, ["Side", "Group", "Code", "Account", "Amount"], rows);
    } else if (tab === "profit-and-loss") {
      const rows = [];
      [["Income", data.income], ["Expenses", data.expenses]]
        .forEach(([side, sections]) => (sections || []).forEach((s) =>
          s.lines.forEach((l) => rows.push([side, s.name, l.name, l.amount]))));
      downloadCsv(name, ["Side", "Group", "Account", "Amount"], rows);
    } else if (tab === "aged-receivables" || tab === "aged-payables") {
      downloadCsv(name, ["Party", "Open documents", "Current", "1-30", "31-60", "61-90", "90+", "Total"],
        (data.rows || []).map((r) => [r.name, r.openDocuments, r.current, r.days1To30,
          r.days31To60, r.days61To90, r.over90, r.total]));
    } else if (tab === "cash-book") {
      downloadCsv(name, ["Account", "Code", "Opening", "Money in", "Money out", "Closing"],
        (data.accounts || []).map((a) => [a.name, a.code || "", a.opening, a.moneyIn, a.moneyOut, a.closing]));
    } else if (tab === "expenses") {
      downloadCsv(name, ["Account", "Group", "Amount", "Share %"],
        (data.rows || []).map((r) => [r.name, r.groupName, r.amount, r.percent]));
    } else if (tab === "tax-control") {
      downloadCsv(name, ["Tax", "Account", "Per ledger", "Per documents", "Difference"],
        (data.rows || []).map((r) => [r.role, r.accountName, r.perLedger, r.perDocuments, r.difference]));
    }
  };

  if (!canView) {
    return (
      <div style={{ padding: "2rem", color: colors.textSecondary }}>
        You don't have permission to view the accounting reports.
      </div>
    );
  }

  const Table = ({ head, rows, foot }) => (
    <div style={{ overflowX: "auto" }}>
      <table style={st.table}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={i} style={{ ...st.th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={r.__strong ? st.strongRow : undefined}>
              {r.cells.map((c, j) => (
                <td key={j} style={{ ...st.td, textAlign: j === 0 ? "left" : "right",
                  ...(r.__strong ? { fontWeight: 800 } : null),
                  ...(j === 0 ? { overflowWrap: "anywhere" } : { whiteSpace: "nowrap" }) }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {foot && (
            <tr style={st.footRow}>
              {foot.map((c, j) => (
                <td key={j} style={{ ...st.td, ...st.footCell, textAlign: j === 0 ? "left" : "right" }}>{c}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const statementRows = (sections) => {
    const rows = [];
    (sections || []).forEach((s) => {
      rows.push({ __strong: true, cells: [s.name, money(s.total)] });
      s.lines.forEach((l) => rows.push({ cells: [`   ${l.code ? `${l.code} · ` : ""}${l.name}`, money(l.amount)] }));
    });
    return rows;
  };

  const body = () => {
    if (!companyId) return <div style={st.empty}>Select a company to run a report.</div>;
    if (loading) return <div style={st.empty}>Loading…</div>;
    if (error) return <div style={{ ...formStyles.error, margin: 0 }}>{error}</div>;
    if (!data) return <div style={st.empty}>Nothing to show.</div>;

    if (tab === "balance-sheet") {
      return (
        <>
          {/* An unbalanced sheet is stated in words and with an icon, not by a
              colour alone — and it is stated at the top, because every figure
              below it is suspect until it is fixed. */}
          <div style={data.isBalanced ? st.okBanner : st.warnBanner}>
            {data.isBalanced
              ? <><MdCheckCircle size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
                  Balanced — assets equal liabilities plus equity.</>
              : <><MdWarning size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
                  Does not balance. Assets {money(data.totalAssets)} against liabilities plus
                  equity {money(data.totalLiabilities + data.totalEquity)}.</>}
          </div>
          <div style={st.twoCol}>
            <div style={st.panel}>
              <div style={st.panelHead}>Assets</div>
              <Table head={["Account", "Amount"]} rows={statementRows(data.assets)}
                foot={["Total assets", money(data.totalAssets)]} />
            </div>
            <div style={st.panel}>
              <div style={st.panelHead}>Liabilities &amp; Equity</div>
              <Table head={["Account", "Amount"]}
                rows={[
                  ...statementRows(data.liabilities),
                  ...statementRows(data.equity),
                  { cells: ["   Current-Year Earnings", money(data.currentEarnings)] },
                ]}
                foot={["Total liabilities & equity", money(data.totalLiabilities + data.totalEquity)]} />
            </div>
          </div>
        </>
      );
    }

    if (tab === "profit-and-loss") {
      return (
        <>
          <div style={st.twoCol}>
            <div style={st.panel}>
              <div style={st.panelHead}>Income</div>
              <Table head={["Account", "Amount"]} rows={statementRows(data.income)}
                foot={["Total income", money(data.totalIncome)]} />
            </div>
            <div style={st.panel}>
              <div style={st.panelHead}>Expenses</div>
              <Table head={["Account", "Amount"]} rows={statementRows(data.expenses)}
                foot={["Total expenses", money(data.totalExpenses)]} />
            </div>
          </div>
          <div style={st.netBox}>
            <span>{data.netProfit >= 0 ? "Net profit" : "Net loss"}</span>
            <strong style={{ color: data.netProfit >= 0 ? colors.success : colors.danger }}>
              Rs. {money(Math.abs(data.netProfit))}
            </strong>
          </div>
        </>
      );
    }

    if (tab === "aged-receivables" || tab === "aged-payables") {
      return (
        <div style={st.panel}>
          <div style={st.panelHead}>
            {data.kind} as at {fmtDate(data.asOf)}
          </div>
          <Table
            head={["Party", "Docs", "Current", "1–30", "31–60", "61–90", "90+", "Total"]}
            rows={(data.rows || []).map((r) => ({
              cells: [r.name, r.openDocuments, money(r.current), money(r.days1To30),
                money(r.days31To60), money(r.days61To90), money(r.over90), money(r.total)],
            }))}
            foot={["Total", "", money(data.current), money(data.days1To30), money(data.days31To60),
              money(data.days61To90), money(data.over90), money(data.total)]}
          />
        </div>
      );
    }

    if (tab === "cash-book") {
      return (
        <div style={st.panel}>
          <div style={st.panelHead}>Cash &amp; bank</div>
          <Table
            head={["Account", "Opening", "Money in", "Money out", "Closing"]}
            rows={(data.accounts || []).map((a) => ({
              cells: [a.name, money(a.opening), money(a.moneyIn), money(a.moneyOut), money(a.closing)],
            }))}
            foot={["Total", money(data.opening), money(data.moneyIn), money(data.moneyOut), money(data.closing)]}
          />
        </div>
      );
    }

    if (tab === "expenses") {
      return (
        <div style={st.panel}>
          <div style={st.panelHead}>Expenses</div>
          <Table
            head={["Account", "Group", "Amount", "Share"]}
            rows={(data.rows || []).map((r) => ({
              cells: [r.name, r.groupName, money(r.amount), `${Number(r.percent || 0).toFixed(1)}%`],
            }))}
            foot={["Total", "", money(data.total), "100.0%"]}
          />
        </div>
      );
    }

    if (tab === "tax-control") {
      return (
        <div style={st.panel}>
          <div style={data.allReconcile ? st.okBanner : st.warnBanner}>
            {data.allReconcile
              ? <><MdCheckCircle size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
                  Every tax account agrees with the documents behind it.</>
              : <><MdWarning size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
                  A tax account disagrees with the documents. Worth resolving before filing on
                  these figures — the two columns are computed separately on purpose.</>}
          </div>
          <Table
            head={["Tax", "Account", "Per ledger", "Per documents", "Difference"]}
            rows={(data.rows || []).map((r) => ({
              cells: [
                r.role.replace(/([a-z])([A-Z])/g, "$1 $2"),
                r.accountName,
                money(r.perLedger),
                money(r.perDocuments),
                r.reconciles ? "✓ agrees" : `✗ ${money(r.difference)}`,
              ],
            }))}
          />
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <MdAssessment size={26} color={colors.blue} />
          <h2 style={st.h2}>Accounting Reports</h2>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button style={st.secondaryBtn} onClick={load} disabled={!companyId}>
            <MdRefresh size={16} /> Refresh
          </button>
          <button style={st.primaryBtn} onClick={exportCsv} disabled={!data}>
            <MdDownload size={16} /> Export CSV
          </button>
        </div>
      </div>

      <div style={st.controls}>
        {companies.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={dropdownStyles.base}
              aria-label="Company"
              value={selectedCompany?.id || ""}
              onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </span>
        )}
        {current?.period === "range" && (
          <label style={st.dateLabel}>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={formStyles.input} />
          </label>
        )}
        <label style={st.dateLabel}>
          {current?.period === "asOf" ? "As at" : "To"}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={formStyles.input} />
        </label>
      </div>

      {/* The tab strip scrolls sideways on a phone rather than wrapping into a
          block that pushes the report off the screen. */}
      <div style={{ ...st.tabs, ...(isNarrow ? { overflowX: "auto", flexWrap: "nowrap" } : null) }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            style={{ ...st.tab, ...(t.key === tab ? st.tabActive : null) }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {body()}
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0 1rem", height: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  secondaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0 1rem", height: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  controls: { display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "0.6rem", marginBottom: "0.9rem" },
  dateLabel: { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", fontWeight: 600, color: colors.textSecondary, flex: "0 1 170px", minWidth: 0 },
  tabs: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1rem", paddingBottom: 2 },
  tab: { padding: "0 0.9rem", height: 44, borderRadius: 999, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "none", flexShrink: 0 },
  tabActive: { background: colors.blue, borderColor: colors.blue, color: "#fff" },
  twoCol: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: "1rem", alignItems: "start" },
  panel: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", minWidth: 0 },
  panelHead: { fontSize: "0.8rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.blue, borderBottom: `2px solid ${colors.cardBorder}`, paddingBottom: 6, marginBottom: 8 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 320 },
  th: { padding: "0.45rem 0.5rem", fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  td: { padding: "0.38rem 0.5rem", fontSize: "0.83rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary },
  strongRow: { background: colors.inputBg },
  footRow: { background: colors.inputBg },
  footCell: { fontWeight: 800, borderTop: `2px solid ${colors.cardBorder}`, borderBottom: "none" },
  netBox: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: "1rem", padding: "0.8rem 1rem", background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, fontSize: "1rem", fontWeight: 700, color: colors.textPrimary },
  okBanner: { padding: "0.55rem 0.8rem", borderRadius: 8, marginBottom: "0.8rem", background: "#e8f5e9", border: "1px solid #c8e6c9", color: "#1b5e20", fontSize: "0.82rem", fontWeight: 600 },
  warnBanner: { padding: "0.55rem 0.8rem", borderRadius: 8, marginBottom: "0.8rem", background: "#ffebee", border: "1px solid #ffcdd2", color: "#b71c1c", fontSize: "0.82rem", fontWeight: 600 },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
