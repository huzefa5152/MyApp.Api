import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  MdAccountBalance, MdBusiness, MdExpandMore, MdSearch,
  MdFilterAltOff, MdInfoOutline,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, dropdownStyles } from "../theme";
import Pagination from "../Components/Pagination";
import { getCustomerLedgerSummary, getCustomerLedgerEntries } from "../api/customerLedgerApi";

/* ------------------------------------------------------------------ */
/*  Formatting                                                         */
/* ------------------------------------------------------------------ */

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Entry types, exactly as CustomerLedgerService emits them. */
const TYPES = ["Invoice", "Debit Note", "Credit Note", "Receipt", "Adjustment"];

/** Receipt methods, mirroring PaymentForm's list. Any method actually present
 *  in a loaded page is merged in too, so a custom value still filters. */
const METHODS = ["Cash", "Bank Transfer", "Cheque", "Online", "Other"];

/** Invoices / debit notes sit in the Credit column and push the balance up;
 *  receipts / credit notes / adjustments sit in Debit and pull it down. */
const isMoneyIn = (type) => type === "Receipt" || type === "Credit Note" || type === "Adjustment";

/* ------------------------------------------------------------------ */
/*  Customer Ledger                                                     */
/* ------------------------------------------------------------------ */

/**
 * One aggregate row per customer, each expanding IN PLACE to that customer's
 * full money in/out trail. No navigation: collapsing puts you straight back
 * on the list, and several rows can be open at once (tracked by clientId in
 * a Set).
 *
 * SIGN CONVENTION — the operator's own workbook, NOT textbook A/R:
 *   invoices + debit notes            → Credit column
 *   receipts + credit notes + adjust. → Debit column
 *   Balance = Opening + Σ Credit − Σ Debit   (positive = the customer owes,
 *   negative = they hold an advance)
 * The API returns figures this way already. This screen RENDERS them; it never
 * re-derives, negates or swaps a column.
 *
 * FILTERS split two ways:
 *   • from / to / type go to the server — they change the figures, so a change
 *     drops every cached per-customer trail and refetches whatever is open.
 *   • method and outstanding/advance are client-side; the API has no parameter
 *     for either, so they only hide rows that are already loaded.
 *
 * Gated by customerledger.list.view (route + page + nav entry all agree).
 */
export default function CustomerLedgerPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("customerledger.list.view");
  const companyId = selectedCompany?.id;

  // Server-side filters.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");

  // Client-side filters — they hide loaded rows, they never refetch.
  const [method, setMethod] = useState("");
  const [balance, setBalance] = useState("");     // "" | "outstanding" | "advance"
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [expanded, setExpanded] = useState(() => new Set());
  const [ledgers, setLedgers] = useState({});     // clientId → { loading, error, data, page }

  // Any of these changing re-bases every figure on screen.
  const ledgerKey = `${companyId || ""}|${from}|${to}|${type}`;

  // Mirrors of state read from inside the invalidation effect, so that effect
  // can stay keyed on ledgerKey alone instead of re-running on every expand.
  const openRef = useRef(expanded);
  useEffect(() => { openRef.current = expanded; }, [expanded]);

  // Bumped whenever the server-side filters change. A request that finishes
  // after its generation is stale gets dropped instead of overwriting fresher
  // data — otherwise a slow "all history" fetch could land on top of a
  // narrowed date window.
  const genRef = useRef(0);

  /* ---- summary ---------------------------------------------------- */

  const fetchSummary = useCallback(async () => {
    if (!companyId) { setRows([]); setError(""); return; }
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const { data } = await getCustomerLedgerSummary(companyId, params);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setRows([]);
      setError(err?.response?.data?.message || "Could not load the customer ledger.");
    } finally {
      setLoading(false);
    }
  }, [companyId, from, to]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  /* ---- one customer's trail (lazy — only when a row is opened) ----- */

  const fetchLedger = useCallback(async (clientId, pg) => {
    if (!companyId) return;
    const gen = genRef.current;
    setLedgers((prev) => ({
      ...prev,
      [clientId]: { ...(prev[clientId] || {}), loading: true, error: "" },
    }));
    try {
      const params = { page: pg || 1 };
      if (from) params.from = from;
      if (to) params.to = to;
      if (type) params.type = type;
      const { data } = await getCustomerLedgerEntries(companyId, clientId, params);
      if (genRef.current !== gen) return;
      setLedgers((prev) => ({
        ...prev,
        [clientId]: { loading: false, error: "", data, page: data?.page || pg || 1 },
      }));
    } catch (err) {
      if (genRef.current !== gen) return;
      setLedgers((prev) => ({
        ...prev,
        [clientId]: {
          loading: false, data: null,
          error: err?.response?.data?.message || "Could not load this customer's ledger.",
        },
      }));
    }
  }, [companyId, from, to, type]);

  // Drop every cached trail when the window or type changes, then refetch the
  // rows the operator has open. A COMPANY switch collapses them instead — the
  // open client ids belong to the company we just left.
  const prevCompanyRef = useRef(companyId);
  useEffect(() => {
    genRef.current += 1;
    setLedgers({});
    if (prevCompanyRef.current !== companyId) {
      prevCompanyRef.current = companyId;
      setExpanded(new Set());
      return;
    }
    openRef.current.forEach((id) => fetchLedger(id, 1));
    // fetchLedger changes exactly when ledgerKey does, so keying on ledgerKey
    // alone is equivalent and keeps this from firing on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerKey]);

  const toggleRow = (clientId) => {
    const isOpen = expanded.has(clientId);
    const next = new Set(expanded);
    if (isOpen) next.delete(clientId); else next.add(clientId);
    setExpanded(next);
    // Lazy: fetch the first time this customer is opened, not for every row.
    if (!isOpen && !ledgers[clientId]) fetchLedger(clientId, 1);
  };

  /* ---- client-side narrowing -------------------------------------- */

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(r.clientName || "").toLowerCase().includes(q)) return false;
      if (balance === "outstanding" && !(Number(r.outstanding) > 0)) return false;
      if (balance === "advance" && !(Number(r.advance) > 0)) return false;
      return true;
    });
  }, [rows, search, balance]);

  const totals = useMemo(() => visibleRows.reduce((acc, r) => ({
    opening: acc.opening + Number(r.opening || 0),
    invoiced: acc.invoiced + Number(r.invoiced || 0),
    received: acc.received + Number(r.received || 0),
    outstanding: acc.outstanding + Number(r.outstanding || 0),
    advance: acc.advance + Number(r.advance || 0),
    closing: acc.closing + Number(r.closing || 0),
  }), { opening: 0, invoiced: 0, received: 0, outstanding: 0, advance: 0, closing: 0 }),
  [visibleRows]);

  // Methods offered = the canonical list plus anything a loaded page actually
  // carries, so a hand-typed method is still selectable.
  const methodOptions = useMemo(() => {
    const seen = new Set(METHODS);
    Object.values(ledgers).forEach((s) => {
      (s?.data?.entries || []).forEach((e) => { if (e.method) seen.add(e.method); });
    });
    return Array.from(seen);
  }, [ledgers]);

  const filtersActive = !!(from || to || type || method || balance || search);
  const clearFilters = () => {
    setFrom(""); setTo(""); setType(""); setMethod(""); setBalance(""); setSearch("");
  };

  if (!canView) {
    return (
      <div style={{ padding: "2rem", color: colors.textSecondary }}>
        You don't have permission to view the customer ledger.
      </div>
    );
  }

  return (
    <div style={st.page}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
          <span style={st.headerIcon}><MdAccountBalance size={24} /></span>
          <div style={{ minWidth: 0 }}>
            <h2 style={st.h2}>Customer Ledger</h2>
            <div style={st.subtitle}>Every customer's balance, and the money in / out behind it</div>
          </div>
        </div>
      </div>

      {companies.length > 0 && (
        <div style={st.companyRow}>
          <MdBusiness size={20} color={colors.blue} />
          <select
            style={{ ...dropdownStyles.base, minHeight: 44 }}
            value={selectedCompany?.id || ""}
            onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
            aria-label="Company"
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select>
        </div>
      )}

      {!companyId ? (
        <div style={st.empty}>Select a company to view the customer ledger.</div>
      ) : (
        <>
          {/* ---- Filters ------------------------------------------- */}
          <div style={st.filterCard}>
            <div style={st.filterGrid}>
              <label style={st.field}>
                <span style={st.fieldLabel}>From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={st.input} />
              </label>
              <label style={st.field}>
                <span style={st.fieldLabel}>To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={st.input} />
              </label>
              <label style={st.field}>
                <span style={st.fieldLabel}>Transaction type</span>
                <select value={type} onChange={(e) => setType(e.target.value)} style={st.input}>
                  <option value="">All types</option>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={st.field}>
                <span style={st.fieldLabel}>Payment method</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)} style={st.input}>
                  <option value="">All methods</option>
                  {methodOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label style={st.field}>
                <span style={st.fieldLabel}>Balance</span>
                <select value={balance} onChange={(e) => setBalance(e.target.value)} style={st.input}>
                  <option value="">All customers</option>
                  <option value="outstanding">Has outstanding</option>
                  <option value="advance">Has advance</option>
                </select>
              </label>
              <label style={st.field}>
                <span style={st.fieldLabel}>Customer</span>
                <span style={{ position: "relative", display: "block" }}>
                  <MdSearch size={18} style={st.searchIcon} />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name…"
                    style={{ ...st.input, paddingLeft: 34 }}
                  />
                </span>
              </label>
            </div>

            <div style={st.filterFoot}>
              <span style={st.hint}>
                <MdInfoOutline size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  {from
                    ? "Opening carries in everything dated before the From date."
                    : "Opening is 0 until a From date is set — the window is all of history."}
                  {method ? " Payment method narrows the entries already loaded on a page (receipts only)." : ""}
                </span>
              </span>
              {filtersActive && (
                <button type="button" style={st.clearBtn} onClick={clearFilters}>
                  <MdFilterAltOff size={16} /> Clear filters
                </button>
              )}
            </div>
          </div>

          {/* ---- Totals across the visible customers --------------- */}
          {!loading && visibleRows.length > 0 && (
            <div style={st.totalsCard}>
              <span style={st.totalsLead}>
                {visibleRows.length} customer{visibleRows.length === 1 ? "" : "s"}
                {visibleRows.length !== rows.length ? ` of ${rows.length}` : ""}
              </span>
              <span style={st.figures}>
                <Figure label="Opening" value={totals.opening} />
                <Figure label="Invoiced" value={totals.invoiced} tone="up" />
                <Figure label="Received" value={totals.received} tone="down" />
                <Figure label="Outstanding" value={totals.outstanding} tone="owed" />
                <Figure label="Advance" value={totals.advance} tone="down" />
                <Figure label="Closing" value={totals.closing} tone="signed" strong />
              </span>
            </div>
          )}

          {/* ---- Customer rows ------------------------------------- */}
          {loading ? (
            <div style={st.empty}>Loading customer ledger…</div>
          ) : error ? (
            <div style={{ ...st.empty, color: colors.danger }}>{error}</div>
          ) : rows.length === 0 ? (
            <div style={st.empty}>No customer activity in this window.</div>
          ) : visibleRows.length === 0 ? (
            <div style={st.empty}>No customers match these filters.</div>
          ) : (
            <div style={st.list}>
              {visibleRows.map((r) => (
                <CustomerRow
                  key={r.clientId}
                  row={r}
                  open={expanded.has(r.clientId)}
                  state={ledgers[r.clientId]}
                  method={method}
                  onToggle={() => toggleRow(r.clientId)}
                  onPage={(pg) => fetchLedger(r.clientId, pg)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One customer — aggregate header + in-place trail                    */
/* ------------------------------------------------------------------ */

function CustomerRow({ row, open, state, method, onToggle, onPage }) {
  return (
    <div style={{ ...st.row, ...(open ? st.rowOpen : null) }}>
      {/* The whole aggregate block is the toggle, so a tap anywhere on the
          row opens it. Children are spans (phrasing content) so the button
          stays valid HTML and keeps native keyboard/focus behaviour. */}
      <button
        type="button"
        style={st.rowBtn}
        onClick={onToggle}
        aria-expanded={open}
        title={open ? "Collapse" : "Show this customer's ledger"}
      >
        <span style={st.rowHead}>
          <MdExpandMore
            size={22}
            style={{ ...st.chev, transform: open ? "rotate(180deg)" : "none" }}
            aria-hidden="true"
          />
          {/* Line-clamped, never nowrap+ellipsis — similar-prefix customer
              names must stay distinguishable (dashboard incident 2026-05-13). */}
          <span style={st.clientName}>{row.clientName}</span>
          <span style={{ ...st.closingPill, ...pillTone(row.closing) }}>
            {Number(row.closing) < 0 ? "Advance" : "Owes"} Rs {fmtMoney(Math.abs(row.closing))}
          </span>
        </span>

        <span style={st.figures}>
          <Figure label="Opening" value={row.opening} />
          <Figure label="Invoiced" value={row.invoiced} tone="up" />
          <Figure label="Received" value={row.received} tone="down" />
          <Figure label="Outstanding" value={row.outstanding} tone="owed" />
          <Figure label="Advance" value={row.advance} tone="down" />
          <Figure label="Closing" value={row.closing} tone="signed" strong />
        </span>
      </button>

      {open && <LedgerPanel state={state} method={method} onPage={onPage} />}
    </div>
  );
}

/** The expanded trail. Lazily fetched — `state` is undefined until first open. */
function LedgerPanel({ state, method, onPage }) {
  if (!state || state.loading) {
    return <div style={st.panelMsg}>Loading ledger…</div>;
  }
  if (state.error) {
    return <div style={{ ...st.panelMsg, color: colors.danger }}>{state.error}</div>;
  }
  const d = state.data;
  if (!d) return null;

  const all = d.entries || [];
  // Method is client-side: the API has no parameter for it, so it narrows the
  // page that is already loaded. Say so rather than silently under-reporting.
  const shown = method ? all.filter((e) => (e.method || "") === method) : all;
  const hiddenByMethod = all.length - shown.length;

  return (
    <div style={st.panel}>
      <div style={st.figures}>
        <Figure label="Opening" value={d.openingBalance} />
        <Figure label="Total credit" value={d.totalCredit} tone="up" />
        <Figure label="Total debit" value={d.totalDebit} tone="down" />
        <Figure label="Closing" value={d.closingBalance} tone="signed" strong />
      </div>

      {shown.length === 0 ? (
        <div style={st.panelMsg}>
          {all.length === 0 ? "No entries in this window." : `No ${method} entries on this page.`}
        </div>
      ) : (
        <>
          {/* Scrolls inside itself — the page body must never scroll sideways. */}
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Reference</th>
                  <th style={st.th}>Type</th>
                  <th style={st.thNum}>Debit</th>
                  <th style={st.thNum}>Credit</th>
                  <th style={st.thNum}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={`${e.type}-${e.docId ?? "n"}-${e.reference}-${i}`} style={st.tr}>
                    <td style={st.td}>{fmtDate(e.date)}</td>
                    <td style={st.td}>
                      <span style={st.ref}>{e.reference || "—"}</span>
                      {(e.method || e.bankAccount || e.description) && (
                        <span style={st.refSub}>
                          {[e.method, e.bankAccount, e.description].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td style={st.td}>
                      <span style={{ ...st.typePill, ...typeTone(e.type) }}>{e.type}</span>
                    </td>
                    <td style={st.tdNum}>{Number(e.debit) ? fmtMoney(e.debit) : <span style={st.nil}>—</span>}</td>
                    <td style={st.tdNum}>{Number(e.credit) ? fmtMoney(e.credit) : <span style={st.nil}>—</span>}</td>
                    <td style={{ ...st.tdNum, ...st.tdBal, color: Number(e.balance) < 0 ? colors.success : colors.textPrimary }}>
                      {fmtMoney(e.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hiddenByMethod > 0 && (
            <div style={st.panelNote}>
              {hiddenByMethod} entr{hiddenByMethod === 1 ? "y" : "ies"} on this page hidden by the {method} filter.
              Paging still counts all {d.total} entries in the window.
            </div>
          )}
        </>
      )}

      <Pagination
        page={d.page || 1}
        totalPages={d.pageSize > 0 ? Math.ceil((d.total || 0) / d.pageSize) : 0}
        total={d.total || 0}
        onPage={onPage}
        unit="entries"
      />
    </div>
  );
}

/** Label + right-aligned figure. Reads as a statement line at every width. */
function Figure({ label, value, tone, strong }) {
  const n = Number(value || 0);
  let color = colors.textPrimary;
  if (tone === "up") color = colors.blue;
  else if (tone === "down") color = colors.success;
  else if (tone === "owed") color = n > 0 ? "#c05621" : colors.textSecondary;
  else if (tone === "signed") color = n < 0 ? colors.success : colors.textPrimary;

  return (
    <span style={st.figure}>
      <span style={st.figureLabel}>{label}</span>
      <span style={{ ...st.figureValue, color, fontWeight: strong ? 800 : 700 }}>{fmtMoney(n)}</span>
    </span>
  );
}

const pillTone = (closing) =>
  Number(closing) < 0
    ? { background: "#e8f6ec", color: "#1b6b32" }
    : Number(closing) > 0
      ? { background: "#fdf0e6", color: "#a8501a" }
      : { background: colors.inputBg, color: colors.textSecondary };

const typeTone = (type) =>
  isMoneyIn(type)
    ? { background: "#e8f6ec", color: "#1b6b32" }
    : { background: "#e8effa", color: colors.blue };

/* ------------------------------------------------------------------ */

const st = {
  page: { padding: "clamp(0.75rem, 2vw, 1.5rem)" },

  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  headerIcon: { display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: `${colors.blue}15`, color: colors.blue },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary, lineHeight: 1.1 },
  subtitle: { fontSize: "0.8rem", color: colors.textSecondary, marginTop: 2 },

  companyRow: { marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" },

  filterCard: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 14, padding: "0.9rem 1rem", marginBottom: "1rem" },
  filterGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" },
  field: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  fieldLabel: { fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary },
  input: { ...dropdownStyles.base, width: "100%", minWidth: 0, minHeight: 44, boxSizing: "border-box" },
  searchIcon: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary, pointerEvents: "none" },

  filterFoot: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" },
  hint: { display: "flex", alignItems: "flex-start", gap: 5, fontSize: "0.74rem", color: colors.textSecondary, lineHeight: 1.4, flex: "1 1 240px", minWidth: 0 },
  clearBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },

  totalsCard: { background: "linear-gradient(135deg, rgba(13,71,161,0.05), rgba(0,137,123,0.06))", border: `1px solid ${colors.cardBorder}`, borderRadius: 14, padding: "0.8rem 1rem", marginBottom: "1rem" },
  totalsLead: { display: "block", fontSize: "0.78rem", fontWeight: 700, color: colors.textSecondary, marginBottom: "0.55rem" },

  list: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  row: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" },
  // Full `border` shorthand, not `borderColor`: st.row already sets the
  // shorthand, and toggling a longhand on top of it makes React warn about
  // mixing the two (and can leave the border half-applied on rerender).
  rowOpen: { border: `1px solid ${colors.blue}55`, boxShadow: "0 4px 18px rgba(13,71,161,0.10)" },
  rowBtn: { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", font: "inherit", color: "inherit", cursor: "pointer", padding: "0.85rem 1rem", minHeight: 44 },

  rowHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: "0.6rem", minWidth: 0 },
  chev: { color: colors.blue, flexShrink: 0, transition: "transform 0.2s ease" },
  // NEVER nowrap + ellipsis here: "MEKO FABRICS" and "MEKO DENIM" must not
  // render identically (dashboard incident 2026-05-13).
  clientName: { flex: 1, minWidth: 0, fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflowWrap: "anywhere" },
  closingPill: { flexShrink: 0, padding: "0.2rem 0.55rem", borderRadius: 999, fontSize: "0.72rem", fontWeight: 800, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },

  // Collapses to one column on a phone with no media query.
  figures: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.3rem 1.2rem" },
  figure: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "0.22rem 0", borderBottom: `1px dotted ${colors.cardBorder}`, minWidth: 0 },
  figureLabel: { fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, whiteSpace: "nowrap" },
  figureValue: { fontSize: "0.88rem", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },

  panel: { borderTop: `1px solid ${colors.cardBorder}`, background: colors.inputBg, padding: "0.85rem 1rem 0.4rem" },
  panelMsg: { padding: "1rem", textAlign: "center", fontSize: "0.85rem", color: colors.textSecondary },
  panelNote: { marginTop: "0.5rem", fontSize: "0.74rem", color: colors.textSecondary, lineHeight: 1.4 },

  tableWrap: { marginTop: "0.7rem", overflowX: "auto", WebkitOverflowScrolling: "touch", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, background: colors.cardBg },
  table: { width: "100%", minWidth: 620, borderCollapse: "collapse", fontSize: "0.82rem" },
  th: { textAlign: "left", padding: "0.5rem 0.7rem", fontSize: "0.66rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary, borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  thNum: { textAlign: "right", padding: "0.5rem 0.7rem", fontSize: "0.66rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textSecondary, borderBottom: `1px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  tr: { borderBottom: `1px solid ${colors.inputBg}` },
  td: { padding: "0.45rem 0.7rem", color: colors.textPrimary, verticalAlign: "top" },
  tdNum: { padding: "0.45rem 0.7rem", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: colors.textPrimary, verticalAlign: "top" },
  tdBal: { fontWeight: 800 },
  nil: { color: colors.textSecondary, opacity: 0.6 },
  ref: { display: "block", fontWeight: 700, overflowWrap: "anywhere" },
  refSub: { display: "block", fontSize: "0.72rem", color: colors.textSecondary, marginTop: 1, overflowWrap: "anywhere" },
  typePill: { display: "inline-block", padding: "0.12rem 0.45rem", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, whiteSpace: "nowrap" },

  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
