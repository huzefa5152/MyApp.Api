import { getAccountsFlat, getBankCashAccounts } from "../api/accountApi";
import { useState, useEffect, useRef } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import SearchableClientSelect from "./SearchableClientSelect";
import { Button, TableWrap } from "../ui/Kit";
import { createPayment, updatePayment } from "../api/paymentApi";
import { getClientsByCompany } from "../api/clientApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getPagedInvoicesByCompany } from "../api/invoiceApi";
import { getPurchaseBillsByCompanyPaged } from "../api/purchaseBillApi";
import AttachmentManager from "./AttachmentManager";
import useScrollToError from "../hooks/useScrollToError";
import DocumentNotesEditor from "./DocumentNotesEditor";

import { todayYmd } from "../utils/dateInput";
const METHODS = ["Cash", "Bank Transfer", "Cheque", "Online", "Other"];

/** Money in/out: party selection, document settlement, advances/refunds and income/expense lines. */
export default function PaymentForm({ mode, companyId, preset, editPayment = null, onClose, onSaved }) {
  const isReceipt = mode === "receipts";
  const isEdit = !!editPayment?.id;
  const [contactType, setContactType] = useState(editPayment?.contactType || preset?.contactType || (isReceipt ? "Client" : "Supplier"));
  const [contactName, setContactName] = useState(editPayment?.contactType === "Other" ? editPayment.contactName || "" : "");
  const initialPurpose = editPayment?.allocations?.some(a => a.accountId) ? "account"
    : editPayment?.allocations?.some(a => a.kind === "OnAccount") ? "advance" : "settle";
  const [purpose, setPurpose] = useState(initialPurpose);
  const [directLines, setDirectLines] = useState(() => { const lines = (editPayment?.allocations || []).filter(a => a.accountId).map(a => ({ accountId: String(a.accountId), amount: String(a.amount) })); return lines.length ? lines : [{ accountId: "", amount: "" }]; });
  const [advanceAmount, setAdvanceAmount] = useState(String(editPayment?.allocations?.filter(a => a.kind === "OnAccount").reduce((sum,a) => sum + a.amount, 0) || ""));
  const [accounts, setAccounts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankAccountId, setBankAccountId] = useState(String(editPayment?.bankAccountId || ""));
  const contactLabel = contactType === "Other" ? "Payee / payer" : contactType;
  const canSettle = isReceipt && contactType === "Client" || !isReceipt && contactType === "Supplier";
  const changeContactType = next => {
    setContactType(next); setContactId(""); setDocs([]); setAlloc({});
    setPurpose(next === "Other" ? "account" : (isReceipt && next === "Client" || !isReceipt && next === "Supplier") ? "settle" : "advance");
  };
  useEffect(() => {
    let active = true;
    getAccountsFlat(companyId).then(({data}) => { if(active) setAccounts(data || []); }).catch(() => {});
    getBankCashAccounts(companyId).then(({data}) => { if(active) setBankAccounts(data || []); }).catch(() => {});
    return () => { active = false; };
  }, [companyId]);
  const docLabel = isReceipt ? "Invoice" : "Bill";
  const dir = isReceipt ? "receipts" : "payments";

  const today = todayYmd();
  const [date, setDate] = useState(editPayment?.date ? editPayment.date.slice(0, 10) : today);
  const [method, setMethod] = useState(editPayment?.method || "Cash");
  // Optional description complements the selected bank/cash account.
  const [bankAccountName, setBankAccountName] = useState(editPayment?.bankAccountName || "");
  const [description, setDescription] = useState(editPayment?.description || "");
  const [notes, setNotes] = useState(editPayment?.notes || "");
  const [chequeNumber, setChequeNumber] = useState(editPayment?.chequeNumber || "");
  const [chequeDate, setChequeDate] = useState(editPayment?.chequeDate ? editPayment.chequeDate.slice(0, 10) : "");

  const [contacts, setContacts] = useState([]);
  const [contactId, setContactId] = useState(
    editPayment?.contactId ? String(editPayment.contactId) : (preset?.contactId ? String(preset.contactId) : ""));
  const [docs, setDocs] = useState([]);          // open documents for the contact
  const [alloc, setAlloc] = useState({});         // docId -> amount string
  const [loadingDocs, setLoadingDocs] = useState(false);
  // Responsive: the settle-documents table side-scrolls on a phone, so below
  // 760px each open document renders as a tap-friendly stacked card instead.
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 760);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);

  // Load the contact list once.
  useEffect(() => {
    let cancelled = false;
    if (contactType === "Other") { setContacts([]); return; }
    const load = contactType === "Client" ? getClientsByCompany : getSuppliersByCompany;
    load(companyId)
      .then(({ data }) => { if (!cancelled) setContacts(data || []); })
      .catch(() => { if (!cancelled) setContacts([]); });
    return () => { cancelled = true; };
  }, [companyId, contactType]);

  // When a contact is picked, fetch their open documents (balance due > 0).
  useEffect(() => {
    if (!contactId || !canSettle || purpose !== "settle") { setDocs([]); setAlloc({}); setLoadingDocs(false); return; }
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
            const total = isReceipt
              ? (d.commercialTotal ?? ((Number(d.grandTotal) || 0) + (Number(d.freightCharges) || 0)))
              : d.grandTotal;
            const collectible = isReceipt
              ? (d.collectible ?? Math.max(0, total - (Number(d.withholdingTaxAmount) || 0)))
              : d.grandTotal;
            const balanceDue = d.balanceDue ?? (isReceipt
              ? Math.max(0, collectible - (d.amountPaid || 0))
              : d.grandTotal - (d.amountPaid || 0));
            const own = ownAlloc[d.id] || 0;
            return {
              id: d.id,
              number: isReceipt ? d.invoiceNumber : d.purchaseBillNumber,
              date: d.date,
              grandTotal: total,
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
  }, [contactId, companyId, isReceipt, preset?.documentId, editPayment?.id, contactType, purpose]);

  const setAllocAmount = (docId, value) =>
    setAlloc((prev) => ({ ...prev, [docId]: value }));

  const fillBalance = (doc) => setAllocAmount(doc.id, String(doc.available));

  const total = purpose === "advance" ? Number(advanceAmount) || 0
    : purpose === "account" ? directLines.reduce((sum,a) => sum + (Number(a.amount) || 0), 0)
    : Object.values(alloc).reduce((sum,a) => sum + (Number(a) || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");

    const documentAllocations = docs
      .map((d) => ({ doc: d, amount: parseFloat(alloc[d.id]) || 0 }))
      .filter((x) => x.amount > 0);

    if (purpose === "settle" && documentAllocations.length === 0) {
      setError(`Enter an amount against at least one ${docLabel.toLowerCase()}.`);
      return;
    }
    // Client-side over-allocation guard (server enforces too). Uses `available`
    // (= balance due + this payment's own current allocation when editing).
    const over = documentAllocations.find((x) => x.amount > x.doc.available + 0.001);
    if (over) {
      setError(`${docLabel} #${over.doc.number}: amount exceeds the available balance (${over.doc.available.toLocaleString()}).`);
      return;
    }
    if (contactType === "Other" ? !contactName.trim() : !contactId) {
      setError("Choose who paid or received this money."); return;
    }
    if (purpose === "settle" && !canSettle || purpose === "advance" && contactType === "Other") {
      setError("Choose a valid purpose for this contact."); return;
    }
    const allocations = purpose === "settle" ? documentAllocations.map(x => ({
      kind: "Document", invoiceId: isReceipt ? x.doc.id : null,
      purchaseBillId: isReceipt ? null : x.doc.id, amount: x.amount
    })) : purpose === "advance" ? [{ kind: "OnAccount", amount: Number(advanceAmount) }]
      : directLines.map(a => ({ kind: "Account", accountId: Number(a.accountId), amount: Number(a.amount) }));
    if (allocations.some(a => !Number.isFinite(a.amount) || a.amount <= 0 || purpose === "account" && !a.accountId)) {
      setError("Enter a positive amount and choose an account for each income/expense line."); return;
    }
    if (method === "Cheque" && !chequeNumber.trim()) {
      setError("Enter the cheque number.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        direction: isReceipt ? "Receipt" : "Payment",
        date: new Date(date).toISOString(),
        contactType,
        contactName: contactType === "Other" ? contactName.trim() : null,
        bankAccountId: bankAccountId ? Number(bankAccountId) : null,
        contactId: contactId ? Number(contactId) : null,
        bankAccountName: bankAccountName.trim() || null,
        method,
        description: description.trim() || null,
        notes: notes.trim() || null,
        chequeNumber: method === "Cheque" ? chequeNumber.trim() : null,
        chequeDate: method === "Cheque" && chequeDate ? new Date(chequeDate).toISOString() : null,
        allocations,
      };
      let savedId = editPayment?.id;
      if (isEdit) {
        await updatePayment(dir, editPayment.id, payload);
      } else {
        const { data: saved } = await createPayment(dir, companyId, payload);
        savedId = saved?.id ?? savedId;
      }
      // Upload any files staged before the record had an id (no-op on edit /
      // when nothing was staged). Best-effort — the record is already saved.
      if (savedId) { try { await attachmentRef.current?.flush(savedId); } catch { /* attachments best-effort */ } }
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || `Could not save the ${isReceipt ? "receipt" : "payment"}.`);
      setSaving(false);
    }
  };

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit ${editPayment.reference || (isReceipt ? "Receipt" : "Payment")}` : (isReceipt ? "Record Receipt" : "Record Payment")}</h5>
          <button data-admin-close="" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>{isReceipt ? "Who paid you?" : "Who are you paying?"}</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["Client", "Supplier", "Other"].map(type => <button key={type} type="button"
                  style={{ ...fillBtn, minHeight: 44, padding: "8px 14px", background: contactType === type ? "#d9f1ed" : "#fff" }}
                  onClick={() => changeContactType(type)}>{type === "Other" ? "Someone else" : type}</button>)}
              </div>
              {contactType === "Other" ? <input aria-label="Payee or payer name" maxLength={200} style={formStyles.input}
                value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Name" />
                : <SearchableClientSelect clients={contacts} noun={contactType === "Client" ? "clients" : "suppliers"} ariaLabel={contactType} value={contactId}
                  onChange={v => { setContactId(v); setAlloc({}); }} placeholder={`Select ${contactType.toLowerCase()}`} />}
            </div>
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>What is this for?</label>
              <select aria-label="Payment purpose" style={formStyles.input} value={purpose} onChange={e => setPurpose(e.target.value)}>
                {canSettle && <option value="settle">Settle invoices / bills</option>}
                {contactType !== "Other" && <option value="advance">Advance / on account / refund</option>}
                <option value="account">{isReceipt ? "Other income" : "An expense"}</option>
              </select>
            </div>
            {purpose === "advance" && <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Advance / refund amount</label>
              <input aria-label="Advance amount" type="number" min="0" step="0.01" style={formStyles.input}
                value={advanceAmount} onChange={e => setAdvanceAmount(e.target.value)} />
              <p style={hintBox}>Recorded against the selected party’s balance. No invoice or bill is marked paid.</p>
            </div>}
            {purpose === "account" && <div style={formStyles.formGroup}>
              {directLines.map((line,idx) => <div key={idx} style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
                <select aria-label={`Account ${idx+1}`} value={line.accountId} style={{ ...formStyles.input, flex:"1 1 180px" }}
                  onChange={e => setDirectLines(prev => prev.map((a,i) => i===idx ? {...a,accountId:e.target.value} : a))}>
                  <option value="">Choose {isReceipt ? "income" : "expense"} account</option>
                  {accounts.filter(a => (a.isActive || String(a.id) === line.accountId) && a.accountType === (isReceipt ? "Income" : "Expense"))
                    .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input aria-label={`Amount ${idx+1}`} type="number" min="0" step="0.01" value={line.amount}
                  style={{ ...formStyles.input, flex:"1 1 120px" }}
                  onChange={e => setDirectLines(prev => prev.map((a,i) => i===idx ? {...a,amount:e.target.value} : a))} />
                {directLines.length>1 && <button type="button" style={{...fillBtn,minHeight:44}} onClick={() => setDirectLines(prev => prev.filter((_,i) => i!==idx))}>Remove</button>}
              </div>)}
              <button type="button" style={{...fillBtn,minHeight:44}} onClick={() => setDirectLines(prev => [...prev,{accountId:"",amount:""}])}>Add account line</button>
            </div>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Date</label>
                <input type="date" style={formStyles.input} value={date} onChange={(e) => setDate(e.target.value)} max={today} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Method</label>
                <select className="k-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>{isReceipt ? "Received in (bank/cash)" : "Paid from (bank/cash)"}</label>
                <select aria-label="Bank cash account" style={formStyles.input} value={bankAccountId}
                  onChange={e => { setBankAccountId(e.target.value); if(e.target.value) setBankAccountName(bankAccounts.find(a => String(a.id)===e.target.value)?.name || ""); }}>
                  <option value="">Default bank/cash account</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input
                  style={formStyles.input}
                  value={bankAccountName}
                  onChange={(e) => setBankAccountName(e.target.value)}
                  placeholder="e.g. Cash in Hand, HBL Current A/C"
                />
              </div>
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
            <DocumentNotesEditor value={notes} onChange={setNotes} />

            {/* Allocation against open documents */}
            {purpose === "settle" && <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Apply to open {docLabel.toLowerCase()}s</label>
              {!contactId ? (
                <div style={hintBox}>Select a {contactLabel.toLowerCase()} to see their unpaid {docLabel.toLowerCase()}s.</div>
              ) : loadingDocs ? (
                <div style={hintBox}>Loading…</div>
              ) : docs.length === 0 ? (
                <div style={hintBox}>No open {docLabel.toLowerCase()}s with a balance due for this {contactLabel.toLowerCase()}.</div>
              ) : (
                isNarrow ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    {docs.map((d) => (
                      <div key={d.id} style={{ border: "1px solid var(--k-line)", borderRadius: "var(--k-card-radius)", padding: "0.7rem 0.75rem", background: "var(--k-surface)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.45rem" }}>
                          <strong style={{ color: "var(--k-ink)" }}>#{d.number}</strong>
                          <span style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)" }}>{d.date ? new Date(d.date).toLocaleDateString() : "—"}</span>
                        </div>
                        <div style={narrowRow}><span>Total</span><span>{d.grandTotal.toLocaleString()}</span></div>
                        <div style={{ ...narrowRow, marginBottom: "0.55rem" }}><span>Balance due</span><span>{d.available.toLocaleString()}</span></div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="number" min="0" step="0.01" className="k-input" style={{ textAlign: "right", flex: 1, fontVariantNumeric: "tabular-nums" }}
                            value={alloc[d.id] ?? ""}
                            onChange={(e) => setAllocAmount(d.id, e.target.value)}
                            placeholder="Apply amount"
                          />
                          <Button size="sm" onClick={() => fillBalance(d)} title="Apply full balance">Max</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                <TableWrap data-admin-table-region="">
                  <table className="k-table k-table--compact">
                    <thead>
                      <tr>
                        <th>{docLabel} #</th>
                        <th>Date</th>
                        <th className="k-num">Total</th>
                        <th className="k-num">Balance due</th>
                        <th className="k-num" style={{ width: 150 }}>Apply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map((d) => (
                        <tr key={d.id}>
                          <td><strong>#{d.number}</strong></td>
                          <td>{d.date ? new Date(d.date).toLocaleDateString() : "—"}</td>
                          <td className="k-num">{d.grandTotal.toLocaleString()}</td>
                          <td className="k-num">{d.available.toLocaleString()}</td>
                          <td className="k-num">
                            <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
                              <input
                                type="number" min="0" step="0.01" className="k-input" style={{ textAlign: "right", width: 110, fontVariantNumeric: "tabular-nums" }}
                                value={alloc[d.id] ?? ""}
                                onChange={(e) => setAllocAmount(d.id, e.target.value)}
                              />
                              <Button size="sm" onClick={() => fillBalance(d)} title="Apply full balance">Max</Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                )
              )}
            </div>

            }
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", alignItems: "baseline", fontSize: "1.05rem", fontWeight: 700, color: colors.blue }}>
              <span style={{ color: colors.textSecondary, fontSize: "0.85rem", fontWeight: 600 }}>Total {isReceipt ? "received" : "paid"}:</span>
              <span>Rs {total.toLocaleString()}</span>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager ref={attachmentRef} companyId={companyId} entityType="Payment" entityId={editPayment?.id ?? null} mode="edit" />
            </div>
          </div>

          <div style={formStyles.footer}>
            <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            {(() => {
              const blocked = saving || total <= 0;
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

const hintBox = { padding: "0.75rem", background: "var(--k-surface-2)", border: "1px dashed var(--k-line-strong)", borderRadius: "var(--k-radius)", color: "var(--k-muted)", fontSize: "var(--k-font)" };
const narrowRow = { display: "flex", justifyContent: "space-between", fontSize: "var(--k-font-sm)", color: "var(--k-muted)", marginBottom: 2, fontVariantNumeric: "tabular-nums" };
