import { useState, useEffect, useCallback } from "react";
import {
  MdAccountTree, MdAdd, MdEdit, MdDelete, MdAutoAwesome, MdLock, MdBusiness,
  MdReceiptLong,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, formStyles, modalSizes } from "../theme";
import SearchableSelect from "../Components/SearchableSelect";
import { PageHeader, CompanyPicker, Button, IconButton, Card, EmptyState, Loading } from "../ui/Kit";
import useScrollToError from "../hooks/useScrollToError";
import {
  getCoaTree, seedWholesaleCoa, createAccountGroup, createAccount,
  updateAccount, deleteAccount, deleteAccountGroup, adjustOpeningBalance,
} from "../api/accountApi";
import { getGlStatus, setGlLockDate } from "../api/accountingApi";
import AccountLedgerDialog from "../Components/AccountLedgerDialog";

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
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("accounting.coa.view");
  const canManage = has("accounting.coa.manage");
  const canClosePeriod = has("accounting.gl.manage");

  const [tree, setTree] = useState({ balanceSheet: [], profitAndLoss: [] });
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [form, setForm] = useState(null);   // { kind: "account" | "group", ... }
  const [glStatus, setGlStatus] = useState(null);
  const [ledgerAccount, setLedgerAccount] = useState(null);  // { id, name, code }
  const [periodOpen, setPeriodOpen] = useState(false);

  const companyId = selectedCompany?.id;

  const load = useCallback(async () => {
    if (!companyId) { setTree({ balanceSheet: [], profitAndLoss: [] }); setGlStatus(null); return; }
    setLoading(true);
    try {
      const [treeRes, statusRes] = await Promise.all([
        getCoaTree(companyId),
        // The status chip is a nicety; failing to read it must not blank the
        // chart, which is the thing the operator came here for.
        getGlStatus(companyId).catch(() => null),
      ]);
      setTree(treeRes.data || { balanceSheet: [], profitAndLoss: [] });
      setGlStatus(statusRes?.data || null);
    } catch {
      setTree({ balanceSheet: [], profitAndLoss: [] });
      setGlStatus(null);
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
      <EmptyState icon={MdAccountTree}>
        You don't have permission to view the chart of accounts.
      </EmptyState>
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

  // Icon buttons: IconButton grows to a 40px tap target on touch (kit rule),
  // and stays tight on desktop where the tree is dense and a pointer is precise.
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
          <IconButton danger icon={MdDelete} size={15} label={`Delete group ${node.name}`} title="Delete group" onClick={() => handleDeleteGroup(node)} />
        )}
      </div>

      {node.accounts?.map((a) => (
        <div
          key={`${a.id}-${a.externalRef || a.name}`}
          style={{ ...st.accountRow, cursor: a.id > 0 ? "pointer" : "default" }}
          title={a.id > 0 ? "View ledger" : undefined}
          onClick={a.id > 0 ? () => setLedgerAccount({ id: a.id, name: a.name, code: a.code }) : undefined}
        >
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
              <IconButton
                icon={MdEdit} size={14} label={`Edit ${a.name}`} title="Edit"
                onClick={(e) => { e.stopPropagation(); setForm({ kind: "account", ...a }); }}
              />
              {!a.isControlAccount && (
                <IconButton
                  danger icon={MdDelete} size={14} label={`Delete ${a.name}`} title="Delete"
                  onClick={(e) => { e.stopPropagation(); handleDeleteAccount(a); }}
                />
              )}
            </span>
          )}
        </div>
      ))}

      {node.children?.map((c) => renderNode(c, depth + 1, creditNormal))}
    </div>
  );

  const Column = ({ title, nodes }) => (
    // marginTop: 0 cancels the kit's ".k-card + .k-card" stacking gap — the columns sit in a grid.
    <Card title={title} style={{ marginTop: 0 }}>
      {nodes?.length
        ? nodes.map((n) => renderNode(n, 0, isCreditNormal(firstAcctType(n))))
        : <div style={st.emptyCol}>No groups yet.</div>}
    </Card>
  );

  const glChips = companyId && glStatus && (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
      <span style={st.glChip}>
        <MdReceiptLong size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        {(glStatus.entryCount ?? 0).toLocaleString()} ledger entries
      </span>
      {/* Every entry is refused unless it balances, so this can only be
          false if something wrote around the service. Say so here rather
          than letting a report discover it later. */}
      {glStatus.isBalanced === false && (
        <span style={st.glChipWarn} title="Total debits and credits do not match">unbalanced</span>
      )}
      {glStatus.lockDate && (
        <span style={st.lockedChip}>
          <MdLock size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
          closed to {new Date(glStatus.lockDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
      )}
      {canClosePeriod && (
        <Button size="sm" onClick={() => setPeriodOpen(true)}>
          {glStatus.lockDate ? "Change period" : "Close a period"}
        </Button>
      )}
    </span>
  );

  return (
    <div>
      <PageHeader
        icon={MdAccountTree}
        tone="blue"
        title="Chart of Accounts"
        subtitle={glChips || undefined}
        actions={canManage && companyId && !isEmpty && (
          <>
            <Button icon={MdAdd} onClick={() => setForm({ kind: "group", statement: "BalanceSheet" })}>
              New Group
            </Button>
            <Button variant="primary" icon={MdAdd} onClick={() => setForm({ kind: "account" })} disabled={flatGroups.length === 0}>
              New Account
            </Button>
          </>
        )}
      />

      {companies.length > 0 && <CompanyPicker />}

      {!companyId ? (
        <EmptyState icon={MdBusiness}>Select a company to view its chart of accounts.</EmptyState>
      ) : loading ? (
        <Loading>Loading…</Loading>
      ) : isEmpty ? (
        <EmptyState
          icon={MdAutoAwesome}
          title="No chart of accounts yet"
          action={canManage && (
            <Button variant="primary" icon={MdAutoAwesome} onClick={handleSeed} disabled={seeding}>
              {seeding ? "Seeding…" : "Seed wholesale preset"}
            </Button>
          )}
        >
          Start with the <strong>Wholesale / Distribution</strong> preset — Bank &amp; Cash, A/R, A/P,
          Inventory, Input/Output Sales Tax, Capital, Sales, Cost of goods sold and the common
          expense categories, ready to use. You can rename, add to or prune it afterwards.
        </EmptyState>
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

      {periodOpen && (
        <PeriodCloseDialog
          companyId={companyId}
          current={glStatus?.lockDate || null}
          onClose={() => setPeriodOpen(false)}
          onSaved={() => { setPeriodOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Period close ──
// Closing the books to a date freezes everything on or before it — additions,
// edits AND deletions, because removing an entry changes a filed figure exactly
// as much as adding one does. Reopening is a deliberate second action.
function PeriodCloseDialog({ companyId, current, onClose, onSaved }) {
  const [lockDate, setLockDate] = useState(current ? String(current).slice(0, 10) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const errRef = useScrollToError(error);

  const save = async (value) => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      await setGlLockDate(companyId, value || null);
      notify(value ? "Period closed." : "Period reopened.", "success");
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Could not change the period.");
      setSaving(false);
    }
  };

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>Accounting Period</h5>
          <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div data-admin-body="" style={formStyles.body}>
          {error && <div ref={errRef} style={formStyles.error}>{error}</div>}
          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Books are closed up to and including</label>
            <input type="date" style={formStyles.input} value={lockDate} onChange={(e) => setLockDate(e.target.value)} />
            <div style={st.fieldHint}>
              Nothing dated on or before this day can be added, changed or removed —
              including deleting an entry, which moves a filed figure just as much
              as adding one. Leave it empty to reopen the books.
            </div>
          </div>
        </div>
        <div data-admin-footer="" style={formStyles.footer}>
          <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
          {current && (
            <button
              type="button"
              style={{ ...formStyles.button, background: "#fff", color: colors.danger, border: `1px solid ${colors.danger}40` }}
              disabled={saving}
              onClick={() => save("")}
            >
              Reopen
            </button>
          )}
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit, opacity: saving || !lockDate ? 0.6 : 1 }}
            disabled={saving || !lockDate}
            onClick={() => save(lockDate)}
          >
            {saving ? "Saving…" : "Close period"}
          </button>
        </div>
      </div>
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
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>{isAccount ? (isEdit ? "Edit Account" : "New Account") : "New Group"}</h5>
          <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div data-admin-body="" style={formStyles.body}>
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
                    className="k-select"
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
                  <SearchableSelect
                    items={flatGroups}
                    value={parentGroupId}
                    onChange={(id) => setParentGroupId(id === "" || id == null ? "" : String(id))}
                    placeholder="— Top level —"
                    ariaLabel="Parent group"
                  />
                </div>
              </>
            )}

            {isAccount && (
              <>
                <div style={st.formGrid}>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Group</label>
                    <SearchableSelect
                      items={flatGroups}
                      value={accountGroupId}
                      onChange={(id) => setAccountGroupId(id === "" || id == null ? "" : String(id))}
                      allowClear={false}
                      placeholder="Pick a group"
                      ariaLabel="Group"
                    />
                  </div>

                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Type</label>
                    {isEdit ? (
                      <>
                        <input style={formStyles.input} value={accountType} readOnly disabled />
                        <div style={st.fieldHint}>Fixed after creation — reclassifying an account would rewrite its history.</div>
                      </>
                    ) : (
                      <select className="k-select" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
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
                      <select className="k-select" value={controlType} onChange={(e) => setControlType(e.target.value)}>
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
                    <select className="k-select" value={isDebit ? "debit" : "credit"} onChange={(e) => setIsDebit(e.target.value === "debit")}>
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

          <div data-admin-footer="" style={formStyles.footer}>
            <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
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
  glChip: { fontSize: "0.72rem", fontWeight: 700, color: "var(--k-blue)", background: "#eef2ff", border: "1px solid var(--k-line)", padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" },
  glChipWarn: { fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "#b71c1c", background: "#ffebee", border: "1px solid #ffcdd2", padding: "3px 10px", borderRadius: 12 },
  lockedChip: { fontSize: "0.7rem", fontWeight: 700, color: "#8a5a00", background: "#fff3cd", border: "1px solid #ffe69c", padding: "3px 9px", borderRadius: 12, whiteSpace: "nowrap" },
  // auto-fit collapses the two statement columns to one on a phone with no
  // media query; min() keeps it from forcing horizontal scroll at 375px.
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "var(--k-gap)", alignItems: "start" },
  groupHeader: { display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: "1px solid var(--k-line)" },
  groupName: { fontWeight: 800, color: "var(--k-ink)", fontSize: "var(--k-font)", flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  groupTotal: { fontWeight: 700, color: "var(--k-muted)", fontSize: "var(--k-td-font)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  accountRow: { display: "flex", alignItems: "center", gap: 6, padding: "3px 0 3px 14px", fontSize: "var(--k-td-font)" },
  // Account names are operator-supplied: wrap them rather than truncating, so
  // two that share a prefix can never render identically.
  accName: { flex: 1, minWidth: 0, color: "var(--k-ink)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", overflowWrap: "anywhere" },
  code: { fontFamily: "monospace", fontSize: "0.72rem", color: "var(--k-muted)", background: "var(--k-surface-2)", padding: "0 4px", borderRadius: 4 },
  ctrlBadge: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#e3f2fd", color: "#0d47a1", padding: "1px 5px", borderRadius: 10 },
  inactiveBadge: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#eceff1", color: "#607d8b", padding: "1px 5px", borderRadius: 10 },
  accAmt: { color: "var(--k-muted)", fontSize: "var(--k-font-sm)", minWidth: 70, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  rowActions: { display: "flex", gap: 2, flexShrink: 0 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "0.75rem" },
  fieldHint: { fontSize: "0.72rem", color: "var(--k-muted)", marginTop: 4, lineHeight: 1.4 },
  emptyCol: { padding: "1rem", color: "var(--k-muted)", fontSize: "var(--k-font)" },
};
