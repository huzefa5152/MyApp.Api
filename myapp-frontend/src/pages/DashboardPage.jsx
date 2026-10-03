// src/pages/DashboardPage.jsx
//
// Home-page dashboard — permission-shaped, time-aware, mobile-first.
//
// Architecture:
//   • Single API call: GET /api/dashboard/kpis?companyId&period
//   • Backend returns ONLY the sections the caller has perm for
//     (sales/purchases/fbr/inventory blocks are nullable on the wire),
//     which means the page renders ONLY what's allowed without leaking
//     numbers via empty placeholders.
//   • If the user has dashboard.view but no .kpi.* perms → welcome
//     banner only. No metrics, no chart, no leak.
//
// Layout (mobile-first, built from the shared UI kit so it follows the
// selected theme — Classic roomy, Workspace compact):
//   • PageHeader (greeting + period picker) + CompanyPicker.
//   • Hero KPI band: StatGrid of KpiCards (auto-fit, collapses on phones).
//   • Section grid: kit Cards — 1 col on mobile, 2 cols when wide.
//
// Visuals:
//   • Each section card carries its identity tone (Sales blue /
//     Purchases teal / FBR purple / Inventory orange).
//   • Numbers are monospace + PKR locale formatted.
//   • Sparklines are inline SVG (no charting lib) — tight bundle size,
//     full mobile control.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  MdTrendingUp, MdShoppingCart, MdReceipt, MdInventory, MdCloudDone,
  MdHourglassEmpty, MdError, MdCheckCircle, MdLock,
  MdOpenInNew, MdInfo, MdAttachMoney, MdAccountBalance, MdDashboard,
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getDashboardKpis } from "../api/dashboardApi";
import KpiCard from "../Components/dashboard/KpiCard";
import TopList from "../Components/dashboard/TopList";
import ByCounterpartyCard from "../Components/dashboard/ByCounterpartyCard";
import { notify } from "../utils/notify";
import { PageHeader, CompanyPicker, Card, StatGrid, EmptyState, Loading, Alert } from "../ui/Kit";
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

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

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

export default function DashboardPage() {
  const { user } = useAuth();
  const { selectedCompany, companies } = useCompany();
  const { has, loading: permsLoading } = usePermissions();

  const [period, setPeriod] = useState(() => localStorage.getItem(PERIOD_STORAGE_KEY) || "all-time");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const canViewPage = has?.("dashboard.view") ?? false;
  const displayName = user?.name || user?.username || "there";

  // Persist the period selection so the operator's last choice
  // survives reloads.
  useEffect(() => {
    if (period) localStorage.setItem(PERIOD_STORAGE_KEY, period);
  }, [period]);

  // Refetch whenever the company picker or period changes. Skip when
  // perms are still loading (we'd hammer the endpoint with a request
  // that the fetch wrapper would 401 on).
  useEffect(() => {
    if (permsLoading || !canViewPage || !selectedCompany?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await getDashboardKpis(selectedCompany.id, period);
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        const msg = err?.response?.data?.error || err?.message || "Failed to load dashboard.";
        setError(msg);
        notify(msg, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [permsLoading, canViewPage, selectedCompany?.id, period]);

  // ── Permission gates (fast-paths before render) ─────────────────────

  if (permsLoading) {
    return <Shell><Loading>Loading dashboard…</Loading></Shell>;
  }

  if (!canViewPage) {
    return <Shell><AccessDeniedBanner displayName={displayName} /></Shell>;
  }

  if (!selectedCompany) {
    return (
      <Shell>
        <EmptyState icon={MdInfo} title="Pick a company">Use the company picker in the top bar to start.</EmptyState>
      </Shell>
    );
  }

  // We allow the page to render the welcome banner before data lands,
  // so the operator doesn't see a flash of "no permission" on slow
  // networks.
  const flags = data?.permissions;
  const hasAnyKpi = !!(flags?.canViewSales || flags?.canViewPurchases || flags?.canViewFbr || flags?.canViewInventory);

  return (
    <Shell>
      <Header
        displayName={displayName}
        companies={companies}
        selectedCompany={selectedCompany}
        period={period}
        onPeriodChange={setPeriod}
      />

      {error && (
        <Alert tone="error" icon={MdError}>
          <strong>Couldn't load dashboard:</strong> {error}
        </Alert>
      )}

      {loading && !data && <Loading>Loading dashboard…</Loading>}

      {!loading && data && !hasAnyKpi && (
        <WelcomeOnlyBanner displayName={displayName} />
      )}

      {data && hasAnyKpi && (
        <>
          {/* Hero band — 4 KPIs. Hides cards the user can't see (sales-
              only role gets 2 hero cards; admin gets 4). */}
          <HeroBand data={data} />

          {/* Counterparty breakdown row — Sales by Client + Purchases by
              Supplier. Sits right under the hero so the operator sees
              "where is the money coming from / going to" before drilling
              into per-section detail. Each card hides if the operator
              lacks the matching .kpi.* perm. */}
          {(data.sales || data.purchases) && (
            <div className="dash-section-grid" style={styles.sectionGrid}>
              {data.sales && (
                <ByCounterpartyCard
                  items={data.sales.topClients}
                  total={data.sales.totalSales}
                  accent={accents.sales}
                  title="Sales by Client"
                  subtitle={`Top ${Math.min(20, (data.sales.topClients || []).length)} clients · period total Rs. ${formatPkrCompact(data.sales.totalSales)}`}
                  emptyText="No invoiced clients in this period."
                />
              )}
              {data.purchases && (
                <ByCounterpartyCard
                  items={data.purchases.topSuppliers}
                  total={data.purchases.totalPurchases}
                  accent={accents.purchases}
                  title="Purchases by Supplier"
                  subtitle={`Top ${Math.min(20, (data.purchases.topSuppliers || []).length)} suppliers · period total Rs. ${formatPkrCompact(data.purchases.totalPurchases)}`}
                  emptyText="No supplier activity in this period."
                />
              )}
            </div>
          )}

          {/* Section grid — sales / purchases side-by-side at desktop,
              stacked on mobile. The Top 5 lists were moved into the
              Sales/Purchases-by-Counterparty cards above; sections
              below stick to recent items + drill-through links.
              Each section's "Open" header link is gated by the DESTINATION
              screen's view permission (not the KPI perm) so a user who
              can see sales numbers but can't open /invoices doesn't
              see a button that 403s on click. */}
          <div className="dash-section-grid" style={styles.sectionGrid}>
            {data.sales      && <SalesSection      data={data.sales}      canOpen={has?.("invoices.list.view") || has?.("bills.list.view")} />}
            {data.purchases  && <PurchasesSection  data={data.purchases}  canOpen={has?.("purchasebills.list.view")} />}
            {data.fbr        && <FbrSection        data={data.fbr} />}
            {data.inventory  && <InventorySection  data={data.inventory}  canOpen={has?.("stock.dashboard.view")} />}
          </div>
        </>
      )}
    </Shell>
  );
}

// ── Shell + header + helpers ────────────────────────────────────────

function Shell({ children }) {
  // .dl-main already provides outer padding (1.75rem 2rem desktop / 1.25rem 1rem mobile),
  // so the dashboard itself only needs a max-width cap.
  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      {children}
    </div>
  );
}

function Header({ displayName, companies, selectedCompany, period, onPeriodChange }) {
  const periodLabel = PERIOD_OPTIONS.find((p) => p.code === period)?.label || "";
  // Hide the picker when there's only one company — showing a 1-option
  // dropdown is just visual noise.
  const showCompanyPicker = (companies?.length ?? 0) > 1;
  return (
    <>
      <PageHeader
        icon={MdDashboard}
        tone="brand"
        className="k-header--hero"
        title={<>Welcome back, <span style={{ color: "var(--k-tone)" }}>{displayName}</span></>}
        subtitle={(
          <>
            Overview · {selectedCompany?.name ? <><strong>{selectedCompany.name}</strong> · </> : null}
            Showing <strong>{periodLabel}</strong>
          </>
        )}
        actions={(
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            className="k-select"
            style={{ width: "auto", minWidth: 150 }}
            aria-label="Period"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.code} value={p.code}>{p.label}</option>
            ))}
          </select>
        )}
      />
      {showCompanyPicker && <CompanyPicker />}
    </>
  );
}

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
      Hi {displayName}, your role doesn't have permission to view the dashboard.
      Use the sidebar to navigate to a section you have access to.
    </EmptyState>
  );
}

// ── Hero band ──────────────────────────────────────────────────────

function HeroBand({ data }) {
  const hero = data.hero || {};
  const sales = data.sales;
  const purchases = data.purchases;
  const flags = data.permissions || {};

  // Hide individual hero cards based on perms. A user with only sales
  // gets 2 cards (Total Sales + Net would be misleading without
  // purchases, so we hide Net too). Admin gets all 4.
  const showSales = flags.canViewSales;
  const showPurchases = flags.canViewPurchases;
  const showNet = showSales && showPurchases;
  const showGstNet = showSales && showPurchases;

  return (
    <section aria-label="Headline KPIs">
      <StatGrid className="dash-hero-grid">
        {showSales && (
          <KpiCard
            label="Total Sales"
            value={hero.totalSales}
            prevValue={hero.totalSalesPrev}
            accent={accents.sales}
            format={(v) => `Rs. ${formatPkrCompact(v)}`}
            trend={sales?.trend12m}
            icon={<MdAttachMoney size={16} />}
            title="Sum of GrandTotal across all sales invoices in the selected period"
          />
        )}
        {showPurchases && (
          <KpiCard
            label="Total Purchases"
            value={hero.totalPurchases}
            prevValue={hero.totalPurchasesPrev}
            accent={accents.purchases}
            format={(v) => `Rs. ${formatPkrCompact(v)}`}
            trend={purchases?.trend12m}
            icon={<MdShoppingCart size={16} />}
            higherIsBetter={false}
            title="Sum of GrandTotal across all purchase bills in the selected period"
          />
        )}
        {showNet && (
          <KpiCard
            label="Net (Sales − Purchases)"
            value={hero.net}
            prevValue={hero.netPrev}
            accent="#37474f"
            format={(v) => `Rs. ${formatPkrCompact(v)}`}
            icon={<MdTrendingUp size={16} />}
            title="What's left after subtracting purchases from sales — a rough cash-flow signal"
          />
        )}
        {showGstNet && (
          <KpiCard
            label="GST Net (Output − Input)"
            value={hero.gstNet}
            prevValue={hero.gstNetPrev}
            accent="#6a1b9a"
            format={(v) => `Rs. ${formatPkrCompact(v)}`}
            icon={<MdAccountBalance size={16} />}
            higherIsBetter={false}
            title="Output Tax (collected on sales) minus Input Tax (paid on purchases) — what you owe FBR"
          />
        )}
      </StatGrid>
    </section>
  );
}

// ── Sections ───────────────────────────────────────────────────────

function SectionCard({ title, tone, icon, children, headerExtra = null }) {
  return (
    <Card className="dash-card" title={title} icon={icon} tone={tone} actions={headerExtra} style={{ marginTop: 0 }}>
      <div style={styles.sectionBody}>
        {children}
      </div>
    </Card>
  );
}

function OpenLink({ to, title }) {
  return (
    <Link to={to} className="k-btn k-btn--secondary k-btn--sm dash-section-card__open" title={title}>
      <MdOpenInNew size={14} aria-hidden="true" /> <span className="dash-section-card__open-label">Open</span>
    </Link>
  );
}

function SalesSection({ data, canOpen = false }) {
  return (
    <SectionCard title="Sales" tone="blue" icon={MdReceipt}
      headerExtra={canOpen ? <OpenLink to="/invoices" title="Open Invoices page" /> : null}
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
    <SectionCard title="Purchases" tone="teal" icon={MdShoppingCart}
      headerExtra={canOpen ? <OpenLink to="/purchase-bills" title="Open Purchase Bills page" /> : null}
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
    <SectionCard title="FBR / Compliance" tone="purple" icon={MdCloudDone}>
      <div className="dash-funnel-grid" style={styles.fbrGrid}>
        <Funnel label="Pending"   value={data.pendingSubmission} color="#f57c00" icon={MdHourglassEmpty} />
        <Funnel label="Validated" value={data.validated}         color="#0277bd" icon={MdCheckCircle} />
        <Funnel label="Submitted" value={data.submitted}         color="#2e7d32" icon={MdCloudDone} />
        <Funnel label="Failed"    value={data.failed}            color="#c62828" icon={MdError} />
      </div>

      {data.excluded > 0 && (
        <div style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", paddingLeft: "0.25rem" }}>
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
    <SectionCard title="Inventory" tone="orange" icon={MdInventory}
      headerExtra={canOpen ? <OpenLink to="/stock" title="Open Stock Dashboard" /> : null}
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
            <div style={styles.rowList}>
              {data.recentMovements.map((m, i) => (
                <div key={`${m.id}-${i}`} className="dash-mov-row" style={styles.listRow}>
                  <span style={{ ...styles.miniChip, color: m.direction === "In" ? "#15803d" : "#c62828", backgroundColor: m.direction === "In" ? "rgba(21,128,61,0.10)" : "rgba(198,40,40,0.09)" }}>
                    {m.direction}
                  </span>
                  <span className="dash-mov-row__name" style={{ ...styles.clampName, flex: 1 }}>{m.itemTypeName}</span>
                  <span className="dash-mov-row__qty" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--k-ink)" }}>{m.quantity}</span>
                  <span style={{ color: "var(--k-muted)", fontSize: "0.73rem" }}>{formatDate(m.date)}</span>
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
        color: warn ? "var(--k-danger)" : highlight ? "var(--k-ink)" : "var(--k-muted)",
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
        fontSize: "0.64rem", color: "var(--k-muted)", textTransform: "uppercase",
        letterSpacing: "0.1em", fontWeight: 600,
        fontFamily: MONO,
      }}>{label}</div>
      <div className="dash-funnel-card__value" style={{
        fontFamily: MONO,
        fontVariantNumeric: "tabular-nums",
        fontSize: "var(--k-stat-value)", fontWeight: 600, color,
      }}>
        {value || 0}
      </div>
    </div>
  );
}

function ReconChip({ label, value, color }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", padding: "0.3rem 0.75rem", borderRadius: 999, border: `1px solid ${color}40`, backgroundColor: `${color}0d` }}>
      <span style={{ fontSize: "0.74rem", color: "var(--k-ink)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: "var(--k-font)", fontWeight: 600, color }}>{value || 0}</span>
    </div>
  );
}

function RecentList({ rows }) {
  return (
    <div style={styles.rowList}>
      {rows.map((r, i) => (
        <div key={`${r.id}-${i}`} className="dash-recent-row" style={{ ...styles.listRow, flexWrap: "wrap" }}>
          <span className="dash-recent-row__number" style={{ fontFamily: MONO, fontSize: "0.75rem", color: "var(--k-muted)", flexShrink: 0 }}>#{r.number}</span>
          <span className="dash-recent-row__name" style={{ ...styles.clampName, flex: 1 }}>{r.counterpartyName || "(unknown)"}</span>
          <span className="dash-recent-row__date" style={{ color: "var(--k-muted)", fontSize: "0.73rem", flexShrink: 0 }}>{formatDate(r.date)}</span>
          <span className="dash-recent-row__amount" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--k-ink)", flexShrink: 0 }}>{formatPkr(r.grandTotal)}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ children }) {
  return <div style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", fontStyle: "italic" }}>{children}</div>;
}

// ── Styles ─────────────────────────────────────────────────────────
//
// Page-specific layout only; surfaces, sizes and colours come from the
// kit tokens (--k-*) so Classic and Workspace both apply. All grids use
// auto-fit/minmax so they collapse to one column on small screens.

const styles = {
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
    gap: "var(--k-gap)",
    marginBottom: "var(--k-gap)",
  },
  sectionBody: {
    display: "flex",
    flexDirection: "column",
    gap: "calc(var(--k-gap) * 0.75)",
  },
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.85rem",
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
    fontSize: "calc(var(--k-font) + 0.05rem)",
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
  rowList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
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
  // Counterparty / item names — 2-line clamp, never nowrap+ellipsis
  // (similar-prefix names must stay distinguishable).
  clampName: {
    minWidth: 0,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    wordBreak: "break-word",
    lineHeight: 1.3,
    fontWeight: 600,
    color: "var(--k-ink)",
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
    padding: "var(--k-stat-pad)",
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
};
