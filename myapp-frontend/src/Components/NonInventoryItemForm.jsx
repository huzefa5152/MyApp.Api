import { useState, useEffect } from "react";
import { getAccountsFlat } from "../api/accountApi";
import { notify } from "../utils/notify";
import { formStyles, modalSizes } from "../theme";

// Create / edit a per-company Non-Inventory Item (Freight, Discount, …).
// Maps to the company's chart of accounts (sale + purchase account). Accounts
// are optional — an unmapped item posts to Suspense until an account is picked.

export default function NonInventoryItemForm({ companyId, item, onClose, onSaved }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    name: item?.name || "",
    code: item?.code || "",
    unitName: item?.unitName || "",
    saleAccountId: item?.saleAccountId ?? "",
    purchaseAccountId: item?.purchaseAccountId ?? "",
    defaultLineDescription: item?.defaultLineDescription || "",
    defaultSalePrice: item?.defaultSalePrice ?? "",
    defaultPurchasePrice: item?.defaultPurchasePrice ?? "",
    hideNameOnPrint: item?.hideNameOnPrint || false,
    isActive: item?.isActive ?? true,
  });
  const [accounts, setAccounts] = useState([]);
  const [accountsErr, setAccountsErr] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getAccountsFlat(companyId)
      .then(({ data }) => { if (alive) setAccounts(Array.isArray(data) ? data.filter((a) => a.isActive) : []); })
      .catch(() => { if (alive) setAccountsErr(true); });
    return () => { alive = false; };
  }, [companyId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Split accounts by side so the pickers surface the natural choice first:
  // income for "when sold", expense/asset for "when purchased".
  const incomeAccounts = accounts.filter((a) => a.accountType === "Income");
  const otherAccounts = accounts.filter((a) => a.accountType !== "Income");
  const expenseAccounts = accounts.filter((a) => a.accountType === "Expense");
  const nonExpenseAccounts = accounts.filter((a) => a.accountType !== "Expense");

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { notify("A name is required.", "warning"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        unitName: form.unitName.trim() || null,
        saleAccountId: form.saleAccountId ? Number(form.saleAccountId) : null,
        purchaseAccountId: form.purchaseAccountId ? Number(form.purchaseAccountId) : null,
        defaultLineDescription: form.defaultLineDescription.trim() || null,
        defaultSalePrice: form.defaultSalePrice === "" ? null : Number(form.defaultSalePrice),
        defaultPurchasePrice: form.defaultPurchasePrice === "" ? null : Number(form.defaultPurchasePrice),
        hideNameOnPrint: form.hideNameOnPrint,
        isActive: form.isActive,
      };
      await onSaved(payload);
      onClose();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to save the non-inventory item.", "error");
    } finally {
      setSaving(false);
    }
  };

  const AccountSelect = ({ value, onChange, primary, primaryLabel, rest, restLabel, placeholder }) => (
    <select style={formStyles.input} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{accountsErr ? "(chart of accounts unavailable)" : placeholder}</option>
      {primary.length > 0 && (
        <optgroup label={primaryLabel}>
          {primary.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label={restLabel}>
          {rest.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.accountType})</option>)}
        </optgroup>
      )}
    </select>
  );

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <form style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? "Edit Non-Inventory Item" : "New Non-Inventory Item"}</h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <div style={formStyles.body}>
          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Name *</label>
            <input style={formStyles.input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Freight Charges" autoFocus />
          </div>

          <div style={row2}>
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Code</label>
              <input style={formStyles.input} value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="Optional" />
            </div>
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Unit</label>
              <input style={formStyles.input} value={form.unitName} onChange={(e) => set("unitName", e.target.value)} placeholder="e.g. Trip, Each" />
            </div>
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>When sold → account</label>
            <AccountSelect
              value={form.saleAccountId} onChange={(v) => set("saleAccountId", v)}
              primary={incomeAccounts} primaryLabel="Income"
              rest={otherAccounts} restLabel="Other accounts"
              placeholder="(Suspense — unmapped)"
            />
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>When purchased → account</label>
            <AccountSelect
              value={form.purchaseAccountId} onChange={(v) => set("purchaseAccountId", v)}
              primary={expenseAccounts} primaryLabel="Expenses"
              rest={nonExpenseAccounts} restLabel="Other accounts"
              placeholder="(Suspense — unmapped)"
            />
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Default line description</label>
            <input style={formStyles.input} value={form.defaultLineDescription} onChange={(e) => set("defaultLineDescription", e.target.value)} placeholder="Optional narration prefilled on the line" />
          </div>

          <div style={row2}>
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Default sale price</label>
              <input type="number" step="0.01" style={formStyles.input} value={form.defaultSalePrice} onChange={(e) => set("defaultSalePrice", e.target.value)} placeholder="Optional" />
            </div>
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Default purchase price</label>
              <input type="number" step="0.01" style={formStyles.input} value={form.defaultPurchasePrice} onChange={(e) => set("defaultPurchasePrice", e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <label style={checkRow}>
            <input type="checkbox" checked={form.hideNameOnPrint} onChange={(e) => set("hideNameOnPrint", e.target.checked)} />
            <span>Hide item name on printed documents</span>
          </label>
          <label style={checkRow}>
            <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            <span>Active (uncheck to hide from new documents)</span>
          </label>
        </div>
        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...formStyles.button, ...formStyles.submit, ...(saving ? { opacity: 0.6 } : {}) }}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

const row2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: "0.75rem" };
const checkRow = { display: "flex", alignItems: "center", gap: 8, fontSize: "0.88rem", color: "#334155", margin: "0.5rem 0 0", cursor: "pointer" };
