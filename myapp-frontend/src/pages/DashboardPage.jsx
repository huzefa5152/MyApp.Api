// src/pages/DashboardPage.jsx
//
// The Overview dashboard (spec 2026-10-18 §4-§5): header, data-health banner,
// tile groups (Sales & margin, Cash & balances, Payable to FBR, Stock health),
// four charts, then the recent-invoices / FBR-status lists.
//
// The rule every figure keeps: clicking it opens KpiDrilldown, whose rows add
// up to the figure on the card (cardValue is that figure; see overviewData.js).
// A tile whose figure has no matching breakdown has no drill.
//
// Permission shape: GET /api/dashboard/kpis returns only the sections the
// caller may see (sales / purchases / fbr / inventory are nullable) plus the
// permission flags; a section or tile the user cannot see does not render.
// The tax panel is its own request and its 403 message is shown in its place.
//
// Drill state lives in the URL (?drill=&group=, plus ?dperiod= for a chart
// month opened outside the page's period) so Back from "Open bill" reopens it.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  MdReceipt, MdShoppingCart, MdInventory, MdCloudDone, MdHourglassEmpty, MdError,
  MdCheckCircle, MdLock, MdOpenInNew, MdInfo, MdAttachMoney, MdLocalShipping,
  MdRequestQuote, MdSavings, MdAssignmentReturn, MdWarehouse, MdPayments, MdTrendingUp,
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getDashboardKpis, getDashboardTaxPosition } from "../api/dashboardApi";
import KpiCard from "../Components/dashboard/KpiCard";
import KpiGroup from "../Components/dashboard/KpiGroup";
import KpiDrilldown from "../Components/dashboard/KpiDrilldown";
import useDrillState from "../Components/dashboard/useDrillState";
import DashboardHeader from "../Components/dashboard/DashboardHeader";
import HealthBanner from "../Components/dashboard/HealthBanner";
import ChartCard from "../Components/dashboard/ChartCard";
import TaxPositionPanel from "../Components/dashboard/TaxPositionPanel";
import TopList from "../Components/dashboard/TopList";
import BarLineChart from "../Components/dashboard/charts/BarLineChart";
import StackedBarChart from "../Components/dashboard/charts/StackedBarChart";
import HBarChart from "../Components/dashboard/charts/HBarChart";
import { chartPalette, formatMoneyShort } from "../Components/dashboard/chartTheme";
import {
  drillCardValue, monthlySeries, taxMonthSeries, topCustomers, ageingSeries, ageingTotal, hasAny, monthRange,
} from "../Components/dashboard/overviewData";
import "./DashboardPage.css";

const STORE = { period: "dashboardPeriod", from: "dashboardFrom", to: "dashboardTo" };
const PERIOD_IDS = ["this-week", "last-week", "this-month", "last-month", "this-year", "last-year", "all-time", "custom"];

function load(key) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key, v) { try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key); } catch { /* private window */ } }

const exact = (v) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 }));
const money = (v) => (v == null || isNaN(v) ? "—" : `Rs. ${exact(v)}`);
const count = (v) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("en-PK"));
const pct = (v) => (v == null || isNaN(v) ? "—" : `${Number(v).toFixed(1)}%`);
function formatDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-PK", { day: "2-digit", month: "short" }); } catch { return s; }
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { selectedCompany, companies, setSelectedCompany } = useCompany();
  const { has, loading: permsLoading } = usePermissions();

  const [range, setRange] = useState(() => {
    const p = load(STORE.period);
    return { period: PERIOD_IDS.includes(p) ? p : "this-month", from: load(STORE.from) || "", to: load(STORE.to) || "" };
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [asOf, setAsOf] = useState("");
  const [reload, setReload] = useState(0);
  const [tax, setTax] = useState({ data: null, loading: false, error: null });
  const [taxReload, setTaxReload] = useState(0);

  // Resume a drill from the URL (Back from "Open bill" lands here).
  const { drill, openDrill, closeDrill } = useDrillState();

  const canViewPage = has?.("dashboard.view") ?? false;
  const displayName = user?.name || user?.username || "there";
  const companyId = selectedCompany?.id;
  const ready = range.period !== "custom" || (range.from && range.to);

  useEffect(() => {
    save(STORE.period, range.period);
    save(STORE.from, range.from);
    save(STORE.to, range.to);
  }, [range]);

  useEffect(() => {
    if (permsLoading || !canViewPage || !companyId || !ready) return;
    let cancelled = false;
    // A new company or period must never show the old one's figures under its header.
    setLoading(true); setError(null); setData(null);
    getDashboardKpis(companyId, range)
      .then((res) => { if (!cancelled) { setData(res); setAsOf(new Date().toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })); } })
      .catch(() => { if (!cancelled) setError("Could not load the dashboard."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [permsLoading, canViewPage, companyId, range, ready, reload]);

  const canSales = !!data?.permissions?.canViewSales;
  useEffect(() => {
    if (!canSales || !companyId || !ready) { setTax({ data: null, loading: false, error: null }); return; }
    let cancelled = false;
    setTax({ data: null, loading: true, error: null });
    getDashboardTaxPosition(companyId, range)
      .then((d) => { if (!cancelled) setTax({ data: d, loading: false, error: null }); })
      .catch((e) => {
        if (cancelled) return;
        const body = e?.response?.data;
        const msg = e?.response?.status === 403
          ? (body?.message || body?.error || "You do not have access to the tax position.")
          : "Could not load the tax position.";
        setTax({ data: null, loading: false, error: msg, denied: e?.response?.status === 403 });
      });
    return () => { cancelled = true; };
  }, [canSales, companyId, range, ready, taxReload]);

  if (permsLoading) return <Shell><LoadingShimmer /></Shell>;
  if (!canViewPage) return <Shell><AccessDeniedBanner displayName={displayName} /></Shell>;
  if (!selectedCompany) return <Shell><EmptyState heading="Pick a company" body="Use the company picker in the top bar to start." /></Shell>;

  const flags = data?.permissions;
  const hasAnyKpi = !!(flags?.canViewSales || flags?.canViewPurchases || flags?.canViewFbr || flags?.canViewInventory);
  const drillPeriod = drill?.period || range.period;

  return (
    <Shell>
      {/* Pinned while the figures scroll (.page-sticky-head). */}
      <div className="page-sticky-head">
      <DashboardHeader
        company={selectedCompany}
        companies={companies}
        onCompanyChange={(id) => { const c = companies.find((cc) => cc.id === id); if (c) setSelectedCompany(c); }}
        period={range.period} from={range.from} to={range.to}
        onChange={(r) => setRange({ period: r.period, from: r.from || "", to: r.to || "" })}
        asOf={data ? asOf : ""}
      />
      </div>

      {!ready && <EmptyState heading="Choose the dates" body="Pick a From and a To date for the custom range." />}

      {error && (
        <ChartCard title="Dashboard" error={error} onRetry={() => setReload((n) => n + 1)} height={120} />
      )}

      {loading && !data && <LoadingShimmer />}

      {!loading && data && !hasAnyKpi && <WelcomeOnlyBanner displayName={displayName} />}

      {data && hasAnyKpi && (
        <Overview
          data={data} tax={tax} onTaxRetry={() => setTaxReload((n) => n + 1)}
          has={has} openDrill={openDrill}
        />
      )}

      {data && (
        <KpiDrilldown
          open={!!drill}
          onClose={closeDrill}
          kind={drill?.kind}
          initialGroupKey={drill?.groupKey || null}
          period={drillPeriod}
          from={drill?.period ? drill.from || undefined : range.from}
          to={drill?.period ? drill.to || undefined : range.to}
          companyId={companyId}
          cardValue={drillCardValue(drill, { hero: data.hero, health: data.health, tax: tax.data })}
        />
      )}
    </Shell>
  );
}

// ── The page body ───────────────────────────────────────────────────

function Overview({ data, tax, onTaxRetry, has, openDrill }) {
  const p = chartPalette();
  const hero = data.hero || {};
  const flags = data.permissions || {};
  const sales = data.sales;

  const showSales = !!flags.canViewSales;
  // Payables, stock and recoverables are not sales figures: the server sends
  // them with the hero (sales OR purchases KPI), so that is their gate.
  const hasHero = !!data.hero;
  const showStock = hasHero && !!hero.hasStock;
  const showPayables = hasHero && (hero.payablesTotal || 0) !== 0;
  const showReceivables = showSales && (hero.receivablesScopeRestricted || (hero.receivablesTotal || 0) !== 0);
  const showRecoverable = hasHero && (hero.recoverableTaxTotal || 0) !== 0;
  // Every drill reads /api/dashboard/breakdown (dashboard.view); no key, no clickable figure.
  const canDrill = has("dashboard.view");
  const drillTo = (kind, opts) => (canDrill ? () => openDrill(kind, opts) : null);
  const onBar = (fn) => (canDrill ? fn : undefined);

  if (hero.hasAnyActivity === false) {
    return (
      <section style={{ ...styles.card, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem", padding: "2.4rem 1.2rem", textAlign: "center" }} aria-label="No activity yet">
        <MdWarehouse size={30} style={{ color: "var(--dash-text)" }} />
        <div style={{ fontSize: "1.02rem", fontWeight: 600, color: "var(--dash-ink)" }}>No activity yet</div>
        <div style={{ color: "var(--dash-text)", fontSize: "0.86rem", maxWidth: 460, lineHeight: 1.5 }}>
          This company is set up but has no stock, bills or invoices. Import an opening stock sheet or raise
          the first bill, and the figures will appear here.
        </div>
      </section>
    );
  }

  const monthly = monthlySeries(data.monthly);
  const taxMonths = taxMonthSeries(tax.data?.months);
  const customers = topCustomers(sales?.topClients);
  const ageing = ageingSeries(hero);
  const uncosted = hero.uncostedItemCount || 0;

  return (
    <>
      <HealthBanner items={data.health} onDrill={canDrill ? (key) => openDrill(key) : null} />

      {showSales && (
        <KpiGroup title="Sales & margin">
          <KpiCard
            label="Net sales" value={hero.netSales} prevValue={hero.netSalesPrev} format={money} accent={p.primary}
            icon={<MdAttachMoney size={16} />}
            trend={monthly.length ? monthly.map((m) => ({ value: m.netSales })) : null}
            secondLine={`Incl. tax ${money(hero.salesInclTax)}`}
            howCalculated="Sale invoices excluding tax, less credit notes, plus debit notes. Cancelled, demo and FBR-cancelled bills are left out."
            onDrillDown={drillTo("sales")}
          />
          <KpiCard
            label="Landed cost of sales" value={hero.landedCostOfSales} format={money} accent={p.secondary}
            icon={<MdLocalShipping size={16} />} higherIsBetter={false}
            secondLine={uncosted > 0 ? `${uncosted} item${uncosted === 1 ? "" : "s"} sold with no landed cost (counted at zero)` : null}
            howCalculated="What the goods that left stock in the period actually cost (landed), from the stock walk."
            onDrillDown={drillTo("cogs-landed")}
          />
          <KpiCard
            label="Gross margin (landed)" value={hero.grossMarginLanded} format={money} accent={p.positive}
            icon={<MdTrendingUp size={16} />}
            badge={uncosted > 0 ? `${uncosted} uncosted` : null}
            secondLine={hero.grossMarginLandedPct == null ? "No sales in the period" : `${pct(hero.grossMarginLandedPct)} of net sales`}
            howCalculated={"Net sales less landed cost of sales." + (uncosted > 0 ? " Items sold with no landed cost overstate it." : "")}
            onDrillDown={drillTo("margin-landed")}
          />
          {sales && (
            <KpiCard
              label="Invoices" value={sales.invoiceCount} format={count} accent={p.primary}
              icon={<MdReceipt size={16} />}
              secondLine={`Average invoice ${money(sales.averageInvoiceValue)}`}
              howCalculated="Number of sale invoices in the period; the average is net of notes divided by that count."
            />
          )}
        </KpiGroup>
      )}

      {(showSales || showPayables || showStock || showRecoverable) && (
        <KpiGroup title="Cash & balances">
          {showReceivables && <KpiCard
            label="Receivables"
            value={hero.receivablesScopeRestricted ? null : hero.receivablesTotal}
            format={hero.receivablesScopeRestricted ? () => "—" : money}
            accent={p.primary} icon={<MdRequestQuote size={16} />} higherIsBetter={false}
            subValue={hero.receivablesScopeRestricted
              ? "Company-wide figure — not available for division-restricted access"
              : null}
            secondLine={hero.receivablesScopeRestricted ? null : `236G/H billed in period ${money(hero.receivablesAdvanceTaxBilled)}`}
            howCalculated="Customer balances from the aged receivables report, all time, net of receipts on account. 236G/H advance tax is shown separately."
            onDrillDown={hero.receivablesScopeRestricted ? null : drillTo("receivables")}
          />}
          {showSales && <KpiCard
            label="Received in period" value={hero.receivedInPeriod} format={money} accent={p.positive}
            icon={<MdPayments size={16} />}
            howCalculated="Customer receipts dated in the period, cancelled receipts left out."
          />}
          {showPayables && (
            <KpiCard
              label="Payables" value={hero.payablesTotal} format={money} accent={p.negative}
              icon={<MdAssignmentReturn size={16} />} higherIsBetter={false}
              subValue={[
                (hero.payablesTax || 0) !== 0 ? `tax ${money(hero.payablesTax)}` : null,
                (hero.payablesTrade || 0) !== 0 ? `suppliers ${money(hero.payablesTrade)}` : null,
                (hero.payablesImportClearing || 0) !== 0 ? `import clearing ${money(hero.payablesImportClearing)}` : null,
              ].filter(Boolean).join("  ·  ") || null}
              howCalculated="Everything owed from the ledger: tax payable, trade creditors and unsettled import clearing."
              onDrillDown={drillTo("payables")}
            />
          )}
          {showStock && (
            <KpiCard
              label="Stock on hand" value={hero.stockOnHandValue} format={money} accent={p.warn}
              icon={<MdWarehouse size={16} />}
              secondLine={`Landed ${money(hero.stockOnHandLanded)} · a position, not a period`}
              howCalculated="Declared value of the goods in the warehouse now, from the stock walk; the second line is the same goods at landed cost. The breakdown is declared."
              onDrillDown={drillTo("stock-on-hand")}
            />
          )}
          {showRecoverable && (
            <KpiCard
              label="Recoverable from FBR" value={hero.recoverableTaxTotal} format={money} accent={p.secondary}
              icon={<MdSavings size={16} />}
              subValue={[
                (hero.recoverableInputTax || 0) !== 0 ? `input tax ${money(hero.recoverableInputTax)}` : null,
                (hero.recoverableAdvanceIncomeTax || 0) !== 0 ? `adv. income tax ${money(hero.recoverableAdvanceIncomeTax)}` : null,
              ].filter(Boolean).join("  ·  ") || null}
              howCalculated="Input sales tax and advance income tax paid at import — credited back, not owed."
              onDrillDown={drillTo("recoverable-tax")}
            />
          )}
        </KpiGroup>
      )}

      {showSales && (
        <section style={{ marginBottom: "1.25rem" }}>
          <h3 style={styles.groupTitle}>Payable to FBR</h3>
          <div style={styles.chartGrid}>
            {tax.data
              ? <TaxPositionPanel data={tax.data} onDrill={canDrill ? (line) => openDrill("tax-payable", { groupKey: line }) : null} />
              : <ChartCard title="Tax position" loading={tax.loading} error={tax.error} onRetry={tax.denied ? null : onTaxRetry} height={200} />}
            {!tax.denied && (
              <ChartCard
                title="Tax by month" subtitle="Output tax, further tax and 236G/H; input tax claimed below the line. Click a month for the lines."
                loading={tax.loading} error={tax.error ? "Could not load the tax position." : null} onRetry={onTaxRetry}
                empty={!hasAny(taxMonths, ["output", "further", "adv236", "input"])}
              >
                <StackedBarChart
                  data={taxMonths} ariaLabel="Tax by month: output tax, further tax, 236G/H and input tax claimed"
                  series={[
                    { key: "output", label: "Output tax", colorKey: "primary" },
                    { key: "further", label: "Further tax", colorKey: "secondary" },
                    { key: "adv236", label: "236G/H", colorKey: "warn" },
                    { key: "input", label: "Input tax claimed", colorKey: "negative" },
                  ]}
                  onBarClick={onBar((d) => { const r = monthRange(d?.month); if (r) openDrill("tax-payable", { period: "custom", ...r }); })}
                />
              </ChartCard>
            )}
          </div>
        </section>
      )}

      {showStock && (
        <KpiGroup title="Stock health">
          <KpiCard
            label="Dead stock" value={hero.deadStockValue} format={money} accent={p.negative}
            icon={<MdWarehouse size={16} />} higherIsBetter={false}
            secondLine={`${count(hero.deadStockItemCount)} item${hero.deadStockItemCount === 1 ? "" : "s"} never sold`
              + (hero.deadStockPercent != null ? ` · ${pct(hero.deadStockPercent)} of stock` : "")}
            howCalculated="Declared value of items still held that have never gone out once."
            onDrillDown={drillTo("dead-stock")}
          />
          <KpiCard
            label="Stock sitting 90+ days" value={hero.stockAgeOver90} format={money} accent={p.warn}
            icon={<MdHourglassEmpty size={16} />} higherIsBetter={false}
            secondLine={`Under 30 days ${money(hero.stockAgeUnder30)} · 30–90 days ${money(hero.stockAge30To90)}`}
            howCalculated="Stock still held, by days since it last moved. The Stock ageing chart below opens the whole breakdown."
          />
          <KpiCard
            label="Stock converted" value={hero.stockConvertedValue} format={money} accent={p.secondary}
            icon={<MdLocalShipping size={16} />}
            secondLine={hero.stockConvertedPercent != null ? `${pct(hero.stockConvertedPercent)} of everything ever held` : null}
            howCalculated="Declared value that has turned back into sales."
            onDrillDown={drillTo("stock-converted")}
          />
        </KpiGroup>
      )}

      {(showSales || showStock) && (
        <div style={{ ...styles.chartGrid, marginBottom: "1.25rem" }}>
          {showSales && (
            <ChartCard
              title="Net sales vs landed cost" subtitle="Last 12 months; the line is margin %. Click a month for its invoices."
              empty={!hasAny(monthly, ["netSales", "landedCost"])} height={280}
            >
              <BarLineChart
                data={monthly} ariaLabel="Monthly net sales and landed cost of sales, with margin percentage"
                series={[
                  { key: "netSales", label: "Net sales", colorKey: "primary" },
                  { key: "landedCost", label: "Landed cost", colorKey: "secondary" },
                  { key: "marginPct", label: "Margin %", colorKey: "warn", type: "line", axis: "right", format: pct },
                ]}
                onBarClick={onBar((d) => d?.month && openDrill("sales", { groupKey: d.month, period: "all-time" }))}
              />
            </ChartCard>
          )}
          {showSales && (
            <ChartCard
              title="Top 10 customers" subtitle="Net sales excluding tax in the period. Click a customer for their invoices."
              empty={customers.length === 0} emptyText="No invoiced customers in this period."
              height={Math.max(240, customers.length * 34)}
            >
              <HBarChart data={customers} ariaLabel="Top 10 customers by net sales" valueLabel="Net sales"
                onBarClick={onBar((d) => openDrill("sales", { groupKey: d?.groupKey || null }))} />
            </ChartCard>
          )}
          {showStock && (
            <ChartCard
              title="Stock ageing" subtitle="Declared value still held, by days since it last moved. Click for the items."
              empty={ageingTotal(hero) === 0} emptyText="No stock held." height={240}
            >
              <StackedBarChart
                data={ageing} ariaLabel="Stock held by age: under 30 days, 30 to 90 days, over 90 days"
                series={[
                  { key: "under30", label: "Under 30 days", colorKey: "positive" },
                  { key: "d30to90", label: "30–90 days", colorKey: "warn" },
                  { key: "over90", label: "90+ days", colorKey: "negative" },
                ]}
                onBarClick={onBar(() => openDrill("stock-ageing"))}
              />
            </ChartCard>
          )}
        </div>
      )}

      <div style={styles.chartGrid}>
        {sales && (
          <ListCard title="Recent invoices" icon={MdReceipt}
            link={(has?.("invoices.list.view") || has?.("bills.list.view")) ? { to: "/invoices", label: "Open invoices" } : null}>
            {(sales.recentInvoices || []).length === 0
              ? <EmptyLine>No invoices in this period.</EmptyLine>
              : <RecentList rows={sales.recentInvoices} />}
          </ListCard>
        )}
        {data.fbr && <FbrCard data={data.fbr} />}
        {data.purchases && hero.hasPurchases !== false && (
          <ListCard title="Recent purchase bills" icon={MdShoppingCart}
            link={has?.("purchasebills.list.view") ? { to: "/purchase-bills", label: "Open purchase bills" } : null}>
            <Stats items={[["Bills", count(data.purchases.billCount)], ["Average", money(data.purchases.averageBillValue)], ["Total", money(data.purchases.totalPurchases)]]} />
            {(data.purchases.recentBills || []).length === 0
              ? <EmptyLine>No purchase bills in this period.</EmptyLine>
              : <RecentList rows={data.purchases.recentBills} />}
          </ListCard>
        )}
        {data.inventory && (
          <ListCard title="Inventory" icon={MdInventory}
            link={has?.("stock.dashboard.view") ? { to: "/stock", label: "Open stock" } : null}>
            <Stats items={[["Stock value", money(data.inventory.totalStockValue)], ["Items tracked", count(data.inventory.trackedItemCount)], ["Low stock", count(data.inventory.lowStockItemCount)]]} />
            <div style={styles.subHeading}>Top movers (last 30 days)</div>
            <TopList items={data.inventory.topItemsByMovement} accent={p.warn} valueMode="qty"
              secondary={(it) => `${it.count} movement${it.count !== 1 ? "s" : ""}`}
              emptyText="No stock movements in the last 30 days." />
          </ListCard>
        )}
      </div>
    </>
  );
}

// ── Lists ───────────────────────────────────────────────────────────

function ListCard({ title, icon: Icon, link, children }) {
  return (
    <section style={{ ...styles.card, display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Icon size={18} style={{ color: "var(--dash-primary)", flexShrink: 0 }} aria-hidden="true" />
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--dash-ink)", flex: 1, minWidth: 0 }}>{title}</h3>
        {link && (
          <Link to={link.to} style={styles.headerLink} aria-label={link.label}>
            <MdOpenInNew size={14} aria-hidden="true" /> Open
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

function FbrCard({ data }) {
  const stages = [
    ["Pending", data.pendingSubmission, "var(--dash-warn)", MdHourglassEmpty],
    ["Validated", data.validated, "var(--dash-primary)", MdCheckCircle],
    ["Submitted", data.submitted, "var(--dash-positive)", MdCloudDone],
    ["Failed", data.failed, "var(--dash-negative)", MdError],
  ];
  return (
    <ListCard title="FBR status" icon={MdCloudDone}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: "0.5rem" }}>
        {stages.map(([label, v, c, Icon]) => (
          <div key={label} style={{ border: "1px solid var(--dash-grid)", borderTop: `3px solid ${c}`, borderRadius: 12, padding: "0.6rem 0.7rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.72rem", color: "var(--dash-text)", fontWeight: 600 }}>
              <Icon size={14} style={{ color: c }} aria-hidden="true" /> {label}
            </span>
            <span style={{ fontSize: "1.3rem", fontWeight: 600, color: "var(--dash-ink)", fontVariantNumeric: "tabular-nums" }}>{count(v || 0)}</span>
          </div>
        ))}
      </div>
      {data.excluded > 0 && (
        <div style={{ fontSize: "0.78rem", color: "var(--dash-text)" }}>
          <strong>{data.excluded}</strong> bill{data.excluded !== 1 ? "s" : ""} excluded from bulk submit.
        </div>
      )}
      <div>
        <div style={styles.subHeading}>Reconciliation (Annexure-A vs purchase bills)</div>
        <Stats items={[["Pending", count(data.reconciliationPending || 0)], ["Matched", count(data.reconciliationMatched || 0)], ["Disputed", count(data.reconciliationDisputed || 0)]]} />
      </div>
    </ListCard>
  );
}

function Stats({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: "0.5rem" }}>
      {items.map(([label, v]) => (
        <div key={label} style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.68rem", color: "var(--dash-text)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--dash-ink)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function RecentList({ rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((r, i) => (
        <div key={`${r.id}-${i}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", minHeight: 44, padding: "0.35rem 0", borderBottom: "1px solid var(--dash-grid)", fontSize: "0.84rem" }}>
          <span style={{ color: "var(--dash-text)", fontSize: "0.76rem", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>#{r.number}</span>
          <span style={{ flex: 1, minWidth: 120, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", fontWeight: 600, color: "var(--dash-ink)" }}>{r.counterpartyName || "(unknown)"}</span>
          <span style={{ color: "var(--dash-text)", fontSize: "0.76rem", flexShrink: 0 }}>{formatDate(r.date)}</span>
          <span style={{ fontWeight: 600, color: "var(--dash-ink)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }} title={money(r.grandTotal)}>{formatMoneyShort(r.grandTotal)}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ children }) {
  return <div style={{ fontSize: "0.83rem", color: "var(--dash-text)", fontStyle: "italic" }}>{children}</div>;
}

// ── Shell + states ──────────────────────────────────────────────────

function Shell({ children }) {
  // .dl-main provides the outer padding; the page caps its width.
  return <div style={{ maxWidth: 1480, margin: "0 auto", minWidth: 0 }}>{children}</div>;
}

function WelcomeOnlyBanner({ displayName }) {
  return (
    <div style={{ ...styles.card, padding: "2.5rem 1.5rem", textAlign: "center" }}>
      <MdInfo size={30} style={{ color: "var(--dash-primary)" }} />
      <h2 style={{ margin: "0.4rem 0 0", fontSize: "1.2rem", fontWeight: 700, color: "var(--dash-ink)" }}>Welcome back, {displayName}</h2>
      <p style={{ margin: "0.4rem auto 0", maxWidth: 480, fontSize: "0.9rem", color: "var(--dash-text)", lineHeight: 1.55 }}>
        Your role doesn't include any dashboard KPI permissions yet. Ask an admin to grant Sales,
        Purchases, FBR, or Inventory KPI access to see metrics here.
      </p>
    </div>
  );
}

function AccessDeniedBanner({ displayName }) {
  return (
    <div style={{ ...styles.card, padding: "2.5rem 1.5rem", textAlign: "center" }}>
      <MdLock size={44} style={{ color: "var(--dash-text)" }} />
      <h2 style={{ margin: "0.4rem 0 0", fontSize: "1.15rem", fontWeight: 700, color: "var(--dash-ink)" }}>No dashboard access</h2>
      <p style={{ margin: "0.4rem auto 0", maxWidth: 480, fontSize: "0.9rem", color: "var(--dash-text)", lineHeight: 1.5 }}>
        Hi {displayName}, your role doesn't have permission to view the dashboard.
        Use the sidebar to navigate to a section you have access to.
      </p>
    </div>
  );
}

function EmptyState({ heading, body }) {
  return (
    <div style={{ ...styles.card, padding: "2rem 1.5rem", textAlign: "center", marginBottom: "1rem" }}>
      <MdInfo size={32} style={{ color: "var(--dash-text)" }} />
      <h3 style={{ margin: "0.5rem 0 0.25rem", fontSize: "1rem", fontWeight: 700, color: "var(--dash-ink)" }}>{heading}</h3>
      <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--dash-text)" }}>{body}</p>
    </div>
  );
}

function LoadingShimmer() {
  return (
    <div style={styles.tileGrid}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ ...styles.card, height: 136 }}>
          <div style={{ width: "60%", height: 12, background: "var(--dash-grid)", borderRadius: 4, marginBottom: 16 }} />
          <div style={{ width: "75%", height: 28, background: "var(--dash-grid)", borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

const styles = {
  card: {
    background: "var(--dash-card)",
    border: "1px solid var(--dash-grid)",
    borderRadius: 16,
    padding: "1rem 1.1rem",
    boxShadow: "0 1px 2px rgba(12, 24, 48, 0.04), 0 10px 28px -18px rgba(12, 24, 48, 0.18)",
  },
  tileGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "1rem", marginBottom: "1rem" },
  // Two charts across from ~900px; one full-width column below.
  chartGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: "1rem" },
  groupTitle: { margin: "0 0 0.6rem", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dash-text)" },
  subHeading: { fontSize: "0.7rem", color: "var(--dash-text)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", margin: "0.2rem 0 0.4rem" },
  headerLink: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem", minHeight: 44, minWidth: 44, padding: "0 0.75rem",
    borderRadius: 9, border: "1px solid var(--dash-grid)", color: "var(--dash-primary)", background: "var(--dash-card)",
    fontSize: "0.8rem", fontWeight: 600, textDecoration: "none", flexShrink: 0, justifyContent: "center",
  },
};
