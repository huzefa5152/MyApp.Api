import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors, dropdownStyles } from "../theme";
import SearchableSelect from "./SearchableSelect";
import DivisionSelect from "./DivisionSelect";
import BankCashSelect from "./BankCashSelect";
import AccountSelect from "./AccountSelect";
import AttachmentManager from "./AttachmentManager";
import useScrollToError from "../hooks/useScrollToError";
import useIsNarrow from "../hooks/useIsNarrow";
import { usePermissions } from "../contexts/PermissionsContext";
import { createPayment, updatePayment } from "../api/paymentApi";
import { getClientsByCompany } from "../api/clientApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getPagedInvoicesByCompany } from "../api/invoiceApi";
import { getPurchaseBillsByCompanyPaged } from "../api/purchaseBillApi";
import { getAccountsFlat } from "../api/accountApi";

const METHODS = ["Cash", "Bank Transfer", "Cheque", "Online", "Other"];

/**
 * Record a Receipt (money in) or Payment (money out). mode = "receipts" |
 * "payments" flips the contact (Client ↔ Supplier) and the documents settled
 * (sales invoices ↔ purchase bills). The operator picks a contact, the form
 * lists that contact's open documents (balance > 0) with a cash-received
 * input each; the payment's money total is the sum of the cash applied.
 *
 * Per line the operator can also "settle the remainder": when they receive
 * LESS cash than a document's balance, the shortfall is routed to a GL account
 * (Discount / Write-off quick-picks resolved by control type, or any account)
 * so the invoice/bill shows FULLY SETTLED while only the cash is recorded. When
 * opened from a specific document (preset.documentId) the form is scoped to that
 * one document. Direct (account-only) lines remain deferred.
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
  // alloc[docId] = { cash: "30000", adj: "0.50", adjMode: "none"|"discount"|
  //                  "writeoff"|"other", adjAccountId: <id|null> }
  // cash = money actually received/paid (drives Payment.Amount); adj = the
  // non-cash "settle remainder" gap that also clears the doc.
  const [alloc, setAlloc] = useState({});
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Flat Chart of Accounts, fetched once — feeds the settle-remainder quick-pick
  // resolution and the "Other" account picker. Empty when GL is off / unseeded,
  // in which case adjustments still work but post no account (server sends null).
  const [accounts, setAccounts] = useState([]);
  const accountsRef = useRef([]);                 // latest accounts for async closures

  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);
  // Below 768px the allocation table reflows to a stacked card per document.
  const isNarrow = useIsNarrow();

  // Load the contact list once.
  useEffect(() => {
    let cancelled = false;
    const load = isReceipt ? getClientsByCompany : getSuppliersByCompany;
    load(companyId)
      .then(({ data }) => { if (!cancelled) setContacts(data || []); })
      .catch(() => { if (!cancelled) setContacts([]); });
    return () => { cancelled = true; };
  }, [companyId, isReceipt]);

  // Load the flat Chart of Accounts once (best-effort — the form works without it).
  useEffect(() => {
    let cancelled = false;
    getAccountsFlat(companyId)
      .then(({ data }) => { if (!cancelled) setAccounts(data || []); })
      .catch(() => { if (!cancelled) setAccounts([]); });
    return () => { cancelled = true; };
  }, [companyId]);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);

  // The company runs GL when it has any accounts. Adjustments must carry an
  // account only when GL is on (mirrors the server's glEnabled rule).
  const glOn = accounts.length > 0;
  // The "Other" picker lists active accounts; a receipt gap leads with Expenses
  // (discount/write-off), a payment gap with Income (discount received/write-back).
  const activeAccounts = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);
  const adjSide = isReceipt ? "expense" : "income";
  // Resolve the two quick-pick accounts by control type (active preferred).
  const ctrlId = (list, ct) => {
    const m = (list || []).filter((a) => a.controlType === ct);
    return (m.find((a) => a.isActive) || m[0])?.id ?? null;
  };
  const discountAccId = useMemo(
    () => ctrlId(accounts, isReceipt ? "DiscountAllowed" : "DiscountReceived"),
    [accounts, isReceipt]);
  const writeoffAccId = useMemo(
    () => ctrlId(accounts, isReceipt ? "BadDebtWriteOff" : "WriteBackIncome"),
    [accounts, isReceipt]);
  // The quick-pick pills offered under a short line. When GL is off there are no
  // accounts to route to, so a single "Write off" pill just clears the balance.
  const quickPicks = useMemo(() => {
    if (!glOn) return [{ mode: "writeoff", label: "Write off", accId: null }];
    const picks = [];
    if (discountAccId != null) picks.push({ mode: "discount", label: "Discount", accId: discountAccId });
    if (writeoffAccId != null) picks.push({ mode: "writeoff", label: "Write-off", accId: writeoffAccId });
    picks.push({ mode: "other", label: "Other", accId: null });
    return picks;
  }, [glOn, discountAccId, writeoffAccId]);
  const accountName = (id) => accounts.find((a) => String(a.id) === String(id))?.name || "";

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
        // When editing, this payment's own allocations (cash AND adjustment)
        // free up headroom on the docs it settled — show them (even if now
        // fully paid) with available = balanceDue + own, and pre-fill.
        const ownRaw = {};   // docId -> { cash, adj, adjAccountId }
        if (editPayment) {
          for (const a of editPayment.allocations || []) {
            const docId = isReceipt ? a.invoiceId : a.purchaseBillId;
            if (!docId) continue;
            const cur = ownRaw[docId] || { cash: 0, adj: 0, adjAccountId: null };
            cur.cash += a.amount || 0;
            cur.adj += a.adjustmentAmount || 0;
            if (a.adjustmentAccountId != null) cur.adjAccountId = a.adjustmentAccountId;
            ownRaw[docId] = cur;
          }
        }
        let shown = (data.items || [])
          .filter((d) => !d.isCancelled)
          .map((d) => {
            const balanceDue = d.balanceDue ?? (d.grandTotal - (d.amountPaid || 0));
            const own = ownRaw[d.id] ? (ownRaw[d.id].cash + ownRaw[d.id].adj) : 0;
            return {
              id: d.id,
              number: isReceipt ? d.invoiceNumber : d.purchaseBillNumber,
              date: d.date,
              grandTotal: d.grandTotal,
              balanceDue,
              available: balanceDue + own,   // headroom this payment can settle
            };
          })
          .filter((d) => d.available > 0.001);

        // TASK 1: opened from a specific invoice/bill → scope to that one doc
        // (the contact is still locked). The standalone page keeps all open docs.
        if (preset?.documentId && !editPayment) {
          shown = shown.filter((d) => d.id === preset.documentId);
        }
        setDocs(shown);

        if (editPayment) {
          const pre = {};
          for (const d of shown) {
            const own = ownRaw[d.id];
            if (!own) continue;
            const adjAmt = own.adj || 0;
            const adjAccountId = own.adjAccountId ?? null;
            // Infer the adjMode from the stored account (best-effort — the
            // account itself is always preserved, so submit stays correct even
            // if accounts haven't loaded yet and this falls back to "other").
            let adjMode = "none";
            if (adjAmt > 0) {
              const disc = ctrlId(accountsRef.current, isReceipt ? "DiscountAllowed" : "DiscountReceived");
              const wo = ctrlId(accountsRef.current, isReceipt ? "BadDebtWriteOff" : "WriteBackIncome");
              if (adjAccountId != null && adjAccountId === disc) adjMode = "discount";
              else if (adjAccountId != null && adjAccountId === wo) adjMode = "writeoff";
              else if (adjAccountId != null) adjMode = "other";
              else adjMode = "writeoff";   // GL off — no account was recorded
            }
            pre[d.id] = { cash: String(own.cash || 0), adj: String(adjAmt), adjMode, adjAccountId };
          }
          setAlloc(pre);
        } else if (preset?.documentId) {
          const target = shown.find((d) => d.id === preset.documentId);
          if (target) setAlloc({ [target.id]: { cash: String(target.available), adj: "0", adjMode: "none", adjAccountId: null } });
        }
      })
      .catch(() => { if (!cancelled) setDocs([]); })
      .finally(() => { if (!cancelled) setLoadingDocs(false); });
    return () => { cancelled = true; };
  }, [contactId, companyId, isReceipt, preset?.documentId, editPayment?.id]);

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const EMPTY_ROW = { cash: "", adj: "0", adjMode: "none", adjAccountId: null };

  const patchRow = (docId, patch) =>
    setAlloc((prev) => ({ ...prev, [docId]: { ...(prev[docId] || EMPTY_ROW), ...patch } }));

  const setCash = (docId, value) => patchRow(docId, { cash: value });
  const setAdjAmount = (docId, value) => patchRow(docId, { adj: value });
  const setAdjAccount = (docId, id) => patchRow(docId, { adjAccountId: id != null ? Number(id) : null });

  // "Max" = settle the whole balance in cash (drops any adjustment).
  const fillBalance = (doc) =>
    setAlloc((prev) => ({ ...prev, [doc.id]: { cash: String(doc.available), adj: "0", adjMode: "none", adjAccountId: null } }));

  // Clicking a quick-pick sets the mode, auto-fills the gap and (for
  // Discount/Write-off) the resolved control account; "Other" starts with no
  // account so the operator picks one via AccountSelect.
  const applyAdjPick = (doc, pick) =>
    setAlloc((prev) => {
      const row = prev[doc.id] || EMPTY_ROW;
      const gap = Math.max(0, round2(doc.available - (parseFloat(row.cash) || 0)));
      return { ...prev, [doc.id]: { ...row, adjMode: pick.mode, adj: String(gap), adjAccountId: pick.accId } };
    });

  const clearAdj = (doc) => patchRow(doc.id, { adj: "0", adjMode: "none", adjAccountId: null });

  // Per-row derived numbers used by both the desktop table and mobile card.
  const rowCalc = (d) => {
    const row = alloc[d.id] || EMPTY_ROW;
    const cashNum = parseFloat(row.cash) || 0;
    const adjNum = row.adjMode === "none" ? 0 : (parseFloat(row.adj) || 0);
    const settled = round2(cashNum + adjNum);
    const gap = round2(d.available - cashNum);
    const over = settled > d.available + 0.005;
    const isSettled = row.adjMode !== "none" && Math.abs(settled - d.available) < 0.005;
    const needsAccount = row.adjMode !== "none" && adjNum > 0 && glOn && row.adjAccountId == null;
    return { row, cashNum, adjNum, settled, gap, over, isSettled, needsAccount };
  };

  // Cash total = the receipt/payment money (backend derives Payment.Amount from
  // Σ cash). Adjustments are the non-cash gaps that also clear the docs.
  const cashTotal = useMemo(
    () => Object.values(alloc).reduce((s, r) => s + (parseFloat(r?.cash) || 0), 0),
    [alloc]
  );
  const adjTotal = useMemo(
    () => Object.values(alloc).reduce((s, r) => s + (r?.adjMode !== "none" ? (parseFloat(r?.adj) || 0) : 0), 0),
    [alloc]
  );

  // Settle-remainder affordance for one document row (shared desktop + mobile).
  // Nothing shows until the operator receives less cash than the balance due.
  const renderAdjust = (d, c) => {
    const { row, cashNum, settled, gap, over, isSettled, needsAccount } = c;
    if (row.adjMode === "none") {
      // Pure cash over-payment (no adjustment) — flag it inline too.
      if (over) return <div style={adjWrap}><span style={adjError}>Cash exceeds the balance due.</span></div>;
      if (!(cashNum > 0 && gap > 0.005)) return null;   // no positive shortfall
      return (
        <div style={adjWrap}>
          <div style={adjPromptRow}>
            <span style={adjShortText}>Short Rs {gap.toLocaleString()} — settle as</span>
            <div style={pillGroup}>
              {quickPicks.map((p) => (
                <button
                  type="button"
                  key={p.mode}
                  style={{ ...pill, ...(isNarrow ? pillNarrow : null) }}
                  onClick={() => applyAdjPick(d, p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }
    const remaining = round2(d.available - settled);
    return (
      <div style={adjWrap}>
        <div style={adjActiveRow}>
          {isSettled
            ? <span style={settledBadge}>✓ Settled</span>
            : <span style={adjModeBadge}>{MODE_LABEL[row.adjMode] || "Adjustment"}</span>}
          <span style={adjMiniLabel}>Adjust</span>
          <input
            type="number" min="0" step="0.01"
            style={{ ...adjInput, ...(isNarrow ? adjInputNarrow : null) }}
            value={row.adj}
            onChange={(e) => setAdjAmount(d.id, e.target.value)}
          />
          <button
            type="button"
            style={{ ...clearX, ...(isNarrow ? clearXNarrow : null) }}
            title="Remove adjustment"
            onClick={() => clearAdj(d)}
          >×</button>
        </div>
        {row.adjMode === "other" && glOn && (
          <div style={{ marginTop: 6 }}>
            <AccountSelect
              accounts={activeAccounts}
              value={row.adjAccountId}
              onChange={(id) => setAdjAccount(d.id, id)}
              side={adjSide}
              placeholder="Select the account for the gap"
            />
          </div>
        )}
        {(row.adjMode === "discount" || row.adjMode === "writeoff") && glOn && row.adjAccountId != null && (
          <span style={adjAcctHint}>Posts to {accountName(row.adjAccountId)}</span>
        )}
        {needsAccount && <span style={adjError}>Choose an account for the adjustment.</span>}
        {over && <span style={adjError}>Cash + adjustment exceeds the balance due.</span>}
        {!over && !isSettled && remaining > 0.005 && (
          <span style={adjRemainHint}>Remaining Rs {remaining.toLocaleString()}</span>
        )}
      </div>
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");

    const allocations = docs
      .map((d) => {
        const c = rowCalc(d);
        return { doc: d, cash: c.cashNum, adj: c.adjNum, adjMode: c.row.adjMode, adjAccountId: c.row.adjAccountId, over: c.over, needsAccount: c.needsAccount };
      })
      .filter((x) => x.cash > 0 || x.adj > 0);

    if (allocations.length === 0) {
      setError(`Enter an amount against at least one ${docLabel.toLowerCase()}.`);
      return;
    }
    // Client-side over-allocation guard (server enforces too). Uses `available`
    // (= balance due + this payment's own settlement when editing).
    const over = allocations.find((x) => x.over);
    if (over) {
      setError(`${docLabel} #${over.doc.number}: cash + adjustment exceeds the balance due (${over.doc.available.toLocaleString()}).`);
      return;
    }
    // An adjustment must land in an account when the ledger is on (server 400s otherwise).
    const missingAcct = allocations.find((x) => x.needsAccount);
    if (missingAcct) {
      setError(`${docLabel} #${missingAcct.doc.number}: choose an account for the settle-remainder adjustment.`);
      return;
    }
    if (method === "Cheque" && !chequeNumber.trim()) {
      setError("Enter the cheque number.");
      return;
    }
    // When bank/cash accounts are configured and actual cash moves, picking one
    // is mandatory — it's the account the money lands in / comes from. A pure
    // write-off (no cash) doesn't touch a bank account, so it's not required.
    if (hasBankAccounts && !bankAccountId && cashTotal > 0) {
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
          amount: round2(x.cash),                                  // cash applied
          adjustmentAmount: x.adjMode === "none" ? 0 : round2(x.adj),
          adjustmentAccountId: x.adjMode === "none" ? null : (x.adjAccountId ?? null),
        })),
      };
      const { data: saved } = isEdit
        ? await updatePayment(dir, editPayment.id, payload)
        : await createPayment(dir, companyId, payload);
      // Upload any files staged before the record had an id (no-op in edit
      // mode / when nothing was staged). Best-effort — the payment is saved.
      try {
        const savedId = saved?.id ?? editPayment?.id;
        if (savedId) await attachmentRef.current?.flush(savedId);
      } catch { /* attachments are best-effort — the payment is already saved */ }
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
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

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
              ) : isNarrow ? (
                /* Phone (<768px): one card per open document so the amount
                   input + Max button get full-width tap targets instead of a
                   5-column table squeezed into ~340px. */
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {docs.map((d) => {
                    const c = rowCalc(d);
                    return (
                      <div key={d.id} style={allocCard}>
                        <div style={allocCardHead}>
                          <strong>#{d.number}</strong>
                          <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>{d.date ? new Date(d.date).toLocaleDateString() : "—"}</span>
                        </div>
                        <div style={allocCardMeta}>
                          <div><span style={allocMetaLabel}>Total</span><span style={allocMetaValue}>{d.grandTotal.toLocaleString()}</span></div>
                          <div><span style={allocMetaLabel}>Balance due</span><span style={allocMetaValue}>{d.available.toLocaleString()}</span></div>
                        </div>
                        <div>
                          <span style={allocMetaLabel}>{isReceipt ? "Received" : "Paid"} (cash)</span>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              type="number" min="0" step="0.01" style={{ ...formStyles.input, textAlign: "right", flex: 1, minHeight: 44 }}
                              value={c.row.cash ?? ""}
                              onChange={(e) => setCash(d.id, e.target.value)}
                            />
                            <button type="button" style={{ ...fillBtn, minHeight: 44, padding: "0.5rem 0.85rem", boxShadow: "none" }} onClick={() => fillBalance(d)} title="Pay full balance in cash">Max</button>
                          </div>
                          {renderAdjust(d, c)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={tbl}>
                    <thead>
                      <tr>
                        <th style={th}>{docLabel} #</th>
                        <th style={th}>Date</th>
                        <th style={{ ...th, textAlign: "right" }}>Total</th>
                        <th style={{ ...th, textAlign: "right" }}>Balance due</th>
                        <th style={{ ...th, textAlign: "right", width: 160 }}>{isReceipt ? "Received" : "Paid"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map((d) => {
                        const c = rowCalc(d);
                        const adjNode = renderAdjust(d, c);
                        // Drop the main row's bottom border when an adjustment
                        // sub-row follows, so the two read as one unit.
                        const cellTd = adjNode ? { ...td, borderBottom: "none" } : td;
                        return (
                          <Fragment key={d.id}>
                            <tr>
                              <td style={cellTd}><strong>#{d.number}</strong></td>
                              <td style={cellTd}>{d.date ? new Date(d.date).toLocaleDateString() : "—"}</td>
                              <td style={{ ...cellTd, textAlign: "right" }}>{d.grandTotal.toLocaleString()}</td>
                              <td style={{ ...cellTd, textAlign: "right" }}>{d.available.toLocaleString()}</td>
                              <td style={{ ...cellTd, textAlign: "right" }}>
                                <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
                                  <input
                                    type="number" min="0" step="0.01" style={{ ...formStyles.input, textAlign: "right", padding: "0.35rem 0.5rem", width: 110 }}
                                    value={c.row.cash ?? ""}
                                    onChange={(e) => setCash(d.id, e.target.value)}
                                  />
                                  <button type="button" style={fillBtn} onClick={() => fillBalance(d)} title="Pay full balance in cash">Max</button>
                                </div>
                              </td>
                            </tr>
                            {adjNode && (
                              <tr>
                                <td colSpan={5} style={{ ...td, paddingTop: 0 }}>{adjNode}</td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={summaryWrap}>
              <div style={summaryLine}>
                <span style={summaryLabel}>Cash {isReceipt ? "received" : "paid"}:</span>
                <span style={summaryStrong}>Rs {cashTotal.toLocaleString()}</span>
              </div>
              {adjTotal > 0 && (
                <>
                  <div style={summaryLine}>
                    <span style={summaryLabelMuted}>Adjustments (settle remainder):</span>
                    <span style={summaryMuted}>Rs {adjTotal.toLocaleString()}</span>
                  </div>
                  <div style={summaryLine}>
                    <span style={summaryLabelMuted}>Total settled:</span>
                    <span style={summaryMuted}>Rs {(cashTotal + adjTotal).toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>

            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager
                ref={attachmentRef}
                companyId={companyId}
                entityType="Payment"
                entityId={editPayment?.id ?? null}
                mode="edit"
              />
            </div>
          </div>

          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            {(() => {
              const bankMissing = hasBankAccounts && !bankAccountId && cashTotal > 0;
              // Allow submit when there's any settlement — cash and/or a pure
              // write-off adjustment (Σ cash + Σ adjustment > 0).
              const blocked = saving || (cashTotal + adjTotal) <= 0 || bankMissing;
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
// Mobile (<768px) allocation cards.
const allocCard = { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem 0.8rem", background: "#fff", display: "flex", flexDirection: "column", gap: "0.5rem" };
const allocCardHead = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" };
const allocCardMeta = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "0.4rem 1rem" };
const allocMetaLabel = { display: "block", fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary, marginBottom: 2 };
const allocMetaValue = { fontSize: "0.9rem", fontWeight: 600, color: colors.textPrimary };

// ── Settle-remainder adjustment affordance ──────────────────────────────
const MODE_LABEL = { discount: "Discount", writeoff: "Write-off", other: "Adjustment" };
const adjWrap = { marginTop: 6, display: "flex", flexDirection: "column", gap: 6 };
const adjPromptRow = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 };
const adjShortText = { fontSize: "0.72rem", color: colors.textSecondary, fontWeight: 600 };
const pillGroup = { display: "flex", flexWrap: "wrap", gap: 4 };
const pill = { padding: "0.25rem 0.6rem", fontSize: "0.72rem", fontWeight: 700, borderRadius: 999, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, cursor: "pointer", minHeight: 30, lineHeight: 1, boxShadow: "none" };
const pillNarrow = { minHeight: 44, padding: "0.5rem 0.95rem", fontSize: "0.82rem" };
const adjActiveRow = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 };
const settledBadge = { display: "inline-flex", alignItems: "center", gap: 4, padding: "0.2rem 0.5rem", fontSize: "0.7rem", fontWeight: 800, borderRadius: 6, background: "#e8f5e9", color: colors.success, border: `1px solid ${colors.success}40` };
const adjModeBadge = { display: "inline-flex", alignItems: "center", padding: "0.2rem 0.5rem", fontSize: "0.7rem", fontWeight: 700, borderRadius: 6, background: colors.inputBg, color: colors.textSecondary, border: `1px solid ${colors.inputBorder}` };
const adjMiniLabel = { fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: colors.textSecondary };
const adjInput = { width: 110, padding: "0.3rem 0.5rem", borderRadius: 6, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, color: colors.textPrimary, fontSize: "0.82rem", textAlign: "right", outline: "none" };
const adjInputNarrow = { flex: 1, minWidth: 90, minHeight: 44, fontSize: "0.95rem" };
const clearX = { width: 28, height: 28, minWidth: 28, display: "grid", placeItems: "center", borderRadius: 6, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.danger, cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: 0, boxShadow: "none" };
const clearXNarrow = { width: 44, height: 44, minWidth: 44, fontSize: "1.2rem" };
const adjAcctHint = { fontSize: "0.72rem", color: colors.textSecondary, fontStyle: "italic" };
const adjError = { fontSize: "0.72rem", color: colors.danger, fontWeight: 600 };
const adjRemainHint = { fontSize: "0.72rem", color: colors.textSecondary };
// Footer money summary.
const summaryWrap = { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 };
const summaryLine = { display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: "0.5rem" };
const summaryLabel = { color: colors.textSecondary, fontSize: "0.85rem", fontWeight: 600 };
const summaryStrong = { fontSize: "1.05rem", fontWeight: 700, color: colors.blue };
const summaryLabelMuted = { color: colors.textSecondary, fontSize: "0.78rem", fontWeight: 500 };
const summaryMuted = { fontSize: "0.85rem", fontWeight: 600, color: colors.textSecondary };
