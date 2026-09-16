import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  MdSpaceDashboard, MdBusiness, MdTrendingUp, MdTrendingDown, MdAccountBalance,
  MdCallReceived, MdCallMade, MdReceiptLong, MdWarning, MdCheckCircle,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, formStyles, dropdownStyles } from "../theme";
import { todayYmd } from "../utils/dateInput";
import { getAccountingDashboard } from "../api/accountingReportApi";

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
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
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
      <div style={{ padding: "2rem", color: colors.textSecondary }}>
        You don't have permission to view the accounting overview.
      </div>
    );
  }

  const Card = ({ icon: Icon, label, value, tone, hint, to: href }) => {
    const inner = (
      <div style={{ ...st.card, ...(tone === "good" ? st.cardGood : tone === "bad" ? st.cardBad : null) }}>
        <div style={st.cardTop}>
          <Icon size={18} color={tone === "bad" ? colors.danger : tone === "good" ? colors.success : colors.blue} />
          <span style={st.cardLabel}>{label}</span>
        </div>
        <div style={st.cardValue}>Rs. {money(value)}</div>
        {hint && <div style={st.cardHint}>{hint}</div>}
      </div>
    );
    return href ? <Link to={href} style={{ textDecoration: "none" }}>{inner}</Link> : inner;
  };

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <MdSpaceDashboard size={26} color={colors.blue} />
          <h2 style={st.h2}>Accounting Overview</h2>
          {data && (data.ledgerBalances
            ? <span style={st.okChip}>
                <MdCheckCircle size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                ledger balanced · {data.journalEntries.toLocaleString()} entries
              </span>
            : <span style={st.warnChip}>
                <MdWarning size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                ledger does not balance
              </span>)}
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
        <label style={st.dateLabel}>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={formStyles.input} />
        </label>
        <label style={st.dateLabel}>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={formStyles.input} />
        </label>
      </div>

      {!companyId ? (
        <div style={st.empty}>Select a company to see its accounting overview.</div>
      ) : loading ? (
        <div style={st.empty}>Loading…</div>
      ) : !data ? (
        <div style={st.empty}>Nothing to show yet.</div>
      ) : (
        <>
          <div style={st.grid}>
            <Card icon={MdTrendingUp} label="Income" value={data.income} to="/accounting/reports" />
            <Card icon={MdTrendingDown} label="Expenses" value={data.expenses} to="/accounting/reports" />
            <Card
              icon={data.netProfit >= 0 ? MdTrendingUp : MdTrendingDown}
              label={data.netProfit >= 0 ? "Net profit" : "Net loss"}
              value={Math.abs(data.netProfit)}
              tone={data.netProfit >= 0 ? "good" : "bad"}
              to="/accounting/reports"
            />
            <Card icon={MdAccountBalance} label="Cash & bank" value={data.cashAndBank} to="/accounting/reports" />
            <Card icon={MdCallReceived} label="Receivables" value={data.receivables}
                  hint="Owed to you" to="/accounting/reports" />
            <Card icon={MdCallMade} label="Payables" value={data.payables}
                  hint="Owed by you" to="/accounting/reports" />
          </div>

          <h3 style={st.sectionTitle}>Tax positions</h3>
          <div style={st.grid}>
            <Card icon={MdReceiptLong} label="Output sales tax" value={data.outputTax} hint="Owed to FBR" />
            <Card icon={MdReceiptLong} label="Input sales tax" value={data.inputTax} hint="Reclaimable" />
            <Card icon={MdReceiptLong} label="Further tax" value={data.furtherTaxPayable} hint="Owed to FBR" />
            <Card icon={MdReceiptLong} label="WHT receivable" value={data.withholdingReceivable}
                  hint="Withheld by customers" />
            <Card icon={MdReceiptLong} label="WHT payable" value={data.withholdingPayable}
                  hint="Withheld by you, owed to FBR" />
          </div>
        </>
      )}
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary },
  okChip: { fontSize: "0.72rem", fontWeight: 700, color: "#1b5e20", background: "#e8f5e9", border: "1px solid #c8e6c9", padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" },
  warnChip: { fontSize: "0.72rem", fontWeight: 700, color: "#b71c1c", background: "#ffebee", border: "1px solid #ffcdd2", padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" },
  controls: { display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "0.6rem", marginBottom: "1rem" },
  dateLabel: { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", fontWeight: 600, color: colors.textSecondary, flex: "0 1 170px", minWidth: 0 },
  // auto-fit collapses to one column on a phone without a media query.
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.85rem" },
  card: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem 1rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", minWidth: 0 },
  cardGood: { borderColor: "#c8e6c9" },
  cardBad: { borderColor: "#ffcdd2" },
  cardTop: { display: "flex", alignItems: "center", gap: 7, marginBottom: 6 },
  cardLabel: { fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary },
  cardValue: { fontSize: "1.25rem", fontWeight: 800, color: colors.textPrimary, letterSpacing: "-0.01em", overflowWrap: "anywhere" },
  cardHint: { fontSize: "0.72rem", color: colors.textSecondary, marginTop: 3 },
  sectionTitle: { margin: "1.5rem 0 0.7rem", fontSize: "0.82rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
