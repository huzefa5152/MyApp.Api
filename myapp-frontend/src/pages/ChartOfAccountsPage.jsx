import { useState, useEffect, useCallback } from "react";
import {
  MdAccountTree, MdAdd, MdEdit, MdDelete, MdAutoAwesome, MdLock, MdBusiness,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, formStyles, modalSizes, dropdownStyles } from "../theme";
import useIsNarrow from "../hooks/useIsNarrow";
import useScrollToError from "../hooks/useScrollToError";
import {
  getCoaTree, seedWholesaleCoa, createAccountGroup, createAccount,
  updateAccount, deleteAccount, deleteAccountGroup, adjustOpeningBalance,
} from "../api/accountApi";

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];

// Models/Accounting/ControlType, minus the ones an operator must not pick:
//   • Suspense — the posting engine's own fallback. A second one would split
//     the pool that exists to make an imbalance visible.
//   • the reserved numbers (ProductionWip, EmployeeClearing, ImportClearing,
//     AdvanceIncomeTaxOnImports, CustomerAdvances) — nothing on this line posts
//     to them, so offering them would only mis-stamp a chart.
// The tax and settle-remainder roles ARE listed: the preset seeds them, but a
// chart an operator has pruned has no other way to designate the account, and a
// missing control account sends its postings to Suspense.
const CONTROL_TYPES = [
  "None", "AccountsReceivable", "AccountsPayable", "Inventory", "BankCash",
  "Capital", "RetainedEarnings", "OutputTax", "InputTax",
  "WithholdingReceivable", "WithholdingPayable", "Rounding",
  "DiscountAllowed", "DiscountReceived", "BadDebtWriteOff", "WriteBackIncome",
  "FurtherTaxPayable",
];

// Brackets for a negative, the way a statement prints one. The `=== 0` guard
// normalises NEGATIVE zero: flipping the sign of an empty credit-normal group
// gives -0, and (-0).toLocaleString() renders the literal string "-0".
const money = (n) => {
  const v = n === 0 ? 0 : n;
  return v < 0 ? `(${Math.abs(v).toLocaleString()})` : v.toLocaleString();
};

/**
 * Accounting → Chart of Accounts. Two-column Balance Sheet | P&L tree; the
 * columns stack on a phone via auto-fit. Gated by accounting.coa.*.
 *
 * Balances are shown in NATURAL sign, the way an accountant reads a statement:
 * credit-normal sections (Liability / Equity / Income) show a credit balance as
 * positive, and a contra balance in brackets. The API's figures are signed
 * debit-positive, so the sign is flipped for those sections here — in exactly
 * one helper, so the tree and the totals can't disagree.
 */
export default function ChartOfAccountsPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const isNarrow = useIsNarrow();
  const canView = has("accounting.coa.view");
  const canManage = has("accounting.coa.manage");

  const [tree, setTree] = useState({ balanceSheet: [], profitAndLoss: [] });
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [form, setForm] = useState(null);   // { kind: "account" | "group", ... }

  const companyId = selectedCompany?.id;

  const load = useCallback(async () => {
    if (!companyId) { setTree({ balanceSheet: [], profitAndLoss: [] }); return; }
    setLoading(true);
    try {
      const { data } = await getCoaTree(companyId);
      setTree(data || { balanceSheet: [], profitAndLoss: [] });
    } catch {
      setTree({ balanceSheet: [], profitAndLoss: [] });
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const isEmpty = (tree.balanceSheet?.length || 0) === 0 && (tree.profitAndLoss?.length || 0) === 0;

  // Flatten the groups for the "parent group" / "account group" pickers. The
  // em-dash prefix shows nesting depth in a plain <option>, which can't indent.
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

  const handleDeleteAccount = async (a) => {
    const ok = await confirm({
      title: "Delete account?",
      message: `Delete "${a.name}"? This cannot be undone.`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    try { await deleteAccount(a.id); notify("Account deleted.", "success"); load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); }
  };

  const handleDeleteGroup = async (g) => {
    const ok = await confirm({
      title: "Delete group?",
      message: `Delete group "${g.name}"?`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    try { await deleteAccountGroup(g.id); notify("Group deleted.", "success"); load(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); }
  };

  if (!canView) {
    return (
      <div style={{ padding: "2rem", color: colors.textSecondary }}>
        You don't have permission to view the chart of accounts.
      </div>
    );
  }

  const isCreditNormal = (t) => t === "Liability" || t === "Equity" || t === "Income";
  // A group's own sign comes from the accounts under it; walk down to the first
  // one so an empty parent still reads the right way round.
  const firstAcctType = (node) => {
    if (node.accounts?.length) return node.accounts[0].accountType;
    for (const c of node.children || []) { const t = firstAcctType(c); if (t) return t; }
    return null;
  };

  // Icon buttons: a real 44px tap target on touch, tighter on desktop where the
  // tree is dense and a pointer is precise.
  const iconBtn = { ...st.iconBtn, width: isNarrow ? 44 : 28, height: isNarrow ? 44 : 28 };

  const renderNode = (node, depth = 0, creditNormal = false) => (
    <div key={node.id} style={{ marginLeft: depth ? 14 : 0, marginTop: depth ? 6 : 12 }}>
      <div style={st.groupHeader}>
        <span style={st.groupName}>
          {node.name}
          {node.isSystem && (
            <MdLock size={12} style={{ marginLeft: 5, opacity: 0.5, verticalAlign: "middle" }} title="System group — can't be renamed or deleted" />
          )}
        </span>
        <span style={st.groupTotal}>{money((creditNormal ? -1 : 1) * (node.balanceTotal ?? 0))}</span>
        {canManage && !node.isSystem && (
          <button style={iconBtn} title="Delete group" aria-label={`Delete group ${node.name}`} onClick={() => handleDeleteGroup(node)}>
            <MdDelete size={15} />
          </button>
        )}
      </div>

      {node.accounts?.map((a) => (
        <div key={`${a.id}-${a.externalRef || a.name}`} style={st.accountRow}>
          <span style={st.accName}>
            {a.code && <span style={st.code}>{a.code}</span>}
            {a.name}
            {a.isControlAccount && <span style={st.ctrlBadge} title={`Control account: ${a.controlType}`}>control</span>}
            {!a.isActive && <span style={st.inactiveBadge}>inactive</span>}
          </span>
          <span style={st.accAmt}>{a.balance ? money((isCreditNormal(a.accountType) ? -1 : 1) * a.balance) : ""}</span>
          {/* id 0 is the synthetic Current-Year Earnings line — it has no row
              behind it, so it gets no actions. */}
          {canManage && a.id > 0 && (
            <span style={st.rowActions}>
              <button style={iconBtn} title="Edit" aria-label={`Edit ${a.name}`} onClick={() => setForm({ kind: "account", ...a })}>
                <MdEdit size={14} />
              </button>
              {!a.isControlAccount && (
                <button style={iconBtn} title="Delete" aria-label={`Delete ${a.name}`} onClick={() => handleDeleteAccount(a)}>
                  <MdDelete size={14} />
                </button>
              )}
            </span>
          )}
        </div>
      ))}

      {node.children?.map((c) => renderNode(c, depth + 1, creditNormal))}
    </div>
  );

  const Column = ({ title, nodes }) => (
    <div style={st.column}>
      <div style={st.colHeader}>{title}</div>
      {nodes?.length
        ? nodes.map((n) => renderNode(n, 0, isCreditNormal(firstAcctType(n))))
        : <div style={st.emptyCol}>No groups yet.</div>}
    </div>
  );

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <MdAccountTree size={26} color={colors.blue} />
          <h2 style={st.h2}>Chart of Accounts</h2>
        </div>
        {canManage && companyId && !isEmpty && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button style={st.secondaryBtn} onClick={() => setForm({ kind: "group", statement: "BalanceSheet" })}>
              <MdAdd size={16} /> New Group
            </button>
            <button style={st.primaryBtn} onClick={() => setForm({ kind: "account" })} disabled={flatGroups.length === 0}>
              <MdAdd size={16} /> New Account
            </button>
          </div>
        )}
      </div>

      {companies.length > 0 && (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <MdBusiness size={20} color={colors.blue} />
          <select
            style={dropdownStyles.base}
            aria-label="Company"
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
            Inventory, Input/Output Sales Tax, Capital, Sales, Cost of goods sold and the common
            expense categories, ready to use. You can rename, add to or prune it afterwards.
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
  const [accountGroupId, setAccountGroupId] = useState(
    form.accountGroupId ? String(form.accountGroupId) : (flatGroups[0]?.id ? String(flatGroups[0].id) : "")
  );
  const [accountType, setAccountType] = useState(form.accountType || "Asset");
  const [controlType, setControlType] = useState(form.controlType || "None");
  const [openingBalance, setOpeningBalance] = useState(form.openingBalance ?? 0);
  const [isDebit, setIsDebit] = useState(form.openingBalanceIsDebit ?? true);
  const [isActive, setIsActive] = useState(form.isActive ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const errRef = useScrollToError(error);

  // A control account can't be deactivated — the posting engine would read it
  // as missing and route its legs to Suspense. Bank & Cash is the exception:
  // it's chosen per document, not resolved by role, so one of several bank
  // accounts can retire without breaking anything.
  const lockedActive = isEdit && form.isControlAccount && form.controlType !== "BankCash";

  const openingChanged =
    Number(openingBalance || 0) !== Number(form.openingBalance || 0) ||
    isDebit !== (form.openingBalanceIsDebit ?? true);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError("");
    try {
      if (isAccount) {
        if (!accountGroupId) { setError("Pick a group."); setSaving(false); return; }
        if (isEdit) {
          await updateAccount(form.id, {
            name: name.trim(),
            code: code.trim() || null,
            accountGroupId: Number(accountGroupId),
            ...(lockedActive ? {} : { isActive }),
          });
          // The opening balance goes through its own endpoint so the
          // equal-and-opposite delta reaches Retained earnings — setting it
          // straight would quietly unbalance the opening balance sheet.
          if (openingChanged) {
            await adjustOpeningBalance(form.id, {
              openingBalance: Number(openingBalance) || 0,
              openingBalanceIsDebit: isDebit,
            });
          }
        } else {
          await createAccount(companyId, {
            name: name.trim(),
            code: code.trim() || null,
            accountGroupId: Number(accountGroupId),
            openingBalance: Number(openingBalance) || 0,
            openingBalanceIsDebit: isDebit,
            accountType,
            controlType,
          });
        }
      } else {
        await createAccountGroup(companyId, {
          name: name.trim(),
          statement,
          parentGroupId: parentGroupId ? Number(parentGroupId) : null,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Could not save.");
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isAccount ? (isEdit ? "Edit Account" : "New Account") : "New Group"}</h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Name</label>
              <input style={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>

            {!isAccount && (
              <>
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Statement</label>
                  <select
                    style={{ ...dropdownStyles.base, width: "100%" }}
                    value={statement}
                    onChange={(e) => setStatement(e.target.value)}
                    disabled={!!parentGroupId}
                    title={parentGroupId ? "A sub-group always follows its parent's statement" : undefined}
                  >
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
                <div style={st.formGrid}>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Group</label>
                    <select style={{ ...dropdownStyles.base, width: "100%" }} value={accountGroupId} onChange={(e) => setAccountGroupId(e.target.value)}>
                      {flatGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>

                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Type</label>
                    {isEdit ? (
                      <>
                        <input style={formStyles.input} value={accountType} readOnly disabled />
                        <div style={st.fieldHint}>Fixed after creation — reclassifying an account would rewrite its history.</div>
                      </>
                    ) : (
                      <select style={{ ...dropdownStyles.base, width: "100%" }} value={accountType} onChange={(e) => setAccountType(e.target.value)}>
                        {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>

                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Code (optional)</label>
                    <input style={formStyles.input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 1100" />
                  </div>

                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Control type</label>
                    {isEdit ? (
                      <>
                        <input style={formStyles.input} value={controlType} readOnly disabled />
                        <div style={st.fieldHint}>Fixed after creation.</div>
                      </>
                    ) : (
                      <select style={{ ...dropdownStyles.base, width: "100%" }} value={controlType} onChange={(e) => setControlType(e.target.value)}>
                        {CONTROL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                <div style={st.formGrid}>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Opening balance</label>
                    <input type="number" step="0.01" style={formStyles.input} value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
                    {isEdit && openingChanged && (
                      <div style={st.fieldHint}>
                        The difference is posted to Retained earnings so the opening balance sheet stays balanced.
                      </div>
                    )}
                  </div>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Side</label>
                    <select style={{ ...dropdownStyles.base, width: "100%" }} value={isDebit ? "debit" : "credit"} onChange={(e) => setIsDebit(e.target.value === "debit")}>
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                  </div>
                </div>

                {isEdit && (
                  <div style={formStyles.formGroup}>
                    <label style={{ ...formStyles.label, display: "flex", alignItems: "center", gap: 8, cursor: lockedActive ? "not-allowed" : "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isActive}
                        disabled={lockedActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        style={{ width: 18, height: 18, margin: 0 }}
                      />
                      Active
                    </label>
                    <div style={st.fieldHint}>
                      {lockedActive
                        ? "A control account can't be deactivated — the posting engine resolves it by role."
                        : "An inactive account stays on past documents but disappears from the pickers."}
                    </div>
                  </div>
                )}
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
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  secondaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  // auto-fit collapses the two statement columns to one on a phone with no
  // media query; min() keeps it from forcing horizontal scroll at 375px.
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "1rem", alignItems: "start" },
  column: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", minWidth: 0 },
  colHeader: { fontSize: "0.8rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.blue, borderBottom: `2px solid ${colors.cardBorder}`, paddingBottom: 6, marginBottom: 4 },
  groupHeader: { display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: `1px solid ${colors.cardBorder}` },
  groupName: { fontWeight: 800, color: colors.textPrimary, fontSize: "0.9rem", flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  groupTotal: { fontWeight: 700, color: colors.textSecondary, fontSize: "0.82rem", whiteSpace: "nowrap" },
  accountRow: { display: "flex", alignItems: "center", gap: 6, padding: "3px 0 3px 14px", fontSize: "0.85rem" },
  // Account names are operator-supplied: wrap them rather than truncating, so
  // two that share a prefix can never render identically.
  accName: { flex: 1, minWidth: 0, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", overflowWrap: "anywhere" },
  code: { fontFamily: "monospace", fontSize: "0.72rem", color: colors.textSecondary, background: colors.inputBg, padding: "0 4px", borderRadius: 4 },
  ctrlBadge: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#e3f2fd", color: "#0d47a1", padding: "1px 5px", borderRadius: 10 },
  inactiveBadge: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#eceff1", color: "#607d8b", padding: "1px 5px", borderRadius: 10 },
  accAmt: { color: colors.textSecondary, fontSize: "0.8rem", minWidth: 70, textAlign: "right", whiteSpace: "nowrap" },
  rowActions: { display: "flex", gap: 2, flexShrink: 0 },
  // placeItems + padding:0 + boxShadow:none override the global button rule in
  // index.css, which would otherwise off-centre the glyph and add a shadow.
  iconBtn: { display: "grid", placeItems: "center", padding: 0, borderRadius: 6, border: "none", background: "transparent", color: colors.textSecondary, cursor: "pointer", boxShadow: "none" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.75rem" },
  fieldHint: { fontSize: "0.72rem", color: colors.textSecondary, marginTop: 4, lineHeight: 1.4 },
  seedBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", padding: "2.5rem 1rem", background: colors.cardBg, border: `1px dashed ${colors.inputBorder}`, borderRadius: 12 },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
  emptyCol: { padding: "1rem", color: colors.textSecondary, fontSize: "0.85rem" },
};
