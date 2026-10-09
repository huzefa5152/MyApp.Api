// src/pages/AccountingDashboardPage.jsx
//
// Dashboards → Accounting — cash & liquidity, working capital, profitability,
// tax positions and cheque exposure on one screen.
//
// Data:
//   • GET /accounting/summary/company/{id}?from&to  → AccountingSummaryDto
//     (gated by accounting.dashboard.view — the same key as this page). It
//     carries the ledger's health too (entry count, Σ Dr / Σ Cr, lock date),
//     so a dashboard-only role needs no second permission and no second call.
//   • POST /accounting/gl/company/{id}/rebuild (accounting.gl.manage) — the
//     button renders only for that key. It re-posts the whole ledger and can
//     take a minute, so it shows a spinner and stays disabled while in flight.
//
// There is no "enable GL" control: on this line the General Ledger is on for
// every company from creation and cannot be turned off.
//
// Every ledger figure is the total of the report its card opens, taken from
// that report on the server, so the dashboard and the report behind it cannot
// tell different stories. Cards open their report only when the caller holds
// accounting.reports.view; otherwise they render as plain cards.
//
// Layout (mobile-first, no media queries):
//   • Row 1  Cash & liquidity  — Cash & Bank (expandable per-account),
//            Receipts, Payments, Net cash flow
//   • Row 2  Working capital   — Receivables / Payables aging bars, Net position
//   • Row 3  Profitability     — Income / Expenses / Net profit
//   • Row 4  Tax positions     — output, input, further tax, WHT both ways
//   • Row 5  Cheques + recents — uncleared cheques in/out, last 5 receipts / payments
//   • Footer Ledger health     — entry count, Σ Dr = Σ Cr, lock date, Rebuild
//
// All grids use repeat(auto-fit, minmax(min(Npx, 100%), 1fr)) so they
// collapse to a single column on phones. Money renders as "Rs. 1,234"
// with negatives in parens. Long operator-supplied names line-clamp to
// 2 lines (never nowrap-ellipsis). Interactive controls are ≥44px tall.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  MdBusiness, MdAccountBalanceWallet, MdReceiptLong, MdPayments, MdSwapVert,
  MdTrendingUp, MdTrendingDown, MdAttachMoney, MdAccountBalance, MdExpandMore,
  MdCallReceived, MdCallMade, MdAutorenew, MdCheckCircle, MdErrorOutline,
  MdLock, MdClose, MdCalendarToday, MdChevronRight,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, dropdownStyles } from "../theme";
import { getAccountingSummary, rebuildGl } from "../api/accountingApi";

// ── Formatting helpers ───────────────────────────────────────────────

/** "Rs. 1,234" — negatives in parens: "(Rs. 1,234)". */
const fmtMoney = (v) => {
  const n = Number(v || 0);
  const abs = Math.abs(n).toLocaleString("en-PK", { maximumFractionDigits: 0 });
  return n < 0 ? `(Rs. ${abs})` : `Rs. ${abs}`;
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const pad2 = (n) => String(n).padStart(2, "0");
/** Local yyyy-MM-dd for <input type="date"> (avoids UTC off-by-one). */
const toInputDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** The current month to date — the server's own default. */
const currentMonthRange = () => {
  const now = new Date();
  return {
    from: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toInputDate(now),
  };
};

// Aging buckets in display order — green (safe) → red (overdue).
const AGING_BUCKETS = [
  { key: "current",   label: "Current", color: "#2e7d32" },
  { key: "days1To30", label: "1–30",    color: "#7cb342" },
  { key: "days31To60", label: "31–60",  color: "#f9a825" },
  { key: "days61To90", label: "61–90",  color: "#ef6c00" },
  { key: "over90",    label: "90+",     color: "#c62828" },
];

// Line-clamp for user-supplied names — NEVER nowrap+ellipsis (see CLAUDE.md).
const clamp2 = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

export default function AccountingDashboardPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has, loading: permsLoading } = usePermissions();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const canView = has("accounting.dashboard.view");
  // The rebuild endpoint is gated on accounting.gl.manage — the button is too.
  const canManageGl = has("accounting.gl.manage");
  const canOpenReports = has("accounting.reports.view");
  const canOpenReceipts = has("accounting.receipts.view");
  const canOpenPayments = has("accounting.payments.view");

  const companyId = selectedCompany?.id;

  // Draft dates live in the inputs; `period` only changes on Apply so we
  // don't refetch on every keystroke of the date picker.
  const [draft, setDraft] = useState(currentMonthRange);
  const [period, setPeriod] = useState(draft);

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rebuilding, setRebuilding] = useState(false);
  // PostingRebuildResult from the last rebuild — shown as a banner.
  const [glResult, setGlResult] = useState(null);

  const load = useCallback(async () => {
    if (!companyId || !canView) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await getAccountingSummary(companyId, { from: period.from, to: period.to });
      setSummary(data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load the accounting summary.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, canView, period]);

  useEffect(() => { load(); }, [load]);

  // A stale rebuild result belongs to the previous company.
  useEffect(() => { setGlResult(null); }, [companyId]);

  // Dashboard → report, carrying the dashboard's own period so the report opens
  // on the numbers the card just showed. Null when the caller cannot read the
  // reports, so the card renders as a plain card rather than a dead link.
  const reportLink = useCallback(
    (reportId) => {
      if (!canOpenReports) return null;
      const qs = new URLSearchParams({ period: "custom", from: period.from, to: period.to });
      return `/accounting/reports/catalog/${reportId}?${qs}`;
    },
    [canOpenReports, period]
  );

  const applyPeriod = () => {
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

  if (permsLoading) {
    return <div style={st.empty}>Loading…</div>;
  }
  if (!canView) {
    return (
      <div style={{ padding: "2rem", color: colors.textSecondary }}>
        You don't have permission to view the accounting dashboard.
      </div>
    );
  }

  const netCashFlow = summary ? Number(summary.receiptsTotal || 0) - Number(summary.paymentsTotal || 0) : 0;
  const netPosition = summary ? Number(summary.receivables?.total || 0) - Number(summary.payables?.total || 0) : 0;

  return (
    <div style={st.page}>
      {/* Spinner keyframes for the rebuild button. */}
      <style>{`@keyframes acctdash-spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={st.headerIcon}><MdAccountBalance size={24} /></span>
          <div>
            <h2 style={st.h2}>Accounting</h2>
            <div style={st.subtitle}>Cash, receivables, payables &amp; profit at a glance</div>
          </div>
        </div>
      </div>

      {/* Company selector — same mechanism as Receipts/Payments. */}
      {companies.length > 1 && (
        <div style={st.companyRow}>
          <MdBusiness size={20} color={colors.blue} style={{ flexShrink: 0 }} />
          <select
            style={{ ...dropdownStyles.base, flex: "1 1 auto", minWidth: 0, maxWidth: 260 }}
            aria-label="Company"
            value={selectedCompany?.id || ""}
            onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select>
        </div>
      )}

      {!companyId ? (
        <div style={st.empty}>Select a company to view its accounting summary.</div>
      ) : (
        <>
          {/* Period picker — from/to date inputs + Apply. Defaults to the
              current month to date. Wraps to full-width controls on phones. */}
          <div style={st.periodBar}>
            <span style={st.periodLabel}><MdCalendarToday size={15} /> Period</span>
            <input
              type="date"
              style={st.dateInput}
              value={draft.from}
              max={draft.to || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              aria-label="From date"
            />
            <span style={{ color: colors.textSecondary }}>→</span>
            <input
              type="date"
              style={st.dateInput}
              value={draft.to}
              min={draft.from || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              aria-label="To date"
            />
            <button type="button" style={st.applyBtn} onClick={applyPeriod}>Apply</button>
          </div>

          {error && (
            <div style={st.errorBanner}>
              <MdErrorOutline size={18} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {loading && !summary && <div style={st.empty}>Loading accounting summary…</div>}

          {summary && (
            <>
              {glResult && <GlResultBanner result={glResult} onDismiss={() => setGlResult(null)} />}

              {/* GL is on from creation on this line; a company that predates
                  the module and was never back-posted is the only way to be
                  here, and it is an operator matter, not a button. */}
              {!summary.glEnabled && (
                <div style={st.errorBanner}>
                  <MdErrorOutline size={18} style={{ flexShrink: 0 }} />
                  <span>This company is not posting to the General Ledger yet, so ledger figures read zero. Ask your administrator to back-post it.</span>
                </div>
              )}

              {/* ── Row 1 · Cash & liquidity ─────────────────────────── */}
              <SectionLabel>Cash &amp; liquidity</SectionLabel>
              <div style={st.kpiGrid}>
                <CashCard
                  total={summary.cashAndBankTotal}
                  accounts={summary.cashAccounts || []}
                  asOf={summary.to}
                  to={reportLink("cash-bank-summary")}
                  onOpen={navigate}
                />
                <MoneyCard
                  label="Receipts (period)"
                  icon={MdReceiptLong}
                  accent={colors.success}
                  value={fmtMoney(summary.receiptsTotal)}
                  sub={`${summary.receiptCount || 0} receipt${summary.receiptCount === 1 ? "" : "s"}`}
                  to={reportLink("receipts-register")}
                  onOpen={navigate}
                />
                <MoneyCard
                  label="Payments (period)"
                  icon={MdPayments}
                  accent={colors.blue}
                  value={fmtMoney(summary.paymentsTotal)}
                  sub={`${summary.paymentCount || 0} payment${summary.paymentCount === 1 ? "" : "s"}`}
                  to={reportLink("payments-register")}
                  onOpen={navigate}
                />
                <MoneyCard
                  label="Net cash flow"
                  icon={MdSwapVert}
                  accent={netCashFlow >= 0 ? colors.success : colors.danger}
                  value={fmtMoney(netCashFlow)}
                  valueColor={netCashFlow >= 0 ? "#2e7d32" : colors.danger}
                  sub="Receipts − payments"
                  to={reportLink("cash-bank-summary")}
                  onOpen={navigate}
                />
              </div>

              {/* ── Row 2 · Working capital ──────────────────────────── */}
              <SectionLabel>Working capital</SectionLabel>
              <div style={st.kpiGrid}>
                <AgingCard
                  title="Receivables" icon={MdCallReceived} accent={colors.teal}
                  data={summary.receivables} emptyText="Nothing outstanding from customers."
                  to={reportLink("aged-receivables")} onOpen={navigate}
                />
                <AgingCard
                  title="Payables" icon={MdCallMade} accent="#e65100"
                  data={summary.payables} emptyText="Nothing owed to suppliers."
                  to={reportLink("aged-payables")} onOpen={navigate}
                />
                <MoneyCard
                  label="Net position"
                  icon={MdAccountBalance}
                  accent={netPosition >= 0 ? colors.success : colors.danger}
                  value={fmtMoney(netPosition)}
                  valueColor={netPosition >= 0 ? "#2e7d32" : colors.danger}
                  sub="Receivables − payables"
                  to={reportLink("aged-receivables")}
                  onOpen={navigate}
                />
              </div>

              {/* ── Row 3 · Profitability ────────────────────────────── */}
              <SectionLabel>Profitability (period)</SectionLabel>
              <div style={st.kpiGrid}>
                <MoneyCard
                  label="Income" icon={MdTrendingUp} accent={colors.success}
                  value={fmtMoney(summary.income)}
                  to={reportLink("profit-loss")} onOpen={navigate}
                />
                <MoneyCard
                  label="Expenses" icon={MdTrendingDown} accent={colors.danger}
                  value={fmtMoney(summary.expenses)}
                  sub="Cost of sales and running costs"
                  to={reportLink("expenses")} onOpen={navigate}
                />
                <MoneyCard
                  label={Number(summary.netProfit || 0) >= 0 ? "Net profit" : "Net loss"}
                  icon={MdAttachMoney}
                  accent={Number(summary.netProfit || 0) >= 0 ? colors.success : colors.danger}
                  value={fmtMoney(summary.netProfit)}
                  valueColor={Number(summary.netProfit || 0) >= 0 ? "#2e7d32" : colors.danger}
                  sub="Income − expenses"
                  to={reportLink("profit-loss")} onOpen={navigate}
                />
              </div>

              {/* ── Row 4 · Tax positions (period, per the ledger) ───── */}
              <SectionLabel>Tax positions (period)</SectionLabel>
              <div style={st.kpiGrid}>
                <MoneyCard label="Output sales tax" icon={MdReceiptLong} accent={colors.blue}
                  value={fmtMoney(summary.outputTax)} sub="Owed to FBR"
                  to={reportLink("tax-summary")} onOpen={navigate} />
                <MoneyCard label="Input sales tax" icon={MdReceiptLong} accent={colors.teal}
                  value={fmtMoney(summary.inputTax)} sub="Reclaimable"
                  to={reportLink("tax-summary")} onOpen={navigate} />
                <MoneyCard label="Further tax" icon={MdReceiptLong} accent={colors.blue}
                  value={fmtMoney(summary.furtherTaxPayable)} sub="Owed to FBR" />
                <MoneyCard label="WHT receivable" icon={MdReceiptLong} accent={colors.teal}
                  value={fmtMoney(summary.withholdingReceivable)} sub="Withheld by customers" />
                <MoneyCard label="WHT payable" icon={MdReceiptLong} accent="#e65100"
                  value={fmtMoney(summary.withholdingPayable)} sub="Withheld by you, owed to FBR" />
              </div>

              {/* ── Row 5 · Cheques + recent money movement ──────────── */}
              <SectionLabel>Cheques &amp; recent activity</SectionLabel>
              <div style={st.listGrid}>
                <PdcCard
                  title="Cheques in hand" icon={MdCallReceived} accent={colors.success} data={summary.pdcIn}
                  to={reportLink("cheques-in-hand")} onOpen={navigate}
                />
                <PdcCard
                  title="Cheques issued" icon={MdCallMade} accent={colors.blue} data={summary.pdcOut}
                  to={reportLink("cheques-issued")} onOpen={navigate}
                />
                <RecentCard
                  title="Recent receipts" accent={colors.success} rows={summary.recentReceipts || []}
                  emptyText="No receipts recorded yet."
                  onOpenRow={canOpenReceipts ? () => navigate("/receipts") : null}
                />
                <RecentCard
                  title="Recent payments" accent={colors.blue} rows={summary.recentPayments || []}
                  emptyText="No payments recorded yet."
                  onOpenRow={canOpenPayments ? () => navigate("/payments") : null}
                />
              </div>

              {/* ── Ledger health footer ─────────────────────────────── */}
              {summary.glEnabled && summary.ledger && (
                <GlHealthFooter status={summary.ledger} canManage={canManageGl} rebuilding={rebuilding} onRebuild={handleRebuild} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────

function SectionLabel({ children }) {
  return <div style={st.sectionLabel}>{children}</div>;
}

/**
 * Makes a KPI card open its report.
 *
 * The dashboard is the starting point for an investigation, so a figure the
 * operator can question should be reachable in one click. Rendered as a real
 * button when there is somewhere to go — keyboard and screen readers get the
 * affordance too — and as a plain div when there isn't, so a card never looks
 * clickable and then do nothing. `to` is null when the user lacks report
 * permission, which is why the guard is here and not at the call sites.
 */
function Clickable({ to, onOpen, children }) {
  const [hover, setHover] = useState(false);
  if (!to) return <div style={st.card}>{children}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(to)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(to); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...st.card,
        cursor: "pointer",
        transform: hover ? "translateY(-2px)" : "none",
        boxShadow: hover ? "0 10px 24px rgba(13,71,161,0.14)" : st.card.boxShadow,
        transition: "transform 0.18s ease, box-shadow 0.18s ease",
      }}
    >
      {children}
      <span style={{ ...st.drillHint, opacity: hover ? 1 : 0.55 }}>
        View report <MdChevronRight size={14} />
      </span>
    </div>
  );
}

/** Generic KPI card — accent strip, label, big money value, optional sub. */
function MoneyCard({ label, icon: Icon, accent, value, valueColor, sub, children, to, onOpen }) {
  return (
    <Clickable to={to} onOpen={onOpen}>
      <div style={{ ...st.accentStrip, background: accent }} />
      <div style={st.cardBody}>
        <div style={st.cardLabelRow}>
          <span style={{ ...st.cardIcon, background: `${accent}15`, color: accent }}><Icon size={16} /></span>
          <span style={st.cardLabel}>{label}</span>
        </div>
        <div style={{ ...st.cardValue, color: valueColor || colors.textPrimary }}>{value}</div>
        {sub && <div style={st.cardSub}>{sub}</div>}
        {children}
      </div>
    </Clickable>
  );
}

/** Cash & Bank total with an expandable per-account balance list. */
function CashCard({ total, accounts, asOf, to, onOpen }) {
  const [open, setOpen] = useState(false);
  const count = accounts.length;
  return (
    <MoneyCard
      label="Cash & Bank"
      icon={MdAccountBalanceWallet}
      accent={colors.teal}
      value={fmtMoney(total)}
      sub={asOf ? `Closing balance at ${fmtDate(asOf)}` : undefined}
      to={to}
      onOpen={onOpen}
    >
      {count > 0 && (
        <div style={{ marginTop: 8, borderTop: `1px dashed ${colors.cardBorder}`, paddingTop: 4 }}>
          {/* Inside a clickable card: expanding the balance list must not also
              navigate away from the dashboard. */}
          <button
            type="button"
            style={st.expandToggle}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            aria-expanded={open}
          >
            <MdExpandMore
              size={18}
              style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none", color: colors.teal }}
            />
            {count} account{count !== 1 ? "s" : ""}
            {!open && <span style={st.expandHint}>view balances</span>}
          </button>
          {open && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
              {accounts.map((a) => (
                <div key={a.accountId} style={st.accountRow}>
                  <span style={{ ...clamp2, flex: 1, minWidth: 0, fontWeight: 600, color: colors.textPrimary }}>
                    {a.code ? `${a.code} · ` : ""}{a.name}
                  </span>
                  <span style={st.accountBal}>{fmtMoney(a.balance)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </MoneyCard>
  );
}

/** Receivables / payables total + horizontal aging bucket bars. */
function AgingCard({ title, icon: Icon, accent, data, emptyText, to, onOpen }) {
  const buckets = data || {};
  const total = Number(buckets.total || 0);
  return (
    <Clickable to={to} onOpen={onOpen}>
      <div style={{ ...st.accentStrip, background: accent }} />
      <div style={st.cardBody}>
        <div style={st.cardLabelRow}>
          <span style={{ ...st.cardIcon, background: `${accent}15`, color: accent }}><Icon size={16} /></span>
          <span style={st.cardLabel}>{title}</span>
        </div>
        <div style={{ ...st.cardValue, color: colors.textPrimary }}>{fmtMoney(total)}</div>
        {total <= 0 ? (
          <div style={st.cardSub}>{emptyText}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {AGING_BUCKETS.map((b) => {
              const amount = Number(buckets[b.key] || 0);
              const pct = Math.max(0, Math.min(100, (amount / total) * 100));
              return (
                <div key={b.key}>
                  <div style={st.bucketHead}>
                    <span style={{ fontWeight: 600 }}>{b.label}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(amount)}</span>
                  </div>
                  <div style={st.bucketTrack} role="img" aria-label={`${b.label}: ${fmtMoney(amount)}`}>
                    <div style={{ ...st.bucketFill, width: `${pct}%`, background: b.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Clickable>
  );
}

/** Post-dated cheque exposure card with a due-soon (next 7 days) highlight. */
function PdcCard({ title, icon: Icon, accent, data, to, onOpen }) {
  const d = data || {};
  const count = d.count || 0;
  return (
    <Clickable to={to} onOpen={onOpen}>
      <div style={{ ...st.accentStrip, background: accent }} />
      <div style={st.cardBody}>
        <div style={st.cardLabelRow}>
          <span style={{ ...st.cardIcon, background: `${accent}15`, color: accent }}><Icon size={16} /></span>
          <span style={st.cardLabel}>{title}</span>
        </div>
        <div style={{ ...st.cardValue, color: colors.textPrimary }}>{fmtMoney(d.amount)}</div>
        <div style={st.cardSub}>{count} pending cheque{count !== 1 ? "s" : ""}</div>
        {(d.dueSoonCount || 0) > 0 && (
          <div style={st.dueSoonChip}>
            <MdErrorOutline size={14} style={{ flexShrink: 0 }} />
            {d.dueSoonCount} due within 7 days · {fmtMoney(d.dueSoonAmount)}
          </div>
        )}
      </div>
    </Clickable>
  );
}

/** Last 5 receipts / payments — reference, contact, amount, date. */
function RecentCard({ title, accent, rows, emptyText, onOpenRow }) {
  const items = rows.slice(0, 5);
  return (
    <div style={st.card}>
      <div style={{ ...st.accentStrip, background: accent }} />
      <div style={st.cardBody}>
        <div style={st.cardLabelRow}>
          <span style={{ ...st.cardIcon, background: `${accent}15`, color: accent }}>
            <MdReceiptLong size={16} />
          </span>
          <span style={st.cardLabel}>{title}</span>
        </div>
        {items.length === 0 ? (
          <div style={{ ...st.cardSub, fontStyle: "italic" }}>{emptyText}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {items.map((r) => (
              <div
                key={r.id}
                style={{ ...st.recentRow, ...(onOpenRow ? { cursor: "pointer" } : {}) }}
                onClick={onOpenRow ? () => onOpenRow(r) : undefined}
                role={onOpenRow ? "button" : undefined}
                tabIndex={onOpenRow ? 0 : undefined}
                onKeyDown={onOpenRow ? (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenRow(r); }
                } : undefined}
                title={onOpenRow ? `Open the ${title.toLowerCase().replace("recent ", "")} list` : undefined}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...st.recentRef, color: accent }}>{r.reference}</div>
                  <div style={{ ...clamp2, fontSize: "0.78rem", color: colors.textPrimary, fontWeight: 600 }}>
                    {r.contactName || "(no contact)"}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={st.recentAmt}>{fmtMoney(r.amount)}</div>
                  <div style={st.recentDate}>{fmtDate(r.date)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
        <div style={{ fontWeight: 700, color: colors.textPrimary, fontSize: "0.9rem" }}>
          Ledger rebuilt
        </div>
        <div style={st.resultChips}>
          {chips.length === 0
            ? <span style={st.resultChip}>Nothing to post — ledger was already up to date</span>
            : chips.map(([label, v]) => (
                <span key={label} style={st.resultChip}>{label}: <strong>{v}</strong></span>
              ))}
        </div>
      </div>
      <button type="button" style={st.dismissBtn} onClick={onDismiss} aria-label="Dismiss">
        <MdClose size={16} />
      </button>
    </div>
  );
}

/** Small muted footer — ledger entry count, Dr/Cr balance check, lock date. */
function GlHealthFooter({ status, canManage, rebuilding, onRebuild }) {
  return (
    <div style={st.glFooter}>
      <span style={st.glFooterItem}>
        {Number(status.entryCount || 0).toLocaleString("en-PK")} journal entries
      </span>
      <span style={st.glFooterDot}>·</span>
      <span style={{ ...st.glFooterItem, color: status.isBalanced ? "#2e7d32" : colors.danger }}>
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

// ── Styles ───────────────────────────────────────────────────────────

const st = {
  page: { padding: 0, maxWidth: 1480, margin: "0 auto" },

  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  headerIcon: { display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, borderRadius: 12, flexShrink: 0, background: `${colors.blue}15`, color: colors.blue },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary, lineHeight: 1.1 },
  subtitle: { fontSize: "0.8rem", color: colors.textSecondary, marginTop: 2 },

  companyRow: { marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" },

  periodBar: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" },
  periodLabel: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.8rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" },
  dateInput: {
    ...dropdownStyles.base,
    minWidth: "min(150px, 100%)",
    flex: "1 1 140px",
    maxWidth: 190,
    minHeight: 44,
    cursor: "pointer",
  },
  applyBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "0.55rem 1.2rem", minHeight: 44, borderRadius: 8, border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff", fontWeight: 700, cursor: "pointer", flexShrink: 0,
  },

  errorBanner: {
    display: "flex", alignItems: "center", gap: 8, padding: "0.75rem 1rem",
    borderRadius: 10, border: `1px solid ${colors.danger}40`, background: colors.dangerLight,
    color: colors.danger, fontSize: "0.86rem", fontWeight: 600, marginBottom: "1rem",
  },

  sectionLabel: {
    fontSize: "0.72rem", fontWeight: 700, color: colors.textSecondary,
    textTransform: "uppercase", letterSpacing: "0.12em",
    margin: "1.1rem 0 0.5rem", paddingLeft: 2,
  },

  // Card grid per spec — collapses to one column on phones without media queries.
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
    gap: "0.85rem",
    alignItems: "start",
  },
  // Row 4 lists get a wider minimum so a 5-row receipt list stays legible.
  listGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
    gap: "0.85rem",
    alignItems: "start",
  },

  // "View report" hint that fades in on hover — present but never shouting.
  drillHint: {
    display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2,
    padding: "0 0.9rem 0.6rem", fontSize: "0.7rem", fontWeight: 700,
    color: colors.blue, transition: "opacity 0.18s ease",
  },
  card: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 14,
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)", position: "relative", overflow: "hidden",
    display: "flex", minWidth: 0,
  },
  accentStrip: { width: 5, flexShrink: 0 },
  cardBody: { padding: "0.9rem 1rem", flex: 1, minWidth: 0 },
  cardLabelRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  cardIcon: { display: "grid", placeItems: "center", width: 28, height: 28, padding: 0, borderRadius: 8, flexShrink: 0 },
  cardLabel: { fontSize: "0.78rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 0, ...clamp2 },
  cardValue: { fontSize: "1.45rem", fontWeight: 800, lineHeight: 1.15, wordBreak: "break-word", fontVariantNumeric: "tabular-nums" },
  cardSub: { fontSize: "0.78rem", color: colors.textSecondary, marginTop: 4 },

  expandToggle: {
    display: "flex", alignItems: "center", gap: 5, width: "100%", minHeight: 44,
    padding: "0.3rem 0", background: "none", border: "none", boxShadow: "none", cursor: "pointer",
    font: "inherit", fontSize: "0.82rem", fontWeight: 700, color: colors.textPrimary,
  },
  expandHint: { marginLeft: "auto", fontSize: "0.72rem", fontWeight: 500, color: colors.textSecondary },
  accountRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "0.4rem 0.5rem",
    borderRadius: 6, background: colors.inputBg, fontSize: "0.8rem",
  },
  accountBal: { fontWeight: 700, color: colors.textPrimary, fontVariantNumeric: "tabular-nums", flexShrink: 0 },

  bucketHead: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.74rem", color: colors.textSecondary, marginBottom: 2 },
  bucketTrack: { height: 8, borderRadius: 999, background: colors.inputBg, overflow: "hidden" },
  bucketFill: { height: "100%", borderRadius: 999, transition: "width 0.3s ease" },

  dueSoonChip: {
    display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8,
    padding: "0.3rem 0.65rem", borderRadius: 999, fontSize: "0.75rem", fontWeight: 700,
    background: "#fff8e1", border: "1px solid #f9a82550", color: "#b26a00",
  },

  recentRow: {
    display: "flex", alignItems: "flex-start", gap: 10, padding: "0.45rem 0.55rem",
    borderRadius: 8, background: colors.inputBg,
  },
  recentRef: { fontSize: "0.74rem", fontWeight: 800, letterSpacing: "0.02em" },
  recentAmt: { fontSize: "0.84rem", fontWeight: 700, color: colors.textPrimary, fontVariantNumeric: "tabular-nums" },
  recentDate: { fontSize: "0.72rem", color: colors.textSecondary, marginTop: 1 },


  resultBanner: {
    display: "flex", alignItems: "flex-start", gap: 10, padding: "0.8rem 1rem",
    borderRadius: 12, border: "1px solid #2e7d3240", background: "#f0f9f1",
    marginBottom: "0.35rem",
  },
  resultChips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 },
  resultChip: {
    fontSize: "0.75rem", color: colors.textPrimary, background: "#fff",
    border: `1px solid ${colors.cardBorder}`, borderRadius: 999, padding: "0.2rem 0.6rem",
  },
  dismissBtn: {
    display: "grid", placeItems: "center", width: 44, height: 44, minWidth: 44, padding: 0,
    borderRadius: 8, border: "none", background: "transparent", color: colors.textSecondary,
    cursor: "pointer", boxShadow: "none", flexShrink: 0,
  },

  glFooter: {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem 0.6rem",
    marginTop: "1.4rem", paddingTop: "0.85rem", borderTop: `1px dashed ${colors.cardBorder}`,
    fontSize: "0.76rem", color: colors.textSecondary,
  },
  glFooterItem: { display: "inline-flex", alignItems: "center", gap: 4, fontVariantNumeric: "tabular-nums" },
  glFooterDot: { opacity: 0.5 },
  rebuildBtn: {
    display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto",
    padding: "0.4rem 0.85rem", minHeight: 44, borderRadius: 8,
    border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.textSecondary,
    fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", boxShadow: "none",
  },

  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
