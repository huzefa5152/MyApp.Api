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
  MdShoppingCart,
  MdReceipt,
  MdInventory,
  MdCloudDone,
  MdHourglassEmpty,
  MdError,
  MdCheckCircle,
  MdLock,
  MdOpenInNew,
  MdInfo,
  MdAttachMoney,
  MdAccountBalance,
  MdLocalShipping,
  MdAddShoppingCart,
  MdCallReceived,
  MdCallMade,
  MdMenuBook,
  MdPostAdd,
  MdNoteAdd,
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getDashboardKpis } from "../api/dashboardApi";
import TopList from "../Components/dashboard/TopList";
import ByCounterpartyCard from "../Components/dashboard/ByCounterpartyCard";
import {
  Hero,
  Section,
  Panel,
  HeadLink,
  Metric,
  MetricGrid,
  QuickActions,
  AttentionList,
  TrendChart,
  PartyTable,
  Skeleton,
  ErrorBanner,
  fmtMoney,
  fmtDate,
  ymd,
  daysSince,
  change,
  reportHref,
} from "../Components/dashboard/CommandCenter";
import useUi2 from "../ui2/useUi2";
import { Card, EmptyState } from "../ui/Kit";
import "./DashboardPage.css";

const PERIOD_OPTIONS = [
  // "All Time" first + default — gives the operator a complete-history
  // view without any time filter on first load. Other ranges are
  // available from the dropdown when they want a specific window.
  { code: "all-time", label: "All Time" },
  { code: "this-week", label: "This Week" },
  { code: "last-week", label: "Last Week" },
  { code: "this-month", label: "This Month" },
  { code: "last-month", label: "Last Month" },
  { code: "this-year", label: "This Year" },
  { code: "last-year", label: "Last Year" },
];

const PERIOD_STORAGE_KEY = "dashboardPeriod";

const accents = {
  sales: "#0d47a1",
  purchases: "#00897b",
  fbr: "#6a1b9a",
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
  } catch {
    return s;
  }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function readStoredPeriod() {
  try {
    return localStorage.getItem(PERIOD_STORAGE_KEY) || "all-time";
  } catch {
    return "all-time";
  }
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
  // The workspace theme switches company in its top bar; no second picker here.
  const topbarSwitcher = useUi2();

  const [period, setPeriod] = useState(readStoredPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const canViewPage = has?.("dashboard.view") ?? false;
  const displayName = user?.name || user?.username || "there";

  useEffect(() => {
    try {
      if (period) localStorage.setItem(PERIOD_STORAGE_KEY, period);
    } catch {
      /* storage blocked */
    }
  }, [period]);

  // `cancelled` guards a slow response for an old company/period landing
  // after a newer one.
  const load = useCallback(
    (isCancelled = () => false) => {
      if (permsLoading || !canViewPage || !selectedCompany?.id) return;
      setLoading(true);
      setError(null);
      getDashboardKpis(selectedCompany.id, period)
        .then((res) => {
          if (!isCancelled()) setData(res);
        })
        .catch((err) => {
          if (isCancelled()) return;
          setError(err?.response?.data?.error || "The dashboard could not be loaded.");
        })
        .finally(() => {
          if (!isCancelled()) setLoading(false);
        });
    },
    [permsLoading, canViewPage, selectedCompany?.id, period],
  );

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (permsLoading)
    return (
      <div className="cc">
        <Skeleton />
      </div>
    );
  if (!canViewPage)
    return (
      <div className="cc">
        <AccessDeniedBanner displayName={displayName} reason="page" />
      </div>
    );
  if (!selectedCompany) {
    return (
      <div className="cc">
        <EmptyState icon={MdInfo} title="Pick a company">
          Use the company picker in the top bar to start.
        </EmptyState>
      </div>
    );
  }

  const flags = data?.permissions;
  const hasAnyKpi = !!(
    flags?.canViewSales ||
    flags?.canViewPurchases ||
    flags?.canViewFbr ||
    flags?.canViewInventory
  );
  const periodLabel = PERIOD_OPTIONS.find((p) => p.code === period)?.label || "";
  const showCompanyPicker = !topbarSwitcher && (companies?.length ?? 0) > 1;

  return (
    <div className="cc">
      <Hero
        eyebrow="Overview"
        title={
          <>
            Welcome back, <span className="cc-hero__accent">{displayName}</span>
          </>
        }
        subtitle={
          <>
            {selectedCompany?.name ? (
              <>
                <strong>{selectedCompany.name}</strong> ·{" "}
              </>
            ) : null}
            Showing <strong>{periodLabel}</strong>
          </>
        }
      >
        {showCompanyPicker && (
          <select
            className="cc-hero-select"
            aria-label="Company"
            value={selectedCompany?.id ?? ""}
            onChange={(e) => {
              const c = companies.find((cc) => cc.id === parseInt(e.target.value, 10));
              if (c) setSelectedCompany(c);
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="cc-hero-select"
          aria-label="Period"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
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
    can("challans.manage.create") && {
      label: "New delivery challan",
      to: "/challans?new=1",
      icon: MdLocalShipping,
    },
    can("bills.manage.create") && {
      label: "Bill delivered challans",
      to: "/bills?new=1",
      icon: MdPostAdd,
    },
    can("bills.manage.create.standalone") && {
      label: "Bill without challan",
      to: "/bills?new=standalone",
      icon: MdNoteAdd,
    },
    can("purchasebills.manage.create") && {
      label: "Record local purchase",
      to: "/purchase-bills?new=local",
      icon: MdAddShoppingCart,
    },
    can("accounting.receipts.create") && {
      label: "Record customer receipt",
      to: "/receipts?new=1",
      icon: MdCallReceived,
    },
    can("accounting.payments.create") && {
      label: "Record supplier payment",
      to: "/payments?new=1",
      icon: MdCallMade,
    },
    can("purchasebills.payables.view") && {
      label: "Supplier payables",
      to: "/supplier-payables",
      icon: MdMenuBook,
    },
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
    sales: reports
      ? reportHref("sales-invoice-register", range)
      : can("bills.list.view")
        ? "/bills"
        : null,
    purchases: reports
      ? reportHref("purchase-bill-register", range)
      : can("purchasebills.list.view")
        ? "/purchase-bills"
        : null,
    collections: reports
      ? reportHref("receipts-register", range)
      : can("accounting.receipts.view")
        ? "/receipts"
        : null,
    payments: reports
      ? reportHref("payments-register", range)
      : can("accounting.payments.view")
        ? "/payments"
        : null,
    gst: reports ? reportHref("tax-summary", range) : null,
    receivables: reports
      ? reportHref("aged-receivables", today)
      : can("reports.outstanding.view")
        ? "/reports/outstanding"
        : null,
    receivablesOverdue: reports
      ? reportHref("aged-receivables", { ...today, status: "overdue" })
      : can("reports.outstanding.view")
        ? "/reports/outstanding"
        : null,
    payables: reports
      ? reportHref("aged-payables", today)
      : can("purchasebills.payables.view")
        ? "/supplier-payables"
        : null,
    payablesOverdue: reports
      ? reportHref("aged-payables", { ...today, status: "overdue" })
      : can("purchasebills.payables.view")
        ? "/supplier-payables"
        : null,
    billChallans: can("bills.manage.create")
      ? "/bills?new=1"
      : can("challans.list.view")
        ? "/challans"
        : null,
    setupRequired: can("challans.list.view")
      ? `/challans?status=${encodeURIComponent("Setup Required")}`
      : null,
    notCosted: can("bills.list.view") ? "/bills?costingStatus=not-costed" : null,
    fbr: can("bills.list.view") ? "/invoices" : null,
  };
  const customerHref = (r) =>
    reports ? reportHref("customer-outstanding", { ...today, clientId: r.id }) : null;
  const supplierHref = (r) =>
    reports
      ? reportHref("supplier-outstanding", { ...today, supplierId: r.id })
      : can("purchasebills.payables.view")
        ? `/supplier-payables?supplierId=${r.id}`
        : null;

  const asAt = receivables?.asOf || payables?.asOf;
  const oldestDays = daysSince(work?.oldestAwaitingBillingDate);

  // 12-month sales vs purchases, one point per month. A month opens its sales
  // register when the caller can read reports.
  const trend = (sales?.trend12m || purchases?.trend12m || []).map((pt, i) => {
    const [y, m] = pt.month.split("-").map(Number);
    const to =
      reports && sales
        ? reportHref("sales-invoice-register", {
            period: "custom",
            from: ymd(new Date(y, m - 1, 1)),
            to: ymd(new Date(y, m, 0)),
          })
        : null;
    return {
      label: pt.label,
      short: pt.label,
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
            <Metric
              label="Sales"
              icon={MdAttachMoney}
              accent={accents.sales}
              value={fmtMoney(hero.totalSales)}
              delta={change(hero.totalSales, hero.totalSalesPrev)}
              sub={
                sales
                  ? `${plural(sales.invoiceCount, "bill")} · avg ${fmtMoney(sales.averageInvoiceValue)}`
                  : undefined
              }
              hint="Billed to customers (grand total incl. GST). Credit and debit notes, demo and voided bills are left out. Not profit."
              to={links.sales}
            />
          )}
          {flags.canViewPurchases && (
            <Metric
              label="Purchases"
              icon={MdShoppingCart}
              accent={accents.purchases}
              value={fmtMoney(hero.totalPurchases)}
              delta={change(hero.totalPurchases, hero.totalPurchasesPrev)}
              higherIsBetter={false}
              sub={
                purchases
                  ? `${plural(purchases.billCount, "bill")}${purchases.localPurchaseCount > 0 ? ` · ${fmtMoney(purchases.localPurchasesTotal)} local` : ""}`
                  : undefined
              }
              hint="Every purchase bill in the period, including local purchases booked from supplier costs on challans and bills — those are part of this total, not added to it."
              to={links.purchases}
            />
          )}
          {cash?.hasCollections && (
            <Metric
              label="Collected"
              icon={MdCallReceived}
              accent="#2e7d32"
              value={fmtMoney(cash.collections)}
              delta={change(cash.collections, cash.collectionsPrev)}
              sub={plural(cash.collectionCount, "receipt")}
              hint="Money received from customers in the period. Voided and bounced receipts are left out."
              to={links.collections}
            />
          )}
          {cash?.hasPayments && (
            <Metric
              label="Paid out"
              icon={MdCallMade}
              accent="#37474f"
              value={fmtMoney(cash.payments)}
              delta={change(cash.payments, cash.paymentsPrev)}
              higherIsBetter={false}
              sub={plural(cash.paymentCount, "payment")}
              hint="Money paid out in the period. Voided and bounced payments are left out."
              to={links.payments}
            />
          )}
          {flags.canViewSales && flags.canViewPurchases && (
            <Metric
              label="GST net"
              icon={MdAccountBalance}
              accent={accents.fbr}
              value={fmtMoney(hero.gstNet)}
              delta={change(hero.gstNet, hero.gstNetPrev)}
              higherIsBetter={false}
              sub={`Output ${fmtMoney(hero.gstOutput)} − input ${fmtMoney(hero.gstInput)}`}
              hint="Sales tax charged on sales less sales tax on purchases, from the documents."
              to={links.gst}
            />
          )}
        </MetricGrid>
      </Section>

      {/* ── Position — balances today ───────────────────────────────── */}
      {(receivables || payables || work) && (
        <Section title="Position" kind={asAt ? `As at ${fmtDate(asAt)}` : "Today"}>
          <MetricGrid>
            {receivables && (
              <Metric
                label="Customers owe you"
                icon={MdCallReceived}
                accent="#00897b"
                value={fmtMoney(receivables.total)}
                sub={
                  receivables.overdue > 0
                    ? `${fmtMoney(receivables.overdue)} overdue · ${plural(receivables.overduePartyCount, "customer")}`
                    : `${plural(receivables.partyCount, "customer")} · nothing overdue`
                }
                hint="Unpaid balance of sale bills, less tax withheld at source. A bill is overdue the day after its due date (its bill date when none is set)."
                to={links.receivables}
              />
            )}
            {payables && (
              <Metric
                label="You owe suppliers"
                icon={MdCallMade}
                accent="#e65100"
                value={fmtMoney(payables.total)}
                sub={
                  payables.overdue > 0
                    ? `${fmtMoney(payables.overdue)} overdue · ${plural(payables.overduePartyCount, "supplier")}`
                    : `${plural(payables.partyCount, "supplier")} · nothing overdue`
                }
                hint="Unpaid balance of purchase bills (local purchases included), less tax you withheld."
                to={links.payables}
              />
            )}
            {work && (
              <Metric
                label="Challans to bill"
                icon={MdLocalShipping}
                accent="#f57c00"
                value={work.challansAwaitingBilling.toLocaleString("en-PK")}
                sub={
                  work.challansAwaitingBilling > 0
                    ? `Oldest ${fmtDate(work.oldestAwaitingBillingDate)}${oldestDays != null ? ` · ${plural(oldestDays, "day")}` : ""}`
                    : "Everything delivered is billed"
                }
                hint="Delivered challans not yet on a bill. They are not sales until billed, so they are not counted in Sales."
                to={work.challansAwaitingBilling > 0 ? links.billChallans : null}
              />
            )}
          </MetricGrid>
        </Section>
      )}

      {/* ── Trend + attention ───────────────────────────────────────── */}
      <div className="cc-split cc-split--wide cc-gap-top--lg">
        {trendBars.length > 0 && (
          <Panel title="Sales and purchases" kind="Last 12 months">
            <TrendChart
              points={trend}
              bars={trendBars}
              ariaLabel="Monthly sales and purchases for the last 12 months"
            />
            {reports && sales && (
              <p className="cc-note">Select a month to open its sales register.</p>
            )}
          </Panel>
        )}
        <Panel title="Needs attention">
          <AttentionList
            items={attentionItems({
              receivables,
              payables,
              work,
              fbr,
              links,
              oldestDays,
              canCosts: can("bills.costs.view"),
              periodLabel,
            })}
          />
        </Panel>
      </div>

      {/* ── Who owes / whom you owe ─────────────────────────────────── */}
      {(receivables || payables) && (
        <div className="cc-split cc-gap-top">
          {receivables && (
            <Panel
              title="Largest customer balances"
              kind="Today"
              action={<HeadLink to={links.receivables}>Full aging</HeadLink>}
            >
              <PartyTable
                rows={receivables.top}
                hrefFor={customerHref}
                emptyText="No customer owes anything."
                columns={[
                  { key: "name", label: "Customer" },
                  { key: "total", label: "Owed", money: true },
                  {
                    key: "overdue",
                    label: "Overdue",
                    money: true,
                    tone: (r) => (r.overdue > 0 ? "bad" : undefined),
                  },
                ]}
              />
            </Panel>
          )}
          {payables && (
            <Panel
              title="Largest supplier balances"
              kind="Today"
              action={<HeadLink to={links.payables}>Full aging</HeadLink>}
            >
              <PartyTable
                rows={payables.top}
                hrefFor={supplierHref}
                emptyText="Nothing is owed to suppliers."
                columns={[
                  { key: "name", label: "Supplier" },
                  { key: "total", label: "Owed", money: true },
                  {
                    key: "overdue",
                    label: "Overdue",
                    money: true,
                    tone: (r) => (r.overdue > 0 ? "bad" : undefined),
                  },
                ]}
              />
            </Panel>
          )}
        </div>
      )}

      {/* ── Counterparty breakdown for the period ───────────────────── */}
      {(sales || purchases) && (
        <div className="dash-section-grid" style={styles.sectionGrid}>
          {sales && (
            <ByCounterpartyCard
              items={sales.topClients}
              total={sales.totalSales}
              accent={accents.sales}
              title="Sales by Client"
              subtitle={`Top ${Math.min(20, (sales.topClients || []).length)} clients · ${periodLabel} total Rs. ${formatPkrCompact(sales.totalSales)}`}
              emptyText="No invoiced clients in this period."
            />
          )}
          {purchases && (
            <ByCounterpartyCard
              items={purchases.topSuppliers}
              total={purchases.totalPurchases}
              accent={accents.purchases}
              title="Purchases by Supplier"
              subtitle={`Top ${Math.min(20, (purchases.topSuppliers || []).length)} suppliers · ${periodLabel} total Rs. ${formatPkrCompact(purchases.totalPurchases)}`}
              emptyText="No supplier activity in this period."
            />
          )}
        </div>
      )}

      {/* ── Detail sections (unchanged) ──────────────────────────────
          Each "Open" link is gated by the destination screen's own view
          permission, so it never 403s. */}
      <div className="dash-section-grid" style={styles.sectionGrid}>
        {sales && (
          <SalesSection
            data={sales}
            canOpen={can("invoices.list.view") || can("bills.list.view")}
          />
        )}
        {purchases && (
          <PurchasesSection data={purchases} canOpen={can("purchasebills.list.view")} />
        )}
        {fbr && <FbrSection data={fbr} />}
        {data.inventory && (
          <InventorySection data={data.inventory} canOpen={can("stock.dashboard.view")} />
        )}
      </div>
    </>
  );
}

/**
 * The attention list, most urgent first: money past due (largest first), then
 * work blocking a sale, then housekeeping. Each item names what, why, how
 * much, and opens the records to act on. Built only from server figures.
 */
function attentionItems({
  receivables,
  payables,
  work,
  fbr,
  links,
  oldestDays,
  canCosts,
  periodLabel,
}) {
  const items = [];
  if (receivables?.overdue > 0) {
    items.push({
      rank: receivables.over90 > 0 ? 0 : 1,
      amount: receivables.overdue,
      tone: receivables.over90 > 0 ? "danger" : "warn",
      title: `${plural(receivables.overduePartyCount, "customer")} past due`,
      why:
        receivables.over90 > 0
          ? `${fmtMoney(receivables.over90)} is more than 90 days late. Follow up for collection.`
          : "Bills past their due date. Follow up for collection.",
      figure: fmtMoney(receivables.overdue),
      actionLabel: "See who",
      to: links.receivablesOverdue,
    });
  }
  if (payables?.overdue > 0) {
    items.push({
      rank: payables.over90 > 0 ? 0 : 1,
      amount: payables.overdue,
      tone: payables.over90 > 0 ? "danger" : "warn",
      title: `${plural(payables.overduePartyCount, "supplier")} awaiting payment`,
      why:
        payables.over90 > 0
          ? `${fmtMoney(payables.over90)} is more than 90 days past due.`
          : "Purchase bills past their due date.",
      figure: fmtMoney(payables.overdue),
      actionLabel: "Review",
      to: links.payablesOverdue,
    });
  }
  if (work?.challansAwaitingBilling > 0) {
    items.push({
      rank: oldestDays != null && oldestDays > 7 ? 1 : 2,
      amount: 0,
      tone: oldestDays != null && oldestDays > 7 ? "warn" : "info",
      title: `${plural(work.challansAwaitingBilling, "challan")} waiting to be billed`,
      why: `Goods delivered but not billed${oldestDays != null ? `; the oldest is ${plural(oldestDays, "day")} old` : ""}.`,
      actionLabel: "Bill now",
      to: links.billChallans,
    });
  }
  if (work?.challansSetupRequired > 0) {
    items.push({
      rank: 2,
      amount: 0,
      tone: "warn",
      title: `${plural(work.challansSetupRequired, "challan")} need FBR setup`,
      why: "FBR details are missing on the company or the client, so these cannot be filed once billed.",
      actionLabel: "Open",
      to: links.setupRequired,
    });
  }
  if (canCosts && work?.billsWithoutCost > 0) {
    items.push({
      rank: 3,
      amount: 0,
      tone: "info",
      title: `${plural(work.billsWithoutCost, "bill")} with no actual cost`,
      why: `${periodLabel}: no line has its cost entered, so profit on these bills is not known yet.`,
      actionLabel: "Add costs",
      to: links.notCosted,
    });
  }
  if (fbr?.failed > 0) {
    items.push({
      rank: 1,
      amount: 0,
      tone: "danger",
      title: `${plural(fbr.failed, "invoice")} failed at FBR`,
      why: `${periodLabel}: rejected on validation or submission. Fix and resubmit.`,
      actionLabel: "Open invoices",
      to: links.fbr,
    });
  }
  return items.sort((a, b) => a.rank - b.rank || b.amount - a.amount);
}

// ── Gates and empty states ─────────────────────────────────────────────
//
// Kit EmptyState (boxed): surface, line, radius and type follow the theme.

function WelcomeOnlyBanner({ displayName }) {
  return (
    <EmptyState icon={MdInfo} title={`Welcome back, ${displayName}`}>
      Your role doesn't include any dashboard KPI permissions yet. Ask an admin to grant Sales,
      Purchases, FBR, or Inventory KPI access to see metrics here.
    </EmptyState>
  );
}

function AccessDeniedBanner({ displayName }) {
  return (
    <EmptyState icon={MdLock} title="No dashboard access">
      Hi {displayName}, your role doesn't have permission to view the dashboard. Use the sidebar to
      navigate to a section you have access to.
    </EmptyState>
  );
}

// ── Sections ───────────────────────────────────────────────────────
//
// Kit Card: surface, border, radius, shadow, head and body padding come from
// the theme tokens. The accent only tints the icon tile and the Open link.

function SectionCard({ title, accent, icon, children, headerExtra = null }) {
  const Icon = icon;
  const cardTitle = (
    <>
      <span
        className="dash-section-card__header-icon"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: "var(--k-radius)",
          background: `${accent}12`,
          border: `1px solid ${accent}2e`,
          color: accent,
          flexShrink: 0,
        }}
      >
        <Icon size={17} />
      </span>
      {title}
    </>
  );
  return (
    <Card
      className="dash-card"
      title={cardTitle}
      actions={headerExtra}
      style={{
        "--acc": accent,
        marginTop: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>{children}</div>
    </Card>
  );
}

function SalesSection({ data, canOpen = false }) {
  return (
    <SectionCard
      title="Sales"
      accent={accents.sales}
      icon={MdReceipt}
      headerExtra={
        canOpen ? (
          <Link
            to="/invoices"
            className="dash-section-card__open"
            style={styles.headerLink}
            title="Open Invoices page"
          >
            <MdOpenInNew size={14} /> <span className="dash-section-card__open-label">Open</span>
          </Link>
        ) : null
      }
    >
      <div className="dash-meta-row" style={styles.metaRow}>
        <Stat label="Invoices" value={data.invoiceCount} />
        <Stat label="Avg Invoice" value={formatPkr(data.averageInvoiceValue)} />
        <Stat label="Total" value={formatPkr(data.totalSales)} highlight />
      </div>

      <div>
        <div style={styles.subHeading}>Recent Invoices</div>
        {(data.recentInvoices || []).length === 0 ? (
          <EmptyLine>No recent invoices in this period.</EmptyLine>
        ) : (
          <RecentList rows={data.recentInvoices} />
        )}
      </div>
    </SectionCard>
  );
}

function PurchasesSection({ data, canOpen = false }) {
  return (
    <SectionCard
      title="Purchases"
      accent={accents.purchases}
      icon={MdShoppingCart}
      headerExtra={
        canOpen ? (
          <Link
            to="/purchase-bills"
            className="dash-section-card__open"
            style={{
              ...styles.headerLink,
              color: accents.purchases,
              borderColor: accents.purchases,
            }}
            title="Open Purchase Bills page"
          >
            <MdOpenInNew size={14} /> <span className="dash-section-card__open-label">Open</span>
          </Link>
        ) : null
      }
    >
      <div className="dash-meta-row" style={styles.metaRow}>
        <Stat label="Bills" value={data.billCount} />
        <Stat label="Avg Bill" value={formatPkr(data.averageBillValue)} />
        <Stat label="Total" value={formatPkr(data.totalPurchases)} highlight />
      </div>

      <div>
        <div style={styles.subHeading}>Recent Purchase Bills</div>
        {(data.recentBills || []).length === 0 ? (
          <EmptyLine>No recent purchase bills in this period.</EmptyLine>
        ) : (
          <RecentList rows={data.recentBills} />
        )}
      </div>
    </SectionCard>
  );
}

function FbrSection({ data }) {
  // FBR section visualises a small funnel — pending → validated →
  // submitted, with failed as a separate signal. Reconciliation is
  // the bottom row. The stage colours are a status palette, not theme.
  return (
    <SectionCard title="FBR / Compliance" accent={accents.fbr} icon={MdCloudDone}>
      <div className="dash-funnel-grid" style={styles.fbrGrid}>
        <Funnel
          label="Pending"
          value={data.pendingSubmission}
          color="#f57c00"
          icon={MdHourglassEmpty}
        />
        <Funnel label="Validated" value={data.validated} color="#0277bd" icon={MdCheckCircle} />
        <Funnel label="Submitted" value={data.submitted} color="#2e7d32" icon={MdCloudDone} />
        <Funnel label="Failed" value={data.failed} color="#c62828" icon={MdError} />
      </div>

      {data.excluded > 0 && (
        <div
          style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", paddingLeft: "0.25rem" }}
        >
          <strong>{data.excluded}</strong> bill{data.excluded !== 1 ? "s" : ""} excluded from bulk
          submit (operator marked as skip).
        </div>
      )}

      <div>
        <div style={styles.subHeading}>Reconciliation (Annexure-A vs Purchase Bills)</div>
        <div style={styles.reconRow}>
          <ReconChip label="Pending" value={data.reconciliationPending} color="#f57c00" />
          <ReconChip label="Matched" value={data.reconciliationMatched} color="#2e7d32" />
          <ReconChip label="Disputed" value={data.reconciliationDisputed} color="#c62828" />
        </div>
      </div>
    </SectionCard>
  );
}

function InventorySection({ data, canOpen = false }) {
  return (
    <SectionCard
      title="Inventory"
      accent={accents.inventory}
      icon={MdInventory}
      headerExtra={
        canOpen ? (
          <Link
            to="/stock"
            className="dash-section-card__open"
            style={{
              ...styles.headerLink,
              color: accents.inventory,
              borderColor: accents.inventory,
            }}
            title="Open Stock Dashboard"
          >
            <MdOpenInNew size={14} /> <span className="dash-section-card__open-label">Open</span>
          </Link>
        ) : null
      }
    >
      <div className="dash-meta-row" style={styles.metaRow}>
        <Stat label="Stock value" value={formatPkr(data.totalStockValue)} highlight />
        <Stat label="Items tracked" value={data.trackedItemCount} />
        <Stat label="Low stock" value={data.lowStockItemCount} warn={data.lowStockItemCount > 0} />
      </div>

      <div>
        <div style={styles.subHeading}>Top movers (last 30 days)</div>
        <TopList
          items={data.topItemsByMovement}
          accent={accents.inventory}
          valueMode="qty"
          secondary={(it) => `${it.count} movement${it.count !== 1 ? "s" : ""}`}
          emptyText="No stock movements in the last 30 days."
        />
      </div>

      <div>
        <div style={styles.subHeading}>Recent Movements</div>
        {(data.recentMovements || []).length === 0 ? (
          <EmptyLine>No recent stock movements.</EmptyLine>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {data.recentMovements.map((m, i) => (
              <div key={`${m.id}-${i}`} className="dash-mov-row" style={styles.listRow}>
                <span
                  style={{
                    ...styles.miniChip,
                    color: m.direction === "In" ? "#15803d" : "var(--k-danger)",
                    backgroundColor:
                      m.direction === "In"
                        ? "rgba(21,128,61,0.10)"
                        : "color-mix(in srgb, var(--k-danger) 9%, transparent)",
                  }}
                >
                  {m.direction}
                </span>
                <span className="dash-mov-row__name" style={styles.listName}>
                  {m.itemTypeName}
                </span>
                <span className="dash-mov-row__qty" style={styles.listFigure}>
                  {m.quantity}
                </span>
                <span style={styles.listMeta}>{formatDate(m.date)}</span>
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
      <div className="dash-stat-label" style={styles.statLabel}>
        {label}
      </div>
      <div
        className="dash-stat-value"
        style={{
          ...styles.statValue,
          color: warn ? "var(--k-danger)" : highlight ? "var(--k-ink)" : "var(--k-muted)",
          fontWeight: highlight ? 700 : 500,
        }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function Funnel({ label, value, color, icon }) {
  const Icon = icon;
  return (
    <div
      className="dash-funnel-card"
      style={{
        ...styles.funnelCard,
        borderColor: `${color}33`,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "calc(var(--k-radius) - 2px)",
          background: `${color}12`,
          border: `1px solid ${color}2e`,
          color,
        }}
      >
        <Icon size={15} />
      </div>
      <div
        style={{
          fontSize: "0.64rem",
          color: "var(--k-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600,
          fontFamily: MONO,
        }}
      >
        {label}
      </div>
      <div
        className="dash-funnel-card__value"
        style={{
          fontFamily: MONO,
          fontVariantNumeric: "tabular-nums",
          fontSize: "var(--k-stat-value)",
          fontWeight: 600,
          color,
        }}
      >
        {value || 0}
      </div>
    </div>
  );
}

function ReconChip({ label, value, color }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.45rem",
        padding: "0.3rem 0.75rem",
        borderRadius: 999,
        border: `1px solid ${color}40`,
        backgroundColor: `${color}0d`,
      }}
    >
      <span style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", fontWeight: 600 }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontVariantNumeric: "tabular-nums",
          fontSize: "var(--k-td-font)",
          fontWeight: 600,
          color,
        }}
      >
        {value || 0}
      </span>
    </div>
  );
}

function RecentList({ rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      {rows.map((r, i) => (
        <div
          key={`${r.id}-${i}`}
          className="dash-recent-row"
          style={{ ...styles.listRow, flexWrap: "wrap" }}
        >
          <span
            className="dash-recent-row__number"
            style={{ ...styles.listMeta, fontFamily: MONO, fontSize: "0.75rem", flexShrink: 0 }}
          >
            #{r.number}
          </span>
          <span className="dash-recent-row__name" style={styles.listName}>
            {r.counterpartyName || "(unknown)"}
          </span>
          <span className="dash-recent-row__date" style={{ ...styles.listMeta, flexShrink: 0 }}>
            {formatDate(r.date)}
          </span>
          <span className="dash-recent-row__amount" style={{ ...styles.listFigure, flexShrink: 0 }}>
            {formatPkr(r.grandTotal)}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ children }) {
  return (
    <div style={{ fontSize: "var(--k-font)", color: "var(--k-muted)", fontStyle: "italic" }}>
      {children}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────
//
// Mobile-first: all grids use auto-fit/minmax so they collapse to one
// column on small screens without needing media queries. Colours, radii,
// borders and type sizes read the kit's --k-* tokens (ui/kit.css) so the
// sections follow the selected theme; --cc-gap comes from CommandCenter.css.

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const styles = {
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
    gap: "var(--cc-gap)",
    marginTop: "var(--cc-gap)",
  },
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--cc-gap)",
    paddingBottom: "0.6rem",
    borderBottom: "1px dashed var(--k-line)",
  },
  statLabel: {
    fontFamily: MONO,
    fontSize: "0.62rem",
    color: "var(--k-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 600,
    marginBottom: "0.2rem",
  },
  statValue: {
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
    fontSize: "var(--k-font)",
  },
  subHeading: {
    fontFamily: MONO,
    fontSize: "0.66rem",
    color: "var(--k-faint)",
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
    background: "var(--k-surface-2)",
    border: "1px solid",
    borderRadius: "var(--k-radius)",
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
  // One row of the Recent Invoices / Bills / Movements lists.
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    fontSize: "var(--k-td-font)",
    padding: "0.45rem 0.6rem",
    background: "var(--k-surface-2)",
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
  },
  // Counterparty / item names are user-supplied: 2-line clamp, never
  // nowrap + ellipsis (similar-prefix names must stay distinguishable).
  listName: {
    flex: 1,
    minWidth: 0,
    fontWeight: 600,
    color: "var(--k-ink)",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    wordBreak: "break-word",
    lineHeight: 1.3,
  },
  listFigure: {
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    color: "var(--k-ink)",
  },
  listMeta: {
    color: "var(--k-muted)",
    fontSize: "0.73rem",
  },
  headerLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    minHeight: 44,
    padding: "0.3rem 0.6rem",
    borderRadius: "var(--k-radius)",
    border: "1px solid var(--k-line-strong)",
    color: "var(--k-blue)",
    backgroundColor: "var(--k-surface)",
    fontSize: "var(--k-font-sm)",
    fontWeight: 600,
    textDecoration: "none",
    flexShrink: 0,
  },
};
