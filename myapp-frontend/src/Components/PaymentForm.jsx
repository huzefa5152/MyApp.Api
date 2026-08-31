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
import { createPayment, updatePayment } from "../api/paymentApi";
import { getClientsByCompany } from "../api/clientApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getPagedInvoicesByCompany } from "../api/invoiceApi";
import { getPurchaseBillsByCompanyPaged } from "../api/purchaseBillApi";
import { getAccountsFlat } from "../api/accountApi";

const METHODS = ["Cash", "Bank Transfer", "Cheque", "Online", "Other"];

/**
 * Record money in (a Receipt) or money out (a Payment). mode = "receipts" |
 * "payments" sets the direction; everything else the operator chooses.
 *
 * Two questions drive the whole form, in plain language:
 *
 *   Who are you paying / who paid you?   → payeeType: Client | Supplier | Other
 *   What is this for?                    → purpose:
 *        "settle"   settle their unpaid invoices/bills: lists open documents
 *                   with a cash box each, plus an optional "write off the
 *                   difference" that clears the rest to a GL account so the
 *                   document shows fully settled. For a customer receipt the
 *                   document ticks are OPTIONAL — the operator types the money
 *                   received and whatever no invoice claims becomes the
 *                   customer's advance
 *        "expense"  a plain income/expense line — "paid the electricity bill".
 *                   Picks an account from the Chart of Accounts, with optional
 *                   recoverable tax
 *        "advance"  money against the party's running balance with no document
 *                   (a supplier advance, a customer advance, either refund)
 *
 * Deliberately NOT accounting-shaped: the operator never sees debit/credit. The
 * payee scopes the pickers and names the party on the ledger; the purpose picks
 * which account the other side of the entry lands on. The server derives the
 * double entry (see Services/Implementations/PostingService.PostPaymentAsync)
 * and re-validates every line by its Kind (PaymentService.NormalizeAllocations).
 */
export default function PaymentForm({ mode, companyId, preset, editPayment = null, onClose, onSaved }) {
  const isReceipt = mode === "receipts";
  const isEdit = !!editPayment?.id;
  const docLabel = isReceipt ? "Invoice" : "Bill";
  const dir = isReceipt ? "receipts" : "payments";

  // Who the money went to / came from. Defaults to the side that matches the
  // direction, which is the common case, but either is allowed: a refund to a
  // customer is a Payment with a Client payee.
  const [payeeType, setPayeeType] = useState(
    editPayment?.contactType || preset?.contactType || (isReceipt ? "Client" : "Supplier"));
  const [payeeName, setPayeeName] = useState(
    (editPayment?.contactType === "Other" && editPayment?.contactName) || "");
  const contactLabel = payeeType === "Client" ? "Client" : payeeType === "Supplier" ? "Supplier" : "Payee";
  // Settling documents only makes sense for the party that owns them, and only
  // in the matching direction (a receipt can't settle a purchase bill).
  const canSettle = (isReceipt && payeeType === "Client") || (!isReceipt && payeeType === "Supplier");

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
  // What this money is for. Derived on open from the record being edited: a
  // saved payment's first line already says which shape it is. A receipt with
  // NO lines at all is a pure advance held against the customer's balance, and
  // it is the "settle" screen that owns that shape (typed amount, no ticks) —
  // so it opens there rather than on the explicit advance line.
  const [purpose, setPurpose] = useState(() => {
    const k = editPayment?.allocations?.[0]?.kind;
    if (k === "Account") return "expense";
    if (k === "OnAccount") return "advance";
    return "settle";
  });

  // Income/expense lines for purpose === "expense". Amount is GROSS (what left
  // the bank); the tax rate carves the recoverable slice out of it, matching how
  // an invoice's GrandTotal already includes its GST.
  const [expLines, setExpLines] = useState(() => {
    const rows = (editPayment?.allocations || [])
      .filter((a) => a.kind === "Account")
      .map((a) => ({
        accountId: a.accountId ?? null,
        amount: String(a.amount ?? ""),
        taxRate: a.taxRate != null ? String(a.taxRate) : "",
      }));
    return rows.length ? rows : [{ accountId: null, amount: "", taxRate: "" }];
  });
  // Advance amount for purpose === "advance" (one figure, no document).
  const [advanceAmount, setAdvanceAmount] = useState(() => {
    const a = (editPayment?.allocations || []).find((x) => x.kind === "OnAccount");
    return a ? String(a.amount) : "";
  });

  // Receipt + "settle" only: the operator TYPES the document's total cash — it
  // is not derived by summing the per-invoice allocations below. Whatever is
  // left after those allocations becomes the customer's advance. Sent as
  // `amount` on BOTH create and edit so an existing advance is never silently
  // flattened to the allocated total (Task 7, 2026-08-31). Payment (money-out)
  // has no such field; its total stays derived server-side, unchanged. The
  // expense/advance purposes derive it from their own lines (see receiptAmount).
  const [amount, setAmount] = useState(editPayment?.amount != null ? String(editPayment.amount) : "");
  const [docs, setDocs] = useState([]);          // open documents for the contact
  // alloc[docId] = { cash: "30000", adj: "0.50", adjMode: "none"|"discount"|
  //                  "writeoff"|"other", adjAccountId: <id|null> }
  // cash = money actually received/paid (drives Payment.Amount); adj = the
  // non-cash "settle remainder" gap that also clears the doc.
  const [alloc, setAlloc] = useState({});
  const [loadingDocs, setLoadingDocs] = useState(false);
  // True when the docs fetch for the CURRENT contact settled with a failure
  // (network error, 5xx, timeout) rather than success. Distinct from
  // `loadingDocs`, which only tracks "in flight" -- a FAILED fetch still
  // resolves that to false, which used to silently re-enable Save on an
  // edit whose real allocations never actually loaded (review fix round 3;
  // same failure class as rounds 1-2, just reached via a network error
  // instead of a race). Reset at the top of every effect run -- a fresh
  // attempt (new contact, or a Retry) starts clean -- and set only in the
  // .catch() below.
  const [docsLoadFailed, setDocsLoadFailed] = useState(false);
  // Bumped by the Retry action to re-run the docs-fetch effect without any
  // of its other dependencies changing.
  const [retryToken, setRetryToken] = useState(0);

  // Flat Chart of Accounts, fetched once — feeds the settle-remainder quick-pick
  // resolution and the "Other" account picker. Empty when GL is off / unseeded,
  // in which case adjustments still work but post no account (server sends null).
  const [accounts, setAccounts] = useState([]);
  const accountsRef = useRef([]);                 // latest accounts for async closures

  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);
  // Below 768px the allocation table reflows to a stacked card per document and
  // the expense grid collapses to one column.
  const isNarrow = useIsNarrow();

  // Load the list that matches the chosen payee type. "Other" has no master
  // list — the operator just types the name.
  useEffect(() => {
    if (payeeType === "Other") { setContacts([]); return; }
    let cancelled = false;
    const load = payeeType === "Client" ? getClientsByCompany : getSuppliersByCompany;
    load(companyId)
      .then(({ data }) => { if (!cancelled) setContacts(data || []); })
      .catch(() => { if (!cancelled) setContacts([]); });
    return () => { cancelled = true; };
  }, [companyId, payeeType]);

  // Switching payee type invalidates the selected party and, when the new type
  // can't own settleable documents, the "settle" purpose too.
  const changePayeeType = (next) => {
    if (next === payeeType) return;
    setPayeeType(next);
    setContactId("");
    setDocs([]);
    setAlloc({});
    setError("");
    if (next === "Other") setPurpose((p) => (p === "settle" || p === "advance" ? "expense" : p));
    else if (!((isReceipt && next === "Client") || (!isReceipt && next === "Supplier"))) {
      setPurpose((p) => (p === "settle" ? "expense" : p));
    }
  };

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
  // Only for the "settle" purpose — an expense or an advance has no document.
  //
  // `alloc` is cleared unconditionally on every run of this effect, BEFORE
  // the guards below — not just when contactId goes empty. Previously
  // it was only cleared on empty, so ticking invoices for Client A and then
  // switching the picker to Client B (without submitting) left Client A's
  // entries in `alloc`: invisible in the new `docs` list (keyed by a docId
  // that no longer appears), but still summed into cashTotal/advance/
  // overAllocated below, and able to false-fire the over-allocation guard —
  // a wrong Advance figure with nothing on screen to explain it (review
  // finding, Task 7 fix round 1).
  //
  // This does NOT special-case "just mounted for an edit" vs. "user changed
  // the contact" — it doesn't need to. Both are just "this effect ran (for
  // whatever reason)": clear first, then the SAME repopulate logic below
  // (editPayment branch / preset branch) recomputes the right allocations
  // against whatever the CURRENT contactId's docs turn out to be. On mount
  // for an edit, `pre` is rebuilt from editPayment.allocations and matches
  // immediately after the clear — the clear is followed by the correct
  // refill within the same effect, so the edit's own allocations are never
  // actually lost, only (very briefly, same window `loadingDocs` already
  // covers with "Loading…") absent from `alloc` until the fetch resolves.
  // Switching to a DIFFERENT contact mid-edit correctly ends up `{}` (none
  // of editPayment's old invoice ids match the new contact's docs); switching
  // back to the original contact correctly restores the original pre-fill.
  useEffect(() => {
    setAlloc({});
    setDocsLoadFailed(false);
    if (purpose !== "settle" || !canSettle || !contactId) {
      setDocs([]);
      // Clear the in-flight flag too: a run cancelled mid-fetch never reaches
      // its own .finally, so without this an edit could be left permanently
      // "Loading…" (and therefore permanently un-saveable) after switching
      // purpose or clearing the contact while a fetch was still open.
      setLoadingDocs(false);
      return;
    }
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
          if (target) {
            setAlloc({ [target.id]: { cash: String(target.available), adj: "0", adjMode: "none", adjAccountId: null } });
            // "Record a receipt for THIS invoice" means the money received is
            // the invoice's balance — seed the typed amount to match, so the
            // shortcut isn't born over-allocated (cash ticked, amount blank).
            // The operator can still raise it to bank an advance on top.
            if (isReceipt) setAmount(String(target.available));
          }
        }
      })
      .catch(() => { if (!cancelled) { setDocs([]); setDocsLoadFailed(true); } })
      .finally(() => { if (!cancelled) setLoadingDocs(false); });
    return () => { cancelled = true; };
  }, [contactId, companyId, isReceipt, purpose, canSettle, preset?.documentId, editPayment?.id, retryToken]);

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const EMPTY_ROW = { cash: "", adj: "0", adjMode: "none", adjAccountId: null };

  // ── Income/expense lines (purpose === "expense") ───────────────────────────
  const patchExp = (i, patch) =>
    setExpLines((prev) => prev.map((r, ix) => (ix === i ? { ...r, ...patch } : r)));
  const addExpLine = () => setExpLines((prev) => [...prev, { accountId: null, amount: "", taxRate: "" }]);
  const removeExpLine = (i) =>
    setExpLines((prev) => (prev.length === 1 ? prev : prev.filter((_, ix) => ix !== i)));

  /** Tax is the slice already inside the gross amount: gross × rate / (100 + rate).
   *  Mirrors the server (PaymentService.NormalizeLineTax) so the preview the
   *  operator sees is the figure that gets posted. */
  const expCalc = (row) => {
    const gross = parseFloat(row.amount) || 0;
    const rate = parseFloat(row.taxRate) || 0;
    const tax = rate > 0 ? round2((gross * rate) / (100 + rate)) : 0;
    return { gross, rate, tax, net: round2(gross - tax) };
  };
  const expTotal = useMemo(
    () => expLines.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), [expLines]);
  const advanceNum = parseFloat(advanceAmount) || 0;

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

  // Σ cash ticked against open documents (the "settle" purpose only — the other
  // purposes leave `alloc` empty, so this is 0 there).
  const docCashTotal = useMemo(
    () => Object.values(alloc).reduce((s, r) => s + (parseFloat(r?.cash) || 0), 0),
    [alloc]
  );
  // Cash that actually moves through the bank on this document, whatever shape
  // it takes. Adjustments are the non-cash gaps that also clear the docs.
  const cashTotal = purpose === "expense" ? expTotal
    : purpose === "advance" ? advanceNum
      : docCashTotal;
  const adjTotal = useMemo(
    () => (purpose !== "settle" ? 0
      : Object.values(alloc).reduce((s, r) => s + (r?.adjMode !== "none" ? (parseFloat(r?.adj) || 0) : 0), 0)),
    [alloc, purpose]
  );

  // Receipt only: the live split shown under the invoice list. Advance is
  // CASH only — never subtract adjustmentAmount, since that settles the
  // invoice, not the receipt (see PaymentService.ResolveAmount /
  // AssertAllocationsFitAmount — the server enforces the same cash-only rule
  // and rejects Σ allocation cash > amount).
  const amountNum = parseFloat(amount) || 0;
  // What goes on the wire as Payment.Amount for a receipt: the typed figure on
  // the "settle" screen (which may exceed the ticks — that gap is the advance),
  // and the lines' own total on the expense/advance screens, which have no
  // separate amount box to disagree with.
  const receiptAmount = purpose === "settle" ? amountNum : cashTotal;
  const advance = Math.max(0, round2(amountNum - docCashTotal));
  const overAllocated = isReceipt && purpose === "settle"
    && round2(docCashTotal) > round2(amountNum) + 0.005;

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
    // Belt-and-suspenders: the Save button is disabled during this same
    // window (see the footer's `notReadyToSubmit`) so this shouldn't be
    // reachable via a click, but guard the handler itself too in case
    // submission is ever triggered another way (e.g. an implicit Enter
    // submit slipping past a disabled default button in some browser).
    if (isEdit && purpose === "settle" && (loadingDocs || docsLoadFailed)) return;
    setError("");

    // Who the money went to / came from.
    if (payeeType === "Other") {
      if (!payeeName.trim()) {
        setError(isReceipt ? "Enter who this money came from." : "Enter who this payment was made to.");
        return;
      }
    } else if (!contactId) {
      setError(`Select the ${contactLabel.toLowerCase()}.`);
      return;
    }

    // Build the lines for the chosen purpose. Each shape maps to one server-side
    // allocation Kind; the server re-validates all of this.
    let allocLines = [];
    if (purpose === "expense") {
      const rows = expLines
        .map((r) => ({ ...r, ...expCalc(r) }))
        .filter((r) => r.accountId != null || r.gross > 0);
      if (rows.length === 0) { setError("Add at least one line: what the money was for, and how much."); return; }
      const noAccount = rows.find((r) => r.accountId == null);
      if (noAccount) { setError("Choose what each line was for (an income or expense account)."); return; }
      const badAmount = rows.find((r) => !(r.gross > 0));
      if (badAmount) { setError("Enter an amount greater than zero on every line."); return; }
      const badRate = rows.find((r) => r.rate < 0 || r.rate > 100);
      if (badRate) { setError("Tax rate must be between 0 and 100."); return; }
      allocLines = rows.map((r) => ({
        kind: "Account",
        accountId: Number(r.accountId),
        amount: round2(r.gross),
        taxRate: r.rate > 0 ? r.rate : null,
        taxAmount: r.rate > 0 ? r.tax : 0,
        adjustmentAmount: 0,
        adjustmentAccountId: null,
      }));
    } else if (purpose === "advance") {
      if (!(advanceNum > 0)) { setError("Enter the advance amount."); return; }
      if (payeeType === "Other") {
        setError("An advance has to be against a client or a supplier. Pick one, or record this as an expense.");
        return;
      }
      allocLines = [{
        kind: "OnAccount",
        amount: round2(advanceNum),
        adjustmentAmount: 0,
        adjustmentAccountId: null,
      }];
    } else {
      const allocations = docs
        .map((d) => {
          const c = rowCalc(d);
          return { doc: d, cash: c.cashNum, adj: c.adjNum, adjMode: c.row.adjMode, adjAccountId: c.row.adjAccountId, over: c.over, needsAccount: c.needsAccount };
        })
        .filter((x) => x.cash > 0 || x.adj > 0);

      // A receipt no longer needs a settled invoice — the uncovered remainder
      // becomes a customer advance. It still needs a positive amount when
      // there's nothing else on the document (the named Client is already
      // enforced by the payee check above). Money-out keeps the old
      // "at least one line" rule, untouched, in the else branch below.
      if (isReceipt) {
        if (allocations.length === 0 && amountNum <= 0) {
          setError("Enter the amount received.");
          return;
        }
        // Server rejects Σ allocation cash > amount (the advance can't go
        // negative) — check it here too so the button never 400s.
        if (round2(docCashTotal) > round2(amountNum) + 0.005) {
          setError(`Allocated cash (Rs ${docCashTotal.toLocaleString()}) is more than the amount received (Rs ${amountNum.toLocaleString()}).`);
          return;
        }
      } else if (allocations.length === 0) {
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
      allocLines = allocations.map((x) => ({
        kind: "Document",
        invoiceId: isReceipt ? x.doc.id : null,
        purchaseBillId: isReceipt ? null : x.doc.id,
        amount: round2(x.cash),                                  // cash applied
        adjustmentAmount: x.adjMode === "none" ? 0 : round2(x.adj),
        adjustmentAccountId: x.adjMode === "none" ? null : (x.adjAccountId ?? null),
      }));
    }
    if (method === "Cheque" && !chequeNumber.trim()) {
      setError("Enter the cheque number.");
      return;
    }
    // When bank/cash accounts are configured and actual cash moves, picking one
    // is mandatory — it's the account the money lands in / comes from. A pure
    // write-off (no cash) doesn't touch a bank account, so it's not required.
    // For a receipt the cash that moved is the typed Amount, not just what got
    // allocated — an all-advance receipt (zero ticks) still landed somewhere.
    const cashMoved = isReceipt ? receiptAmount : cashTotal;
    if (hasBankAccounts && !bankAccountId && cashMoved > 0) {
      setError(`Select the bank/cash account the money was ${isReceipt ? "received in" : "paid from"}.`);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        direction: isReceipt ? "Receipt" : "Payment",
        date: new Date(date).toISOString(),
        contactType: payeeType,
        contactId: payeeType === "Other" ? null : (contactId ? Number(contactId) : null),
        contactName: payeeType === "Other" ? payeeName.trim() : null,
        divisionId: divisionId ? Number(divisionId) : null,
        bankAccountId: bankAccountId ? Number(bankAccountId) : null,
        bankAccountName: bankAccountName.trim() || null,
        method,
        description: description.trim() || null,
        chequeNumber: method === "Cheque" ? chequeNumber.trim() : null,
        chequeDate: method === "Cheque" && chequeDate ? new Date(chequeDate).toISOString() : null,
        allocations: allocLines,
      };
      // Authoritative cash total (Task 7, 2026-08-31): always sent for a
      // receipt, on BOTH create and edit — the server otherwise falls back to
      // Σ allocation cash, which on an edit would silently flatten (destroy)
      // an existing advance. Money-out ignores it server-side (ResolveAmount);
      // never add `amount` there.
      if (isReceipt) payload.amount = round2(receiptAmount);
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

            {/* Question 1: who. Plain language on purpose — the operator should
                never have to think about contact "types" or subledgers. The
                picker spans the full row so long client/supplier names aren't
                truncated inside a narrow grid column. */}
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>{isReceipt ? "Who paid you?" : "Who are you paying?"}</label>
              <div style={payeeTabs}>
                {[
                  { key: "Client", label: "Client" },
                  { key: "Supplier", label: "Supplier" },
                  { key: "Other", label: "Someone else" },
                ].map((t) => (
                  <button
                    type="button"
                    key={t.key}
                    onClick={() => changePayeeType(t.key)}
                    style={{ ...payeeTab, ...(payeeType === t.key ? payeeTabActive : null) }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {payeeType === "Other" ? (
                <input
                  style={{ ...formStyles.input, marginTop: "0.5rem" }}
                  data-testid="payee-name"
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                  placeholder="Name — e.g. the landlord, a courier, an employee"
                />
              ) : (
                <div style={{ marginTop: "0.5rem" }}>
                  <SearchableSelect
                    items={contacts}
                    value={contactId}
                    onChange={(id) => setContactId(id ? String(id) : "")}
                    placeholder={`— Select ${contactLabel} —`}
                  />
                </div>
              )}
              {payeeType === "Other" && (
                <span style={payeeHint}>
                  Not added to your Clients or Suppliers — use this for one-off payees.
                </span>
              )}
            </div>

            {/* Question 2: what for. Decides which account the other side of the
                entry lands on; the operator picks a purpose, not a debit. */}
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>What is this {isReceipt ? "money" : "payment"} for?</label>
              <div style={payeeTabs}>
                {[
                  canSettle && {
                    key: "settle",
                    label: `Settle unpaid ${docLabel.toLowerCase()}s`,
                    hint: `Clear specific ${docLabel.toLowerCase()}s they already owe`,
                  },
                  {
                    key: "expense",
                    label: isReceipt ? "Other income" : "An expense",
                    hint: isReceipt ? "Money in that isn't against an invoice" : "Rent, electricity, supplies…",
                  },
                  payeeType !== "Other" && {
                    key: "advance",
                    label: "Advance / on account",
                    hint: "No document yet — sits against their balance",
                  },
                ].filter(Boolean).map((t) => (
                  <button
                    type="button"
                    key={t.key}
                    title={t.hint}
                    data-testid={`purpose-${t.key}`}
                    onClick={() => { setPurpose(t.key); setError(""); }}
                    style={{ ...payeeTab, ...(purpose === t.key ? payeeTabActive : null) }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
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

            {/* Income/expense lines — the everyday "paid the electricity bill".
                Amount is what left the bank; the tax rate carves the recoverable
                slice out of it, so the operator types the figure on the bill. */}
            {purpose === "expense" && (
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>
                  What was it for? {glOn && <span style={{ fontWeight: 400, color: colors.textSecondary }}>(from your Chart of Accounts)</span>}
                </label>
                {accounts.length === 0 ? (
                  <div style={hintBox}>
                    No accounts available yet. Set them up under Accounting → Chart of Accounts,
                    then come back to record this {isReceipt ? "income" : "expense"}.
                  </div>
                ) : (
                  <>
                    {expLines.map((row, i) => {
                      const c = expCalc(row);
                      return (
                        <div key={i} style={isNarrow ? expRowNarrow : expRow}>
                          <div style={isNarrow ? expAccountCellNarrow : expAccountCell}>
                            <AccountSelect
                              accounts={activeAccounts}
                              value={row.accountId}
                              onChange={(id) => patchExp(i, { accountId: id != null ? Number(id) : null })}
                              side={isReceipt ? "credit" : "debit"}
                              placeholder={isReceipt ? "Income account — e.g. Other income" : "Expense account — e.g. Electricity"}
                            />
                          </div>
                          <div style={expCell}>
                            <input
                              type="number" min="0" step="0.01"
                              data-testid={`exp-amount-${i}`}
                              style={formStyles.input}
                              value={row.amount}
                              onChange={(e) => patchExp(i, { amount: e.target.value })}
                              placeholder="Amount"
                            />
                          </div>
                          <div style={expCell}>
                            <input
                              type="number" min="0" max="100" step="0.01"
                              style={formStyles.input}
                              value={row.taxRate}
                              onChange={(e) => patchExp(i, { taxRate: e.target.value })}
                              placeholder="Tax %"
                            />
                          </div>
                          <button
                            type="button"
                            style={{ ...expRemove, opacity: expLines.length === 1 ? 0.45 : 1, cursor: expLines.length === 1 ? "not-allowed" : "pointer" }}
                            title="Remove this line"
                            disabled={expLines.length === 1}
                            onClick={() => removeExpLine(i)}
                          >×</button>
                          {c.tax > 0 && (
                            <div style={expTaxHint}>
                              Includes Rs {c.tax.toLocaleString()} {isReceipt ? "sales tax" : "input tax"} —
                              Rs {c.net.toLocaleString()} goes to {accountName(row.accountId) || "the account"}.
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button type="button" style={expAddBtn} onClick={addExpLine}>+ Add another line</button>
                    <span style={payeeHint}>
                      Enter the amount as it appears on the bill — including tax. Leave Tax % blank
                      when there is no recoverable tax.
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Advance / on account — one figure, no document. */}
            {purpose === "advance" && (
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Advance amount</label>
                <input
                  type="number" min="0" step="0.01"
                  data-testid="advance-amount"
                  style={formStyles.input}
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  placeholder="0.00"
                />
                <span style={payeeHint}>
                  {isReceipt
                    ? "Held against this client's balance until you raise the invoice it belongs to."
                    : payeeType === "Client"
                      ? "Recorded against this client's balance — use this for a refund."
                      : "Held against this supplier's balance until their bill arrives."}
                </span>
              </div>
            )}

            {purpose === "settle" && (
              <>
                {/* Receipt-only: the total cash of this document, typed — not
                    summed from the ticks below. Whatever isn't allocated to an
                    invoice becomes the customer's advance (see the split under
                    the invoice list). */}
                {isReceipt && (
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Amount received</label>
                    <input
                      type="number" min="0" step="0.01"
                      data-testid="receipt-amount"
                      style={formStyles.input}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                )}

                {/* Allocation against open documents */}
                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>
                    Apply to open {docLabel.toLowerCase()}s
                    {isReceipt && <span style={{ fontWeight: 400, color: colors.textSecondary }}> (optional — anything left over is an advance)</span>}
                  </label>
                  {!contactId ? (
                    <div style={hintBox}>Select a {contactLabel.toLowerCase()} to see their unpaid {docLabel.toLowerCase()}s.</div>
                  ) : loadingDocs ? (
                    <div style={hintBox}>Loading…</div>
                  ) : docsLoadFailed ? (
                    <div style={{ ...hintBox, borderStyle: "solid", borderColor: colors.danger, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ color: colors.danger }}>
                        Could not load {docLabel.toLowerCase()}s for this {contactLabel.toLowerCase()}.
                        {isEdit && " This receipt cannot be saved until they load."}
                      </span>
                      <button type="button" style={retryBtn} onClick={() => setRetryToken((t) => t + 1)}>Retry</button>
                    </div>
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
              </>
            )}

            <div style={summaryWrap}>
              {isReceipt && purpose === "settle" ? (
                <>
                  <div style={summaryLine}>
                    <span style={summaryLabel}>Allocated:</span>
                    <span style={summaryStrong} data-testid="receipt-allocated">Rs {docCashTotal.toLocaleString()}</span>
                  </div>
                  <div style={summaryLine}>
                    <span style={summaryLabelMuted}>Advance:</span>
                    <span style={summaryMuted} data-testid="receipt-advance">Rs {advance.toLocaleString()}</span>
                  </div>
                  {overAllocated && (
                    <div style={summaryLine}>
                      <span style={adjError}>Allocated cash is more than the amount received.</span>
                    </div>
                  )}
                </>
              ) : (
                <div style={summaryLine}>
                  <span style={summaryLabel}>Cash {isReceipt ? "received" : "paid"}:</span>
                  <span style={summaryStrong} data-testid="cash-total">Rs {cashTotal.toLocaleString()}</span>
                </div>
              )}
              {adjTotal > 0 && (
                <>
                  <div style={summaryLine}>
                    <span style={summaryLabelMuted}>Adjustments (settle remainder):</span>
                    <span style={summaryMuted}>Rs {adjTotal.toLocaleString()}</span>
                  </div>
                  <div style={summaryLine}>
                    <span style={summaryLabelMuted}>Total settled:</span>
                    <span style={summaryMuted}>Rs {(docCashTotal + adjTotal).toLocaleString()}</span>
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
              const bankMissing = hasBankAccounts && !bankAccountId && (isReceipt ? receiptAmount : cashTotal) > 0;
              // Allow submit when there's any settlement — cash and/or a pure
              // write-off adjustment (Σ cash + Σ adjustment > 0). A receipt
              // with a positive typed Amount is also submittable with zero
              // ticks — the whole thing becomes an advance. The expense and
              // advance screens have no adjustments, so cash alone decides.
              const hasSomething = purpose !== "settle"
                ? cashTotal > 0
                : isReceipt
                  ? (amountNum > 0 || (docCashTotal + adjTotal) > 0)
                  : (docCashTotal + adjTotal) > 0;
              // An edit's OWN allocations aren't in `alloc` yet until the docs
              // fetch for its contact resolves SUCCESSFULLY (see the
              // docs-fetch effect) — but `amount` is seeded from
              // editPayment.amount at mount, so `hasSomething` above is
              // already true before that fetch settles. Without this gate a
              // fast click, a slow network, or a fetch that fails outright
              // submits an empty allocations array and wipes the receipt's
              // real ones — the exact failure class Task 7 exists to close,
              // just via a race or a network error instead of a missing
              // field (review fix rounds 2 and 3). `docsLoadFailed` covers
              // the "fails outright" half: `loadingDocs` alone cannot see
              // it, since a failed fetch still resolves that to false. A
              // fresh CREATE has nothing to lose in either window (its
              // alloc was already correctly cleared, not "not yet loaded" —
              // see the docs-fetch effect), so this only gates the edit
              // path; it must never make a brand-new receipt wait, even if
              // that contact's own doc fetch also fails. It is scoped to the
              // "settle" purpose because that is the only one whose lines
              // come from that fetch — an edit switched to expense/advance is
              // deliberately replacing them.
              const notReadyToSubmit = isEdit && purpose === "settle" && (loadingDocs || docsLoadFailed);
              const blocked = saving || !hasSomething || bankMissing || notReadyToSubmit;
              return (
                <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: blocked ? 0.6 : 1 }} disabled={blocked}>
                  {saving ? "Saving…" : (isEdit && purpose === "settle" && docsLoadFailed) ? "Unable to Save" : notReadyToSubmit ? "Loading…" : isEdit ? "Save Changes" : isReceipt ? "Save Receipt" : "Save Payment"}
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
// Retry action inside the docs-load-failed hint box (review fix round 3). Sized for a real tap target (>=44px) since this recovers a stuck edit.
const retryBtn = { minHeight: 44, padding: "0.4rem 0.9rem", fontSize: "0.78rem", fontWeight: 700, borderRadius: 6, border: `1px solid ${colors.danger}`, background: "#fff", color: colors.danger, cursor: "pointer", flexShrink: 0 };
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

// ── Payee / purpose selectors ────────────────────────────────────────────────
// Wraps instead of scrolling, so three or four choices stack on a phone rather
// than hiding behind an edge (CLAUDE.md §3: no media queries needed).
const payeeTabs = { display: "flex", flexWrap: "wrap", gap: "0.4rem" };
const payeeTab = {
  flex: "1 1 auto", minWidth: 110, minHeight: 44, padding: "0.5rem 0.75rem",
  border: `1px solid ${colors.inputBorder}`, borderRadius: 8, background: colors.inputBg,
  color: colors.textSecondary, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
};
const payeeTabActive = { background: colors.blue, borderColor: colors.blue, color: "#fff" };
const payeeHint = { display: "block", marginTop: "0.35rem", color: colors.textSecondary, fontSize: "0.78rem" };

// ── Income/expense line editor ───────────────────────────────────────────────
// Desktop: the account takes the room it needs; amount and tax stay side by
// side. Phone: the account claims its own full-width row above them, because
// the four desktop columns need ~475px and a 375px viewport would scroll.
const expRow = {
  display: "grid", gap: "0.4rem", alignItems: "start", marginBottom: "0.5rem",
  gridTemplateColumns: "minmax(min(240px, 100%), 3fr) minmax(110px, 1fr) minmax(80px, 0.6fr) 44px",
};
const expRowNarrow = {
  display: "grid", gap: "0.4rem", alignItems: "start", marginBottom: "0.75rem",
  gridTemplateColumns: "1fr 1fr 44px",
};
const expAccountCell = { minWidth: 0 };
const expAccountCellNarrow = { minWidth: 0, gridColumn: "1 / -1" };
const expCell = { minWidth: 0 };
// box-sizing + padding are explicit so the button really is the 44px the grid
// column reserves for it — the global button padding otherwise widens it past
// its own track.
const expRemove = {
  display: "grid", placeItems: "center", boxSizing: "border-box", padding: 0,
  width: 44, height: 44, minWidth: 44,
  border: `1px solid ${colors.inputBorder}`, borderRadius: 8, background: colors.inputBg,
  color: colors.textSecondary, fontSize: "1.1rem", lineHeight: 1, cursor: "pointer",
};
const expTaxHint = { gridColumn: "1 / -1", color: colors.textSecondary, fontSize: "0.78rem" };
const expAddBtn = {
  minHeight: 44, padding: "0.5rem 0.9rem", border: `1px dashed ${colors.inputBorder}`,
  borderRadius: 8, background: "transparent", color: colors.blue,
  fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
};

// Footer money summary.
const summaryWrap = { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 };
const summaryLine = { display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: "0.5rem" };
const summaryLabel = { color: colors.textSecondary, fontSize: "0.85rem", fontWeight: 600 };
const summaryStrong = { fontSize: "1.05rem", fontWeight: 700, color: colors.blue };
const summaryLabelMuted = { color: colors.textSecondary, fontSize: "0.78rem", fontWeight: 500 };
const summaryMuted = { fontSize: "0.85rem", fontWeight: 600, color: colors.textSecondary };
