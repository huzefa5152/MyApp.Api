import { useState, useEffect, useMemo } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors, dropdownStyles } from "../theme";
import SearchableSelect from "./SearchableSelect";
import DivisionSelect from "./DivisionSelect";
import BankCashSelect from "./BankCashSelect";
import { usePermissions } from "../contexts/PermissionsContext";
import { createPayment, updatePayment } from "../api/paymentApi";
import { getClientsByCompany } from "../api/clientApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getPagedInvoicesByCompany } from "../api/invoiceApi";
import { getPurchaseBillsByCompanyPaged } from "../api/purchaseBillApi";

const METHODS = ["Cash", "Bank Transfer", "Cheque", "Online", "Other"];

/**
 * Record a Receipt (money in) or Payment (money out). mode = "receipts" |
 * "payments" flips the contact (Client ↔ Supplier) and the documents settled
 * (sales invoices ↔ purchase bills). The operator picks a contact, the form
 * lists that contact's open documents (balance > 0) with an amount-to-apply
 * input each; the payment total is the sum of the applied amounts. Direct
 * (account) lines are deferred to the Chart-of-Accounts phase.
 */
export default function PaymentForm({ mode, companyId, preset, editPayment = null, onClose, onSaved }) {
  const { has } = usePermissions();
  const canViewDivisions = has("divisions.manage.view");
  const isReceipt = mode === "receipts";
  const isEdit = !!editPayment?.id;
  const contactLabel = isReceipt ? "Client" : "Supplier";
  const docLabel = isReceipt ? "Invoice" : "Bill";
  const dir = isReceipt ? "receipts" : "payments";

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(editPayment?.date ? editPayment.date.slice(0, 10) : today);
  const [method, setMethod] = useState(editPayment?.method || "Cash");
  // Bank/Cash account — sourced from the Chart of Accounts (manager.io model:
  // every receipt/payment posts against a real bank/cash account, which is one
  // leg of the journal). Bank/cash accounts are CoA accounts flagged with the
  // BankCash control type; the Payments module is the subledger feeding them.
  // When none exist yet, fall back to the legacy free-text name so the form
  // stays usable until the operator sets up their accounts.
  const [hasBankAccounts, setHasBankAccounts] = useState(false);
  const [bankAccountId, setBankAccountId] = useState(editPayment?.bankAccountId ? String(editPayment.bankAccountId) : "");
  const [bankAccountName, setBankAccountName] = useState(editPayment?.bankAccountName || "");
  const [description, setDescription] = useState(editPayment?.description || "");
  const [chequeNumber, setChequeNumber] = useState(editPayment?.chequeNumber || "");
  const [chequeDate, setChequeDate] = useState(editPayment?.chequeDate ? editPayment.chequeDate.slice(0, 10) : "");

  const [contacts, setContacts] = useState([]);
  const [contactId, setContactId] = useState(
    editPayment?.contactId ? String(editPayment.contactId) : (preset?.contactId ? String(preset.contactId) : ""));
  // Optional Division tag — defaults from the settled document when opened via
  // the invoice/bill shortcut.
  const [divisionId, setDivisionId] = useState(
    editPayment?.divisionId ? String(editPayment.divisionId) : (preset?.divisionId ? String(preset.divisionId) : ""));
  const [docs, setDocs] = useState([]);          // open documents for the contact
  const [alloc, setAlloc] = useState({});         // docId -> amount string
  const [loadingDocs, setLoadingDocs] = useState(false);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Load the contact list once.
  useEffect(() => {
    let cancelled = false;
    const load = isReceipt ? getClientsByCompany : getSuppliersByCompany;
    load(companyId)
      .then(({ data }) => { if (!cancelled) setContacts(data || []); })
      .catch(() => { if (!cancelled) setContacts([]); });
    return () => { cancelled = true; };
  }, [companyId, isReceipt]);

  // When a contact is picked, fetch their open documents (balance due > 0).
  useEffect(() => {
    if (!contactId) { setDocs([]); setAlloc({}); return; }
    let cancelled = false;
    setLoadingDocs(true);
    const fetcher = isReceipt
      ? getPagedInvoicesByCompany(companyId, { clientId: contactId, pageSize: 100 })
      : getPurchaseBillsByCompanyPaged(companyId, { supplierId: contactId, pageSize: 100 });
    fetcher
      .then(({ data }) => {
        if (cancelled) return;
        // When editing, this payment's own allocations free up headroom on the
        // docs it settled — show them (even if now fully paid) with
        // available = balanceDue + own, and pre-fill the current amounts.
        const ownAlloc = {};
        if (editPayment) {
          for (const a of editPayment.allocations || []) {
            const docId = isReceipt ? a.invoiceId : a.purchaseBillId;
            if (docId) ownAlloc[docId] = (ownAlloc[docId] || 0) + (a.amount || 0);
          }
        }
        const shown = (data.items || [])
          .filter((d) => !d.isCancelled)
          .map((d) => {
            const balanceDue = d.balanceDue ?? (d.grandTotal - (d.amountPaid || 0));
            const own = ownAlloc[d.id] || 0;
            return {
              id: d.id,
              number: isReceipt ? d.invoiceNumber : d.purchaseBillNumber,
              date: d.date,
              grandTotal: d.grandTotal,
              balanceDue,
              available: balanceDue + own,   // headroom this payment can apply
            };
          })
          .filter((d) => d.available > 0.001);
        setDocs(shown);

        if (editPayment) {
          const pre = {};
          for (const d of shown) if (ownAlloc[d.id]) pre[d.id] = String(ownAlloc[d.id]);
          setAlloc(pre);
        } else if (preset?.documentId) {
          const target = shown.find((d) => d.id === preset.documentId);
          if (target) setAlloc({ [target.id]: String(target.available) });
        }
      })
      .catch(() => { if (!cancelled) setDocs([]); })
      .finally(() => { if (!cancelled) setLoadingDocs(false); });
    return () => { cancelled = true; };
  }, [contactId, companyId, isReceipt, preset?.documentId, editPayment?.id]);

  const setAllocAmount = (docId, value) =>
    setAlloc((prev) => ({ ...prev, [docId]: value }));

  const fillBalance = (doc) => setAllocAmount(doc.id, String(doc.available));

  const total = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [alloc]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");

    const allocations = docs
      .map((d) => ({ doc: d, amount: parseFloat(alloc[d.id]) || 0 }))
      .filter((x) => x.amount > 0);

    if (allocations.length === 0) {
      setError(`Enter an amount against at least one ${docLabel.toLowerCase()}.`);
      return;
    }
    // Client-side over-allocation guard (server enforces too). Uses `available`
    // (= balance due + this payment's own current allocation when editing).
    const over = allocations.find((x) => x.amount > x.doc.available + 0.001);
    if (over) {
      setError(`${docLabel} #${over.doc.number}: amount exceeds the available balance (${over.doc.available.toLocaleString()}).`);
      return;
    }
    if (method === "Cheque" && !chequeNumber.trim()) {
      setError("Enter the cheque number.");
      return;
    }
    // When bank/cash accounts are configured, picking one is mandatory — it's
    // the account the money lands in / comes from (manager.io requires it too).
    if (hasBankAccounts && !bankAccountId) {
      setError(`Select the bank/cash account the money was ${isReceipt ? "received in" : "paid from"}.`);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        direction: isReceipt ? "Receipt" : "Payment",
        date: new Date(date).toISOString(),
        contactType: contactLabel,
        contactId: contactId ? Number(contactId) : null,
        divisionId: divisionId ? Number(divisionId) : null,
        bankAccountId: bankAccountId ? Number(bankAccountId) : null,
        bankAccountName: bankAccountName.trim() || null,
        method,
        description: description.trim() || null,
        chequeNumber: method === "Cheque" ? chequeNumber.trim() : null,
        chequeDate: method === "Cheque" && chequeDate ? new Date(chequeDate).toISOString() : null,
        allocations: allocations.map((x) => ({
          invoiceId: isReceipt ? x.doc.id : null,
          purchaseBillId: isReceipt ? null : x.doc.id,
          amount: x.amount,
        })),
      };
      if (isEdit) await updatePayment(dir, editPayment.id, payload);
      else await createPayment(dir, companyId, payload);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || `Could not save the ${isReceipt ? "receipt" : "payment"}.`);
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit ${editPayment.reference || (isReceipt ? "Receipt" : "Payment")}` : (isReceipt ? "Record Receipt" : "Record Payment")}</h5>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={formStyles.error}>{error}</div>}

            {/* Contact picker spans the full row so long client/supplier names
                aren't truncated inside a narrow grid column. */}
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>{contactLabel}</label>
              <SearchableSelect
                items={contacts}
                value={contactId}
                onChange={(id) => setContactId(id ? String(id) : "")}
                placeholder={`— Select ${contactLabel} —`}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Date</label>
                <input type="date" style={formStyles.input} value={date} onChange={(e) => setDate(e.target.value)} max={today} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Method</label>
                <select style={{ ...dropdownStyles.base, width: "100%" }} value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <BankCashSelect
                companyId={companyId}
                value={bankAccountId}
                name={bankAccountName}
                onChange={(id, nm) => { setBankAccountId(id ? String(id) : ""); setBankAccountName(nm || ""); }}
                onLoaded={(list) => setHasBankAccounts(list.length > 0)}
                includeAccount={editPayment?.bankAccountId ? { id: editPayment.bankAccountId, name: editPayment.bankAccountName } : null}
                autoSelectSingle={!isEdit}
                label={isReceipt ? "Received in (bank/cash)" : "Paid from (bank/cash)"}
              />
              {canViewDivisions && (
                <div style={formStyles.formGroup}>
                  <DivisionSelect
                    companyId={companyId}
                    value={divisionId}
                    onChange={setDivisionId}
                    mode="select"
                    label={<>Division <span style={{ fontWeight: 400, color: colors.textSecondary }}>(optional)</span></>}
                    labelStyle={formStyles.label}
                    style={{ ...dropdownStyles.base, width: "100%" }}
                  />
                </div>
              )}
            </div>

            {method === "Cheque" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Cheque #</label>
                  <input style={formStyles.input} value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} />
                </div>
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Cheque date <span style={{ color: colors.textSecondary, fontWeight: 400 }}>(future = post-dated)</span></label>
                  <input type="date" style={formStyles.input} value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
                </div>
              </div>
            )}

            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Description (optional)</label>
              <input style={formStyles.input} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            {/* Allocation against open documents */}
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Apply to open {docLabel.toLowerCase()}s</label>
              {!contactId ? (
                <div style={hintBox}>Select a {contactLabel.toLowerCase()} to see their unpaid {docLabel.toLowerCase()}s.</div>
              ) : loadingDocs ? (
                <div style={hintBox}>Loading…</div>
              ) : docs.length === 0 ? (
                <div style={hintBox}>No open {docLabel.toLowerCase()}s with a balance due for this {contactLabel.toLowerCase()}.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={tbl}>
                    <thead>
                      <tr>
                        <th style={th}>{docLabel} #</th>
                        <th style={th}>Date</th>
                        <th style={{ ...th, textAlign: "right" }}>Total</th>
                        <th style={{ ...th, textAlign: "right" }}>Balance due</th>
                        <th style={{ ...th, textAlign: "right", width: 150 }}>Apply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map((d) => (
                        <tr key={d.id}>
                          <td style={td}><strong>#{d.number}</strong></td>
                          <td style={td}>{d.date ? new Date(d.date).toLocaleDateString() : "—"}</td>
                          <td style={{ ...td, textAlign: "right" }}>{d.grandTotal.toLocaleString()}</td>
                          <td style={{ ...td, textAlign: "right" }}>{d.available.toLocaleString()}</td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
                              <input
                                type="number" min="0" step="0.01" style={{ ...formStyles.input, textAlign: "right", padding: "0.35rem 0.5rem", width: 100 }}
                                value={alloc[d.id] ?? ""}
                                onChange={(e) => setAllocAmount(d.id, e.target.value)}
                              />
                              <button type="button" style={fillBtn} onClick={() => fillBalance(d)} title="Apply full balance">Max</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", alignItems: "baseline", fontSize: "1.05rem", fontWeight: 700, color: colors.blue }}>
              <span style={{ color: colors.textSecondary, fontSize: "0.85rem", fontWeight: 600 }}>Total {isReceipt ? "received" : "paid"}:</span>
              <span>Rs {total.toLocaleString()}</span>
            </div>
          </div>

          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            {(() => {
              const bankMissing = hasBankAccounts && !bankAccountId;
              const blocked = saving || total <= 0 || bankMissing;
              return (
                <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: blocked ? 0.6 : 1 }} disabled={blocked}>
                  {saving ? "Saving…" : isEdit ? "Save Changes" : isReceipt ? "Save Receipt" : "Save Payment"}
                </button>
              );
            })()}
          </div>
        </form>
      </div>
    </div>
  );
}

const hintBox = { padding: "0.75rem", background: colors.inputBg, border: `1px dashed ${colors.inputBorder}`, borderRadius: 8, color: colors.textSecondary, fontSize: "0.85rem" };
const tbl = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th = { textAlign: "left", padding: "0.4rem 0.5rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textSecondary, fontWeight: 700, whiteSpace: "nowrap" };
const td = { padding: "0.4rem 0.5rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary };
const fillBtn = { padding: "0.3rem 0.5rem", fontSize: "0.7rem", fontWeight: 700, borderRadius: 6, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, cursor: "pointer" };
