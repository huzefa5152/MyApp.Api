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
// Layout (mobile-first):
//   • Hero band: 1 col on mobile, 2 cols at 480px, 4 cols at 768px+.
//     Uses CSS grid auto-fit/minmax — no media queries needed.
//   • Section grid: 1 col on mobile, 2 cols at 1024px+. Each section
//     is a card with header, content, optional empty-state line.
//   • Period picker: full-width on mobile, inline on desktop.
//
// Visuals:
//   • Each section has a small accent strip in its KPI cards so the
//     identity (Sales / Purchases / FBR / Inventory) is readable
//     without colour ambiguity.
//   • Numbers are monospace + PKR locale formatted.
//   • Sparklines are inline SVG (no charting lib) — tight bundle size,
//     full mobile control.
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  MdTrendingUp, MdShoppingCart, MdReceipt, MdInventory, MdCloudDone,
  MdHourglassEmpty, MdError, MdCheckCircle, MdLock, MdRefresh,
  MdOpenInNew, MdInfo, MdAttachMoney, MdAccountBalance,
} from "react-icons/md";
import { useAuth } from "../contexts/AuthContext";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getDashboardKpis } from "../api/dashboardApi";
import KpiCard from "../Components/dashboard/KpiCard";
import Sparkline from "../Components/dashboard/Sparkline";
import TopList from "../Components/dashboard/TopList";
import ByCounterpartyCard from "../Components/dashboard/ByCounterpartyCard";
import { notify } from "../utils/notify";
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

export default function DashboardPage() {
  const { user } = useAuth();
  const { selectedCompany, companies, setSelectedCompany } = useCompany();
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
        notify.error(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [permsLoading, canViewPage, selectedCompany?.id, period]);

  // ── Permission gates (fast-paths before render) ─────────────────────

  if (permsLoading) {
    return <Shell><LoadingShimmer /></Shell>;
  }

  if (!canViewPage) {
    return <Shell><AccessDeniedBanner displayName={displayName} reason="page" /></Shell>;
  }

  if (!selectedCompany) {
    return <Shell><EmptyState heading="Pick a company" body="Use the company picker in the top bar to start." /></Shell>;
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
        selectedCompanyId={selectedCompany?.id}
        onCompanyChange={(id) => {
          const c = companies.find((cc) => cc.id === id);
          if (c) setSelectedCompany(c);
        }}
        period={period}
        onPeriodChange={setPeriod}
      />

      {error && (
        <div style={{ ...styles.card, borderLeft: "4px solid #c62828", color: "#c62828", fontSize: "0.85rem" }}>
          <strong>Couldn't load dashboard:</strong> {error}
        </div>
      )}

      {loading && !data && <LoadingShimmer />}

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
  // so the dashboard itself only needs a max-width cap and the inner element gap.
  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      {children}
    </div>
  );
}

function Header({ displayName, companies, selectedCompanyId, onCompanyChange, period, onPeriodChange }) {
  const periodLabel = PERIOD_OPTIONS.find((p) => p.code === period)?.label || "";
  const selectedCompany = companies?.find((c) => c.id === selectedCompanyId);
  // Hide the picker when there's only one company — showing a 1-option
  // dropdown is just visual noise.
  const showCompanyPicker = (companies?.length ?? 0) > 1;
  return (
    <header className="dash-hero" style={styles.heroBanner}>
      <div className="dash-hero__title-block" style={{ flex: 1, minWidth: 0 }}>
        <h1 className="dash-hero__heading" style={styles.heroHeading}>
          Hello, <span style={{ color: "#fff" }}>{displayName}</span> 👋
        </h1>
        <p className="dash-hero__subtitle" style={styles.heroSubtitle}>
          {selectedCompany?.name ? <><strong>{selectedCompany.name}</strong> · </> : null}
          Showing <strong>{periodLabel}</strong>
        </p>
      </div>
      {/* Picker bar — wraps to a new line on phones (flex-wrap on
          parent), sits inline on desktop. Each control is full-width
          on phones so taps land easily. */}
      <div className="dash-hero__pickers" style={styles.heroPickers}>
        {showCompanyPicker && (
          <select
            value={selectedCompanyId ?? ""}
            onChange={(e) => onCompanyChange(parseInt(e.target.value, 10))}
            className="dash-hero__select"
            style={styles.heroSelect}
            aria-label="Company"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <select
          value={period}
          onChange={(e) => onPeriodChange(e.target.value)}
          className="dash-hero__select"
          style={styles.heroSelect}
          aria-label="Period"
        >
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.code} value={p.code}>{p.label}</option>
          ))}
        </select>
      </div>
    </header>
  );
}

function WelcomeOnlyBanner({ displayName }) {
  return (
    <div style={{ ...styles.card, padding: "2rem 1.5rem", textAlign: "center" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>👋</div>
      <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#1a2332" }}>
        Welcome back, {displayName}
      </h2>
      <p style={{ margin: "0.4rem auto 0", maxWidth: 480, fontSize: "0.9rem", color: "#5f6d7e", lineHeight: 1.5 }}>
        Your role doesn't include any dashboard KPI permissions yet. Ask an admin to grant Sales,
        Purchases, FBR, or Inventory KPI access to see metrics here.
      </p>
    </div>
  );
}

function AccessDeniedBanner({ displayName, reason }) {
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

function LoadingShimmer() {
  // Plain skeleton — same layout as the real cards so paint is stable.
  return (
    <>
      <div style={styles.heroGrid}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ ...styles.card, height: 140, animation: "fadeIn 0.4s ease" }}>
            <div style={{ width: "60%", height: 12, background: "#eef2f7", borderRadius: 4, marginBottom: 16 }} />
            <div style={{ width: "75%", height: 28, background: "#eef2f7", borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </>
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
    <section className="dash-hero-grid" style={styles.heroGrid} aria-label="Headline KPIs">
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
    </section>
  );
}

// ── Sections ───────────────────────────────────────────────────────

function SectionCard({ title, accent, icon, children, headerExtra = null }) {
  const Icon = icon;
  return (
    <section style={{ ...styles.card, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", borderTop: `3px solid ${accent}` }}>
      <header className="dash-section-card__header" style={{
        display: "flex",
        alignItems: "center",
        gap: "0.55rem",
        padding: "0.7rem 1rem",
        borderBottom: "1px solid #eef2f7",
        background: `linear-gradient(95deg, ${accent}1f 0%, ${accent}0a 55%, transparent 100%)`,
      }}>
        <span className="dash-section-card__header-icon" style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: 9,
          background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
          color: "#fff",
          boxShadow: `0 4px 10px -2px ${accent}66`,
          flexShrink: 0,
        }}>
          <Icon size={16} />
        </span>
        <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "#1a2332", flex: 1, letterSpacing: "0.01em", minWidth: 0 }}>{title}</h2>
        {headerExtra}
      </header>
      <div className="dash-section-card__body" style={{ padding: "0.8rem 1rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
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
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {data.recentMovements.map((m, i) => (
                <div key={`${m.id}-${i}`} className="dash-mov-row" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.83rem" }}>
                  <span style={{ ...styles.miniChip, color: m.direction === "In" ? "#2e7d32" : "#c62828", backgroundColor: m.direction === "In" ? "#e8f5e9" : "#ffebee", border: `1px solid ${m.direction === "In" ? "#a5d6a7" : "#ef9a9a"}` }}>
                    {m.direction}
                  </span>
                  <span className="dash-mov-row__name" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1a2332" }}>{m.itemTypeName}</span>
                  <span className="dash-mov-row__qty" style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, color: "#1a2332" }}>{m.quantity}</span>
                  <span style={{ color: "#5f6d7e", fontSize: "0.75rem" }}>{formatDate(m.date)}</span>
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
        color: warn ? "#c62828" : highlight ? "#1a2332" : "#37474f",
        fontWeight: highlight ? 800 : 600,
      }}>{value ?? "—"}</div>
    </div>
  );
}

function Funnel({ label, value, color, icon }) {
  const Icon = icon;
  return (
    <div className="dash-funnel-card" style={{
      ...styles.funnelCard,
      borderColor: `${color}40`,
      background: `linear-gradient(160deg, ${color}10 0%, ${color}05 60%, #fff 100%)`,
    }}>
      <div style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, borderRadius: 7,
        background: `${color}1a`, color,
      }}>
        <Icon size={16} />
      </div>
      <div style={{ fontSize: "0.72rem", color: "#5f6d7e", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{label}</div>
      <div className="dash-funnel-card__value" style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.3rem", fontWeight: 800, color }}>
        {value || 0}
      </div>
    </div>
  );
}

function ReconChip({ label, value, color }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.7rem", borderRadius: 99, border: `1px solid ${color}55`, backgroundColor: `${color}10` }}>
      <span style={{ fontSize: "0.75rem", color: "#37474f", fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem", fontWeight: 800, color }}>{value || 0}</span>
    </div>
  );
}

function RecentList({ rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {rows.map((r, i) => (
        <div key={`${r.id}-${i}`} className="dash-recent-row" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.83rem", flexWrap: "wrap" }}>
          <span className="dash-recent-row__number" style={{ fontFamily: "ui-monospace, monospace", color: "#5f6d7e", flexShrink: 0 }}>#{r.number}</span>
          <span className="dash-recent-row__name" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1a2332" }}>{r.counterpartyName || "(unknown)"}</span>
          <span className="dash-recent-row__date" style={{ color: "#5f6d7e", fontSize: "0.75rem", flexShrink: 0 }}>{formatDate(r.date)}</span>
          <span className="dash-recent-row__amount" style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#1a2332", flexShrink: 0 }}>{formatPkr(r.grandTotal)}</span>
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
    background: "linear-gradient(135deg, #0d47a1 0%, #1565c0 35%, #00897b 100%)",
    backgroundImage: `
      radial-gradient(circle at 100% 0%, rgba(255,255,255,0.18) 0%, transparent 38%),
      radial-gradient(circle at 0% 100%, rgba(255,255,255,0.10) 0%, transparent 45%),
      linear-gradient(135deg, #0d47a1 0%, #1565c0 35%, #00897b 100%)
    `,
    borderRadius: 16,
    padding: "0.95rem 1.15rem",
    color: "#fff",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.85rem",
    marginBottom: "0.75rem",
    boxShadow: "0 10px 24px -8px rgba(13, 71, 161, 0.45), 0 4px 10px rgba(0, 137, 123, 0.18)",
    overflow: "hidden",
  },
  heroHeading: {
    margin: 0,
    fontSize: "clamp(1.05rem, 3.5vw, 1.4rem)",
    fontWeight: 800,
    color: "rgba(255,255,255,0.95)",
    lineHeight: 1.2,
  },
  heroSubtitle: {
    margin: "0.25rem 0 0",
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.85)",
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
  heroSelect: {
    background: "rgba(255,255,255,0.96)",
    color: "#1a2332",
    border: "none",
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
  },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
    gap: "0.7rem",
    marginBottom: "0.75rem",
  },
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
    gap: "0.75rem",
    marginTop: "0.75rem",
  },
  card: {
    background: "#fff",
    border: "1px solid #e8edf3",
    borderRadius: 14,
    padding: "0.85rem 1rem",
    boxShadow: "0 2px 6px rgba(13, 71, 161, 0.06)",
  },
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.85rem",
    paddingBottom: "0.25rem",
    borderBottom: "1px dashed #eef2f7",
  },
  statLabel: {
    fontSize: "0.7rem",
    color: "#5f6d7e",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontWeight: 600,
    marginBottom: "0.15rem",
  },
  statValue: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.95rem",
  },
  subHeading: {
    fontSize: "0.78rem",
    color: "#5f6d7e",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "0.5rem",
  },
  fbrGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
    gap: "0.5rem",
  },
  funnelCard: {
    background: "#fafbfd",
    border: "1px solid",
    borderRadius: 10,
    padding: "0.7rem 0.55rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
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
    padding: "0.1rem 0.45rem",
    borderRadius: 6,
    fontSize: "0.7rem",
    fontWeight: 700,
    flexShrink: 0,
  },
  headerLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.2rem",
    padding: "0.25rem 0.5rem",
    borderRadius: 8,
    border: "1px solid #0d47a1",
    color: "#0d47a1",
    backgroundColor: "#fff",
    fontSize: "0.75rem",
    fontWeight: 600,
    textDecoration: "none",
    flexShrink: 0,
  },
};
