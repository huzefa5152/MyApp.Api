// src/pages/DashboardPage.jsx
//
// Home dashboard — the operator's daily command centre: what the business did
// in the period, what it is owed and owes today, what is waiting on them, and
// one click to the work.
//
// Data: ONE call, GET /api/dashboard/kpis?companyId&period. The server returns
// only the sections the caller's dashboard.kpi.* permissions allow (each block
// is null otherwise), so nothing is fetched or shown that the role cannot see.
// Every figure on this page is the server's; the page only formats, compares
// and links.
//
// What each figure IS — said on screen, because they look alike:
//   • Business activity  — totals for the selected period (sales, purchases,
//                          collections, payments, GST).
//   • Position           — balances as at today (aged receivables / payables,
//                          challans waiting to be billed), whatever the period.
//   • Sales and purchases are document totals; collections and payments are
//     money that moved. Neither is profit — profit lives on the Accounting
//     dashboard, which reads the ledger.
//
// Drill-downs go to the report or list that holds the records behind a figure,
// filtered to it. A destination the caller cannot open is not linked at all.
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  MdTrendingUp, MdShoppingCart, MdReceipt, MdInventory, MdCloudDone,
  MdHourglassEmpty, MdError, MdCheckCircle, MdLock,
  MdOpenInNew, MdInfo, MdAttachMoney, MdAccountBalance,
  MdLocalShipping, MdAddShoppingCart, MdCallReceived, MdCallMade, MdMenuBook, MdPostAdd, MdNoteAdd,
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getDashboardKpis } from "../api/dashboardApi";
import TopList from "../Components/dashboard/TopList";
import ByCounterpartyCard from "../Components/dashboard/ByCounterpartyCard";
import {
  Hero, Section, Panel, HeadLink, Metric, MetricGrid, QuickActions, AttentionList,
  TrendChart, PartyTable, Skeleton, ErrorBanner,
  fmtMoney, fmtDate, ymd, daysSince, change, reportHref,
} from "../Components/dashboard/CommandCenter";
import "./DashboardPage.css";

const PERIOD_OPTIONS = [
  // "All Time" first + default — gives the operator a complete-history
  // view without any time filter on first load. Other ranges are
  // available from the dropdown when they want a specific window.
  { code: "all-time",   label: "All Time" },
  { code: "this-week",  label: "This Week" },
  { code: "last-week",  label: "Last Week" },
  { code: "this-month", label: "This Month" },
  { code: "last-month", label: "Last Month" },
  { code: "this-year",  label: "This Year" },
  { code: "last-year",  label: "Last Year" },
];

const PERIOD_STORAGE_KEY = "dashboardPeriod";

const accents = {
  sales:     "#0d47a1",
  purchases: "#00897b",
  fbr:       "#6a1b9a",
  inventory: "#e65100",
};

function formatPkr(v) {
  if (v == null || isNaN(v)) return "Rs. 0";
  return `Rs. ${Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}
function formatPkrCompact(v) {
  // For the hero — drop the Rs prefix because the label provides context.
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 });
}
function formatDate(s) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-PK", { day: "2-digit", month: "short" });
  } catch { return s; }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function readStoredPeriod() {
  try { return localStorage.getItem(PERIOD_STORAGE_KEY) || "all-time"; } catch { return "all-time"; }
}

/**
 * The selected dashboard period as report-screen filters. The dashboard's
 * `to` is exclusive (the first instant after the period); the reports take an
 * inclusive last day. All Time is the reports' All Periods.
 */
function reportRange(period) {
  if (!period?.from || !period?.to) return { period: "allPeriods" };
  const last = new Date(period.to);
  last.setDate(last.getDate() - 1);
  return { period: "custom", from: ymd(period.from), to: ymd(last) };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { selectedCompany, companies, setSelectedCompany } = useCompany();
  const { has, loading: permsLoading } = usePermissions();

  const [period, setPeriod] = useState(readStoredPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const canViewPage = has?.("dashboard.view") ?? false;
  const displayName = user?.name || user?.username || "there";

  useEffect(() => {
    try { if (period) localStorage.setItem(PERIOD_STORAGE_KEY, period); } catch { /* storage blocked */ }
  }, [period]);

  // `cancelled` guards a slow response for an old company/period landing
  // after a newer one.
  const load = useCallback((isCancelled = () => false) => {
    if (permsLoading || !canViewPage || !selectedCompany?.id) return;
    setLoading(true); setError(null);
    getDashboardKpis(selectedCompany.id, period)
      .then((res) => { if (!isCancelled()) setData(res); })
      .catch((err) => {
        if (isCancelled()) return;
        setError(err?.response?.data?.error || "The dashboard could not be loaded.");
      })
      .finally(() => { if (!isCancelled()) setLoading(false); });
  }, [permsLoading, canViewPage, selectedCompany?.id, period]);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  if (permsLoading) return <div className="cc"><Skeleton /></div>;
  if (!canViewPage) return <div className="cc"><AccessDeniedBanner displayName={displayName} reason="page" /></div>;
  if (!selectedCompany) {
    return <div className="cc"><EmptyState heading="Pick a company" body="Use the company picker in the top bar to start." /></div>;
  }

  const flags = data?.permissions;
  const hasAnyKpi = !!(flags?.canViewSales || flags?.canViewPurchases || flags?.canViewFbr || flags?.canViewInventory);
  const periodLabel = PERIOD_OPTIONS.find((p) => p.code === period)?.label || "";
  const showCompanyPicker = (companies?.length ?? 0) > 1;

  return (
    <div className="cc">
      <Hero
        eyebrow="Overview"
        title={<>Welcome back, <span style={{ color: "#9ef2ff" }}>{displayName}</span></>}
        subtitle={<>{selectedCompany?.name ? <><strong>{selectedCompany.name}</strong> · </> : null}Showing <strong>{periodLabel}</strong></>}
      >
        {showCompanyPicker && (
          <select className="cc-hero-select" aria-label="Company" value={selectedCompany?.id ?? ""}
            onChange={(e) => {
              const c = companies.find((cc) => cc.id === parseInt(e.target.value, 10));
              if (c) setSelectedCompany(c);
            }}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select className="cc-hero-select" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIOD_OPTIONS.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
        </select>
      </Hero>

      <QuickActions actions={quickActions(has)} />

      {error && <ErrorBanner message={error} onRetry={() => load()} />}
      {loading && !data && <Skeleton />}
      {!loading && data && !hasAnyKpi && <WelcomeOnlyBanner displayName={displayName} />}

      {data && hasAnyKpi && <CommandCentre data={data} has={has} periodLabel={periodLabel} />}
    </div>
  );
}

// ── Quick actions ───────────────────────────────────────────────────────
//
// Each opens the page's own form (useQueryAction on that page), so there is
// one create path per document. Shown only to a role that can complete it.
function quickActions(has) {
  const can = (k) => has?.(k) ?? false;
  return [
    can("challans.manage.create") && { label: "New delivery challan", to: "/challans?new=1", icon: MdLocalShipping },
    can("bills.manage.create") && { label: "Bill delivered challans", to: "/bills?new=1", icon: MdPostAdd },
    can("bills.manage.create.standalone") && { label: "Bill without challan", to: "/bills?new=standalone", icon: MdNoteAdd },
    can("purchasebills.manage.create") && { label: "Record local purchase", to: "/purchase-bills?new=local", icon: MdAddShoppingCart },
    can("accounting.receipts.create") && { label: "Record customer receipt", to: "/receipts?new=1", icon: MdCallReceived },
    can("accounting.payments.create") && { label: "Record supplier payment", to: "/payments?new=1", icon: MdCallMade },
    can("purchasebills.payables.view") && { label: "Supplier payables", to: "/supplier-payables", icon: MdMenuBook },
  ].filter(Boolean);
}

// ── The command centre itself ───────────────────────────────────────────

function CommandCentre({ data, has, periodLabel }) {
  const can = (k) => has?.(k) ?? false;
  const reports = can("accounting.reports.view");
  const range = reportRange(data.period);
  const today = { period: "today" };
  const hero = data.hero || {};
  const { sales, purchases, receivables, payables, cash, work, fbr } = data;
  const flags = data.permissions || {};

  // Where each figure opens: the filtered report when the caller can read
  // reports, otherwise the list screen behind it, otherwise nothing.
  const links = {
    sales: reports ? reportHref("sales-invoice-register", range) : can("bills.list.view") ? "/bills" : null,
    purchases: reports ? reportHref("purchase-bill-register", range) : can("purchasebills.list.view") ? "/purchase-bills" : null,
    collections: reports ? reportHref("receipts-register", range) : can("accounting.receipts.view") ? "/receipts" : null,
    payments: reports ? reportHref("payments-register", range) : can("accounting.payments.view") ? "/payments" : null,
    gst: reports ? reportHref("tax-summary", range) : null,
    receivables: reports ? reportHref("aged-receivables", today) : can("reports.outstanding.view") ? "/reports/outstanding" : null,
    receivablesOverdue: reports ? reportHref("aged-receivables", { ...today, status: "overdue" }) : can("reports.outstanding.view") ? "/reports/outstanding" : null,
    payables: reports ? reportHref("aged-payables", today) : can("purchasebills.payables.view") ? "/supplier-payables" : null,
    payablesOverdue: reports ? reportHref("aged-payables", { ...today, status: "overdue" }) : can("purchasebills.payables.view") ? "/supplier-payables" : null,
    billChallans: can("bills.manage.create") ? "/bills?new=1" : can("challans.list.view") ? "/challans" : null,
    setupRequired: can("challans.list.view") ? `/challans?status=${encodeURIComponent("Setup Required")}` : null,
    notCosted: can("bills.list.view") ? "/bills?costingStatus=not-costed" : null,
    fbr: can("bills.list.view") ? "/invoices" : null,
  };
  const customerHref = (r) => reports ? reportHref("customer-outstanding", { ...today, clientId: r.id }) : null;
  const supplierHref = (r) => reports ? reportHref("supplier-outstanding", { ...today, supplierId: r.id })
    : can("purchasebills.payables.view") ? `/supplier-payables?supplierId=${r.id}` : null;

  const asAt = receivables?.asOf || payables?.asOf;
  const oldestDays = daysSince(work?.oldestAwaitingBillingDate);

  // 12-month sales vs purchases, one point per month. A month opens its sales
  // register when the caller can read reports.
  const trend = (sales?.trend12m || purchases?.trend12m || []).map((pt, i) => {
    const [y, m] = pt.month.split("-").map(Number);
    const to = reports && sales
      ? reportHref("sales-invoice-register", { period: "custom", from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) })
      : null;
    return {
      label: pt.label, short: pt.label,
      sales: sales?.trend12m?.[i]?.value ?? 0,
      purchases: purchases?.trend12m?.[i]?.value ?? 0,
      to,
    };
  });
  const trendBars = [
    sales && { key: "sales", label: "Sales", color: accents.sales },
    purchases && { key: "purchases", label: "Purchases", color: "#4db6ac" },
  ].filter(Boolean);

  return (
    <>
      {/* ── Business activity — the selected period ─────────────────── */}
      <Section title="Business activity" kind={periodLabel}>
        <MetricGrid min={180}>
          {flags.canViewSales && (
            <Metric label="Sales" icon={MdAttachMoney} accent={accents.sales}
              value={fmtMoney(hero.totalSales)}
              delta={change(hero.totalSales, hero.totalSalesPrev)}
              sub={sales ? `${plural(sales.invoiceCount, "bill")} · avg ${fmtMoney(sales.averageInvoiceValue)}` : undefined}
              hint="Billed to customers (grand total incl. GST). Credit and debit notes, demo and voided bills are left out. Not profit."
              to={links.sales} />
          )}
          {flags.canViewPurchases && (
            <Metric label="Purchases" icon={MdShoppingCart} accent={accents.purchases}
              value={fmtMoney(hero.totalPurchases)}
              delta={change(hero.totalPurchases, hero.totalPurchasesPrev)} higherIsBetter={false}
              sub={purchases ? `${plural(purchases.billCount, "bill")}${purchases.localPurchaseCount > 0 ? ` · ${fmtMoney(purchases.localPurchasesTotal)} local` : ""}` : undefined}
              hint="Every purchase bill in the period, including local purchases booked from supplier costs on challans and bills — those are part of this total, not added to it."
              to={links.purchases} />
          )}
          {cash?.hasCollections && (
            <Metric label="Collected" icon={MdCallReceived} accent="#2e7d32"
              value={fmtMoney(cash.collections)}
              delta={change(cash.collections, cash.collectionsPrev)}
              sub={plural(cash.collectionCount, "receipt")}
              hint="Money received from customers in the period. Voided and bounced receipts are left out."
              to={links.collections} />
          )}
          {cash?.hasPayments && (
            <Metric label="Paid out" icon={MdCallMade} accent="#37474f"
              value={fmtMoney(cash.payments)}
              delta={change(cash.payments, cash.paymentsPrev)} higherIsBetter={false}
              sub={plural(cash.paymentCount, "payment")}
              hint="Money paid out in the period. Voided and bounced payments are left out."
              to={links.payments} />
          )}
          {flags.canViewSales && flags.canViewPurchases && (
            <Metric label="GST net" icon={MdAccountBalance} accent={accents.fbr}
              value={fmtMoney(hero.gstNet)}
              delta={change(hero.gstNet, hero.gstNetPrev)} higherIsBetter={false}
              sub={`Output ${fmtMoney(hero.gstOutput)} − input ${fmtMoney(hero.gstInput)}`}
              hint="Sales tax charged on sales less sales tax on purchases, from the documents."
              to={links.gst} />
          )}
        </MetricGrid>
      </Section>

      {/* ── Position — balances today ───────────────────────────────── */}
      {(receivables || payables || work) && (
        <Section title="Position" kind={asAt ? `As at ${fmtDate(asAt)}` : "Today"}>
          <MetricGrid>
            {receivables && (
              <Metric label="Customers owe you" icon={MdCallReceived} accent="#00897b"
                value={fmtMoney(receivables.total)}
                sub={receivables.overdue > 0
                  ? `${fmtMoney(receivables.overdue)} overdue · ${plural(receivables.overduePartyCount, "customer")}`
                  : `${plural(receivables.partyCount, "customer")} · nothing overdue`}
                hint="Unpaid balance of sale bills, less tax withheld at source. A bill is overdue the day after its due date (its bill date when none is set)."
                to={links.receivables} />
            )}
            {payables && (
              <Metric label="You owe suppliers" icon={MdCallMade} accent="#e65100"
                value={fmtMoney(payables.total)}
                sub={payables.overdue > 0
                  ? `${fmtMoney(payables.overdue)} overdue · ${plural(payables.overduePartyCount, "supplier")}`
                  : `${plural(payables.partyCount, "supplier")} · nothing overdue`}
                hint="Unpaid balance of purchase bills (local purchases included), less tax you withheld."
                to={links.payables} />
            )}
            {work && (
              <Metric label="Challans to bill" icon={MdLocalShipping} accent="#f57c00"
                value={work.challansAwaitingBilling.toLocaleString("en-PK")}
                sub={work.challansAwaitingBilling > 0
                  ? `Oldest ${fmtDate(work.oldestAwaitingBillingDate)}${oldestDays != null ? ` · ${plural(oldestDays, "day")}` : ""}`
                  : "Everything delivered is billed"}
                hint="Delivered challans not yet on a bill. They are not sales until billed, so they are not counted in Sales."
                to={work.challansAwaitingBilling > 0 ? links.billChallans : null} />
            )}
          </MetricGrid>
        </Section>
      )}

      {/* ── Trend + attention ───────────────────────────────────────── */}
      <div className="cc-split cc-split--wide" style={{ marginTop: "1.25rem" }}>
        {trendBars.length > 0 && (
          <Panel title="Sales and purchases" kind="Last 12 months">
            <TrendChart points={trend} bars={trendBars}
              ariaLabel="Monthly sales and purchases for the last 12 months" />
            {reports && sales && <p className="cc-note">Select a month to open its sales register.</p>}
          </Panel>
        )}
        <Panel title="Needs attention">
          <AttentionList items={attentionItems({ receivables, payables, work, fbr, links, oldestDays, canCosts: can("bills.costs.view"), periodLabel })} />
        </Panel>
      </div>

      {/* ── Who owes / whom you owe ─────────────────────────────────── */}
      {(receivables || payables) && (
        <div className="cc-split" style={{ marginTop: "0.85rem" }}>
          {receivables && (
            <Panel title="Largest customer balances" kind="Today" action={<HeadLink to={links.receivables}>Full aging</HeadLink>}>
              <PartyTable rows={receivables.top} hrefFor={customerHref} emptyText="No customer owes anything."
                columns={[
                  { key: "name", label: "Customer" },
                  { key: "total", label: "Owed", money: true },
                  { key: "overdue", label: "Overdue", money: true, tone: (r) => (r.overdue > 0 ? "bad" : undefined) },
                ]} />
            </Panel>
          )}
          {payables && (
            <Panel title="Largest supplier balances" kind="Today" action={<HeadLink to={links.payables}>Full aging</HeadLink>}>
              <PartyTable rows={payables.top} hrefFor={supplierHref} emptyText="Nothing is owed to suppliers."
                columns={[
                  { key: "name", label: "Supplier" },
                  { key: "total", label: "Owed", money: true },
                  { key: "overdue", label: "Overdue", money: true, tone: (r) => (r.overdue > 0 ? "bad" : undefined) },
                ]} />
            </Panel>
          )}
        </div>
      )}

      {/* ── Counterparty breakdown for the period ───────────────────── */}
      {(sales || purchases) && (
        <div className="dash-section-grid" style={styles.sectionGrid}>
          {sales && (
            <ByCounterpartyCard items={sales.topClients} total={sales.totalSales} accent={accents.sales}
              title="Sales by Client"
              subtitle={`Top ${Math.min(20, (sales.topClients || []).length)} clients · ${periodLabel} total Rs. ${formatPkrCompact(sales.totalSales)}`}
              emptyText="No invoiced clients in this period." />
          )}
          {purchases && (
            <ByCounterpartyCard items={purchases.topSuppliers} total={purchases.totalPurchases} accent={accents.purchases}
              title="Purchases by Supplier"
              subtitle={`Top ${Math.min(20, (purchases.topSuppliers || []).length)} suppliers · ${periodLabel} total Rs. ${formatPkrCompact(purchases.totalPurchases)}`}
              emptyText="No supplier activity in this period." />
          )}
        </div>
      )}

      {/* ── Detail sections (unchanged) ──────────────────────────────
          Each "Open" link is gated by the destination screen's own view
          permission, so it never 403s. */}
      <div className="dash-section-grid" style={styles.sectionGrid}>
        {sales      && <SalesSection      data={sales}           canOpen={can("invoices.list.view") || can("bills.list.view")} />}
        {purchases  && <PurchasesSection  data={purchases}       canOpen={can("purchasebills.list.view")} />}
        {fbr        && <FbrSection        data={fbr} />}
        {data.inventory && <InventorySection data={data.inventory} canOpen={can("stock.dashboard.view")} />}
      </div>
    </>
  );
}

/**
 * The attention list, most urgent first: money past due (largest first), then
 * work blocking a sale, then housekeeping. Each item names what, why, how
 * much, and opens the records to act on. Built only from server figures.
 */
function attentionItems({ receivables, payables, work, fbr, links, oldestDays, canCosts, periodLabel }) {
  const items = [];
  if (receivables?.overdue > 0) {
    items.push({
      rank: receivables.over90 > 0 ? 0 : 1, amount: receivables.overdue,
      tone: receivables.over90 > 0 ? "danger" : "warn",
      title: `${plural(receivables.overduePartyCount, "customer")} past due`,
      why: receivables.over90 > 0
        ? `${fmtMoney(receivables.over90)} is more than 90 days late. Follow up for collection.`
        : "Bills past their due date. Follow up for collection.",
      figure: fmtMoney(receivables.overdue), actionLabel: "See who", to: links.receivablesOverdue,
    });
  }
  if (payables?.overdue > 0) {
    items.push({
      rank: payables.over90 > 0 ? 0 : 1, amount: payables.overdue,
      tone: payables.over90 > 0 ? "danger" : "warn",
      title: `${plural(payables.overduePartyCount, "supplier")} awaiting payment`,
      why: payables.over90 > 0
        ? `${fmtMoney(payables.over90)} is more than 90 days past due.`
        : "Purchase bills past their due date.",
      figure: fmtMoney(payables.overdue), actionLabel: "Review", to: links.payablesOverdue,
    });
  }
  if (work?.challansAwaitingBilling > 0) {
    items.push({
      rank: oldestDays != null && oldestDays > 7 ? 1 : 2, amount: 0,
      tone: oldestDays != null && oldestDays > 7 ? "warn" : "info",
      title: `${plural(work.challansAwaitingBilling, "challan")} waiting to be billed`,
      why: `Goods delivered but not billed${oldestDays != null ? `; the oldest is ${plural(oldestDays, "day")} old` : ""}.`,
      actionLabel: "Bill now", to: links.billChallans,
    });
  }
  if (work?.challansSetupRequired > 0) {
    items.push({
      rank: 2, amount: 0, tone: "warn",
      title: `${plural(work.challansSetupRequired, "challan")} need FBR setup`,
      why: "FBR details are missing on the company or the client, so these cannot be filed once billed.",
      actionLabel: "Open", to: links.setupRequired,
    });
  }
  if (canCosts && work?.billsWithoutCost > 0) {
    items.push({
      rank: 3, amount: 0, tone: "info",
      title: `${plural(work.billsWithoutCost, "bill")} with no actual cost`,
      why: `${periodLabel}: no line has its cost entered, so profit on these bills is not known yet.`,
      actionLabel: "Add costs", to: links.notCosted,
    });
  }
  if (fbr?.failed > 0) {
    items.push({
      rank: 1, amount: 0, tone: "danger",
      title: `${plural(fbr.failed, "invoice")} failed at FBR`,
      why: `${periodLabel}: rejected on validation or submission. Fix and resubmit.`,
      actionLabel: "Open invoices", to: links.fbr,
    });
  }
  return items.sort((a, b) => a.rank - b.rank || b.amount - a.amount);
}

// ── Gates and empty states ─────────────────────────────────────────────

function WelcomeOnlyBanner({ displayName }) {
  return (
    <div className="dash-card" style={{ ...styles.card, padding: "2.5rem 1.5rem", textAlign: "center" }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 52, height: 52, borderRadius: 16, marginBottom: "0.8rem",
        background: "rgba(13, 71, 161, 0.08)", border: "1px solid rgba(13, 71, 161, 0.18)",
        color: "#0d47a1",
      }}>
        <MdInfo size={26} />
      </span>
      <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#0c1830", fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif' }}>
        Welcome back, {displayName}
      </h2>
      <p style={{ margin: "0.4rem auto 0", maxWidth: 480, fontSize: "0.9rem", color: "#5b6b86", lineHeight: 1.55 }}>
        Your role doesn't include any dashboard KPI permissions yet. Ask an admin to grant Sales,
        Purchases, FBR, or Inventory KPI access to see metrics here.
      </p>
    </div>
  );
}

function AccessDeniedBanner({ displayName }) {
  return (
    <div style={{ ...styles.card, padding: "2.5rem 1.5rem", textAlign: "center" }}>
      <MdLock size={48} color="#9e9e9e" style={{ marginBottom: "0.5rem" }} />
      <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "#1a2332" }}>
        No dashboard access
      </h2>
      <p style={{ margin: "0.4rem auto 0", maxWidth: 480, fontSize: "0.9rem", color: "#5f6d7e", lineHeight: 1.5 }}>
        Hi {displayName}, your role doesn't have permission to view the dashboard.
        Use the sidebar to navigate to a section you have access to.
      </p>
    </div>
  );
}

function EmptyState({ heading, body, icon = MdInfo }) {
  const Icon = icon;
  return (
    <div style={{ ...styles.card, padding: "2rem 1.5rem", textAlign: "center" }}>
      <Icon size={36} color="#9e9e9e" />
      <h3 style={{ margin: "0.5rem 0 0.25rem", fontSize: "1rem", fontWeight: 700, color: "#1a2332" }}>{heading}</h3>
      <p style={{ margin: 0, fontSize: "0.85rem", color: "#5f6d7e" }}>{body}</p>
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────

function SectionCard({ title, accent, icon, children, headerExtra = null }) {
  const Icon = icon;
  return (
    <section className="dash-card" style={{ ...styles.card, "--acc": accent, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <header className="dash-section-card__header" style={{
        display: "flex",
        alignItems: "center",
        gap: "0.65rem",
        padding: "0.85rem 1.15rem",
        borderBottom: "1px solid #eef2f8",
      }}>
        <span className="dash-section-card__header-icon" style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 10,
          background: `${accent}12`,
          border: `1px solid ${accent}2e`,
          color: accent,
          flexShrink: 0,
        }}>
          <Icon size={17} />
        </span>
        <h2 style={{
          margin: 0,
          fontSize: "1rem",
          fontWeight: 700,
          color: "#0c1830",
          flex: 1,
          letterSpacing: "-0.01em",
          minWidth: 0,
          fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif',
        }}>{title}</h2>
        {headerExtra}
      </header>
      <div className="dash-section-card__body" style={{ padding: "0.95rem 1.15rem 1.05rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        {children}
      </div>
    </section>
  );
}

function SalesSection({ data, canOpen = false }) {
  return (
    <SectionCard title="Sales" accent={accents.sales} icon={MdReceipt}
      headerExtra={canOpen ? (
        <Link to="/invoices" className="dash-section-card__open" style={styles.headerLink} title="Open Invoices page">
          <MdOpenInNew size={14} /> <span className="dash-section-card__open-label">Open</span>
        </Link>
      ) : null}
    >
      <div className="dash-meta-row" style={styles.metaRow}>
        <Stat label="Invoices" value={data.invoiceCount} />
        <Stat label="Avg Invoice" value={formatPkr(data.averageInvoiceValue)} />
        <Stat label="Total" value={formatPkr(data.totalSales)} highlight />
      </div>

      <div>
        <div style={styles.subHeading}>Recent Invoices</div>
        {(data.recentInvoices || []).length === 0
          ? <EmptyLine>No recent invoices in this period.</EmptyLine>
          : <RecentList rows={data.recentInvoices} />}
      </div>
    </SectionCard>
  );
}

function PurchasesSection({ data, canOpen = false }) {
  return (
    <SectionCard title="Purchases" accent={accents.purchases} icon={MdShoppingCart}
      headerExtra={canOpen ? (
        <Link to="/purchase-bills" className="dash-section-card__open" style={{ ...styles.headerLink, color: accents.purchases, borderColor: accents.purchases }} title="Open Purchase Bills page">
          <MdOpenInNew size={14} /> <span className="dash-section-card__open-label">Open</span>
        </Link>
      ) : null}
    >
      <div className="dash-meta-row" style={styles.metaRow}>
        <Stat label="Bills" value={data.billCount} />
        <Stat label="Avg Bill" value={formatPkr(data.averageBillValue)} />
        <Stat label="Total" value={formatPkr(data.totalPurchases)} highlight />
      </div>

      <div>
        <div style={styles.subHeading}>Recent Purchase Bills</div>
        {(data.recentBills || []).length === 0
          ? <EmptyLine>No recent purchase bills in this period.</EmptyLine>
          : <RecentList rows={data.recentBills} />}
      </div>
    </SectionCard>
  );
}

function FbrSection({ data }) {
  // FBR section visualises a small funnel — pending → validated →
  // submitted, with failed as a separate signal. Reconciliation is
  // the bottom row.
  return (
    <SectionCard title="FBR / Compliance" accent={accents.fbr} icon={MdCloudDone}>
      <div className="dash-funnel-grid" style={styles.fbrGrid}>
        <Funnel label="Pending"   value={data.pendingSubmission} color="#f57c00" icon={MdHourglassEmpty} />
        <Funnel label="Validated" value={data.validated}         color="#0277bd" icon={MdCheckCircle} />
        <Funnel label="Submitted" value={data.submitted}         color="#2e7d32" icon={MdCloudDone} />
        <Funnel label="Failed"    value={data.failed}            color="#c62828" icon={MdError} />
      </div>

      {data.excluded > 0 && (
        <div style={{ fontSize: "0.78rem", color: "#5f6d7e", paddingLeft: "0.25rem" }}>
          <strong>{data.excluded}</strong> bill{data.excluded !== 1 ? "s" : ""} excluded from bulk submit (operator marked as skip).
        </div>
      )}

      <div>
        <div style={styles.subHeading}>Reconciliation (Annexure-A vs Purchase Bills)</div>
        <div style={styles.reconRow}>
          <ReconChip label="Pending"  value={data.reconciliationPending}  color="#f57c00" />
          <ReconChip label="Matched"  value={data.reconciliationMatched}  color="#2e7d32" />
          <ReconChip label="Disputed" value={data.reconciliationDisputed} color="#c62828" />
        </div>
      </div>
    </SectionCard>
  );
}

function InventorySection({ data, canOpen = false }) {
  return (
    <SectionCard title="Inventory" accent={accents.inventory} icon={MdInventory}
      headerExtra={canOpen ? (
        <Link to="/stock" className="dash-section-card__open" style={{ ...styles.headerLink, color: accents.inventory, borderColor: accents.inventory }} title="Open Stock Dashboard">
          <MdOpenInNew size={14} /> <span className="dash-section-card__open-label">Open</span>
        </Link>
      ) : null}
    >
      <div className="dash-meta-row" style={styles.metaRow}>
        <Stat label="Stock value" value={formatPkr(data.totalStockValue)} highlight />
        <Stat label="Items tracked" value={data.trackedItemCount} />
        <Stat label="Low stock" value={data.lowStockItemCount}
          warn={data.lowStockItemCount > 0} />
      </div>

      <div>
        <div style={styles.subHeading}>Top movers (last 30 days)</div>
        <TopList items={data.topItemsByMovement} accent={accents.inventory} valueMode="qty"
          secondary={(it) => `${it.count} movement${it.count !== 1 ? "s" : ""}`}
          emptyText="No stock movements in the last 30 days." />
      </div>

      <div>
        <div style={styles.subHeading}>Recent Movements</div>
        {(data.recentMovements || []).length === 0
          ? <EmptyLine>No recent stock movements.</EmptyLine>
          : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {data.recentMovements.map((m, i) => (
                <div key={`${m.id}-${i}`} className="dash-mov-row" style={{
                  display: "flex", alignItems: "center", gap: "0.55rem", fontSize: "0.83rem",
                  padding: "0.45rem 0.6rem", background: "#f8fafd",
                  border: "1px solid #eef2f8", borderRadius: 10,
                }}>
                  <span style={{ ...styles.miniChip, color: m.direction === "In" ? "#15803d" : "#c62828", backgroundColor: m.direction === "In" ? "rgba(21,128,61,0.10)" : "rgba(198,40,40,0.09)" }}>
                    {m.direction}
                  </span>
                  <span className="dash-mov-row__name" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: "#0c1830" }}>{m.itemTypeName}</span>
                  <span className="dash-mov-row__qty" style={{ fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#0c1830" }}>{m.quantity}</span>
                  <span style={{ color: "#69788f", fontSize: "0.73rem" }}>{formatDate(m.date)}</span>
                </div>
              ))}
            </div>
          )}
      </div>
    </SectionCard>
  );
}

// ── Smaller building blocks ────────────────────────────────────────

function Stat({ label, value, highlight = false, warn = false }) {
  return (
    <div className="dash-stat" style={{ flex: 1, minWidth: 100 }}>
      <div className="dash-stat-label" style={styles.statLabel}>{label}</div>
      <div className="dash-stat-value" style={{
        ...styles.statValue,
        color: warn ? "#c62828" : highlight ? "#0c1830" : "#3b4a63",
        fontWeight: highlight ? 700 : 500,
      }}>{value ?? "—"}</div>
    </div>
  );
}

function Funnel({ label, value, color, icon }) {
  const Icon = icon;
  return (
    <div className="dash-funnel-card" style={{
      ...styles.funnelCard,
      borderColor: `${color}33`,
    }}>
      <div style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 8,
        background: `${color}12`, border: `1px solid ${color}2e`, color,
      }}>
        <Icon size={15} />
      </div>
      <div style={{
        fontSize: "0.64rem", color: "#69788f", textTransform: "uppercase",
        letterSpacing: "0.1em", fontWeight: 600,
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      }}>{label}</div>
      <div className="dash-funnel-card__value" style={{
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        fontVariantNumeric: "tabular-nums",
        fontSize: "1.35rem", fontWeight: 600, color,
      }}>
        {value || 0}
      </div>
    </div>
  );
}

function ReconChip({ label, value, color }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", padding: "0.3rem 0.75rem", borderRadius: 999, border: `1px solid ${color}40`, backgroundColor: `${color}0d` }}>
      <span style={{ fontSize: "0.74rem", color: "#3b4a63", fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontVariantNumeric: "tabular-nums", fontSize: "0.85rem", fontWeight: 600, color }}>{value || 0}</span>
    </div>
  );
}

function RecentList({ rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      {rows.map((r, i) => (
        <div key={`${r.id}-${i}`} className="dash-recent-row" style={{
          display: "flex", alignItems: "center", gap: "0.55rem", fontSize: "0.83rem",
          flexWrap: "wrap", padding: "0.45rem 0.6rem", background: "#f8fafd",
          border: "1px solid #eef2f8", borderRadius: 10,
        }}>
          <span className="dash-recent-row__number" style={{ fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: "0.75rem", color: "#69788f", flexShrink: 0 }}>#{r.number}</span>
          <span className="dash-recent-row__name" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: "#0c1830" }}>{r.counterpartyName || "(unknown)"}</span>
          <span className="dash-recent-row__date" style={{ color: "#69788f", fontSize: "0.73rem", flexShrink: 0 }}>{formatDate(r.date)}</span>
          <span className="dash-recent-row__amount" style={{ fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#0c1830", flexShrink: 0 }}>{formatPkr(r.grandTotal)}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ children }) {
  return <div style={{ fontSize: "0.83rem", color: "#5f6d7e", fontStyle: "italic" }}>{children}</div>;
}

// ── Styles ─────────────────────────────────────────────────────────
//
// Mobile-first: all grids use auto-fit/minmax so they collapse to one
// column on small screens without needing media queries. clamp()
// handles fluid font sizes / paddings.

const styles = {
  heroBanner: {
    position: "relative",
    // Layer order: cyan glow (top-right) → teal glow (bottom-left) →
    // blueprint grid lines → brand gradient base. Same visual language
    // as the public landing/login, so the product feels like one piece.
    background: `
      radial-gradient(80% 160% at 100% 0%, rgba(34, 224, 255, 0.16) 0%, transparent 55%),
      radial-gradient(60% 140% at 0% 100%, rgba(0, 137, 123, 0.30) 0%, transparent 60%),
      linear-gradient(to right, rgba(160, 195, 255, 0.07) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(160, 195, 255, 0.07) 1px, transparent 1px),
      linear-gradient(135deg, #0a2d66 0%, #0d47a1 48%, #0b6e62 100%)
    `,
    backgroundSize: "auto, auto, 44px 44px, 44px 44px, auto",
    borderRadius: 18,
    padding: "1.15rem 1.3rem",
    color: "#fff",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.85rem",
    marginBottom: "0.85rem",
    boxShadow: "0 18px 40px -18px rgba(8, 34, 84, 0.55)",
    overflow: "hidden",
  },
  heroEyebrow: {
    margin: "0 0 0.25rem",
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: "0.62rem",
    fontWeight: 600,
    letterSpacing: "0.24em",
    textTransform: "uppercase",
    color: "rgba(158, 242, 255, 0.85)",
  },
  heroHeading: {
    margin: 0,
    fontSize: "clamp(1.15rem, 3.5vw, 1.5rem)",
    fontWeight: 700,
    color: "#fff",
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif',
  },
  heroSubtitle: {
    margin: "0.3rem 0 0",
    fontSize: "0.84rem",
    color: "rgba(222, 235, 255, 0.78)",
  },
  // Picker bar in the hero. The hero banner itself is flex-wrap, so
  // this block sits inline next to the greeting on desktop and wraps
  // to its own row on phones. flex-basis 240px keeps it from
  // squeezing the greeting too thin.
  heroPickers: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    flex: "1 1 240px",
    minWidth: 0,
  },
  // Glass pills on the gradient — option list colors are fixed in
  // DashboardPage.css (white dropdown panel needs dark text).
  heroSelect: {
    background: "rgba(255, 255, 255, 0.12)",
    color: "#fff",
    border: "1px solid rgba(255, 255, 255, 0.28)",
    borderRadius: 10,
    padding: "0.5rem 0.85rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    outline: "none",
    flex: 1,
    minWidth: 140,
    // Cap on big screens — without this the company picker stretches
    // to absorb all available width.
    maxWidth: 260,
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
  },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
    gap: "0.85rem",
    marginBottom: "0.85rem",
  },
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
    gap: "0.85rem",
    marginTop: "0.85rem",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e6ecf4",
    borderRadius: 16,
    padding: "1rem 1.15rem",
    boxShadow: "0 1px 2px rgba(12, 24, 48, 0.04), 0 10px 28px -18px rgba(12, 24, 48, 0.18)",
  },
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.85rem",
    paddingBottom: "0.6rem",
    borderBottom: "1px dashed #e6ecf4",
  },
  statLabel: {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: "0.62rem",
    color: "#69788f",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 600,
    marginBottom: "0.2rem",
  },
  statValue: {
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontVariantNumeric: "tabular-nums",
    fontSize: "0.95rem",
  },
  subHeading: {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: "0.66rem",
    color: "#8593ab",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    marginBottom: "0.55rem",
  },
  fbrGrid: {
    display: "grid",
    // 94px min fits all four funnel stages on one row inside a
    // half-width section card at desktop; still wraps 2×2 on phones.
    gridTemplateColumns: "repeat(auto-fit, minmax(min(94px, 100%), 1fr))",
    gap: "0.55rem",
  },
  funnelCard: {
    background: "#fafcff",
    border: "1px solid",
    borderRadius: 12,
    padding: "0.7rem 0.6rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    alignItems: "flex-start",
  },
  reconRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.4rem",
  },
  miniChip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.12rem 0.5rem",
    borderRadius: 999,
    fontSize: "0.7rem",
    fontWeight: 700,
    flexShrink: 0,
  },
  headerLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.3rem 0.6rem",
    borderRadius: 9,
    border: "1px solid #dbe4f0",
    color: "#0d47a1",
    backgroundColor: "#fff",
    fontSize: "0.75rem",
    fontWeight: 600,
    textDecoration: "none",
    flexShrink: 0,
  },
};
