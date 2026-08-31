import { useEffect, useMemo, useState } from "react";
import { MdFilterAltOff, MdSearch, MdTune } from "react-icons/md";
import { colors, dropdownStyles, formStyles } from "../theme";
import { FILTERS, PERIOD_OPTIONS } from "../config/accountingReports";
import SearchableSelect from "./SearchableSelect";
import { getAccountsFlat, getBankCashAccounts } from "../api/accountApi";
import { getDivisionsByCompany } from "../api/divisionApi";
import { getClientsByCompany } from "../api/clientApi";
import { getSuppliersByCompany } from "../api/supplierApi";

/**
 * The one filter bar every accounting report uses.
 *
 * A report declares which controls it wants (`filters` in the registry) and only
 * those render — so the bar is never cluttered with a control that does nothing
 * for the report on screen, and every report's filters look and behave the same.
 *
 * Two-stage state on purpose: the operator edits a DRAFT and presses Apply. A
 * report over a year of journal lines is not something to re-run on every
 * keystroke. Applied filters then show as chips, so what shaped the numbers is
 * visible without reopening the panel — the same list the server prints on the
 * report header and in Excel.
 */
export default function ReportFilterBar({
  companyId,
  filters = [],
  value,
  onApply,
  loading = false,
  accountKind = null,   // "cash" | "bank" — narrows the account picker for the books
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);

  // Lookups, loaded once per company and only for the controls in play.
  const [accounts, setAccounts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [clients, setClients] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const wants = useMemo(() => new Set(filters), [filters]);

  // Re-sync the draft when the caller changes the applied filters from outside
  // (a drill-down arriving from another report, or a reset).
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    const need = (k) => wants.has(k);

    (async () => {
      try {
        const jobs = [];
        if (need(FILTERS.account) || need(FILTERS.accountGroup))
          jobs.push(getAccountsFlat(companyId).then(({ data }) => alive && setAccounts(data || [])));
        if (need(FILTERS.paymentAccount))
          jobs.push(getBankCashAccounts(companyId).then(({ data }) => alive && setBankAccounts(data || [])));
        if (need(FILTERS.division))
          jobs.push(getDivisionsByCompany(companyId).then(({ data }) => alive && setDivisions(data || [])));
        if (need(FILTERS.payee) || need(FILTERS.client))
          jobs.push(getClientsByCompany(companyId).then(({ data }) => alive && setClients(data || [])));
        if (need(FILTERS.payee) || need(FILTERS.supplier))
          jobs.push(getSuppliersByCompany(companyId).then(({ data }) => alive && setSuppliers(data || [])));
        await Promise.allSettled(jobs);
      } catch {
        // A lookup that fails leaves its picker empty rather than blocking the
        // report — the operator can still run it unfiltered.
      }
    })();
    return () => { alive = false; };
  }, [companyId, wants]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const apply = () => {
    // Page always resets on a filter change — staying on page 7 of a different
    // result set shows an empty table and looks broken.
    onApply({ ...draft, page: 1 });
    setOpen(false);
  };

  const reset = () => {
    const cleared = { period: draft.period || "thisMonth", page: 1, pageSize: draft.pageSize };
    setDraft(cleared);
    onApply(cleared);
  };

  // ── Option sets ────────────────────────────────────────────────────────────
  const expenseAccounts = useMemo(() => {
    if (accountKind === "cash" || accountKind === "bank") {
      // Cash/Bank Book: only asset accounts that look like money.
      return accounts.filter((a) => a.accountType === "Asset" && isMoneyAccount(a, accountKind));
    }
    return accounts.filter((a) => a.accountType === "Expense");
  }, [accounts, accountKind]);

  const accountGroups = useMemo(() => {
    const seen = new Map();
    accounts
      .filter((a) => (accountKind ? true : a.accountType === "Expense"))
      .forEach((a) => {
        if (a.accountGroupId && !seen.has(a.accountGroupId))
          seen.set(a.accountGroupId, { id: a.accountGroupId, name: a.accountGroupName || "—" });
      });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, accountKind]);

  // The payee list follows the payee TYPE, so a "Supplier" filter never offers
  // customers. With no type chosen, both are offered and labelled.
  const payeeOptions = useMemo(() => {
    if (draft.payeeType === "Client") return clients.map((c) => ({ id: c.id, name: c.name }));
    if (draft.payeeType === "Supplier") return suppliers.map((s) => ({ id: s.id, name: s.name }));
    if (draft.payeeType === "Other") return [];
    return [
      ...clients.map((c) => ({ id: c.id, name: `${c.name} · Customer` })),
      ...suppliers.map((s) => ({ id: s.id, name: `${s.name} · Supplier` })),
    ];
  }, [draft.payeeType, clients, suppliers]);

  const isCustom = draft.period === "custom";

  // Chips describe the APPLIED filters, not the draft.
  const chips = useMemo(
    () => describeChips(value, { accounts, bankAccounts, divisions, clients, suppliers, accountGroups }),
    [value, accounts, bankAccounts, divisions, clients, suppliers, accountGroups]
  );

  const clearOne = (key) => {
    const next = { ...value, page: 1 };
    delete next[key];
    if (key === "payeeType") delete next.payeeId;
    onApply(next);
  };

  return (
    <div style={st.wrap}>
      {/* Always-visible row: period + search + the toggle. The two controls an
          operator reaches for most often never hide behind a panel. */}
      <div style={st.topRow}>
        <label style={st.field}>
          <span style={st.label}>Period</span>
          <select
            style={{ ...dropdownStyles.base, ...st.control }}
            value={draft.period || "thisMonth"}
            onChange={(e) => set({ period: e.target.value })}
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        {isCustom && (
          <>
            <label style={st.field}>
              <span style={st.label}>From</span>
              <input
                type="date"
                style={{ ...formStyles.input, ...st.control }}
                value={draft.from || ""}
                onChange={(e) => set({ from: e.target.value })}
              />
            </label>
            <label style={st.field}>
              <span style={st.label}>To</span>
              <input
                type="date"
                style={{ ...formStyles.input, ...st.control }}
                value={draft.to || ""}
                onChange={(e) => set({ to: e.target.value })}
              />
            </label>
          </>
        )}

        {wants.has(FILTERS.search) && (
          <label style={{ ...st.field, flex: "2 1 220px" }}>
            <span style={st.label}>Search</span>
            <div style={st.searchWrap}>
              <MdSearch size={18} color={colors.textSecondary} style={st.searchIcon} />
              <input
                style={{ ...formStyles.input, ...st.control, paddingLeft: 36 }}
                placeholder="Account, description, reference…"
                value={draft.search || ""}
                onChange={(e) => set({ search: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && apply()}
              />
            </div>
          </label>
        )}

        <div style={st.actions}>
          {hasMoreFilters(wants) && (
            <button
              type="button"
              style={{ ...st.ghostBtn, ...(open ? st.ghostBtnActive : {}) }}
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              <MdTune size={18} />
              <span>Filters</span>
            </button>
          )}
          <button type="button" style={st.applyBtn} onClick={apply} disabled={loading}>
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>
      </div>

      {/* The rest, collapsed by default so the report is what fills the screen. */}
      {open && (
        <div style={st.panel}>
          <div style={st.grid}>
            {wants.has(FILTERS.division) && divisions.length > 0 && (
              <Field label="Branch">
                <SelectPlain
                  value={draft.divisionId}
                  onChange={(v) => set({ divisionId: v })}
                  placeholder="All branches"
                  options={divisions.map((d) => ({ id: d.id, name: d.name }))}
                />
              </Field>
            )}

            {wants.has(FILTERS.account) && (
              <Field label={accountKind ? "Account" : "Expense account"}>
                <SearchableSelect
                  items={expenseAccounts.map((a) => ({
                    id: a.id,
                    name: a.name,
                    group: a.accountGroupName || "",
                  }))}
                  value={draft.accountId ?? ""}
                  onChange={(id) => set({ accountId: id === "" ? undefined : id })}
                  searchKeys={["name", "group"]}
                  placeholder={accountKind ? "All accounts" : "All expense accounts"}
                  style={st.control}
                />
              </Field>
            )}

            {wants.has(FILTERS.accountGroup) && accountGroups.length > 0 && (
              <Field label="Category (account group)">
                <SelectPlain
                  value={draft.accountGroupId}
                  onChange={(v) => set({ accountGroupId: v })}
                  placeholder="All categories"
                  options={accountGroups}
                />
              </Field>
            )}

            {wants.has(FILTERS.paymentAccount) && (
              <Field label="Payment account">
                <SearchableSelect
                  items={bankAccounts.map((a) => ({ id: a.id, name: a.name }))}
                  value={draft.paymentAccountId ?? ""}
                  onChange={(id) => set({ paymentAccountId: id === "" ? undefined : id })}
                  placeholder="All bank & cash"
                  style={st.control}
                />
              </Field>
            )}

            {wants.has(FILTERS.payeeType) && (
              <Field label="Payee type">
                <SelectPlain
                  value={draft.payeeType}
                  // Changing the type invalidates the chosen payee.
                  onChange={(v) => set({ payeeType: v, payeeId: undefined })}
                  placeholder="Any"
                  options={[
                    { id: "Client", name: "Customer" },
                    { id: "Supplier", name: "Supplier" },
                    { id: "Other", name: "Other (one-off payee)" },
                  ]}
                  numeric={false}
                />
              </Field>
            )}

            {wants.has(FILTERS.payee) && draft.payeeType !== "Other" && (
              <Field label="Payee">
                <SearchableSelect
                  items={payeeOptions}
                  value={draft.payeeId ?? ""}
                  onChange={(id) => set({ payeeId: id === "" ? undefined : id })}
                  placeholder="Anyone"
                  style={st.control}
                />
              </Field>
            )}

            {wants.has(FILTERS.tax) && (
              <Field label="Tax">
                <SelectPlain
                  value={draft.tax}
                  onChange={(v) => set({ tax: v })}
                  placeholder="Any"
                  options={[
                    { id: "taxed", name: "With tax only" },
                    { id: "untaxed", name: "Without tax only" },
                  ]}
                  numeric={false}
                />
              </Field>
            )}

            {wants.has(FILTERS.status) && (
              <Field label="Status">
                <SelectPlain
                  value={draft.status}
                  onChange={(v) => set({ status: v })}
                  placeholder="Any"
                  options={STATUS_OPTIONS}
                  numeric={false}
                />
              </Field>
            )}
          </div>

          <div style={st.panelFooter}>
            <button type="button" style={st.resetBtn} onClick={reset}>
              <MdFilterAltOff size={17} />
              <span>Clear filters</span>
            </button>
            <button type="button" style={st.applyBtn} onClick={apply} disabled={loading}>
              {loading ? "Loading…" : "Apply"}
            </button>
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div style={st.chipRow}>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              style={st.chip}
              onClick={() => clearOne(c.key)}
              title={`Remove: ${c.text}`}
            >
              <span style={st.chipText}>{c.text}</span>
              <span style={st.chipX} aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <label style={st.field}>
      <span style={st.label}>{label}</span>
      {children}
    </label>
  );
}

/**
 * A plain themed <select> for short option lists. Long lists (accounts, payees)
 * use SearchableSelect instead — a 500-client native dropdown is unusable.
 */
function SelectPlain({ value, onChange, placeholder, options, numeric = true }) {
  return (
    <select
      style={{ ...dropdownStyles.base, ...st.control }}
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(undefined);
        onChange(numeric ? parseInt(raw, 10) : raw);
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}

const STATUS_OPTIONS = [
  { id: "cheque", name: "Cheque pending" },
  { id: "chequeCleared", name: "Cheque cleared" },
  { id: "bounced", name: "Cheque bounced" },
  { id: "reconciled", name: "Reconciled" },
  { id: "unreconciled", name: "Not reconciled" },
  { id: "cancelled", name: "Cancelled only" },
  { id: "journal", name: "Journal entries only" },
];

const hasMoreFilters = (wants) =>
  [FILTERS.division, FILTERS.account, FILTERS.accountGroup, FILTERS.paymentAccount,
   FILTERS.payeeType, FILTERS.payee, FILTERS.tax, FILTERS.status].some((k) => wants.has(k));

/** Bank/cash split follows the account NAME, matching the server's resolution. */
function isMoneyAccount(a, kind) {
  const name = (a.name || "").toLowerCase();
  const looksCash = name.includes("cash") || name.includes("petty");
  const group = (a.accountGroupName || "").toLowerCase();
  const inMoneyGroup = group.includes("bank") || group.includes("cash");
  if (!inMoneyGroup && a.controlType !== "BankCash") return false;
  return kind === "cash" ? looksCash : !looksCash;
}

/**
 * Human labels for the applied filters. Deliberately mirrors the server's
 * FiltersApplied list so screen, print and Excel tell the same story.
 */
function describeChips(applied, lookups) {
  const out = [];
  const name = (list, id, key = "name") => list.find((x) => x.id === id)?.[key];

  if (applied.divisionId)
    out.push({ key: "divisionId", text: `Branch: ${name(lookups.divisions, applied.divisionId) || applied.divisionId}` });
  if (applied.accountId)
    out.push({ key: "accountId", text: `Account: ${name(lookups.accounts, applied.accountId) || applied.accountId}` });
  if (applied.accountGroupId)
    out.push({ key: "accountGroupId", text: `Category: ${name(lookups.accountGroups, applied.accountGroupId) || applied.accountGroupId}` });
  if (applied.paymentAccountId)
    out.push({ key: "paymentAccountId", text: `Paid from: ${name(lookups.bankAccounts, applied.paymentAccountId) || applied.paymentAccountId}` });
  if (applied.payeeType)
    out.push({ key: "payeeType", text: `Payee type: ${applied.payeeType === "Client" ? "Customer" : applied.payeeType}` });
  if (applied.payeeId) {
    const who = name(lookups.clients, applied.payeeId) || name(lookups.suppliers, applied.payeeId);
    out.push({ key: "payeeId", text: `Payee: ${who || applied.payeeId}` });
  }
  if (applied.tax)
    out.push({ key: "tax", text: `Tax: ${applied.tax === "taxed" ? "with tax" : applied.tax === "untaxed" ? "without tax" : `${applied.tax}%`}` });
  if (applied.status)
    out.push({ key: "status", text: `Status: ${STATUS_OPTIONS.find((s) => s.id === applied.status)?.name || applied.status}` });
  if (applied.search)
    out.push({ key: "search", text: `Search: "${applied.search}"` });

  return out;
}

// ── Styles ──────────────────────────────────────────────────────────────────
const st = {
  wrap: {
    background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14,
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
    padding: "0.9rem clamp(0.75rem, 1.6vw, 1.1rem)",
    marginBottom: "1rem",
  },
  topRow: { display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "0.75rem" },

  // auto-fit so the panel goes 4-up → 2-up → 1-up with no media queries
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))",
    gap: "0.75rem 1rem",
  },
  panel: { marginTop: "0.9rem", paddingTop: "0.9rem", borderTop: `1px solid ${colors.cardBorder}` },
  panelFooter: {
    display: "flex", justifyContent: "flex-end", gap: "0.6rem",
    marginTop: "0.9rem", flexWrap: "wrap",
  },

  field: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 170px", minWidth: 0 },
  label: {
    fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.textSecondary,
  },
  // 44px min tap target on every control (mobile-first standard).
  control: { minHeight: 44, width: "100%", minWidth: 0, fontSize: "0.88rem" },

  searchWrap: { position: "relative", display: "flex", alignItems: "center" },
  searchIcon: { position: "absolute", left: 10, pointerEvents: "none" },

  actions: { display: "flex", gap: "0.5rem", alignItems: "flex-end", marginLeft: "auto" },
  applyBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    minHeight: 44, padding: "0 1.3rem", borderRadius: 10, border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer",
    boxShadow: "0 2px 8px rgba(13,71,161,0.22)",
  },
  ghostBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    minHeight: 44, padding: "0 0.95rem", borderRadius: 10,
    border: `1px solid ${colors.inputBorder}`, background: colors.inputBg,
    color: colors.textSecondary, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
  },
  ghostBtnActive: { borderColor: colors.blue, color: colors.blue, background: "#eef4fd" },
  resetBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    minHeight: 44, padding: "0 0.95rem", borderRadius: 10,
    border: `1px solid ${colors.inputBorder}`, background: "transparent",
    color: colors.textSecondary, fontWeight: 600, fontSize: "0.85rem", cursor: "pointer",
  },

  chipRow: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.8rem" },
  chip: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "0.3rem 0.6rem", borderRadius: 20,
    background: "#eef4fd", border: `1px solid #d6e4f7`,
    color: colors.blue, fontSize: "0.76rem", fontWeight: 600,
    cursor: "pointer", maxWidth: "100%",
  },
  // Never nowrap-ellipsis a filter value — similar-prefix names must stay
  // distinguishable (the MEKO FABRICS / MEKO DENIM lesson).
  chipText: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", textAlign: "left" },
  chipX: { fontSize: "1rem", lineHeight: 1, opacity: 0.7 },
};
