import { useState, useEffect, useCallback, useMemo } from "react";
import {
  MdAssessment, MdBusiness, MdDownload, MdWarning, MdCheckCircle, MdRefresh,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors } from "../theme";
import { todayYmd } from "../utils/dateInput";
import {
  PageHeader, CompanyPicker, Button, Toolbar, Field, Card, TableWrap, Tabs, Alert, EmptyState, Loading,
} from "../ui/Kit";
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
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
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
      <EmptyState icon={MdAssessment}>
        You don't have permission to view the accounting reports.
      </EmptyState>
    );
  }

  // First column is the label; every other column is a figure, right-aligned
  // in tabular numerals (k-num) so the amounts line up digit for digit.
  const Table = ({ head, rows, foot }) => (
    <TableWrap>
      <table className="k-table k-table--compact" style={{ minWidth: 320 }}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={i} className={i === 0 ? undefined : "k-num"}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.cells.map((c, j) => (
                <td key={j} className={j === 0 ? undefined : "k-num"} style={{
                  ...(r.__strong ? st.strongCell : null),
                  ...(j === 0 ? { overflowWrap: "anywhere" } : { whiteSpace: "nowrap" }) }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr>
              {foot.map((c, j) => (
                <td key={j} className={j === 0 ? undefined : "k-num"} style={st.footCell}>{c}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </TableWrap>
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
    if (!companyId) return <EmptyState icon={MdBusiness}>Select a company to run a report.</EmptyState>;
    if (loading) return <Loading>Loading…</Loading>;
    if (error) return <Alert tone="error">{error}</Alert>;
    if (!data) return <EmptyState icon={MdAssessment}>Nothing to show.</EmptyState>;

    if (tab === "balance-sheet") {
      return (
        <>
          {/* An unbalanced sheet is stated in words and with an icon, not by a
              colour alone — and it is stated at the top, because every figure
              below it is suspect until it is fixed. */}
          {data.isBalanced
            ? <Alert tone="success" icon={MdCheckCircle}>
                Balanced — assets equal liabilities plus equity.
              </Alert>
            : <Alert tone="error" icon={MdWarning}>
                Does not balance. Assets {money(data.totalAssets)} against liabilities plus
                equity {money(data.totalLiabilities + data.totalEquity)}.
              </Alert>}
          <div style={st.twoCol}>
            <Card title="Assets" style={st.panel}>
              <Table head={["Account", "Amount"]} rows={statementRows(data.assets)}
                foot={["Total assets", money(data.totalAssets)]} />
            </Card>
            <Card title="Liabilities & Equity" style={st.panel}>
              <Table head={["Account", "Amount"]}
                rows={[
                  ...statementRows(data.liabilities),
                  ...statementRows(data.equity),
                  { cells: ["   Current-Year Earnings", money(data.currentEarnings)] },
                ]}
                foot={["Total liabilities & equity", money(data.totalLiabilities + data.totalEquity)]} />
            </Card>
          </div>
        </>
      );
    }

    if (tab === "profit-and-loss") {
      return (
        <>
          <div style={st.twoCol}>
            <Card title="Income" style={st.panel}>
              <Table head={["Account", "Amount"]} rows={statementRows(data.income)}
                foot={["Total income", money(data.totalIncome)]} />
            </Card>
            <Card title="Expenses" style={st.panel}>
              <Table head={["Account", "Amount"]} rows={statementRows(data.expenses)}
                foot={["Total expenses", money(data.totalExpenses)]} />
            </Card>
          </div>
          <div className="k-card" style={st.netBox}>
            <span>{data.netProfit >= 0 ? "Net profit" : "Net loss"}</span>
            <strong style={{ color: data.netProfit >= 0 ? colors.success : colors.danger, fontVariantNumeric: "tabular-nums" }}>
              Rs. {money(Math.abs(data.netProfit))}
            </strong>
          </div>
        </>
      );
    }

    if (tab === "aged-receivables" || tab === "aged-payables") {
      return (
        <Card title={<>{data.kind} as at {fmtDate(data.asOf)}</>} style={st.panel}>
          <Table
            head={["Party", "Docs", "Current", "1–30", "31–60", "61–90", "90+", "Total"]}
            rows={(data.rows || []).map((r) => ({
              cells: [r.name, r.openDocuments, money(r.current), money(r.days1To30),
                money(r.days31To60), money(r.days61To90), money(r.over90), money(r.total)],
            }))}
            foot={["Total", "", money(data.current), money(data.days1To30), money(data.days31To60),
              money(data.days61To90), money(data.over90), money(data.total)]}
          />
        </Card>
      );
    }

    if (tab === "cash-book") {
      return (
        <Card title="Cash & bank" style={st.panel}>
          <Table
            head={["Account", "Opening", "Money in", "Money out", "Closing"]}
            rows={(data.accounts || []).map((a) => ({
              cells: [a.name, money(a.opening), money(a.moneyIn), money(a.moneyOut), money(a.closing)],
            }))}
            foot={["Total", money(data.opening), money(data.moneyIn), money(data.moneyOut), money(data.closing)]}
          />
        </Card>
      );
    }

    if (tab === "expenses") {
      return (
        <Card title="Expenses" style={st.panel}>
          <Table
            head={["Account", "Group", "Amount", "Share"]}
            rows={(data.rows || []).map((r) => ({
              cells: [r.name, r.groupName, money(r.amount), `${Number(r.percent || 0).toFixed(1)}%`],
            }))}
            foot={["Total", "", money(data.total), "100.0%"]}
          />
        </Card>
      );
    }

    if (tab === "tax-control") {
      return (
        <Card style={st.panel}>
          {data.allReconcile
            ? <Alert tone="success" icon={MdCheckCircle}>
                Every tax account agrees with the documents behind it.
              </Alert>
            : <Alert tone="error" icon={MdWarning}>
                A tax account disagrees with the documents. Worth resolving before filing on
                these figures — the two columns are computed separately on purpose.
              </Alert>}
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
        </Card>
      );
    }
    return null;
  };

  return (
    <div>
      <PageHeader
        icon={MdAssessment}
        tone="blue"
        title="Accounting Reports"
        actions={(
          <>
            <Button icon={MdRefresh} onClick={load} disabled={!companyId}>Refresh</Button>
            <Button variant="primary" icon={MdDownload} onClick={exportCsv} disabled={!data}>Export CSV</Button>
          </>
        )}
      />

      {companies.length > 0 && <CompanyPicker />}

      <Toolbar style={{ alignItems: "flex-end" }}>
        {current?.period === "range" && (
          <div style={st.dateCell}>
            <Field label="From">
              <input type="date" className="k-input" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
        )}
        <div style={st.dateCell}>
          <Field label={current?.period === "asOf" ? "As at" : "To"}>
            <input type="date" className="k-input" aria-label={current?.period === "asOf" ? "As at" : "To"} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Toolbar>

      <Tabs
        label="Reports"
        idPrefix="acct-report"
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={tab}
        onChange={setTab}
      />

      <div role="tabpanel" id={`acct-report-panel-${tab}`} aria-labelledby={`acct-report-${tab}`}>
        {body()}
      </div>
    </div>
  );
}

const st = {
  dateCell: { flex: "0 1 170px", minWidth: 0 },
  twoCol: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: "var(--k-gap)", alignItems: "start" },
  // marginTop: 0 — panels sit in a grid, so the kit's ".k-card + .k-card" stacking gap must not apply.
  panel: { marginTop: 0 },
  strongCell: { fontWeight: 800, background: "var(--k-surface-2)" },
  footCell: { fontWeight: 800, borderTop: "2px solid var(--k-line)" },
  netBox: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: "var(--k-gap)", padding: "0.8rem 1rem", fontSize: "calc(var(--k-font) + 0.1rem)", fontWeight: 700, color: "var(--k-ink)" },
};
