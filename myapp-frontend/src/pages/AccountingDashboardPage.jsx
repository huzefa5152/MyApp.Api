// src/pages/AccountingDashboardPage.jsx
//
// Accounting dashboard (spec 2026-10-18 §6): cash & liquidity, working capital,
// the stock & tax position, the Payable to FBR panel, the import book (hidden when the ledger is off), where
// the capital sits, profitability, three charts, then cheques and recent money.
//
// Data:
//   • GET /accounting/summary/company/{id}?from&to  → AccountingSummaryDto
//     (accounting.dashboard.view, same as this page; a division-restricted user
//     gets a 403 whose message is shown in place of the figures)
//   • GET /dashboard/tax-position — only with dashboard.kpi.sales.view
//   • GET /accounting/gl/company/{id}/status — only with accounting.coa.view
//   • POST /accounting/gl/company/{id}/enable|rebuild (accounting.gl.manage)
//
// Ledger off: the GL figures (cash & bank, stock & tax position, import book,
// capital, profitability, income vs expense) say so instead of showing zeros;
// the subledger ones (receipts, payments, receivables, cheques) still render.
// No receivable age buckets anywhere: receipts are taken on account (CLAUDE.md 5b-8).
//
// Drills: only a tile whose breakdown totals exactly its own figure opens one
// (accountingData.accountingCardValue); every drill reads the page's own
// from/to. Other tiles open their report when the user may see reports.
// Drill state lives in the URL (useDrillState) so Back from "Open bill" reopens it.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdAccountBalanceWallet, MdReceiptLong, MdPayments, MdSwapVert, MdTrendingUp, MdTrendingDown,
  MdAttachMoney, MdAccountBalance, MdCallReceived, MdCallMade, MdAutorenew, MdCheckCircle,
  MdErrorOutline, MdLock, MdClose, MdInventory2, MdInfo,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { todayPakistanYmd } from "../utils/dateInput";
import { getAccountingSummary, getGlStatus, enableGl, rebuildGl } from "../api/accountingApi";
import { getDashboardTaxPosition, getDashboardBreakdown } from "../api/dashboardApi";
import KpiCard from "../Components/dashboard/KpiCard";
import KpiGroup from "../Components/dashboard/KpiGroup";
import KpiDrilldown from "../Components/dashboard/KpiDrilldown";
import useDrillState from "../Components/dashboard/useDrillState";
import DashboardHeader from "../Components/dashboard/DashboardHeader";
import ChartCard from "../Components/dashboard/ChartCard";
import TaxPositionPanel from "../Components/dashboard/TaxPositionPanel";
import BarLineChart from "../Components/dashboard/charts/BarLineChart";
import HBarChart from "../Components/dashboard/charts/HBarChart";
import { chartPalette } from "../Components/dashboard/chartTheme";
import { hasAny } from "../Components/dashboard/overviewData";
import { presetRange, accountingCardValue, topBalances, cashSeries, profitSeries } from "../Components/dashboard/accountingData";
import usePersistentFilter from "../hooks/usePersistentFilter";
import "./DashboardPage.css";

const PERIOD_IDS = ["this-week", "last-week", "this-month", "last-month", "this-year", "last-year", "all-time", "custom"];
const LEDGER_OFF = "Ledger not enabled for this company";

/** "Rs. 1,234" — negatives in parens: "(Rs. 1,234)". */
const fmtMoney = (v) => {
  if (v == null || isNaN(v)) return "—";
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString("en-PK", { maximumFractionDigits: 0 });
  return n < 0 ? `(Rs. ${abs})` : `Rs. ${abs}`;
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const plural = (n, word) => `${Number(n || 0).toLocaleString("en-PK")} ${word}${n === 1 ? "" : "s"}`;
// Line-clamp for user-supplied names — NEVER nowrap+ellipsis (see CLAUDE.md).
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

export default function AccountingDashboardPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has, loading: permsLoading } = usePermissions();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const canView = has("accounting.dashboard.view");
  const canManageGl = has("accounting.gl.manage");
  // /gl/status is gated by accounting.coa.view — don't call it without that key.
  const canViewGlStatus = has("accounting.coa.view");
  const canOpenReports = has("accounting.reports.view");
  // Drills read /api/dashboard/breakdown (dashboard.view); receivables also need the sales key.
  const canDrill = has("dashboard.view");
  // The tax panel and the customer balances come from /api/dashboard too, so they need both keys.
  const canViewTax = canDrill && has("dashboard.kpi.sales.view");
  const can = (kind) => canDrill && (kind !== "receivables" || canViewTax);

  const companyId = selectedCompany?.id;
  const [sel, setSel] = usePersistentFilter("accountingDashboard", "range", { period: "this-month", from: "", to: "" });
  const period = PERIOD_IDS.includes(sel.period) ? sel.period : "this-month";
  const range = presetRange(period, todayPakistanYmd(), sel);
  const rangeKey = range ? `${range.from}|${range.to}` : "";

  const [summary, setSummary] = useState(null);
  const [glStatus, setGlStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [summaryDenied, setSummaryDenied] = useState(false);
  const [asOf, setAsOf] = useState("");
  const [reload, setReload] = useState(0);
  const [enabling, setEnabling] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  // GlEnableResultDto from the last enable/rebuild — shown as a banner.
  const [glResult, setGlResult] = useState(null);
  const [tax, setTax] = useState({ data: null, loading: false, error: null });
  const [taxReload, setTaxReload] = useState(0);
  const [balances, setBalances] = useState({ rows: [], loading: false, error: null });
  const [balancesReload, setBalancesReload] = useState(0);

  const { drill, openDrill, closeDrill } = useDrillState();

  useEffect(() => {
    if (!companyId || !canView || !rangeKey) return;
    const [from, to] = rangeKey.split("|");
    let cancelled = false;
    // A new company or period must never show the old one's figures under its header.
    setLoading(true); setError(null); setSummary(null); setSummaryDenied(false);
    Promise.all([
      getAccountingSummary(companyId, { from, to }),
      // Status is optional decoration — its failure must not blank the page.
      canViewGlStatus ? getGlStatus(companyId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([sumRes, statRes]) => {
        if (cancelled) return;
        setSummary(sumRes.data);
        setGlStatus(statRes?.data ?? null);
        setAsOf(new Date().toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }));
      })
      .catch((err) => {
        if (cancelled) return;
        const body = err.response?.data;
        setSummaryDenied(err.response?.status === 403);
        setError(body?.message || body?.error || "Failed to load the accounting summary.");
        setGlStatus(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, canView, canViewGlStatus, rangeKey, reload]);

  useEffect(() => {
    if (!canViewTax || !companyId || !rangeKey) { setTax({ data: null, loading: false, error: null }); return; }
    const [from, to] = rangeKey.split("|");
    let cancelled = false;
    setTax({ data: null, loading: true, error: null });
    getDashboardTaxPosition(companyId, { period: "custom", from, to })
      .then((d) => { if (!cancelled) setTax({ data: d, loading: false, error: null }); })
      .catch((e) => {
        if (cancelled) return;
        const body = e?.response?.data;
        const denied = e?.response?.status === 403;
        setTax({ data: null, loading: false, denied, error: denied
          ? (body?.message || body?.error || "You do not have access to the tax position.")
          : "Could not load the tax position." });
      });
    return () => { cancelled = true; };
  }, [canViewTax, companyId, rangeKey, taxReload]);

  // Customer balances for the top-10 chart: the receivables drill's level 1, so a
  // bar opens rows that add up to it. A position, so it does not follow the period.
  useEffect(() => {
    if (!companyId || !canView || !summary || !canViewTax) { setBalances({ rows: [], loading: false, error: null }); return; }
    let cancelled = false;
    setBalances({ rows: [], loading: true, error: null });
    getDashboardBreakdown(companyId, "receivables", { period: "all-time" })
      .then((d) => { if (!cancelled) setBalances({ rows: d?.rows || [], loading: false, error: null }); })
      .catch((e) => {
        if (cancelled) return;
        const body = e?.response?.data;
        const denied = e?.response?.status === 403;
        setBalances({ rows: [], loading: false, denied, error: denied
          ? (body?.message || body?.error || "You do not have access to customer balances.")
          : "Could not load customer balances." });
      });
    return () => { cancelled = true; };
  }, [companyId, canView, canViewTax, !!summary, balancesReload, reload]);

  // Stale enable/rebuild results belong to the previous company.
  useEffect(() => { setGlResult(null); }, [companyId]);

  // Every drill reads the page's own window.
  const drillTo = useCallback((kind, groupKey) => {
    if (!rangeKey) return;
    const [from, to] = rangeKey.split("|");
    openDrill(kind, { groupKey, period: "custom", from, to });
  }, [openDrill, rangeKey]);

  const runGl = async (kind) => {
    const set = kind === "rebuilt" ? setRebuilding : setEnabling;
    set(true);
    try {
      const { data } = await (kind === "rebuilt" ? rebuildGl : enableGl)(companyId);
      setGlResult({ ...data, kind });
      notify(kind === "rebuilt" ? "Ledger rebuilt." : "General Ledger enabled — ledger backfilled.", "success");
      setReload((n) => n + 1);
    } catch (err) {
      notify(err.response?.data?.error || (kind === "rebuilt" ? "Failed to rebuild the ledger." : "Failed to enable GL posting."), "error");
    } finally {
      set(false);
    }
  };
  const handleRebuild = async () => {
    const ok = await confirm({
      title: "Rebuild ledger?",
      message: "This wipes every system-posted journal entry and re-posts all documents from scratch (manual journal entries survive). It can take a minute on a large book.",
      variant: "danger",
      confirmText: "Rebuild",
    });
    if (ok) runGl("rebuilt");
  };

  if (permsLoading) return <Shell><Notice>Loading…</Notice></Shell>;
  if (!canView) return <Shell><Notice icon={MdLock}>You don't have permission to view the accounting dashboard.</Notice></Shell>;

  // Dashboard → report, carrying the dashboard's own period so the report opens
  // on the numbers the card just showed.
  const report = (reportId) => {
    if (!canOpenReports || !range) return null;
    const qs = new URLSearchParams({ period: "custom", from: range.from, to: range.to });
    return () => navigate(`/accounting/reports/${reportId}?${qs}`);
  };

  return (
    <Shell>
      <style>{`@keyframes acctdash-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Pinned while the figures scroll (.page-sticky-head). */}
      <div className="page-sticky-head">
      <DashboardHeader
        company={selectedCompany}
        companies={companies}
        onCompanyChange={(id) => { const c = companies.find((cc) => cc.id === id); if (c) setSelectedCompany(c); }}
        period={period} from={sel.from} to={sel.to}
        onChange={(r) => setSel({ period: r.period, from: r.from || "", to: r.to || "" })}
        asOf={summary ? asOf : ""}
      />
      </div>

      {!companyId && <Notice>Select a company to view its accounting summary.</Notice>}
      {companyId && !range && <Notice>Pick a From and a To date for the custom range.</Notice>}
      {error && <ChartCard title="Accounting summary" error={error} onRetry={summaryDenied ? null : () => setReload((n) => n + 1)} height={120} />}
      {loading && !summary && <LoadingShimmer />}

      {summary && (
        <Body
          can={can} s={summary} tax={tax} canViewTax={canViewTax} onTaxRetry={() => setTaxReload((n) => n + 1)}
          balances={balances} onBalancesRetry={() => setBalancesReload((n) => n + 1)}
          report={report} drillTo={drillTo} navigate={navigate}
          glResult={glResult} onDismissResult={() => setGlResult(null)}
          canManageGl={canManageGl} enabling={enabling} onEnable={() => runGl("enabled")}
        />
      )}

      {summary && glStatus && glStatus.enabled && (
        <GlHealthFooter status={glStatus} canManage={canManageGl} rebuilding={rebuilding} onRebuild={handleRebuild} />
      )}

      {summary && (
        <KpiDrilldown
          open={!!drill}
          onClose={closeDrill}
          kind={drill?.kind}
          initialGroupKey={drill?.groupKey || null}
          period={drill?.period || "custom"}
          from={drill?.from || range?.from}
          to={drill?.to || range?.to}
          companyId={companyId}
          cardValue={accountingCardValue(drill, { summary, tax: tax.data, range })}
        />
      )}
    </Shell>
  );
}

// ── The page body ───────────────────────────────────────────────────

function Body({ can, s, tax, canViewTax, onTaxRetry, balances, onBalancesRetry, report, drillTo, navigate, glResult, onDismissResult, canManageGl, enabling, onEnable }) {
  const p = chartPalette();
  const gl = !!s.glEnabled;
  const netCashFlow = Number(s.receiptsTotal || 0) - Number(s.paymentsTotal || 0);
  const netPosition = Number(s.receivables?.total || 0) - Number(s.payables?.total || 0);
  const receivables = Number(s.receivables?.total || 0);
  const dutyAndTax = Number(s.importInputTax || 0) + Number(s.importIncomeTax || 0);
  const hasStockTax = !!(s.inventoryOnHand || s.taxPayable || s.importClearing || s.recoverableTax || s.unrealisedMargin);
  const topCustomers = topBalances(balances.rows);
  const cash = cashSeries(s.monthly);
  const profit = profitSeries(s.monthly);
  const reportCard = (id) => { const go = report(id); return go ? { onDrillDown: go, clickHint: "Click to open the report." } : {}; };

  return (
    <>
      {glResult && <GlResultBanner result={glResult} onDismiss={onDismissResult} />}
      {!gl && <GlOffCallout canManage={canManageGl} enabling={enabling} onEnable={onEnable} />}

      <KpiGroup title="Cash & liquidity">
        {gl ? (
          <KpiCard
            label="Cash & bank" value={s.cashAndBankTotal} format={fmtMoney} accent={p.secondary}
            icon={<MdAccountBalanceWallet size={16} />}
            secondLine={`${plural((s.cashAccounts || []).length, "account")} · a balance, not a period`}
            howCalculated="Balance of every cash and bank account in the ledger, as of today. The accounts are listed below."
            {...reportCard("cash-bank-summary")}
          />
        ) : <LedgerOffCard label="Cash & bank" />}
        <KpiCard
          label="Receipts (period)" value={s.receiptsTotal} format={fmtMoney} accent={p.positive}
          icon={<MdReceiptLong size={16} />} secondLine={plural(s.receiptCount, "receipt")}
          howCalculated="Customer receipts dated in the period, cancelled ones left out."
          {...reportCard("receipts-register")}
        />
        <KpiCard
          label="Payments (period)" value={s.paymentsTotal} format={fmtMoney} accent={p.primary}
          icon={<MdPayments size={16} />} higherIsBetter={false} secondLine={plural(s.paymentCount, "payment")}
          howCalculated="Payments dated in the period, cancelled ones left out."
          {...reportCard("payments-register")}
        />
        <KpiCard
          label="Net cash flow" value={netCashFlow} format={fmtMoney} accent={netCashFlow >= 0 ? p.positive : p.negative}
          icon={<MdSwapVert size={16} />} secondLine="Receipts less payments"
          howCalculated="Receipts in the period less payments in the period."
          {...reportCard("cash-bank-summary")}
        />
      </KpiGroup>

      <KpiGroup title="Working capital">
        <KpiCard
          label="Receivables" value={receivables} format={fmtMoney} accent={p.secondary}
          icon={<MdCallReceived size={16} />} higherIsBetter={false}
          secondLine={receivables <= 0 ? "Nothing outstanding from customers" : "A balance as of today, not a period"}
          howCalculated="Customer balances from the aged receivables report, net of receipts on account."
          onDrillDown={receivables !== 0 && can("receivables") ? () => drillTo("receivables") : null}
        />
        <KpiCard
          label="Supplier payables" value={s.payables?.total} format={fmtMoney} accent={p.warn}
          icon={<MdCallMade size={16} />} higherIsBetter={false}
          secondLine={Number(s.payables?.total || 0) <= 0 ? "Nothing owed to suppliers" : "A balance as of today, not a period"}
          howCalculated="Supplier balances from the aged payables report. Tax and import clearing owed are in the stock & tax position below."
          {...reportCard("aged-payables")}
        />
        <KpiCard
          label="Net position" value={netPosition} format={fmtMoney} accent={netPosition >= 0 ? p.positive : p.negative}
          icon={<MdAccountBalance size={16} />} secondLine="Receivables less supplier payables"
          howCalculated="Receivables less supplier payables."
          {...reportCard("aged-receivables")}
        />
      </KpiGroup>

      {gl ? hasStockTax && (
        <KpiGroup title="Stock & tax position">
          {!!s.inventoryOnHand && (
            <KpiCard
              label="Inventory on hand" value={s.inventoryOnHand} format={fmtMoney} accent={p.warn}
              icon={<MdInventory2 size={16} />} secondLine="Declared value, relieved as stock sells"
              howCalculated="The ledger's Inventory account. The stock screen's walk can differ from it by paisa, so it has no item breakdown here."
            />
          )}
          {!!s.taxPayable && (
            <KpiCard
              label="Tax payable (ledger)" value={s.taxPayable} format={fmtMoney} accent={p.negative}
              icon={<MdAccountBalance size={16} />} higherIsBetter={false}
              secondLine="Output sales tax, further tax and withholding"
              howCalculated="The ledger's tax liability accounts as of today. The Payable to FBR panel below is the period's return."
            />
          )}
          {!!s.importClearing && (
            <KpiCard
              label="Import clearing" value={s.importClearing} format={fmtMoney} accent={p.primary}
              icon={<MdCallMade size={16} />} higherIsBetter={false} secondLine="Cleared but not yet settled"
              howCalculated="The ledger's Import Clearing account: what is owed on goods cleared but not yet paid for."
            />
          )}
          {!!s.recoverableTax && (
            <KpiCard
              label="Recoverable from FBR" value={s.recoverableTax} format={fmtMoney} accent={p.secondary}
              icon={<MdCallReceived size={16} />} secondLine="Input tax and advance income tax on imports"
              howCalculated="Input sales tax and advance income tax paid at import — credited back, not owed."
              onDrillDown={can("recoverable-tax") ? () => drillTo("recoverable-tax") : null}
            />
          )}
          {!!s.unrealisedMargin && (
            <KpiCard
              label="Unrealised margin" value={s.unrealisedMargin} format={fmtMoney} accent={p.positive}
              icon={<MdTrendingUp size={16} />} secondLine="Declared less landed cost on stock still held"
              howCalculated="Profit locked up in unsold stock: declared value less landed cost on what is still held."
              onDrillDown={can("unrealised-margin") ? () => drillTo("unrealised-margin") : null}
            />
          )}
        </KpiGroup>
      ) : <LedgerOffGroup title="Stock & tax position" />}

      {canViewTax && (
        <section style={{ marginBottom: "1.25rem" }}>
          <h3 style={st.groupTitle}>Payable to FBR</h3>
          <div style={st.chartGrid}>
            {tax.data
              ? <TaxPositionPanel data={tax.data} onDrill={can("tax-payable") ? (line) => drillTo("tax-payable", line) : null} />
              : <ChartCard title="Tax position" loading={tax.loading} error={tax.error} onRetry={tax.denied ? null : onTaxRetry} height={200} />}
          </div>
        </section>
      )}

      {gl && s.importGdCount > 0 && (
        <KpiGroup title="Import book">
          <KpiCard
            label="Goods declarations" value={s.importGdCount} format={(v) => Number(v || 0).toLocaleString("en-PK")} accent={p.primary}
            icon={<MdReceiptLong size={16} />} secondLine="GDs costed into this company"
            howCalculated="Every GD costed into this company. The landed cost tile opens them one by one."
          />
          <KpiCard
            label="Landed cost imported" value={s.importLandedCost} format={fmtMoney} accent={p.warn}
            icon={<MdInventory2 size={16} />} secondLine="Total cost of goods cleared"
            howCalculated="Sum of every GD's cost excluding tax."
            onDrillDown={can("import-book") ? () => drillTo("import-book") : null}
          />
          <KpiCard
            label="Duty & tax at import" value={dutyAndTax} format={fmtMoney} accent={p.negative}
            icon={<MdAccountBalance size={16} />} higherIsBetter={false}
            secondLine={s.importDutyBurdenPercent != null ? `${Number(s.importDutyBurdenPercent).toFixed(1)}% of landed cost` : "Input tax and advance income tax"}
            howCalculated="Input sales tax plus advance income tax paid at clearance."
            onDrillDown={can("duty-burden") ? () => drillTo("duty-burden") : null}
          />
          {!!s.importOutstanding && (
            <KpiCard
              label="Import clearing outstanding" value={s.importOutstanding} format={fmtMoney} accent={p.negative}
              icon={<MdCallMade size={16} />} higherIsBetter={false} secondLine="Credited to clearing, not yet settled"
              howCalculated="What the GDs credited to Import Clearing less what has been settled. A Backfill GD credits nothing by design."
            />
          )}
        </KpiGroup>
      )}

      {gl ? (s.capitalInStock || s.capitalOwedByCustomers) ? (
        <KpiGroup title="Where the capital sits">
          <KpiCard
            label="In stock" value={s.capitalInStock} format={fmtMoney} accent={p.warn}
            icon={<MdInventory2 size={16} />} secondLine="Goods not yet sold"
            howCalculated="The ledger's Inventory account, as of today."
          />
          <KpiCard
            label="Owed by customers" value={s.capitalOwedByCustomers} format={fmtMoney} accent={p.secondary}
            icon={<MdCallReceived size={16} />} secondLine="Invoiced, not collected"
            howCalculated="The receivables balance, from the aged receivables report."
            onDrillDown={s.capitalOwedByCustomers && can("receivables") ? () => drillTo("receivables") : null}
          />
          <KpiCard
            label="Collected" value={s.capitalCollected} format={fmtMoney} accent={p.positive}
            icon={<MdAccountBalanceWallet size={16} />} secondLine="Cash and bank"
            howCalculated="Cash and bank balances in the ledger, as of today."
          />
        </KpiGroup>
      ) : null : <LedgerOffGroup title="Where the capital sits" />}

      {gl ? (
        <KpiGroup title="Profitability (period)">
          <KpiCard
            label="Income" value={s.income} format={fmtMoney} accent={p.positive} icon={<MdTrendingUp size={16} />}
            howCalculated="Income accounts in the ledger, for journal entries dated in the period."
          />
          <KpiCard
            label="Expenses" value={s.expenses} format={fmtMoney} accent={p.negative} icon={<MdTrendingDown size={16} />}
            higherIsBetter={false} howCalculated="Expense accounts in the ledger, for journal entries dated in the period."
            {...reportCard("expenses")}
          />
          <KpiCard
            label="Net profit" value={s.netProfit} format={fmtMoney}
            accent={Number(s.netProfit || 0) >= 0 ? p.positive : p.negative} icon={<MdAttachMoney size={16} />}
            secondLine="Income less expenses" howCalculated="Income less expenses for the period, from the ledger."
          />
        </KpiGroup>
      ) : <LedgerOffGroup title="Profitability (period)" />}

      <div style={{ ...st.chartGrid, marginBottom: "1.25rem" }}>
        {canViewTax && <ChartCard
          title="Top 10 customer balances" subtitle="What each customer owes, as of today. Click a customer for their open bills."
          loading={balances.loading} error={balances.error} onRetry={balances.denied ? null : onBalancesRetry}
          empty={topCustomers.length === 0} emptyText="Nothing outstanding from customers."
          height={Math.max(240, topCustomers.length * 34)}
        >
          <HBarChart
            data={topCustomers} ariaLabel="Top 10 customer balances" valueLabel="Balance"
            onBarClick={can("receivables") ? (d) => d?.groupKey && drillTo("receivables", d.groupKey) : undefined}
          />
        </ChartCard>}
        <ChartCard
          title="Cash in vs cash out" subtitle="Receipts and payments by month, 12 months to the end of the period."
          empty={!hasAny(cash, ["cashIn", "cashOut"])} emptyText="No receipts or payments in these 12 months." height={280}
        >
          <BarLineChart
            data={cash} ariaLabel="Monthly receipts and payments"
            series={[
              { key: "cashIn", label: "Cash in", colorKey: "positive" },
              { key: "cashOut", label: "Cash out", colorKey: "negative" },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Income vs expense" subtitle="From the ledger, 12 months to the end of the period; the line is net profit."
          empty={!gl || !hasAny(profit, ["income", "expense"])}
          emptyText={gl ? "No income or expense in these 12 months." : LEDGER_OFF} height={280}
        >
          <BarLineChart
            data={profit} ariaLabel="Monthly income and expense, with net profit"
            series={[
              { key: "income", label: "Income", colorKey: "positive" },
              { key: "expense", label: "Expense", colorKey: "negative" },
              { key: "netProfit", label: "Net profit", colorKey: "primary", type: "line" },
            ]}
          />
        </ChartCard>
      </div>

      <h3 style={st.groupTitle}>Cheques &amp; recent activity</h3>
      <div style={st.listGrid}>
        <PdcCard title="Cheques in hand" icon={MdCallReceived} data={s.pdcIn} onOpen={report("cheques-in-hand")} />
        <PdcCard title="Cheques issued" icon={MdCallMade} data={s.pdcOut} onOpen={report("cheques-issued")} />
        <RecentCard title="Recent receipts" rows={s.recentReceipts || []} emptyText="No receipts yet."
          onOpenRow={(r) => navigate(`/receipts?highlight=${r.id}`)} />
        <RecentCard title="Recent payments" rows={s.recentPayments || []} emptyText="No payments yet."
          onOpenRow={(r) => navigate(`/payments?highlight=${r.id}`)} />
        {gl && (s.cashAccounts || []).length > 0 && <CashAccountsCard accounts={s.cashAccounts} />}
      </div>
    </>
  );
}

// ── Building blocks ──────────────────────────────────────────────────

function LedgerOffCard({ label }) {
  return (
    <div style={{ ...st.card, minHeight: 136, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={st.tileLabel}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--dash-text)", fontSize: "0.86rem", fontWeight: 600 }}>
        <MdInfo size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> {LEDGER_OFF}
      </div>
    </div>
  );
}

function LedgerOffGroup({ title }) {
  return <KpiGroup title={title}><LedgerOffCard label={title} /></KpiGroup>;
}

function ListCard({ title, icon: Icon, onOpen, children }) {
  return (
    <section style={{ ...st.card, display: "flex", flexDirection: "column", gap: "0.6rem", minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Icon size={18} style={{ color: "var(--dash-primary)", flexShrink: 0 }} aria-hidden="true" />
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--dash-ink)", flex: 1, minWidth: 0 }}>{title}</h3>
        {onOpen && <button type="button" onClick={onOpen} style={st.headerBtn} aria-label={`Open the ${title.toLowerCase()} report`}>Report</button>}
      </header>
      {children}
    </section>
  );
}

/** Pending / post-dated cheques with a due-within-7-days highlight. */
function PdcCard({ title, icon, data, onOpen }) {
  const d = data || {};
  return (
    <ListCard title={title} icon={icon} onOpen={onOpen}>
      <div style={st.bigFigure}>{fmtMoney(d.amount || 0)}</div>
      <div style={st.muted}>{plural(d.count || 0, "pending cheque")}</div>
      {(d.dueSoonCount || 0) > 0 && (
        <div style={st.dueSoon}>
          <MdErrorOutline size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
          {d.dueSoonCount} due within 7 days · {fmtMoney(d.dueSoonAmount)}
        </div>
      )}
    </ListCard>
  );
}

/** Last 5 receipts / payments — reference, contact, amount, date. */
function RecentCard({ title, rows, emptyText, onOpenRow }) {
  const items = rows.slice(0, 5);
  return (
    <ListCard title={title} icon={MdReceiptLong}>
      {items.length === 0 ? <div style={{ ...st.muted, fontStyle: "italic" }}>{emptyText}</div> : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {items.map((r) => (
            <button key={r.id} type="button" onClick={() => onOpenRow(r)} style={st.rowBtn} title={`Open ${r.reference}`}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "0.74rem", color: "var(--dash-primary)", fontWeight: 700 }}>{r.reference}</span>
                <span style={{ ...clamp2, fontSize: "0.82rem", fontWeight: 600, color: "var(--dash-ink)" }}>{r.contactName || "(no contact)"}</span>
              </span>
              <span style={{ textAlign: "right", flexShrink: 0 }}>
                <span style={{ display: "block", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--dash-ink)" }}>{fmtMoney(r.amount)}</span>
                <span style={{ display: "block", fontSize: "0.72rem", color: "var(--dash-text)" }}>{fmtDate(r.date)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </ListCard>
  );
}

function CashAccountsCard({ accounts }) {
  return (
    <ListCard title="Cash & bank accounts" icon={MdAccountBalanceWallet}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {accounts.map((a) => (
          <div key={a.accountId} style={{ ...st.rowBtn, cursor: "default" }}>
            <span style={{ ...clamp2, flex: 1, minWidth: 0, fontWeight: 600, color: "var(--dash-ink)" }}>{a.code ? `${a.code} · ` : ""}{a.name}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", flexShrink: 0, color: "var(--dash-ink)" }}>{fmtMoney(a.balance)}</span>
          </div>
        ))}
      </div>
    </ListCard>
  );
}

/** Shown while summary.glEnabled is false. */
function GlOffCallout({ canManage, enabling, onEnable }) {
  return (
    <div style={{ ...st.card, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.9rem", borderLeft: "4px solid var(--dash-primary)", marginBottom: "1.25rem" }}>
      <MdAccountBalance size={26} style={{ color: "var(--dash-primary)", flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--dash-ink)" }}>General Ledger is off</div>
        <div style={{ ...st.muted, lineHeight: 1.5, marginTop: 3, maxWidth: 620 }}>
          Balances and profit need it, so those figures say "{LEDGER_OFF}" until posting is on. Enabling seeds
          the chart of accounts and backfills journal entries for every existing document.
        </div>
      </div>
      {canManage && (
        <button type="button" style={{ ...st.primaryBtn, opacity: enabling ? 0.75 : 1 }} onClick={onEnable} disabled={enabling}>
          {enabling
            ? <><MdAutorenew size={18} style={{ animation: "acctdash-spin 1s linear infinite" }} /> Enabling — this can take a minute…</>
            : "Enable GL posting"}
        </button>
      )}
    </div>
  );
}

/** Success banner with the backfill counts from enable/rebuild. */
function GlResultBanner({ result, onDismiss }) {
  const chips = [
    ["Accounts seeded", result.seededAccounts], ["Invoices posted", result.postedInvoices],
    ["Bills posted", result.postedBills], ["Consignments posted", result.postedConsignments],
    ["Payments posted", result.postedPayments], ["Transfers posted", result.postedTransfers],
    ["Entries removed", result.removedEntries],
  ].filter(([, v]) => Number(v || 0) > 0);
  return (
    <div style={{ ...st.card, display: "flex", alignItems: "flex-start", gap: 10, borderLeft: "4px solid var(--dash-positive)", marginBottom: "1.25rem" }}>
      <MdCheckCircle size={20} style={{ color: "var(--dash-positive)", flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--dash-ink)", fontSize: "0.9rem" }}>
          Ledger {result.kind === "rebuilt" ? "rebuilt" : "enabled and backfilled"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {chips.length === 0
            ? <span style={st.chip}>Nothing to post — ledger was already up to date</span>
            : chips.map(([label, v]) => <span key={label} style={st.chip}>{label}: <strong>{v}</strong></span>)}
        </div>
      </div>
      <button type="button" style={st.iconBtn} onClick={onDismiss} aria-label="Dismiss"><MdClose size={16} /></button>
    </div>
  );
}

/** Ledger entry count, Dr/Cr balance check, lock date, Rebuild. */
function GlHealthFooter({ status, canManage, rebuilding, onRebuild }) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem 0.6rem", marginTop: "1.4rem", paddingTop: "0.85rem", borderTop: "1px dashed var(--dash-grid)", fontSize: "0.76rem", color: "var(--dash-text)" }}>
      <span style={st.footItem}>{Number(status.entryCount || 0).toLocaleString("en-PK")} journal entries</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span style={{ ...st.footItem, color: status.isBalanced ? "var(--dash-positive)" : "var(--dash-negative)" }}>
        {status.isBalanced
          ? <><MdCheckCircle size={14} /> Σ Dr = Σ Cr ({fmtMoney(status.totalDebit)})</>
          : <><MdErrorOutline size={14} /> Out of balance — Dr {fmtMoney(status.totalDebit)} vs Cr {fmtMoney(status.totalCredit)}</>}
      </span>
      {status.lockDate && (
        <><span style={{ opacity: 0.5 }}>·</span><span style={st.footItem}><MdLock size={13} /> Locked up to {fmtDate(status.lockDate)}</span></>
      )}
      {canManage && (
        <button type="button" style={{ ...st.headerBtn, marginLeft: "auto", opacity: rebuilding ? 0.7 : 1 }} onClick={onRebuild} disabled={rebuilding}>
          <MdAutorenew size={16} style={rebuilding ? { animation: "acctdash-spin 1s linear infinite" } : undefined} />
          {rebuilding ? "Rebuilding…" : "Rebuild ledger"}
        </button>
      )}
    </div>
  );
}

function Shell({ children }) {
  // .dl-main provides the outer padding; the page caps its width.
  return <div style={{ maxWidth: 1480, margin: "0 auto", minWidth: 0 }}>{children}</div>;
}

function Notice({ icon: Icon = MdInfo, children }) {
  return (
    <div style={{ ...st.card, padding: "2rem 1.5rem", textAlign: "center", marginBottom: "1rem", color: "var(--dash-text)" }}>
      <Icon size={30} aria-hidden="true" />
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>{children}</p>
    </div>
  );
}

function LoadingShimmer() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "1rem", marginBottom: "1rem" }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ ...st.card, height: 136 }}>
          <div style={{ width: "60%", height: 12, background: "var(--dash-grid)", borderRadius: 4, marginBottom: 16 }} />
          <div style={{ width: "75%", height: 28, background: "var(--dash-grid)", borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

const st = {
  card: {
    background: "var(--dash-card)", border: "1px solid var(--dash-grid)", borderRadius: 16, padding: "1rem 1.1rem",
    boxShadow: "0 1px 2px rgba(12, 24, 48, 0.04), 0 10px 28px -18px rgba(12, 24, 48, 0.18)", minWidth: 0,
  },
  // Two charts across from ~900px; one full-width column below.
  chartGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: "1rem" },
  listGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: "1rem", alignItems: "start" },
  groupTitle: { margin: "0 0 0.6rem", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dash-text)" },
  tileLabel: { fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dash-text)" },
  bigFigure: { fontSize: "1.3rem", fontWeight: 600, color: "var(--dash-ink)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" },
  muted: { fontSize: "0.8rem", color: "var(--dash-text)" },
  dueSoon: {
    display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", padding: "0.3rem 0.65rem", borderRadius: 999,
    fontSize: "0.75rem", fontWeight: 700, border: "1px solid var(--dash-warn)", color: "var(--dash-warn)",
  },
  rowBtn: {
    display: "flex", alignItems: "center", gap: "0.6rem", width: "100%", minHeight: 44, padding: "0.35rem 0",
    background: "none", border: 0, borderBottom: "1px solid var(--dash-grid)", font: "inherit", textAlign: "left", cursor: "pointer",
  },
  headerBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", minHeight: 44, minWidth: 44, padding: "0 0.75rem",
    borderRadius: 9, border: "1px solid var(--dash-grid)", color: "var(--dash-primary)", background: "var(--dash-card)",
    fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", flexShrink: 0,
  },
  primaryBtn: {
    display: "inline-flex", alignItems: "center", gap: 7, padding: "0 1.15rem", minHeight: 44, borderRadius: 9, border: "none",
    background: "var(--dash-primary)", color: "var(--dash-card)", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", flexShrink: 0,
  },
  iconBtn: {
    display: "grid", placeItems: "center", width: 44, height: 44, minWidth: 44, padding: 0, borderRadius: 8, border: "none",
    background: "transparent", color: "var(--dash-text)", cursor: "pointer", flexShrink: 0,
  },
  chip: { fontSize: "0.75rem", color: "var(--dash-ink)", border: "1px solid var(--dash-grid)", borderRadius: 999, padding: "0.2rem 0.6rem" },
  footItem: { display: "inline-flex", alignItems: "center", gap: 4, fontVariantNumeric: "tabular-nums" },
};
