import { useState } from "react";
import { createPortal } from "react-dom";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors, dropdownStyles } from "../theme";
import { createAccount } from "../api/accountApi";
import { notify } from "../utils/notify";
import useScrollToError from "../hooks/useScrollToError";

export default function CreateBankCashModal({ companyId, assetGroups, defaultGroupId, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [groupId, setGroupId] = useState(defaultGroupId ? String(defaultGroupId) : "");
  const [opening, setOpening] = useState("");
  const [isDebit, setIsDebit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);

  const doCreate = async (addAnother) => {
    if (saving) return;
    if (!name.trim()) { setError("Name is required."); return; }
    if (!groupId) { setError("Pick a group (an asset group in the Chart of Accounts)."); return; }
    setSaving(true); setError("");
    try {
      const { data: account } = await createAccount(companyId, {
        name: name.trim(),
        code: code.trim() || null,
        accountGroupId: Number(groupId),
        accountType: "Asset",
        controlType: "BankCash",
        openingBalance: Number(opening) || 0,
        openingBalanceIsDebit: isDebit,
      });
      notify("Bank / cash account created.", "success");
      if (addAnother) {
        setName(""); setCode(""); setOpening(""); setError(""); setSaving(false);
        onCreated(true, account);   // refresh list, keep the modal open
      } else {
        onCreated(false, account);  // refresh list + close
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Could not create the account.");
      setSaving(false);
    }
  };

  return createPortal(
    <div data-admin-backdrop="" style={{ ...formStyles.backdrop, zIndex: 1200 }} onClick={() => { if (!saving) onClose(); }}>
      <div data-admin-dialog="" role="dialog" aria-modal="true" aria-label="New Bank / Cash Account" style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onClick={(e) => e.stopPropagation()}>
        <div data-admin-header="" style={formStyles.header}>
          <h3 style={formStyles.title}>New Bank / Cash Account</h3>
          <button data-admin-close="" style={{ ...formStyles.closeButton, minWidth: 44, minHeight: 44 }} onClick={onClose} disabled={saving} title="Close"><MdClose size={18} /></button>
        </div>

        <div data-admin-body="" style={formStyles.body}>
          <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); doCreate(false); }} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div style={st.fieldRow}>
              <div style={{ flex: 2, minWidth: 180 }}>
                <label style={st.label}>Name *</label>
                <input style={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bank current account or cash account" autoFocus />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={st.label}>Code</label>
                <input style={formStyles.input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Optional" />
              </div>
            </div>



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

            {error && <div ref={errRef} style={st.error}>{error}</div>}
          </form>
        </div>

        <div data-admin-footer="" style={st.footer}>
          <button data-admin-close="" type="button" style={st.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...st.secondaryBtn, opacity: saving ? 0.6 : 1 }} onClick={() => doCreate(true)} disabled={saving}>Create &amp; add another</button>
          <button type="button" style={{ ...st.primaryBtn, opacity: saving ? 0.6 : 1 }} onClick={() => doCreate(false)} disabled={saving}>{saving ? "Creating…" : "Create"}</button>
        </div>
      </div>
    </div>, document.body
  );
}

const st = {
 fieldRow: { display: "flex", gap: "0.75rem", flexWrap: "wrap" },
 label: { display: "block", fontSize: "0.85rem", fontWeight: 700, marginBottom: 4, color: colors.textSecondary },
 muted: { color: colors.textSecondary },
 error: { color: colors.danger, padding: 12 },
 footer: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, padding: "1rem", flexShrink: 0 },
 secondaryBtn: { ...formStyles.button, minHeight: 44 },
 primaryBtn: { ...formStyles.button, ...formStyles.submit, minHeight: 44 },
};
