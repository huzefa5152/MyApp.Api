import { useState, useEffect, useCallback } from "react";
import { MdAccountTree, MdAdd, MdEdit, MdDelete, MdAutoAwesome, MdLock, MdBusiness } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, formStyles, modalSizes, dropdownStyles } from "../theme";
import {
  getCoaTree, seedWholesaleCoa, createAccountGroup, createAccount,
  updateAccount, deleteAccount, deleteAccountGroup,
} from "../api/accountApi";
import { getGlStatus, enableGl } from "../api/accountingApi";
import AccountLedgerDialog from "../Components/AccountLedgerDialog";

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];
const CONTROL_TYPES = ["None", "AccountsReceivable", "AccountsPayable", "Inventory", "BankCash",
  "Capital", "RetainedEarnings", "OutputTax", "InputTax", "WithholdingReceivable", "WithholdingPayable",
  "ProductionWip", "EmployeeClearing", "Rounding"];

const money = (n) => (n < 0 ? `(${Math.abs(n).toLocaleString()})` : n.toLocaleString());

/**
 * Configuration → Chart of Accounts (design §7). Two-column Balance Sheet | P&L
 * tree. Mobile-first (columns stack on phones). Gated by accounting.coa.*.
 */
export default function ChartOfAccountsPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("accounting.coa.view");
  const canManage = has("accounting.coa.manage");

  const [tree, setTree] = useState({ balanceSheet: [], profitAndLoss: [] });
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [form, setForm] = useState(null);   // { kind: "account"|"group", ... }
  const [glStatus, setGlStatus] = useState(null);   // GET /accounting/gl/.../status
  const [enabling, setEnabling] = useState(false);
  const [ledgerAccount, setLedgerAccount] = useState(null); // { id, name, code }

  const companyId = selectedCompany?.id;

  const load = useCallback(async () => {
    if (!companyId) { setTree({ balanceSheet: [], profitAndLoss: [] }); setGlStatus(null); return; }
    setLoading(true);
    try {
      const [treeRes, statusRes] = await Promise.all([
        getCoaTree(companyId),
        getGlStatus(companyId).catch(() => null), // status failing must not blank the tree
      ]);
      setTree(treeRes.data || { balanceSheet: [], profitAndLoss: [] });
      setGlStatus(statusRes?.data || null);
    } catch { setTree({ balanceSheet: [], profitAndLoss: [] }); setGlStatus(null); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const isEmpty = (tree.balanceSheet?.length || 0) === 0 && (tree.profitAndLoss?.length || 0) === 0;

  // Flatten groups for the "parent group" / "account group" pickers.
  const flatGroups = [];
  const walk = (nodes, depth, statement) => (nodes || []).forEach((n) => {
    flatGroups.push({ id: n.id, name: `${"— ".repeat(depth)}${n.name}`, statement });
    walk(n.children, depth + 1, statement);
  });
  walk(tree.balanceSheet, 0, "BalanceSheet");
  walk(tree.profitAndLoss, 0, "ProfitAndLoss");

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const { data } = await seedWholesaleCoa(companyId);
      notify(data.message || "Preset seeded.", "success");
      await load();
    } catch (err) {
      notify(err.response?.data?.error || "Could not seed preset.", "error");
    } finally { setSeeding(false); }
  };

  const handleEnableGl = async () => {
    if (enabling) return;
    setEnabling(true);
    try {
      const { data } = await enableGl(companyId); // long-running: seeds + back-posts documents
      const parts = [];
      if (data?.seededAccounts != null) parts.push(`${data.seededAccounts} accounts seeded`);
      if (data?.postedInvoices != null) parts.push(`${data.postedInvoices} invoices`);
      if (data?.postedBills != null) parts.push(`${data.postedBills} bills`);
      if (data?.postedPayments != null) parts.push(`${data.postedPayments} payments`);
      notify(parts.length ? `GL enabled — posted ${parts.join(", ")}.` : "GL enabled.", "success");
      await load(); // refresh tree balances + status chip
    } catch (err) {
      notify(err.response?.data?.error || "Could not enable GL.", "error");
    } finally { setEnabling(false); }
  };

  const handleDeleteAccount = async (a) => {
    const ok = await confirm({ title: "Delete account?", message: `Delete "${a.name}"? This cannot be undone.`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try { await deleteAccount(a.id); notify("Account deleted.", "success"); load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); }
  };
  const handleDeleteGroup = async (g) => {
    const ok = await confirm({ title: "Delete group?", message: `Delete group "${g.name}"?`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try { await deleteAccountGroup(g.id); notify("Group deleted.", "success"); load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); }
  };

  if (!canView) return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to view the chart of accounts.</div>;

  const renderNode = (node, depth = 0) => (
    <div key={node.id} style={{ marginLeft: depth ? 14 : 0, marginTop: depth ? 6 : 12 }}>
      <div style={st.groupHeader}>
        <span style={st.groupName}>{node.name}{node.isSystem && <MdLock size={12} style={{ marginLeft: 5, opacity: 0.5, verticalAlign: "middle" }} title="System group" />}</span>
        <span style={st.groupTotal}>{money(node.balanceTotal ?? node.openingBalanceTotal ?? 0)}</span>
        {canManage && !node.isSystem && (
          <button style={st.iconBtn} title="Delete group" onClick={() => handleDeleteGroup(node)}><MdDelete size={14} /></button>
        )}
      </div>
      {node.accounts?.map((a) => (
        <div
          key={a.id}
          style={{ ...st.accountRow, cursor: "pointer" }}
          title="View ledger"
          onClick={() => setLedgerAccount({ id: a.id, name: a.name, code: a.code })}
        >
          <span style={st.accName}>
            {a.code && <span style={st.code}>{a.code}</span>}
            {a.name}
            {a.isControlAccount && <span style={st.ctrlBadge} title={`Control: ${a.controlType}`}>control</span>}
            {!a.isActive && <span style={{ ...st.ctrlBadge, background: "#eceff1", color: "#607d8b" }}>inactive</span>}
          </span>
          {/* Live balance (opening + GL movement, signed debit-positive); blank when zero */}
          <span style={st.accAmt}>{a.balance ? money(a.balance) : ""}</span>
          {canManage && (
            <span style={st.rowActions}>
              <button style={st.iconBtn} title="Edit" onClick={(e) => { e.stopPropagation(); setForm({ kind: "account", ...a }); }}><MdEdit size={13} /></button>
              {!a.isControlAccount && <button style={st.iconBtn} title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteAccount(a); }}><MdDelete size={13} /></button>}
            </span>
          )}
        </div>
      ))}
      {node.children?.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  const Column = ({ title, nodes }) => (
    <div style={st.column}>
      <div style={st.colHeader}>{title}</div>
      {nodes?.length ? nodes.map((n) => renderNode(n)) : <div style={st.emptyCol}>No groups yet.</div>}
    </div>
  );

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <MdAccountTree size={26} color={colors.blue} />
          <h2 style={st.h2}>Chart of Accounts</h2>
          {companyId && glStatus && (glStatus.enabled ? (
            <>
              <span style={st.glChipOn}>GL on · {(glStatus.entryCount ?? 0).toLocaleString()} entries</span>
              {glStatus.isBalanced === false && (
                <span style={st.glChipWarn} title="Total debits and credits do not match">unbalanced</span>
              )}
            </>
          ) : (
            <>
              <span style={st.glChipOff}>GL off — balances show opening only</span>
              {has("accounting.gl.manage") && (
                <button style={{ ...st.glEnableBtn, opacity: enabling ? 0.6 : 1 }} onClick={handleEnableGl} disabled={enabling}>
                  {enabling ? "Enabling…" : "Enable GL"}
                </button>
              )}
            </>
          ))}
        </div>
        {canManage && companyId && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button style={st.secondaryBtn} onClick={() => setForm({ kind: "group", statement: "BalanceSheet" })}><MdAdd size={16} /> New Group</button>
            <button style={st.primaryBtn} onClick={() => setForm({ kind: "account" })} disabled={flatGroups.length === 0}><MdAdd size={16} /> New Account</button>
          </div>
        )}
      </div>

      {companies.length > 0 && (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
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

      {!companyId ? (
        <div style={st.empty}>Select a company to view its chart of accounts.</div>
      ) : loading ? (
        <div style={st.empty}>Loading…</div>
      ) : isEmpty ? (
        <div style={st.seedBox}>
          <MdAutoAwesome size={32} color={colors.teal} />
          <h3 style={{ margin: "0.5rem 0", color: colors.textPrimary }}>No chart of accounts yet</h3>
          <p style={{ color: colors.textSecondary, maxWidth: 460, textAlign: "center" }}>
            Start with the <strong>Wholesale / Distribution</strong> preset — Bank &amp; Cash, A/R, A/P,
            Inventory, Input/Output Sales Tax, Capital, Sales, COGS and common expenses, ready to use.
          </p>
          {canManage && (
            <button style={st.primaryBtn} onClick={handleSeed} disabled={seeding}>
              <MdAutoAwesome size={16} /> {seeding ? "Seeding…" : "Seed wholesale preset"}
            </button>
          )}
        </div>
      ) : (
        <div style={st.grid}>
          <Column title="Balance Sheet" nodes={tree.balanceSheet} />
          <Column title="Profit & Loss" nodes={tree.profitAndLoss} />
        </div>
      )}

      {form && (
        <CoaForm
          form={form}
          companyId={companyId}
          flatGroups={flatGroups}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); }}
        />
      )}

      {ledgerAccount && (
        <AccountLedgerDialog account={ledgerAccount} onClose={() => setLedgerAccount(null)} />
      )}
    </div>
  );
}

// ── Create/edit modal for a group or an account ──
function CoaForm({ form, companyId, flatGroups, onClose, onSaved }) {
  const isAccount = form.kind === "account";
  const isEdit = isAccount && !!form.id;
  const [name, setName] = useState(form.name || "");
  const [code, setCode] = useState(form.code || "");
  const [statement, setStatement] = useState(form.statement || "BalanceSheet");
  const [parentGroupId, setParentGroupId] = useState("");
  const [accountGroupId, setAccountGroupId] = useState(form.accountGroupId ? String(form.accountGroupId) : (flatGroups[0]?.id ? String(flatGroups[0].id) : ""));
  const [accountType, setAccountType] = useState(form.accountType || "Asset");
  const [controlType, setControlType] = useState(form.controlType || "None");
  const [openingBalance, setOpeningBalance] = useState(form.openingBalance || 0);
  const [isDebit, setIsDebit] = useState(form.openingBalanceIsDebit ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError("");
    try {
      if (isAccount) {
        if (!accountGroupId) { setError("Pick a group."); setSaving(false); return; }
        const payload = {
          name: name.trim(), code: code.trim() || null, accountGroupId: Number(accountGroupId),
          openingBalance: Number(openingBalance) || 0, openingBalanceIsDebit: isDebit,
          // Classification is immutable after create — UpdateAccountDto has no such fields.
          ...(isEdit ? {} : { accountType, controlType }),
        };
        if (isEdit) await updateAccount(form.id, payload);
        else await createAccount(companyId, payload);
      } else {
        await createAccountGroup(companyId, {
          name: name.trim(), statement,
          parentGroupId: parentGroupId ? Number(parentGroupId) : null,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Could not save.");
      setSaving(false);
    }
  };

  const groupsForStatement = flatGroups.filter((g) => !parentGroupId || true);

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isAccount ? (isEdit ? "Edit Account" : "New Account") : "New Group"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={submit}>
          <div style={formStyles.body}>
            {error && <div style={formStyles.error}>{error}</div>}
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Name</label>
              <input style={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>

            {!isAccount && (
              <>
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Statement</label>
                  <select style={{ ...dropdownStyles.base, width: "100%" }} value={statement} onChange={(e) => setStatement(e.target.value)} disabled={!!parentGroupId}>
                    <option value="BalanceSheet">Balance Sheet</option>
                    <option value="ProfitAndLoss">Profit &amp; Loss</option>
                  </select>
                </div>
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Parent group (optional)</label>
                  <select style={{ ...dropdownStyles.base, width: "100%" }} value={parentGroupId} onChange={(e) => setParentGroupId(e.target.value)}>
                    <option value="">— Top level —</option>
                    {flatGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </>
            )}

            {isAccount && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px,100%),1fr))", gap: "0.75rem" }}>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Group</label>
                    <select style={{ ...dropdownStyles.base, width: "100%" }} value={accountGroupId} onChange={(e) => setAccountGroupId(e.target.value)}>
                      {groupsForStatement.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Type</label>
                    {isEdit ? (
                      <>
                        <input style={formStyles.input} value={accountType} readOnly disabled title="Fixed after creation" />
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>Fixed after creation</div>
                      </>
                    ) : (
                      <select style={{ ...dropdownStyles.base, width: "100%" }} value={accountType} onChange={(e) => setAccountType(e.target.value)}>
                        {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Code (optional)</label>
                    <input style={formStyles.input} value={code} onChange={(e) => setCode(e.target.value)} />
                  </div>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Control type</label>
                    {isEdit ? (
                      <>
                        <input style={formStyles.input} value={controlType} readOnly disabled title="Fixed after creation" />
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>Fixed after creation</div>
                      </>
                    ) : (
                      <select style={{ ...dropdownStyles.base, width: "100%" }} value={controlType} onChange={(e) => setControlType(e.target.value)}>
                        {CONTROL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px,100%),1fr))", gap: "0.75rem" }}>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Opening balance</label>
                    <input type="number" step="0.01" style={formStyles.input} value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
                  </div>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Side</label>
                    <select style={{ ...dropdownStyles.base, width: "100%" }} value={isDebit ? "debit" : "credit"} onChange={(e) => setIsDebit(e.target.value === "debit")}>
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary },
  glChipOn: { fontSize: "0.72rem", fontWeight: 700, color: "#1b5e20", background: "#e8f5e9", border: "1px solid #c8e6c9", padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" },
  glChipOff: { fontSize: "0.72rem", fontWeight: 700, color: colors.textSecondary, background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, padding: "3px 10px", borderRadius: 12 },
  glChipWarn: { fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "#b71c1c", background: "#ffebee", border: "1px solid #ffcdd2", padding: "3px 10px", borderRadius: 12 },
  glEnableBtn: { fontSize: "0.75rem", fontWeight: 700, padding: "0.3rem 0.85rem", minHeight: 36, borderRadius: 12, border: `1px solid ${colors.blue}`, background: "#fff", color: colors.blue, cursor: "pointer" },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer" },
  secondaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontWeight: 700, cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "1rem", alignItems: "start" },
  column: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" },
  colHeader: { fontSize: "0.8rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.blue, borderBottom: `2px solid ${colors.cardBorder}`, paddingBottom: 6, marginBottom: 4 },
  groupHeader: { display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: `1px solid ${colors.cardBorder}` },
  groupName: { fontWeight: 800, color: colors.textPrimary, fontSize: "0.9rem", flex: 1 },
  groupTotal: { fontWeight: 700, color: colors.textSecondary, fontSize: "0.82rem" },
  accountRow: { display: "flex", alignItems: "center", gap: 6, padding: "3px 0 3px 14px", fontSize: "0.85rem" },
  accName: { flex: 1, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  code: { fontFamily: "monospace", fontSize: "0.72rem", color: colors.textSecondary, background: colors.inputBg, padding: "0 4px", borderRadius: 4 },
  ctrlBadge: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#e3f2fd", color: "#0d47a1", padding: "1px 5px", borderRadius: 10 },
  accAmt: { color: colors.textSecondary, fontSize: "0.8rem", minWidth: 70, textAlign: "right" },
  rowActions: { display: "flex", gap: 2 },
  iconBtn: { display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 6, border: "none", background: "transparent", color: colors.textSecondary, cursor: "pointer" },
  seedBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", padding: "2.5rem 1rem", background: colors.cardBg, border: `1px dashed ${colors.inputBorder}`, borderRadius: 12 },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
  emptyCol: { padding: "1rem", color: colors.textSecondary, fontSize: "0.85rem" },
};
