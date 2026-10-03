import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  MdSpaceDashboard, MdBusiness, MdTrendingUp, MdTrendingDown, MdAccountBalance,
  MdCallReceived, MdCallMade, MdReceiptLong, MdWarning, MdCheckCircle,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { todayYmd } from "../utils/dateInput";
import { getAccountingDashboard } from "../api/accountingReportApi";
import {
  PageHeader, CompanyPicker, Toolbar, Field, StatGrid, StatCard, EmptyState, Loading,
} from "../ui/Kit";

const money = (n) => {
  const raw = Number(n) || 0;
  const v = raw === 0 ? 0 : raw;
  return v < 0
    ? `(${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })})`
    : v.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const isoYearStart = () => `${new Date().getFullYear()}-01-01`;

/**
 * Accounting → Overview. Every figure on this page is the TOTAL of a report
 * that can be opened in full, taken from that report rather than recomputed —
 * so the overview and the report behind it can never tell different stories.
 */
export default function AccountingDashboardPage() {
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("accounting.reports.view");

  const [from, setFrom] = useState(isoYearStart());
  const [to, setTo] = useState(todayYmd());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const companyId = selectedCompany?.id;

  const load = useCallback(async () => {
    if (!companyId) { setData(null); return; }
    setLoading(true);
    try {
      const { data: d } = await getAccountingDashboard(companyId, from, to);
      setData(d);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [companyId, from, to]);

  useEffect(() => { load(); }, [load]);

  if (!canView) {
    return (
      <EmptyState icon={MdSpaceDashboard}>
        You don't have permission to view the accounting overview.
      </EmptyState>
    );
  }

  // One KPI tile. tone "good" / "bad" colours the icon (and only the icon — the
  // label already says profit or loss in words). A tile with `to` opens its report.
  const Tile = ({ icon, label, value, tone, hint, to: href }) => {
    const inner = (
      <StatCard
        icon={icon}
        tone={tone === "good" ? "green" : tone === "bad" ? "red" : "blue"}
        label={label}
        value={`Rs. ${money(value)}`}
        hint={hint}
        style={tone === "good" ? { borderColor: "#c8e6c9" } : tone === "bad" ? { borderColor: "#ffcdd2" } : undefined}
      />
    );
    return href ? <Link to={href} style={{ textDecoration: "none", display: "block", minWidth: 0 }}>{inner}</Link> : inner;
  };

  return (
    <div>
      <PageHeader
        icon={MdSpaceDashboard}
        tone="blue"
        title="Accounting Overview"
        subtitle={data ? (data.ledgerBalances
          ? <span style={st.okChip}>
              <MdCheckCircle size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              ledger balanced · {data.journalEntries.toLocaleString()} entries
            </span>
          : <span style={st.warnChip}>
              <MdWarning size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              ledger does not balance
            </span>) : undefined}
      />

      {companies.length > 0 && <CompanyPicker />}

      <Toolbar style={{ alignItems: "flex-end" }}>
        <div style={st.dateCell}>
          <Field label="From">
            <input type="date" className="k-input" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div style={st.dateCell}>
          <Field label="To">
            <input type="date" className="k-input" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Toolbar>

      {!companyId ? (
        <EmptyState icon={MdBusiness}>Select a company to see its accounting overview.</EmptyState>
      ) : loading ? (
        <Loading>Loading…</Loading>
      ) : !data ? (
        <EmptyState icon={MdSpaceDashboard}>Nothing to show yet.</EmptyState>
      ) : (
        <>
          <StatGrid>
            <Tile icon={MdTrendingUp} label="Income" value={data.income} to="/accounting/reports" />
            <Tile icon={MdTrendingDown} label="Expenses" value={data.expenses} to="/accounting/reports" />
            <Tile
              icon={data.netProfit >= 0 ? MdTrendingUp : MdTrendingDown}
              label={data.netProfit >= 0 ? "Net profit" : "Net loss"}
              value={Math.abs(data.netProfit)}
              tone={data.netProfit >= 0 ? "good" : "bad"}
              to="/accounting/reports"
            />
            <Tile icon={MdAccountBalance} label="Cash & bank" value={data.cashAndBank} to="/accounting/reports" />
            <Tile icon={MdCallReceived} label="Receivables" value={data.receivables}
                  hint="Owed to you" to="/accounting/reports" />
            <Tile icon={MdCallMade} label="Payables" value={data.payables}
                  hint="Owed by you" to="/accounting/reports" />
          </StatGrid>

          <h3 style={st.sectionTitle}>Tax positions</h3>
          <StatGrid>
            <Tile icon={MdReceiptLong} label="Output sales tax" value={data.outputTax} hint="Owed to FBR" />
            <Tile icon={MdReceiptLong} label="Input sales tax" value={data.inputTax} hint="Reclaimable" />
            <Tile icon={MdReceiptLong} label="Further tax" value={data.furtherTaxPayable} hint="Owed to FBR" />
            <Tile icon={MdReceiptLong} label="WHT receivable" value={data.withholdingReceivable}
                  hint="Withheld by customers" />
            <Tile icon={MdReceiptLong} label="WHT payable" value={data.withholdingPayable}
                  hint="Withheld by you, owed to FBR" />
          </StatGrid>
        </>
      )}
    </div>
  );
}

const st = {
  okChip: { fontSize: "0.72rem", fontWeight: 700, color: "#1b5e20", background: "#e8f5e9", border: "1px solid #c8e6c9", padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" },
  warnChip: { fontSize: "0.72rem", fontWeight: 700, color: "#b71c1c", background: "#ffebee", border: "1px solid #ffcdd2", padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" },
  dateCell: { flex: "0 1 170px", minWidth: 0 },
  sectionTitle: { margin: "calc(var(--k-gap) + 0.25rem) 0 0.7rem", fontSize: "var(--k-font-sm)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--k-muted)" },
};
