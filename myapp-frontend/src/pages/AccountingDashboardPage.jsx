// src/pages/AccountingDashboardPage.jsx
//
// Dashboards → Accounting — the financial control centre: profit, its trend,
// cash, what customers owe, what is owed to suppliers, tax positions and the
// ledger's health, for one company and one period.
//
// Data:
//   • GET /accounting/summary/company/{id}?from&to → AccountingSummaryDto
//     (accounting.dashboard.view — the same key as this page). One read for
//     the whole screen, including the Monthly Profit report's period totals and
//     its last twelve months, so a dashboard-only role needs nothing else.
//   • GET /commercial-costs/suppliers/{id}?asOf (purchasebills.payables.view)
//     — Supplier Payables' own balances, only when the caller can open that
//     screen. It nets supplier credits and advances, which the aging (unpaid
//     bills) does not, so it is shown as its own labelled table.
//   • POST /accounting/gl/company/{id}/rebuild (accounting.gl.manage).
//
// Every ledger figure is the total of the report its tile opens, taken from
// that report on the server, so the dashboard and the report cannot disagree.
// Tiles link to their report only for a caller holding accounting.reports.view.
//
// Period figures and as-at balances are labelled as such on screen: profit,
// receipts and payments are for the period; cash, receivables and payables are
// balances at its last day.
import { useState, useEffect, useCallback } from "react";
import {
  MdBusiness, MdAccountBalanceWallet, MdReceiptLong, MdPayments, MdSwapVert,
  MdTrendingUp, MdTrendingDown, MdAttachMoney, MdExpandMore,
  MdCallReceived, MdCallMade, MdAutorenew, MdCheckCircle, MdErrorOutline,
  MdLock, MdClose, MdInventory2,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { getAccountingSummary, rebuildGl } from "../api/accountingApi";
import { supplierSummary } from "../api/commercialCostApi";
import {
  Hero, Section, Panel, HeadLink, Metric, MetricGrid, AgingBar, PartyTable, TrendChart,
  Skeleton, ErrorBanner, fmtMoney, fmtDate, ymd, reportHref,
} from "../Components/dashboard/CommandCenter";

// ── Period presets ───────────────────────────────────────────────────────

function presetRange(code) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (code) {
    case "last-month": return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "this-quarter": { const q = Math.floor(m / 3) * 3; return { from: ymd(new Date(y, q, 1)), to: ymd(now) }; }
    case "this-year": return { from: ymd(new Date(y, 0, 1)), to: ymd(now) };
    case "last-year": return { from: ymd(new Date(y - 1, 0, 1)), to: ymd(new Date(y - 1, 11, 31)) };
    case "this-month":
    default: return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
  }
}
const PRESETS = [
  { code: "this-month", label: "This month" },
  { code: "last-month", label: "Last month" },
  { code: "this-quarter", label: "This quarter" },
  { code: "this-year", label: "This year" },
  { code: "last-year", label: "Last year" },
  { code: "custom", label: "Custom range" },
];

const pct = (v) => `${Number(v).toFixed(1)}%`;

export default function AccountingDashboardPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has, loading: permsLoading } = usePermissions();
  const confirm = useConfirm();

  const canView = has("accounting.dashboard.view");
  const canManageGl = has("accounting.gl.manage");
  const canOpenReports = has("accounting.reports.view");
  const canOpenReceipts = has("accounting.receipts.view");
  const canOpenPayments = has("accounting.payments.view");
  const canSupplierPayables = has("purchasebills.payables.view");

  const companyId = selectedCompany?.id;

  // The preset applies at once; custom dates apply on Apply, so the date
  // picker does not refetch on every keystroke.
  const [preset, setPreset] = useState("this-month");
  const [draft, setDraft] = useState(() => presetRange("this-month"));
  const [period, setPeriod] = useState(draft);

  const [summary, setSummary] = useState(null);
  const [suppliers, setSuppliers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [glResult, setGlResult] = useState(null);

  const load = useCallback(async () => {
    if (!companyId || !canView) return;
    setLoading(true);
    setError(null);
    try {
      const [{ data }, sup] = await Promise.all([
        getAccountingSummary(companyId, { from: period.from, to: period.to }),
        canSupplierPayables
          ? supplierSummary(companyId, { asOf: period.to }).then((r) => r.data).catch(() => null)
          : Promise.resolve(null),
      ]);
      setSummary(data);
      setSuppliers(sup);
    } catch (err) {
      setError(err.response?.data?.error || "The accounting summary could not be loaded.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, canView, canSupplierPayables, period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setGlResult(null); }, [companyId]);

  // Report link carrying the dashboard's own period, so the report opens on the
  // numbers the tile just showed. Null without report permission.
  const reportLink = useCallback(
    (reportId, extra = {}) => canOpenReports
      ? reportHref(reportId, { period: "custom", from: period.from, to: period.to, ...extra })
      : null,
    [canOpenReports, period]
  );

  const choosePreset = (code) => {
    setPreset(code);
    if (code === "custom") return;
    const r = presetRange(code);
    setDraft(r);
    setPeriod(r);
  };
  const applyCustom = () => {
    if (!draft.from || !draft.to) { notify("Pick both From and To dates.", "error"); return; }
    if (new Date(draft.from) > new Date(draft.to)) { notify("From date must be on or before To date.", "error"); return; }
    setPeriod({ ...draft });
  };

  const handleRebuild = async () => {
    const ok = await confirm({
      title: "Rebuild ledger?",
      message: "This removes every system-posted journal entry and re-posts all documents from their current state (manual journal entries survive, and entries in a closed period are left alone). It can take a minute on a large book.",
      variant: "danger",
      confirmText: "Rebuild",
    });
    if (!ok) return;
    setRebuilding(true);
    try {
      const { data } = await rebuildGl(companyId);
      setGlResult(data?.result || {});
      notify("Ledger rebuilt.", "success");
      await load();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to rebuild the ledger.", "error");
    } finally {
      setRebuilding(false);
    }
  };

  if (permsLoading) return <div className="cc"><Skeleton /></div>;
  if (!canView) {
    return <div className="cc"><p className="cc-empty" style={{ padding: "2rem" }}>You don't have permission to view the accounting dashboard.</p></div>;
  }

  return (
    <div className="cc">
      <style>{`@keyframes acctdash-spin { to { transform: rotate(360deg); } }`}</style>
      <Hero
        eyebrow="Accounting"
        title="Financial control centre"
        subtitle={summary
          ? <>From the general ledger · <strong>{fmtDate(summary.from)} – {fmtDate(summary.to)}</strong></>
          : "Profit, cash, receivables and payables from the general ledger"}
      >
        {companies.length > 1 && (
          <select className="cc-hero-select" aria-label="Company" value={selectedCompany?.id || ""}
            onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select>
        )}
        <select className="cc-hero-select" aria-label="Period" value={preset} onChange={(e) => choosePreset(e.target.value)}>
          {PRESETS.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
        </select>
        {preset === "custom" && (
          <>
            <input type="date" className="cc-hero-date" aria-label="From date" value={draft.from} max={draft.to || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
            <input type="date" className="cc-hero-date" aria-label="To date" value={draft.to} min={draft.from || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
            <button type="button" className="cc-hero-btn" onClick={applyCustom}>Apply</button>
          </>
        )}
      </Hero>

      {!companyId && <p className="cc-empty">Select a company to view its accounting summary.</p>}
      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !summary && <Skeleton rows={3} />}

      {companyId && summary && (
        <Dashboard
          summary={summary}
          suppliers={suppliers}
          reportLink={reportLink}
          canOpenReceipts={canOpenReceipts}
          canOpenPayments={canOpenPayments}
          canSupplierPayables={canSupplierPayables}
          canOpenReports={canOpenReports}
          glResult={glResult}
          onDismissGlResult={() => setGlResult(null)}
          ledgerFooter={summary.glEnabled && summary.ledger && (
            <GlHealthFooter status={summary.ledger} canManage={canManageGl} rebuilding={rebuilding} onRebuild={handleRebuild} />
          )}
        />
      )}
    </div>
  );
}

function Dashboard({ summary, suppliers, reportLink, canOpenReceipts, canOpenPayments, canSupplierPayables,
  canOpenReports, glResult, onDismissGlResult, ledgerFooter }) {
  const asAt = `As at ${fmtDate(summary.to)}`;
  const income = Number(summary.income || 0);
  const netProfit = Number(summary.netProfit || 0);
  const hasGross = summary.grossProfit != null;
  const gross = Number(summary.grossProfit || 0);
  // A margin with no cost of sales behind it is just "revenue / revenue" —
  // the Gross Profit report treats it as not meaningful, and so does this tile.
  const costKnown = hasGross && Number(summary.costOfSales || 0) !== 0;
  const margin = costKnown && income > 0 ? (gross / income) * 100 : null;
  const netMargin = income > 0 ? (netProfit / income) * 100 : null;
  const netCash = Number(summary.receiptsTotal || 0) - Number(summary.paymentsTotal || 0);
  const rec = summary.receivables || {};
  const pay = summary.payables || {};
  const overdue = (b) => Number(b.days1To30 || 0) + Number(b.days31To60 || 0) + Number(b.days61To90 || 0) + Number(b.over90 || 0);

  // Aging drill: "Not yet due" opens the whole aging; any late bucket opens
  // the overdue worklist (the report's own filter).
  const agingHref = (id) => (bucket) => reportLink(id, bucket === "current" ? {} : { status: "overdue" });

  // Twelve months, each its own P&L. A month opens that month's Profit & Loss.
  const trend = (summary.profitTrend || []).map((r) => {
    const d = new Date(r.from);
    return {
      label: r.label,
      short: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      revenue: r.revenue, costOfSales: r.costOfSales, grossProfit: r.grossProfit,
      to: canOpenReports ? reportHref("profit-loss", { period: "custom", from: ymd(r.from), to: ymd(r.to) }) : null,
    };
  });

  const supplierRows = (suppliers || [])
    .filter((s) => Math.abs(Number(s.netBalance || 0)) >= 1)
    .sort((a, b) => Number(b.netBalance) - Number(a.netBalance))
    .slice(0, 8)
    .map((s) => ({ ...s, id: s.supplierId, settled: Number(s.cashPaid || 0) + Number(s.otherSettlement || 0) + Number(s.totalCredits || 0) }));

  return (
    <>
      {glResult && <GlResultBanner result={glResult} onDismiss={onDismissGlResult} />}
      {!summary.glEnabled && (
        <div className="cc-banner"><MdErrorOutline size={18} style={{ flexShrink: 0 }} />
          <span>This company is not posting to the General Ledger yet, so ledger figures read zero. Ask your administrator to back-post it.</span>
        </div>
      )}

      {/* ── Profitability — the period ───────────────────────────────── */}
      <Section title="Profitability" kind="Selected period">
        <MetricGrid>
          <Metric label="Revenue" icon={MdTrendingUp} accent="#0d47a1" value={fmtMoney(income)}
            hint="Income accounts in the Profit & Loss — sales net of credit notes, excluding sales tax."
            to={reportLink("profit-loss")} />
          {hasGross && (
            <Metric label="Gross profit" icon={MdInventory2} accent="#00897b" value={fmtMoney(gross)}
              tone={gross < 0 ? "bad" : undefined}
              sub={costKnown
                ? `Cost of sales ${fmtMoney(summary.costOfSales)}${margin != null ? ` · ${pct(margin)} margin` : ""}`
                : "No cost of sales posted in this period, so this equals revenue"}
              hint="Revenue less cost of sales, the top of the Profit & Loss. Cost of sales is the cost of goods sold posted with each sale."
              to={reportLink("gross-profit")} />
          )}
          <Metric label="Expenses" icon={MdTrendingDown} accent="#c62828" value={fmtMoney(summary.expenses)}
            sub="Cost of sales and running costs"
            hint="Every expense account in the Profit & Loss, cost of sales included."
            to={reportLink("expenses")} />
          <Metric label={netProfit >= 0 ? "Net profit" : "Net loss"} icon={MdAttachMoney}
            accent={netProfit >= 0 ? "#2e7d32" : "#c62828"} value={fmtMoney(netProfit)}
            tone={netProfit >= 0 ? "good" : "bad"}
            sub={netMargin != null ? `${pct(netMargin)} of revenue` : "Revenue − expenses"}
            hint="Revenue less all expenses for the period, per the ledger."
            to={reportLink("profit-loss")} />
        </MetricGrid>
        {summary.profitNotice && <p className="cc-note">{summary.profitNotice}</p>}
      </Section>

      <div className="cc-split cc-split--wide" style={{ marginTop: "0.85rem" }}>
        <Panel title="Revenue, cost of sales and gross profit" kind="12 months to period end"
          action={<HeadLink to={canOpenReports ? reportHref("monthly-profit", { period: "custom", from: trend[0] ? ymd(summary.profitTrend[0].from) : summary.from, to: ymd(summary.to) }) : null}>Monthly profit</HeadLink>}>
          <TrendChart points={trend}
            bars={[{ key: "revenue", label: "Revenue", color: "#0d47a1" }, { key: "costOfSales", label: "Cost of sales", color: "#90a4c8" }]}
            line={{ key: "grossProfit", label: "Gross profit", color: "#00897b" }}
            ariaLabel="Monthly revenue, cost of sales and gross profit" />
          {canOpenReports && trend.length > 0 && <p className="cc-note">Select a month to open its Profit &amp; Loss.</p>}
        </Panel>
        <CashPanel total={summary.cashAndBankTotal} accounts={summary.cashAccounts || []} asAt={asAt}
          to={reportLink("cash-bank-summary")} />
      </div>

      {/* ── Cash movement — the period ───────────────────────────────── */}
      <Section title="Cash movement" kind="Selected period">
        <MetricGrid>
          <Metric label="Received" icon={MdReceiptLong} accent="#2e7d32" value={fmtMoney(summary.receiptsTotal)}
            sub={`${summary.receiptCount || 0} receipt${summary.receiptCount === 1 ? "" : "s"}`}
            to={reportLink("receipts-register")} />
          <Metric label="Paid out" icon={MdPayments} accent="#0d47a1" value={fmtMoney(summary.paymentsTotal)}
            sub={`${summary.paymentCount || 0} payment${summary.paymentCount === 1 ? "" : "s"}`}
            to={reportLink("payments-register")} />
          <Metric label="Net cash movement" icon={MdSwapVert} accent={netCash >= 0 ? "#2e7d32" : "#c62828"}
            value={fmtMoney(netCash)} tone={netCash >= 0 ? "good" : "bad"}
            sub="Received − paid out"
            hint="Money in less money out. Cash movement, not profit: a sale on credit is profit before it is cash."
            to={reportLink("cash-bank-summary")} />
          <Metric label="Cheques in hand" icon={MdCallReceived} accent="#2e7d32" value={fmtMoney(summary.pdcIn?.amount)}
            sub={chequeSub(summary.pdcIn)} tone={summary.pdcIn?.dueSoonCount > 0 ? "warn" : undefined}
            hint="Received cheques not yet cleared, whenever written."
            to={reportLink("cheques-in-hand")} />
          <Metric label="Cheques issued" icon={MdCallMade} accent="#0d47a1" value={fmtMoney(summary.pdcOut?.amount)}
            sub={chequeSub(summary.pdcOut)} tone={summary.pdcOut?.dueSoonCount > 0 ? "warn" : undefined}
            hint="Cheques you wrote that have not cleared, whenever written."
            to={reportLink("cheques-issued")} />
        </MetricGrid>
      </Section>

      {/* ── Receivables — as at period end ──────────────────────────── */}
      <Section title="Customers owe you" kind={asAt}
        action={<HeadLink to={reportLink("aged-receivables")}>Receivable aging</HeadLink>}>
        <div className="cc-split">
          <Panel>
            <BalanceHead total={rec.total} overdue={overdue(rec)} label="outstanding" />
            <AgingBar buckets={rec} hrefFor={agingHref("aged-receivables")} />
          </Panel>
          <Panel title="Largest customer balances">
            <PartyTable rows={(summary.topReceivables || []).map((r) => ({ ...r, id: r.partyId, late: overdue(r) }))}
              hrefFor={(r) => reportLink("customer-outstanding", { clientId: r.id })}
              emptyText="No customer owes anything."
              columns={[
                { key: "name", label: "Customer" },
                { key: "openDocuments", label: "Open bills", render: (r) => r.openDocuments },
                { key: "total", label: "Owed", money: true },
                { key: "late", label: "Overdue", money: true, tone: (r) => (r.late > 0 ? "bad" : undefined) },
              ]} />
          </Panel>
        </div>
      </Section>

      {/* ── Payables — as at period end ─────────────────────────────── */}
      <Section title="You owe suppliers" kind={asAt}
        action={<HeadLink to={reportLink("aged-payables")}>Payable aging</HeadLink>}>
        <div className="cc-split">
          <Panel>
            <BalanceHead total={pay.total} overdue={overdue(pay)} label="in unpaid bills" />
            <AgingBar buckets={pay} hrefFor={agingHref("aged-payables")} />
          </Panel>
          {canSupplierPayables && suppliers ? (
            <Panel title="Supplier balances"
              action={<HeadLink to="/supplier-payables">Supplier payables</HeadLink>}>
              <PartyTable rows={supplierRows}
                hrefFor={(r) => `/supplier-payables?supplierId=${r.id}`}
                emptyText="No supplier has a balance."
                columns={[
                  { key: "supplierName", label: "Supplier" },
                  { key: "purchases", label: "Purchased", money: true },
                  { key: "settled", label: "Paid & credited", money: true },
                  { key: "netBalance", label: "Balance", money: true, tone: (r) => (r.netBalance < 0 ? "good" : undefined) },
                ]} />
              <p className="cc-note">Totals to {fmtDate(summary.to)}, local purchases included. The balance also nets supplier credits and advances, so it can differ from unpaid bills on the left. A negative balance is a credit in your favour.</p>
            </Panel>
          ) : (
            <Panel title="Largest supplier balances">
              <PartyTable rows={(summary.topPayables || []).map((r) => ({ ...r, id: r.partyId, late: overdue(r) }))}
                hrefFor={(r) => reportLink("supplier-outstanding", { supplierId: r.id })}
                emptyText="Nothing is owed to suppliers."
                columns={[
                  { key: "name", label: "Supplier" },
                  { key: "openDocuments", label: "Open bills", render: (r) => r.openDocuments },
                  { key: "total", label: "Owed", money: true },
                  { key: "late", label: "Overdue", money: true, tone: (r) => (r.late > 0 ? "bad" : undefined) },
                ]} />
            </Panel>
          )}
        </div>
      </Section>

      {/* ── Tax positions — the period, per the ledger ──────────────── */}
      <Section title="Tax positions" kind="Selected period" action={<HeadLink to={reportLink("tax-summary")}>Tax summary</HeadLink>}>
        <MetricGrid min={180}>
          <Metric label="Output sales tax" accent="#0d47a1" value={fmtMoney(summary.outputTax)} sub="Owed to FBR" to={reportLink("tax-summary")} />
          <Metric label="Input sales tax" accent="#00897b" value={fmtMoney(summary.inputTax)} sub="Reclaimable" to={reportLink("tax-summary")} />
          <Metric label="Further tax" accent="#0d47a1" value={fmtMoney(summary.furtherTaxPayable)} sub="Owed to FBR" />
          <Metric label="WHT receivable" accent="#00897b" value={fmtMoney(summary.withholdingReceivable)} sub="Withheld by customers" />
          <Metric label="WHT payable" accent="#e65100" value={fmtMoney(summary.withholdingPayable)} sub="Withheld by you, owed to FBR" />
        </MetricGrid>
      </Section>

      {/* ── Recent money movement ───────────────────────────────────── */}
      <Section title="Recent activity" kind="Latest five">
        <div className="cc-split">
          <Panel title="Receipts" action={<HeadLink to={canOpenReceipts ? "/receipts" : null}>All receipts</HeadLink>}>
            <RecentTable rows={summary.recentReceipts} to={canOpenReceipts ? "/receipts" : null} empty="No receipts recorded yet." />
          </Panel>
          <Panel title="Payments" action={<HeadLink to={canOpenPayments ? "/payments" : null}>All payments</HeadLink>}>
            <RecentTable rows={summary.recentPayments} to={canOpenPayments ? "/payments" : null} empty="No payments recorded yet." />
          </Panel>
        </div>
      </Section>

      {ledgerFooter}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function chequeSub(d) {
  const count = d?.count || 0;
  const base = `${count} pending cheque${count !== 1 ? "s" : ""}`;
  return d?.dueSoonCount > 0 ? `${base} · ${d.dueSoonCount} due within 7 days (${fmtMoney(d.dueSoonAmount)})` : base;
}

function BalanceHead({ total, overdue, label }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.35rem 1rem", marginBottom: "0.75rem" }}>
      <span className="cc-metric__value">{fmtMoney(total)}</span>
      <span className="cc-metric__sub">{label}</span>
      {overdue > 0 && <span className="cc-metric__sub cc-tone--bad" style={{ fontWeight: 700 }}>{fmtMoney(overdue)} overdue</span>}
    </div>
  );
}

function RecentTable({ rows, to, empty }) {
  return (
    <PartyTable rows={(rows || []).slice(0, 5)} hrefFor={to ? () => to : null} emptyText={empty}
      columns={[
        { key: "contactName", label: "Party", render: (r) => <>{r.contactName || "(no contact)"} <span className="cc-metric__hint">{r.reference}</span></> },
        { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
        { key: "amount", label: "Amount", money: true },
      ]} />
  );
}

/** Cash & bank closing balance, with the per-account list one tap away. */
function CashPanel({ total, accounts, asAt, to }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel title="Cash & bank" kind={asAt} action={<HeadLink to={to}>Cash & bank summary</HeadLink>}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <span className="cc-metric__icon" style={{ color: "#00897b", background: "#00897b14", width: 34, height: 34 }}><MdAccountBalanceWallet size={18} /></span>
        <span className={`cc-metric__value ${Number(total) < 0 ? "cc-tone--bad" : ""}`}>{fmtMoney(total)}</span>
      </div>
      <p className="cc-metric__sub" style={{ margin: "0.3rem 0 0" }}>Closing balance of every cash and bank account</p>
      {accounts.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={st.expandToggle}>
            <MdExpandMore size={18} style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none", color: "#00897b" }} />
            {accounts.length} account{accounts.length !== 1 ? "s" : ""}
          </button>
          {open && (
            <PartyTable rows={accounts.map((a) => ({ ...a, id: a.accountId, label: `${a.code ? `${a.code} · ` : ""}${a.name}` }))}
              columns={[{ key: "label", label: "Account" }, { key: "balance", label: "Balance", money: true, tone: (r) => (r.balance < 0 ? "bad" : undefined) }]} />
          )}
        </>
      )}
    </Panel>
  );
}

/** Success banner with the counts from a rebuild (PostingRebuildResult). */
function GlResultBanner({ result, onDismiss }) {
  const chips = [
    ["Invoices posted", result.postedInvoices],
    ["Purchase bills posted", result.postedPurchaseBills],
    ["Debit notes posted", result.postedPurchaseDebitNotes],
    ["Payments posted", result.postedPayments],
    ["Transfers posted", result.postedTransfers],
    ["Entries removed", result.removedEntries],
  ].filter(([, v]) => Number(v || 0) > 0);
  return (
    <div style={st.resultBanner}>
      <MdCheckCircle size={20} style={{ color: "#2e7d32", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Ledger rebuilt</div>
        <div style={st.resultChips}>
          {chips.length === 0
            ? <span style={st.resultChip}>Nothing to post — ledger was already up to date</span>
            : chips.map(([label, v]) => <span key={label} style={st.resultChip}>{label}: <strong>{v}</strong></span>)}
        </div>
      </div>
      <button type="button" style={st.dismissBtn} onClick={onDismiss} aria-label="Dismiss"><MdClose size={16} /></button>
    </div>
  );
}

/** Ledger entry count, the Dr = Cr check, the lock date and Rebuild. */
function GlHealthFooter({ status, canManage, rebuilding, onRebuild }) {
  return (
    <div style={st.glFooter}>
      <MdBusiness size={14} aria-hidden />
      <span style={st.glFooterItem}>{Number(status.entryCount || 0).toLocaleString("en-PK")} journal entries</span>
      <span style={st.glFooterDot}>·</span>
      <span style={{ ...st.glFooterItem, color: status.isBalanced ? "#2e7d32" : "#c62828" }}>
        {status.isBalanced
          ? <><MdCheckCircle size={14} /> Σ Dr = Σ Cr ({fmtMoney(status.totalDebit)})</>
          : <><MdErrorOutline size={14} /> Out of balance — Dr {fmtMoney(status.totalDebit)} vs Cr {fmtMoney(status.totalCredit)}</>}
      </span>
      {status.lockDate && (
        <>
          <span style={st.glFooterDot}>·</span>
          <span style={st.glFooterItem}><MdLock size={13} /> Locked up to {fmtDate(status.lockDate)}</span>
        </>
      )}
      {canManage && (
        <button type="button" style={{ ...st.rebuildBtn, opacity: rebuilding ? 0.7 : 1 }} onClick={onRebuild} disabled={rebuilding}>
          <MdAutorenew size={16} style={rebuilding ? { animation: "acctdash-spin 1s linear infinite" } : undefined} />
          {rebuilding ? "Rebuilding…" : "Rebuild ledger"}
        </button>
      )}
    </div>
  );
}

const st = {
  expandToggle: {
    display: "flex", alignItems: "center", gap: 5, width: "100%", minHeight: 44, marginTop: "0.5rem",
    padding: "0.3rem 0", background: "none", border: "none", borderTop: "1px dashed #e6ecf4", boxShadow: "none",
    cursor: "pointer", font: "inherit", fontSize: "0.82rem", fontWeight: 700, color: "#1a2332",
  },
  resultBanner: {
    display: "flex", alignItems: "flex-start", gap: 10, padding: "0.8rem 1rem",
    borderRadius: 12, border: "1px solid #2e7d3240", background: "#f0f9f1", marginBottom: "0.85rem",
  },
  resultChips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 },
  resultChip: { fontSize: "0.75rem", background: "#fff", border: "1px solid #e8edf3", borderRadius: 999, padding: "0.2rem 0.6rem" },
  dismissBtn: {
    display: "grid", placeItems: "center", width: 44, height: 44, minWidth: 44, padding: 0,
    borderRadius: 8, border: "none", background: "transparent", color: "#5f6d7e", cursor: "pointer", boxShadow: "none", flexShrink: 0,
  },
  glFooter: {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem 0.6rem",
    marginTop: "1.4rem", paddingTop: "0.85rem", borderTop: "1px dashed #e6ecf4", fontSize: "0.76rem", color: "#5f6d7e",
  },
  glFooterItem: { display: "inline-flex", alignItems: "center", gap: 4, fontVariantNumeric: "tabular-nums" },
  glFooterDot: { opacity: 0.5 },
  rebuildBtn: {
    display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto",
    padding: "0.4rem 0.85rem", minHeight: 44, borderRadius: 8,
    border: "1px solid #e8edf3", background: "#fff", color: "#5f6d7e",
    fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", boxShadow: "none",
  },
};
