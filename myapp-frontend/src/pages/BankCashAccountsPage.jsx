import { useState, useEffect, useCallback, useMemo } from "react";
import { MdAccountBalance, MdAdd, MdSearch, MdVisibility, MdClose, MdBusiness, MdFactCheck, MdUploadFile } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { colors, formStyles, modalSizes, dropdownStyles } from "../theme";
import { getBankCashAccounts, createAccount, getCoaTree } from "../api/accountApi";
import { getGlStatus, getBankReconSummary } from "../api/accountingApi";
import AccountLedgerDialog from "../Components/AccountLedgerDialog";
import ReconcileModal from "../Components/ReconcileModal";
import StatementImportModal from "../Components/StatementImportModal";
import DivisionSelect from "../Components/DivisionSelect";

// "- PKR 10,306,052.29" for negatives, "PKR 3,517,780.34" otherwise — matches
// the reference product's bank-list convention.
const money = (n) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "- " : ""}PKR ${s}`;
};

// Flatten the Balance-Sheet asset groups out of the CoA tree so the quick-create
// can offer a place to file the new account (bank/cash accounts live under an
// asset group).
function flattenGroups(nodes, depth = 0, out = []) {
  for (const g of nodes || []) {
    out.push({ id: g.id, name: `${"  ".repeat(depth)}${g.name}` });
    flattenGroups(g.children, depth + 1, out);
  }
  return out;
}

/**
 * Accounting → Bank & Cash Accounts. A focused list of just the company's
 * bank/cash accounts with their live balance and a one-click ledger drill-down
 * (the reference product's "Bank and Cash Accounts" tab). The accounts are
 * ordinary Chart-of-Accounts accounts with ControlType = BankCash; this screen
 * is the friendly front door for them. Gated by accounting.coa.*.
 */
export default function BankCashAccountsPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("accounting.coa.view");
  const canManage = has("accounting.coa.manage");
  const canViewDivisions = has("divisions.manage.view");
  const canReconcile = has("accounting.reconciliation.view");
  const companyId = selectedCompany?.id;

  const [accounts, setAccounts] = useState([]);
  const [assetGroups, setAssetGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [glOff, setGlOff] = useState(false);
  const [search, setSearch] = useState("");
  const [ledgerAccount, setLedgerAccount] = useState(null); // { id, name, code }
  const [reconcileAccount, setReconcileAccount] = useState(null); // { id, name, code }
  const [importAccount, setImportAccount] = useState(null); // { id, name, code }
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) { setAccounts([]); setAssetGroups([]); return; }
    setLoading(true);
    try {
      // With reconciliation permission, the summary endpoint gives actual +
      // cleared + pending in one call; otherwise fall back to the plain
      // bank/cash list (actual balance only).
      const [bankRes, treeRes, statusRes] = await Promise.all([
        canReconcile ? getBankReconSummary(companyId) : getBankCashAccounts(companyId),
        getCoaTree(companyId).catch(() => null),
        getGlStatus(companyId).catch(() => null),
      ]);
      const rows = (bankRes.data || []).map((r) => canReconcile
        ? {
            id: r.accountId, name: r.name, code: r.code, balance: r.actualBalance,
            clearedBalance: r.clearedBalance, pendingDeposits: r.pendingDeposits,
            pendingWithdrawals: r.pendingWithdrawals,
            uncategorizedReceipts: r.uncategorizedReceipts, uncategorizedPayments: r.uncategorizedPayments,
            uncategorizedCount: r.uncategorizedCount,
          }
        : { id: r.id, name: r.name, code: r.code, balance: r.balance, accountGroupId: r.accountGroupId });
      setAccounts(rows);
      setAssetGroups(flattenGroups(treeRes?.data?.balanceSheet));
      setGlOff(statusRes?.data ? statusRes.data.enabled === false : false);
    } catch { setAccounts([]); }
    finally { setLoading(false); }
  }, [companyId, canReconcile]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      a.name.toLowerCase().includes(q) || (a.code || "").toLowerCase().includes(q));
  }, [accounts, search]);

  const total = useMemo(() => filtered.reduce((s, a) => s + (Number(a.balance) || 0), 0), [filtered]);
  const defaultGroupId = useMemo(() => {
    if (accounts[0]?.accountGroupId) return accounts[0].accountGroupId;
    const bankish = assetGroups.find((g) => /bank|cash/i.test(g.name));
    return bankish?.id || assetGroups[0]?.id || null;
  }, [accounts, assetGroups]);

  if (!canView) {
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to view bank &amp; cash accounts.</div>;
  }

  return (
    <div>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={st.headerIcon}><MdAccountBalance size={26} color="#fff" /></div>
          <div>
            <h2 style={st.h2}>Bank &amp; Cash Accounts</h2>
            <p style={st.subtitle}>Each account's live balance — click a row to see the transactions behind it.</p>
          </div>
        </div>
        {canManage && (
          <button style={st.primaryBtn} onClick={() => setShowCreate(true)} title="Create a new bank or cash account">
            <MdAdd size={18} /> New Bank / Cash Account
          </button>
        )}
      </div>

      {companies.length > 0 && (
        <div style={{ marginBottom: "0.85rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <MdBusiness size={20} color={colors.blue} />
          <select
            style={dropdownStyles.base}
            value={selectedCompany?.id || ""}
            onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select>
        </div>
      )}

      <div style={st.toolbar}>
        <div style={st.searchWrap}>
          <MdSearch size={18} color={colors.textSecondary} />
          <input
            style={st.searchInput}
            placeholder="Search by name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {glOff && <span style={st.glChipOff}>GL off — balances show opening only</span>}
      </div>

      {!companyId ? (
        <div style={st.empty}>Select a company to view its bank &amp; cash accounts.</div>
      ) : loading ? (
        <div style={st.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={st.empty}>
          {accounts.length === 0
            ? "No bank or cash accounts yet. Create one, or add an account with control type “Bank & Cash” in Chart of Accounts."
            : "No accounts match your search."}
        </div>
      ) : (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Name</th>
                <th style={{ ...st.th, width: 100 }}>Code</th>
                {canReconcile && <th style={{ ...st.th, textAlign: "right" }}>Cleared</th>}
                {canReconcile && <th style={{ ...st.th, textAlign: "right" }}>Pending In</th>}
                {canReconcile && <th style={{ ...st.th, textAlign: "right" }}>Pending Out</th>}
                {canReconcile && <th style={{ ...st.th, textAlign: "center" }}>Uncategorized</th>}
                <th style={{ ...st.th, textAlign: "right" }}>Actual Balance</th>
                <th style={{ ...st.th, width: 80, textAlign: "center" }}>Ledger</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} style={st.tr} onClick={() => setLedgerAccount({ id: a.id, name: a.name, code: a.code })} title="View transactions">
                  <td style={st.td}><span style={st.accName}>{a.name}</span></td>
                  <td style={st.td}>{a.code ? <span style={st.code}>{a.code}</span> : <span style={st.muted}>—</span>}</td>
                  {canReconcile && <td style={{ ...st.td, textAlign: "right", color: (Number(a.clearedBalance) || 0) < 0 ? "#b71c1c" : colors.textSecondary, whiteSpace: "nowrap" }}>{money(a.clearedBalance)}</td>}
                  {canReconcile && <td style={{ ...st.td, textAlign: "right", color: a.pendingDeposits ? "#1b7a3d" : colors.textSecondary, whiteSpace: "nowrap" }}>{a.pendingDeposits ? money(a.pendingDeposits) : "—"}</td>}
                  {canReconcile && <td style={{ ...st.td, textAlign: "center", whiteSpace: "nowrap" }}>
                    {a.uncategorizedCount ? (
                      <button
                        type="button"
                        style={{ ...st.reviewLink, color: colors.blue }}
                        title="Import / categorize statement lines"
                        onClick={(e) => { e.stopPropagation(); setImportAccount({ id: a.id, name: a.name, code: a.code }); }}
                      >
                        {a.uncategorizedCount} to review
                      </button>
                    ) : <span style={st.muted}>—</span>}
                  </td>}
                  <td style={{ ...st.td, textAlign: "right", fontWeight: 700, color: (Number(a.balance) || 0) < 0 ? "#b71c1c" : colors.textPrimary, whiteSpace: "nowrap" }}>{money(a.balance)}</td>
                  <td style={{ ...st.td, textAlign: "center" }}>
                    <button style={st.iconBtn} title="View ledger" onClick={(e) => { e.stopPropagation(); setLedgerAccount({ id: a.id, name: a.name, code: a.code }); }}>
                      <MdVisibility size={17} />
                    </button>
                    {canManage && (
                      <button style={st.iconBtn} title="Reconcile this account" onClick={(e) => { e.stopPropagation(); setReconcileAccount({ id: a.id, name: a.name, code: a.code }); }}>
                        <MdFactCheck size={17} />
                      </button>
                    )}
                    {canManage && (
                      <button style={st.iconBtn} title="Import bank statement" onClick={(e) => { e.stopPropagation(); setImportAccount({ id: a.id, name: a.name, code: a.code }); }}>
                        <MdUploadFile size={17} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={st.footTd} colSpan={2}>{filtered.length} account{filtered.length === 1 ? "" : "s"}</td>
                {canReconcile && <td style={{ ...st.footTd, textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>{money(filtered.reduce((s, a) => s + (Number(a.clearedBalance) || 0), 0))}</td>}
                {canReconcile && <td style={{ ...st.footTd, textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>{money(filtered.reduce((s, a) => s + (Number(a.pendingDeposits) || 0), 0))}</td>}
                {canReconcile && <td style={{ ...st.footTd, textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>{money(filtered.reduce((s, a) => s + (Number(a.pendingWithdrawals) || 0), 0))}</td>}
                {canReconcile && (() => {
                  const c = filtered.reduce((s, a) => s + (Number(a.uncategorizedCount) || 0), 0);
                  return <td style={{ ...st.footTd, textAlign: "center", fontWeight: 800, whiteSpace: "nowrap" }}>{c ? `${c} to review` : ""}</td>;
                })()}
                <td style={{ ...st.footTd, textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>{money(total)}</td>
                <td style={st.footTd} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {ledgerAccount && (
        <AccountLedgerDialog account={ledgerAccount} onClose={() => setLedgerAccount(null)} />
      )}

      {reconcileAccount && (
        <ReconcileModal
          companyId={companyId}
          account={reconcileAccount}
          onClose={() => setReconcileAccount(null)}
          onLocked={() => { load(); }}
        />
      )}

      {importAccount && (
        <StatementImportModal
          companyId={companyId}
          account={importAccount}
          onClose={() => setImportAccount(null)}
          onDone={() => { load(); }}
        />
      )}

      {showCreate && (
        <CreateBankCashModal
          companyId={companyId}
          canViewDivisions={canViewDivisions}
          assetGroups={assetGroups}
          defaultGroupId={defaultGroupId}
          onClose={() => setShowCreate(false)}
          onCreated={(keepOpen) => { if (!keepOpen) setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateBankCashModal({ companyId, canViewDivisions, assetGroups, defaultGroupId, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [groupId, setGroupId] = useState(defaultGroupId ? String(defaultGroupId) : "");
  const [divisionId, setDivisionId] = useState("");
  const [opening, setOpening] = useState("");
  const [isDebit, setIsDebit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const doCreate = async (addAnother) => {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!groupId) { setError("Pick a group (an asset group in the Chart of Accounts)."); return; }
    setSaving(true); setError("");
    try {
      await createAccount(companyId, {
        name: name.trim(),
        code: code.trim() || null,
        accountGroupId: Number(groupId),
        accountType: "Asset",
        controlType: "BankCash",
        openingBalance: Number(opening) || 0,
        openingBalanceIsDebit: isDebit,
        divisionId: divisionId ? Number(divisionId) : null,
      });
      notify("Bank / cash account created.", "success");
      if (addAnother) {
        setName(""); setCode(""); setOpening(""); setError(""); setSaving(false);
        onCreated(true);   // refresh list, keep the modal open
      } else {
        onCreated(false);  // refresh list + close
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Could not create the account.");
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>New Bank / Cash Account</h3>
          <button style={formStyles.closeButton} onClick={onClose} title="Close"><MdClose size={18} /></button>
        </div>

        <div style={formStyles.body}>
          <form onSubmit={(e) => { e.preventDefault(); doCreate(false); }} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div style={st.fieldRow}>
              <div style={{ flex: 2, minWidth: 180 }}>
                <label style={st.label}>Name *</label>
                <input style={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HBL — Current 0123" autoFocus />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={st.label}>Code</label>
                <input style={formStyles.input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            {canViewDivisions && (
              <DivisionSelect
                companyId={companyId}
                value={divisionId}
                onChange={setDivisionId}
                mode="select"
                noneLabel="— No division —"
                label="Division (optional)"
                labelStyle={st.label}
                style={{ ...dropdownStyles.base, width: "100%" }}
              />
            )}

            <div>
              <label style={st.label}>Group</label>
              {assetGroups.length === 0 ? (
                <div style={st.muted}>No account groups found — set up the Chart of Accounts first.</div>
              ) : (
                <select style={{ ...dropdownStyles.base, width: "100%" }} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">Select a group…</option>
                  {assetGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
            </div>

            <div style={st.fieldRow}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={st.label}>Opening Balance</label>
                <input type="number" step="0.01" style={formStyles.input} value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={st.label}>Balance is</label>
                <select style={{ ...dropdownStyles.base, width: "100%" }} value={isDebit ? "debit" : "credit"} onChange={(e) => setIsDebit(e.target.value === "debit")}>
                  <option value="debit">Debit (money in the account)</option>
                  <option value="credit">Credit (overdrawn)</option>
                </select>
              </div>
            </div>

            {error && <div style={st.error}>{error}</div>}
          </form>
        </div>

        <div style={st.footer}>
          <button type="button" style={st.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...st.secondaryBtn, opacity: saving ? 0.6 : 1 }} onClick={() => doCreate(true)} disabled={saving}>Create &amp; add another</button>
          <button type="button" style={{ ...st.primaryBtn, opacity: saving ? 0.6 : 1 }} onClick={() => doCreate(false)} disabled={saving}>{saving ? "Creating…" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  headerIcon: { width: 46, height: 46, borderRadius: 12, background: colors.blue, display: "grid", placeItems: "center", flexShrink: 0 },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary },
  subtitle: { margin: "2px 0 0", fontSize: "0.82rem", color: colors.textSecondary },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer" },
  secondaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontWeight: 700, cursor: "pointer" },
  toolbar: { display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.85rem" },
  searchWrap: { display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 200, maxWidth: 360, background: "#fff", border: `1px solid ${colors.inputBorder}`, borderRadius: 8, padding: "0 10px", minHeight: 44 },
  searchInput: { flex: 1, border: "none", outline: "none", fontSize: "0.9rem", background: "transparent", color: colors.textPrimary },
  glChipOff: { fontSize: "0.72rem", fontWeight: 700, color: colors.textSecondary, background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" },
  tableWrap: { overflowX: "auto", background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 480 },
  th: { textAlign: "left", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, padding: "12px 14px", borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap" },
  tr: { cursor: "pointer", borderBottom: `1px solid ${colors.cardBorder}` },
  td: { padding: "11px 14px", fontSize: "0.88rem", color: colors.textPrimary, verticalAlign: "middle" },
  footTd: { padding: "12px 14px", fontSize: "0.82rem", color: colors.textSecondary, borderTop: `2px solid ${colors.cardBorder}`, background: colors.inputBg },
  accName: { fontWeight: 600 },
  code: { fontFamily: "monospace", fontSize: "0.75rem", color: colors.textSecondary, background: colors.inputBg, padding: "1px 6px", borderRadius: 4 },
  muted: { color: colors.textSecondary, fontSize: "0.82rem" },
  reviewLink: { border: "none", background: "transparent", padding: 0, fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", textDecoration: "underline" },
  iconBtn: { display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, border: "none", background: "transparent", color: colors.blue, cursor: "pointer" },
  empty: { padding: "2.5rem 1rem", textAlign: "center", color: colors.textSecondary, background: colors.cardBg, border: `1px dashed ${colors.inputBorder}`, borderRadius: 12 },
  footer: { display: "flex", justifyContent: "flex-end", gap: "0.6rem", flexWrap: "wrap", padding: "0.9rem clamp(1rem, 2vw, 1.5rem)", borderTop: `1px solid ${colors.cardBorder}`, flexShrink: 0 },
  fieldRow: { display: "flex", gap: "0.75rem", flexWrap: "wrap" },
  label: { display: "block", fontSize: "0.75rem", fontWeight: 700, color: colors.textSecondary, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.03em" },
  error: { color: "#b71c1c", fontSize: "0.82rem", background: "#ffebee", border: "1px solid #ffcdd2", borderRadius: 8, padding: "8px 12px" },
};
