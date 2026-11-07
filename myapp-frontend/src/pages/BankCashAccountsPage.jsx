import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  MdAccountBalance,
  MdAdd,
  MdVisibility,
  MdClose,
  MdFactCheck,
  MdUploadFile,
  MdEdit,
  MdDelete,
  MdBlock,
  MdCheckCircle,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { formStyles, modalSizes } from "../theme";
import {
  Alert,
  Button,
  CompanyPicker,
  EmptyState,
  IconButton,
  Loading,
  PageHeader,
  SearchBox,
  TableWrap,
  Toolbar,
} from "../ui/Kit";
import {
  getBankCashAccounts,
  updateAccount,
  deleteAccount,
  adjustOpeningBalance,
  getCoaTree,
} from "../api/accountApi";
import { getGlStatus, getBankReconSummary } from "../api/accountingApi";
import CreateBankCashModal from "../Components/CreateBankCashModal";
import AccountLedgerDialog from "../Components/AccountLedgerDialog";
import ReconcileModal from "../Components/ReconcileModal";
import StatementImportModal from "../Components/StatementImportModal";
import useIsNarrow from "../hooks/useIsNarrow";
import useScrollToError from "../hooks/useScrollToError";

// Semantic amount colours: red owes, green is money coming in.
const NEGATIVE = "var(--k-danger)";
const POSITIVE = "#1b7a3d";

// "- PKR 10,306,052.29" for negatives, "PKR 3,517,780.34" otherwise — matches
// the reference product's bank-list convention.
const money = (n) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("accounting.coa.view");
  const canManage = has("accounting.coa.manage");
  const canReconcile = has("accounting.reconciliation.view");
  const canManageReconciliation = has("accounting.reconciliation.manage");
  const companyId = selectedCompany?.id;
  const isNarrow = useIsNarrow();

  const [accounts, setAccounts] = useState([]);
  const [assetGroups, setAssetGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [glOff, setGlOff] = useState(false);
  const [search, setSearch] = useState("");
  const [ledgerAccount, setLedgerAccount] = useState(null); // { id, name, code }
  const [reconcileAccount, setReconcileAccount] = useState(null); // { id, name, code }
  const [importAccount, setImportAccount] = useState(null); // { id, name, code }
  const [showCreate, setShowCreate] = useState(false);
  const [editAccount, setEditAccount] = useState(null); // full row being edited

  const load = useCallback(async () => {
    if (!companyId) {
      setAccounts([]);
      setAssetGroups([]);
      return;
    }
    setLoading(true);
    try {
      // The bank/cash list carries the account metadata (active flag, control
      // flag, has-activity hint, opening balance) needed to drive the manage
      // actions — includeInactive when the operator can manage, so retired
      // accounts stay visible (badged) for reactivation. The reconciliation
      // summary (when permitted) adds cleared/pending/uncategorized figures,
      // merged onto the base rows by account id.
      const [baseRes, reconRes, treeRes, statusRes] = await Promise.all([
        getBankCashAccounts(companyId, canManage),
        canReconcile ? getBankReconSummary(companyId).catch(() => null) : Promise.resolve(null),
        getCoaTree(companyId).catch(() => null),
        getGlStatus(companyId).catch(() => null),
      ]);
      const reconById = new Map((reconRes?.data || []).map((r) => [r.accountId, r]));
      const rows = (baseRes.data || []).map((a) => {
        const r = reconById.get(a.id);
        return {
          id: a.id,
          name: a.name,
          code: a.code,
          balance: r ? r.actualBalance : a.balance,
          accountGroupId: a.accountGroupId,
          isActive: a.isActive,
          isControlAccount: a.isControlAccount,
          hasActivity: a.hasActivity,
          openingBalance: a.openingBalance,
          openingBalanceIsDebit: a.openingBalanceIsDebit,
          clearedBalance: r?.clearedBalance,
          pendingDeposits: r?.pendingDeposits,
          pendingWithdrawals: r?.pendingWithdrawals,
          uncategorizedReceipts: r?.uncategorizedReceipts,
          uncategorizedPayments: r?.uncategorizedPayments,
          uncategorizedCount: r?.uncategorizedCount,
        };
      });
      setAccounts(rows);
      setAssetGroups(flattenGroups(treeRes?.data?.balanceSheet));
      setGlOff(statusRes?.data ? statusRes.data.enabled === false : false);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, canReconcile, canManage]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.code || "").toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const total = useMemo(
    () => filtered.reduce((s, a) => s + (Number(a.balance) || 0), 0),
    [filtered],
  );
  const defaultGroupId = useMemo(() => {
    if (accounts[0]?.accountGroupId) return accounts[0].accountGroupId;
    const bankish = assetGroups.find((g) => /bank|cash/i.test(g.name));
    return bankish?.id || assetGroups[0]?.id || null;
  }, [accounts, assetGroups]);

  // A row can be hard-deleted only when it's not a control account and nothing
  // references it — mirrors the server guard, so Delete is offered only when it
  // will succeed. Everything else retires via Deactivate.
  const canDeleteRow = (a) => canManage && !a.isControlAccount && !a.hasActivity;

  const handleToggleActive = async (a) => {
    const deactivating = a.isActive;
    if (deactivating) {
      const ok = await confirm({
        title: "Deactivate account?",
        message: `Hide "${a.name}" from the receipt & payment pickers? Its balance and history stay intact — you can reactivate it any time.`,
        confirmText: "Deactivate",
      });
      if (!ok) return;
    }
    try {
      await updateAccount(a.id, { isActive: !a.isActive });
      notify(deactivating ? "Account deactivated." : "Account reactivated.", "success");
      load();
    } catch (err) {
      notify(err?.response?.data?.error || "Could not update the account.", "error");
    }
  };

  const handleDelete = async (a) => {
    const ok = await confirm({
      title: "Delete account?",
      message: `Permanently delete "${a.name}"? This can't be undone.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteAccount(a.id);
      notify("Account deleted.", "success");
      load();
    } catch (err) {
      notify(err?.response?.data?.error || "Could not delete the account.", "error");
    }
  };

  if (!canView) {
    return <Alert tone="warn">You don't have permission to view bank &amp; cash accounts.</Alert>;
  }

  return (
    <div>
      <PageHeader
        icon={MdAccountBalance}
        tone="blue"
        title="Bank &amp; Cash Accounts"
        subtitle="Each account's live balance — click a row to see the transactions behind it."
        actions={
          canManage && (
            <Button
              variant="primary"
              icon={MdAdd}
              onClick={() => setShowCreate(true)}
              title="Create a new bank or cash account"
            >
              New Bank / Cash Account
            </Button>
          )
        }
      />

      <CompanyPicker />

      <Toolbar data-admin-toolbar="">
        <SearchBox value={search} onChange={setSearch} placeholder="Search by name or code…" />
        {glOff && <span style={st.glChipOff}>GL off — balances show opening only</span>}
      </Toolbar>

      <RecordsViewport label="Bank and cash records">
        {!companyId ? (
          <EmptyState icon={MdAccountBalance}>
            Select a company to view its bank &amp; cash accounts.
          </EmptyState>
        ) : loading ? (
          <Loading>Loading accounts…</Loading>
        ) : filtered.length === 0 ? (
          <EmptyState icon={MdAccountBalance}>
            {accounts.length === 0
              ? "No bank or cash accounts yet. Create one, or add an account with control type “Bank & Cash” in Chart of Accounts."
              : "No accounts match your search."}
          </EmptyState>
        ) : isNarrow ? (
          // Mobile: the up-to-8-column table becomes stacked cards. Every
          // column is preserved (balance + the reconcile figures + the
          // uncategorized-review link), and each card + its action buttons
          // open the same ledger / reconcile / import flows as the desktop row.
          <div style={st.cardList}>
            {filtered.map((a) => {
              const bal = Number(a.balance) || 0;
              return (
                <div
                  key={a.id}
                  className="k-card"
                  style={{ ...st.acctCard, opacity: a.isActive === false ? 0.65 : 1 }}
                  onClick={() => setLedgerAccount({ id: a.id, name: a.name, code: a.code })}
                  title="View transactions"
                >
                  <div style={st.acctCardTop}>
                    <span style={st.acctName}>
                      {a.name}
                      {a.isActive === false && <span style={st.inactiveBadge}>inactive</span>}
                    </span>
                    {a.code ? <span style={st.code}>{a.code}</span> : null}
                  </div>
                  <div style={st.acctBalBox}>
                    <span style={st.acctBalLabel}>Actual balance</span>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: "1rem",
                        color: bal < 0 ? NEGATIVE : "var(--k-ink)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {money(a.balance)}
                    </span>
                  </div>
                  {canReconcile && (
                    <div style={st.acctMetaGrid}>
                      <div>
                        <span style={st.acctMetaLabel}>Cleared</span>
                        <span
                          style={{
                            ...st.acctMetaValue,
                            color: (Number(a.clearedBalance) || 0) < 0 ? NEGATIVE : "var(--k-ink)",
                          }}
                        >
                          {money(a.clearedBalance)}
                        </span>
                      </div>
                      <div>
                        <span style={st.acctMetaLabel}>Pending In</span>
                        <span
                          style={{
                            ...st.acctMetaValue,
                            color: a.pendingDeposits ? POSITIVE : "var(--k-muted)",
                          }}
                        >
                          {a.pendingDeposits ? money(a.pendingDeposits) : "—"}
                        </span>
                      </div>
                      <div>
                        <span style={st.acctMetaLabel}>Pending Out</span>
                        <span
                          style={{
                            ...st.acctMetaValue,
                            color: a.pendingWithdrawals ? NEGATIVE : "var(--k-muted)",
                          }}
                        >
                          {a.pendingWithdrawals ? money(a.pendingWithdrawals) : "—"}
                        </span>
                      </div>
                      <div>
                        <span style={st.acctMetaLabel}>Uncategorized</span>
                        {a.uncategorizedCount && canManageReconciliation ? (
                          <button
                            type="button"
                            style={st.reviewLink}
                            onClick={(e) => {
                              e.stopPropagation();
                              setImportAccount({ id: a.id, name: a.name, code: a.code });
                            }}
                          >
                            {a.uncategorizedCount} to review
                          </button>
                        ) : (
                          <span style={st.acctMetaValue}>—</span>
                        )}
                      </div>
                    </div>
                  )}
                  <div style={st.acctActions}>
                    <Button
                      size="sm"
                      icon={MdVisibility}
                      onClick={(e) => {
                        e.stopPropagation();
                        setLedgerAccount({ id: a.id, name: a.name, code: a.code });
                      }}
                    >
                      Ledger
                    </Button>
                    {canManage && (
                      <Button
                        size="sm"
                        icon={MdEdit}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditAccount(a);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                    {canReconcile && a.isActive !== false && (
                      <Button
                        size="sm"
                        icon={MdFactCheck}
                        onClick={(e) => {
                          e.stopPropagation();
                          setReconcileAccount({ id: a.id, name: a.name, code: a.code });
                        }}
                      >
                        Reconcile
                      </Button>
                    )}
                    {canManageReconciliation && a.isActive !== false && (
                      <Button
                        size="sm"
                        icon={MdUploadFile}
                        onClick={(e) => {
                          e.stopPropagation();
                          setImportAccount({ id: a.id, name: a.name, code: a.code });
                        }}
                      >
                        Import
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        size="sm"
                        icon={a.isActive === false ? MdCheckCircle : MdBlock}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleActive(a);
                        }}
                      >
                        {a.isActive === false ? "Reactivate" : "Deactivate"}
                      </Button>
                    )}
                    {canDeleteRow(a) && (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={MdDelete}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(a);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            <div style={st.acctTotalsCard}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "baseline",
                }}
              >
                <span style={st.acctMetaLabel}>
                  {filtered.length} account{filtered.length === 1 ? "" : "s"}
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    color: total < 0 ? NEGATIVE : "var(--k-ink)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {money(total)}
                </span>
              </div>
              {canReconcile && (
                <div style={st.acctMetaGrid}>
                  <div>
                    <span style={st.acctMetaLabel}>Cleared</span>
                    <span style={st.acctMetaValue}>
                      {money(filtered.reduce((s, a) => s + (Number(a.clearedBalance) || 0), 0))}
                    </span>
                  </div>
                  <div>
                    <span style={st.acctMetaLabel}>Pending In</span>
                    <span style={st.acctMetaValue}>
                      {money(filtered.reduce((s, a) => s + (Number(a.pendingDeposits) || 0), 0))}
                    </span>
                  </div>
                  <div>
                    <span style={st.acctMetaLabel}>Pending Out</span>
                    <span style={st.acctMetaValue}>
                      {money(filtered.reduce((s, a) => s + (Number(a.pendingWithdrawals) || 0), 0))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <TableWrap>
            <table className="k-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: 100 }}>Code</th>
                  {canReconcile && <th className="k-num">Cleared</th>}
                  {canReconcile && <th className="k-num">Pending In</th>}
                  {canReconcile && <th className="k-num">Pending Out</th>}
                  {canReconcile && <th style={{ textAlign: "center" }}>Uncategorized</th>}
                  <th className="k-num">Actual Balance</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    style={{ cursor: "pointer", opacity: a.isActive === false ? 0.6 : 1 }}
                    onClick={() => setLedgerAccount({ id: a.id, name: a.name, code: a.code })}
                    title="View transactions"
                  >
                    <td>
                      <span style={st.accName}>{a.name}</span>
                      {a.isActive === false && <span style={st.inactiveBadge}>inactive</span>}
                    </td>
                    <td>
                      {a.code ? (
                        <span style={st.code}>{a.code}</span>
                      ) : (
                        <span className="k-muted">—</span>
                      )}
                    </td>
                    {canReconcile && (
                      <td
                        className="k-num"
                        style={{
                          color: (Number(a.clearedBalance) || 0) < 0 ? NEGATIVE : "var(--k-muted)",
                        }}
                      >
                        {money(a.clearedBalance)}
                      </td>
                    )}
                    {canReconcile && (
                      <td
                        className="k-num"
                        style={{ color: a.pendingDeposits ? POSITIVE : "var(--k-muted)" }}
                      >
                        {a.pendingDeposits ? money(a.pendingDeposits) : "—"}
                      </td>
                    )}
                    {canReconcile && (
                      <td
                        className="k-num"
                        style={{ color: a.pendingWithdrawals ? NEGATIVE : "var(--k-muted)" }}
                      >
                        {a.pendingWithdrawals ? money(a.pendingWithdrawals) : "—"}
                      </td>
                    )}
                    {canReconcile && (
                      <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                        {a.uncategorizedCount && canManageReconciliation ? (
                          <button
                            type="button"
                            style={st.reviewLink}
                            title="Import / categorize statement lines"
                            onClick={(e) => {
                              e.stopPropagation();
                              setImportAccount({ id: a.id, name: a.name, code: a.code });
                            }}
                          >
                            {a.uncategorizedCount} to review
                          </button>
                        ) : (
                          <span className="k-muted">—</span>
                        )}
                      </td>
                    )}
                    <td
                      className="k-num"
                      style={{
                        fontWeight: 700,
                        color: (Number(a.balance) || 0) < 0 ? NEGATIVE : undefined,
                      }}
                    >
                      {money(a.balance)}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          gap: 2,
                          flexWrap: "wrap",
                          justifyContent: "center",
                        }}
                      >
                        <IconButton
                          label="View ledger"
                          icon={MdVisibility}
                          size={17}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLedgerAccount({ id: a.id, name: a.name, code: a.code });
                          }}
                        />
                        {canManage && (
                          <IconButton
                            label="Edit account"
                            icon={MdEdit}
                            size={17}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditAccount(a);
                            }}
                          />
                        )}
                        {canReconcile && a.isActive !== false && (
                          <IconButton
                            label="Reconcile this account"
                            icon={MdFactCheck}
                            size={17}
                            onClick={(e) => {
                              e.stopPropagation();
                              setReconcileAccount({ id: a.id, name: a.name, code: a.code });
                            }}
                          />
                        )}
                        {canManageReconciliation && a.isActive !== false && (
                          <IconButton
                            label="Import bank statement"
                            icon={MdUploadFile}
                            size={17}
                            onClick={(e) => {
                              e.stopPropagation();
                              setImportAccount({ id: a.id, name: a.name, code: a.code });
                            }}
                          />
                        )}
                        {canManage && (
                          <IconButton
                            label={
                              a.isActive === false ? "Reactivate account" : "Deactivate account"
                            }
                            icon={a.isActive === false ? MdCheckCircle : MdBlock}
                            size={17}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleActive(a);
                            }}
                          />
                        )}
                        {canDeleteRow(a) && (
                          <IconButton
                            danger
                            label="Delete account"
                            icon={MdDelete}
                            size={17}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(a);
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    {filtered.length} account{filtered.length === 1 ? "" : "s"}
                  </td>
                  {canReconcile && (
                    <td className="k-num">
                      {money(filtered.reduce((s, a) => s + (Number(a.clearedBalance) || 0), 0))}
                    </td>
                  )}
                  {canReconcile && (
                    <td className="k-num">
                      {money(filtered.reduce((s, a) => s + (Number(a.pendingDeposits) || 0), 0))}
                    </td>
                  )}
                  {canReconcile && (
                    <td className="k-num">
                      {money(filtered.reduce((s, a) => s + (Number(a.pendingWithdrawals) || 0), 0))}
                    </td>
                  )}
                  {canReconcile &&
                    (() => {
                      const c = filtered.reduce(
                        (s, a) => s + (Number(a.uncategorizedCount) || 0),
                        0,
                      );
                      return (
                        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                          {c ? `${c} to review` : ""}
                        </td>
                      );
                    })()}
                  <td className="k-num">{money(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </RecordsViewport>

      {ledgerAccount && (
        <AccountLedgerDialog account={ledgerAccount} onClose={() => setLedgerAccount(null)} />
      )}

      {reconcileAccount && (
        <ReconcileModal
          companyId={companyId}
          account={reconcileAccount}
          onClose={() => setReconcileAccount(null)}
          onLocked={() => {
            load();
          }}
        />
      )}

      {importAccount && (
        <StatementImportModal
          companyId={companyId}
          account={importAccount}
          onClose={() => setImportAccount(null)}
          onDone={() => {
            load();
          }}
        />
      )}

      {showCreate && (
        <CreateBankCashModal
          companyId={companyId}
          assetGroups={assetGroups}
          defaultGroupId={defaultGroupId}
          onClose={() => setShowCreate(false)}
          onCreated={(keepOpen) => {
            if (!keepOpen) setShowCreate(false);
            load();
          }}
        />
      )}

      {editAccount && (
        <EditBankCashModal
          companyId={companyId}
          assetGroups={assetGroups}
          account={editAccount}
          onClose={() => setEditAccount(null)}
          onSaved={() => {
            setEditAccount(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// metadata update; changing the opening balance routes through the dedicated
// adjust endpoint (offset to Retained earnings), so it's shown separately with
// a live preview of the offset. Opening is locked while the account is inactive.
function EditBankCashModal({ companyId, assetGroups, account, onClose, onSaved }) {
  const [name, setName] = useState(account.name || "");
  const [code, setCode] = useState(account.code || "");
  const [groupId, setGroupId] = useState(
    account.accountGroupId ? String(account.accountGroupId) : "",
  );
  const [opening, setOpening] = useState(
    account.openingBalance != null ? String(account.openingBalance) : "0",
  );
  const [isDebit, setIsDebit] = useState(account.openingBalanceIsDebit ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);

  const isInactive = account.isActive === false;
  const signedOld =
    (account.openingBalanceIsDebit ?? true)
      ? Number(account.openingBalance || 0)
      : -Number(account.openingBalance || 0);
  const signedNew = isDebit ? Math.abs(Number(opening) || 0) : -Math.abs(Number(opening) || 0);
  const delta = signedNew - signedOld;
  const openingChanged = !isInactive && delta !== 0;

  const doSave = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!groupId) {
      setError("Pick a group (an asset group in the Chart of Accounts).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        code: code.trim() || null,
        accountGroupId: Number(groupId),
      };
      await updateAccount(account.id, payload);
      if (openingChanged) {
        await adjustOpeningBalance(account.id, {
          openingBalance: Math.abs(Number(opening) || 0),
          openingBalanceIsDebit: isDebit,
        });
      }
      notify("Account updated.", "success");
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save the account.");
      setSaving(false);
    }
  };

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: modalSizes.md }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h3 style={formStyles.title}>Edit Bank / Cash Account</h3>
          <button
            data-admin-close=""
            style={formStyles.closeButton}
            onClick={onClose}
            title="Close"
          >
            <MdClose size={18} />
          </button>
        </div>

        <div data-admin-body="" style={formStyles.body}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              doSave();
            }}
            style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
          >
            <div style={st.fieldRow}>
              <div style={{ flex: 2, minWidth: 180 }}>
                <label style={st.label}>Name *</label>
                <input
                  style={formStyles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={st.label}>Code</label>
                <input
                  style={formStyles.input}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div>
              <label style={st.label}>Group</label>
              {assetGroups.length === 0 ? (
                <div className="k-muted">No account groups found.</div>
              ) : (
                <select
                  className="k-select"
                  style={{ width: "100%" }}
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  <option value="">Select a group…</option>
                  {assetGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div style={st.fieldRow}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={st.label}>Opening Balance</label>
                <input
                  type="number"
                  step="0.01"
                  style={{
                    ...formStyles.input,
                    ...(isInactive
                      ? { background: "var(--k-input-bg)", cursor: "not-allowed" }
                      : {}),
                  }}
                  value={opening}
                  disabled={isInactive}
                  onChange={(e) => setOpening(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={st.label}>Balance is</label>
                <select
                  className="k-select"
                  style={{ width: "100%" }}
                  value={isDebit ? "debit" : "credit"}
                  disabled={isInactive}
                  onChange={(e) => setIsDebit(e.target.value === "debit")}
                >
                  <option value="debit">Debit (money in the account)</option>
                  <option value="credit">Credit (overdrawn)</option>
                </select>
              </div>
            </div>

            {isInactive ? (
              <div style={st.noteMuted}>Reactivate the account to correct its opening balance.</div>
            ) : openingChanged ? (
              <div style={st.noteInfo}>
                Offsets <b>{money(Math.abs(delta))}</b> to <b>Retained earnings</b> to keep the
                balance sheet balanced.
              </div>
            ) : null}

            {error && (
              <div ref={errRef}>
                <Alert tone="error">{error}</Alert>
              </div>
            )}
          </form>
        </div>

        <div data-admin-footer="" style={st.footer}>
          <Button data-admin-close="" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={doSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const st = {
  glChipOff: {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "var(--k-muted)",
    background: "var(--k-input-bg)",
    border: "1px solid var(--k-line)",
    padding: "3px 10px",
    borderRadius: 12,
    whiteSpace: "nowrap",
  },
  accName: { fontWeight: 600 },
  code: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "var(--k-muted)",
    background: "var(--k-input-bg)",
    padding: "1px 6px",
    borderRadius: 4,
  },
  reviewLink: {
    border: "none",
    background: "transparent",
    padding: 0,
    color: "var(--k-blue)",
    fontSize: "0.82rem",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
  },
  // Mobile stacked-card fallback for the accounts table (<768px).
  cardList: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  acctCard: {
    padding: "0.8rem 0.9rem",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  acctCardTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  // Line-clamp long account names — never nowrap+ellipsis (CLAUDE.md §3).
  acctName: {
    fontWeight: 700,
    color: "var(--k-ink)",
    fontSize: "0.95rem",
    minWidth: 0,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  acctBalBox: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    padding: "0.45rem 0.6rem",
    background: "var(--k-input-bg)",
    borderRadius: 8,
  },
  acctBalLabel: {
    fontSize: "0.66rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--k-muted)",
  },
  acctMetaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))",
    gap: "0.4rem 0.8rem",
  },
  acctMetaLabel: {
    display: "block",
    fontSize: "0.62rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--k-muted)",
  },
  acctMetaValue: {
    display: "block",
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "var(--k-ink)",
    fontVariantNumeric: "tabular-nums",
  },
  acctActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: "0.5rem",
    borderTop: "1px solid var(--k-line)",
  },
  acctTotalsCard: {
    background: "var(--k-input-bg)",
    border: "1px solid var(--k-line)",
    borderRadius: 12,
    padding: "0.7rem 0.9rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
    flexWrap: "wrap",
    padding: "0.9rem clamp(1rem, 2vw, 1.5rem)",
    borderTop: "1px solid var(--k-line)",
    flexShrink: 0,
  },
  fieldRow: { display: "flex", gap: "0.75rem", flexWrap: "wrap" },
  label: {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "var(--k-muted)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  inactiveBadge: {
    marginLeft: 6,
    fontSize: "0.62rem",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--k-muted)",
    background: "var(--k-surface-2)",
    border: "1px solid var(--k-line)",
    borderRadius: 10,
    padding: "1px 7px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  noteInfo: {
    fontSize: "0.8rem",
    color: "var(--k-ink)",
    background: "var(--k-surface-3)",
    border: "1px solid var(--k-line)",
    borderRadius: 8,
    padding: "8px 12px",
  },
  noteMuted: {
    fontSize: "0.8rem",
    color: "var(--k-muted)",
    background: "var(--k-input-bg)",
    border: "1px solid var(--k-line)",
    borderRadius: 8,
    padding: "8px 12px",
  },
};
