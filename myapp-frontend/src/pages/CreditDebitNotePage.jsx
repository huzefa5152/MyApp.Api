import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MdUndo, MdSearch, MdReceipt, MdArrowBack } from "react-icons/md";
import { getInvoicesByCompany, createNote } from "../api/invoiceApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import AttachmentManager from "../Components/AttachmentManager";

const colors = {
  blue: "#0d47a1",
  purple: "#5e35b1",
  teal: "#00695c",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  border: "#d0d7e2",
  inputBg: "#f8f9fb",
};

// FBR's OFFICIAL note reasons — the enumerated list from IRIS (bulk-import
// template REFERENCES sheet / Annexure-I DCN dropdown). Free text is not
// accepted; "Others" requires remarks (FBR 0028).
const FBR_REASONS = [
  "Cancellation of supply",
  "Return of goods",
  "Change in nature of supply",
  "Change in value of supply",
  "Change in amount of tax",
  "Others",
  "Adjustment given to Steel Melters",
];

// Reasons where goods PHYSICALLY move — drives the default of the
// "affects stock" toggle (industry pattern: physical return is separate
// from the financial adjustment; a discount note must not touch stock).
const GOODS_REASONS = new Set(["Return of goods", "Cancellation of supply"]);

// Effective (FBR-facing) line values — mirror the server's overlay-first logic
// so the quantities the operator sees match what was filed.
const effQty  = (it) => it.adjustment?.adjustedQuantity  ?? it.quantity;
const effPrice = (it) => it.adjustment?.adjustedUnitPrice ?? it.unitPrice;
const effDesc = (it) => it.adjustment?.adjustedDescription ?? it.description;
const effHs   = (it) => it.adjustment?.adjustedHSCode ?? it.hsCode;

export default function CreditDebitNotePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("invoices.note.create");

  // ?type=credit|debit picks the note kind; ?invoiceId=N preselects the
  // original invoice (the Reverse button's entry path).
  const isCredit = (searchParams.get("type") || "credit") !== "debit";
  const docType = isCredit ? 10 : 9;
  const label = isCredit ? "Credit Note" : "Debit Note";
  const preselectId = Number(searchParams.get("invoiceId")) || null;

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);   // the chosen original invoice
  const [lines, setLines] = useState([]);           // [{ id, include, noteQty, noteRate, ... }]
  const [reason, setReason] = useState(isCredit ? "Return of goods" : "");
  const [remarks, setRemarks] = useState("");
  const [affectsStock, setAffectsStock] = useState(isCredit); // derived default, operator-overridable
  const [stockTouched, setStockTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const attachmentRef = useRef(null);

  const pickInvoice = useCallback((inv) => {
    setSelected(inv);
    setLines((inv.items || []).map((it) => ({
      id: it.id,
      description: effDesc(it),
      hsCode: effHs(it),
      uom: it.uom,
      invoicedQty: effQty(it),
      invoicedRate: effPrice(it),
      include: true,
      noteQty: effQty(it),
      noteRate: effPrice(it),   // debit notes may lower this to the delta
    })));
  }, []);

  const fetchInvoices = useCallback(async () => {
    if (!selectedCompany?.id) return;
    setLoading(true);
    try {
      const { data } = await getInvoicesByCompany(selectedCompany.id);
      // Only FBR-submitted sale invoices; per type, hide ones that already
      // carry a live note of THIS type (FBR 0064 — one per type per invoice).
      const eligible = (data || []).filter((i) =>
        i.fbrStatus === "Submitted" &&
        (isCredit ? !i.reversedByCreditNoteNumber : !i.adjustedByDebitNoteNumber));
      setInvoices(eligible);
      if (preselectId) {
        const pre = eligible.find((i) => i.id === preselectId);
        if (pre) pickInvoice(pre);
        else notify("That invoice is not eligible (not submitted, or it already has a note of this type).", "error");
      }
    } catch {
      notify("Failed to load invoices.", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedCompany?.id, isCredit, preselectId, pickInvoice]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // Reason drives the stock default until the operator overrides the toggle.
  useEffect(() => {
    if (!stockTouched) setAffectsStock(isCredit && GOODS_REASONS.has(reason));
  }, [reason, isCredit, stockTouched]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices.slice(0, 50);
    return invoices.filter((i) =>
      String(i.invoiceNumber).includes(q) ||
      (i.clientName || "").toLowerCase().includes(q) ||
      (i.fbrIRN || "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [invoices, search]);

  const clearSelection = () => { setSelected(null); setLines([]); setRemarks(""); };

  const updateLine = (id, patch) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const chosen = lines.filter((l) => l.include && Number(l.noteQty) > 0);
  const subtotal = chosen.reduce((s, l) => s + Number(l.noteQty) * Number(l.noteRate), 0);
  const gstRate = selected?.gstRate ?? 0;
  const gstAmount = Math.round(subtotal * gstRate) / 100;
  const grandTotal = subtotal + gstAmount;

  const overQty = lines.some((l) => l.include && Number(l.noteQty) > Number(l.invoicedQty));
  const overRate = lines.some((l) => l.include && Number(l.noteRate) > Number(l.invoicedRate));
  const needsRemarks = reason === "Others" && !remarks.trim();
  const canSubmit =
    canCreate && selected && chosen.length > 0 && reason && !needsRemarks && !overQty && !overRate && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Full reversal (credit note, every line untouched) → empty lines so
      // the server mirrors the original's totals exactly; otherwise the
      // explicit selection.
      const fullReversal = isCredit &&
        chosen.length === lines.length &&
        lines.every((l) => Number(l.noteQty) === Number(l.invoicedQty) && Number(l.noteRate) === Number(l.invoicedRate));
      const payload = {
        originalInvoiceId: selected.id,
        documentType: docType,
        reason,
        remarks: reason === "Others" ? remarks.trim() : (remarks.trim() || null),
        affectsStock,
        lines: fullReversal ? [] : chosen.map((l) => ({
          invoiceItemId: l.id,
          quantity: Number(l.noteQty),
          // Debit notes may carry a per-unit DELTA (undercharge); credit
          // notes always refund at the original rate — the server pins it.
          ...(isCredit ? {} : { unitPrice: Number(l.noteRate) }),
        })),
      };
      const { data: note } = await createNote(payload);
      // Upload any files staged before the note had an id. Best-effort — the
      // note is already created.
      if (note?.id) { try { await attachmentRef.current?.flush(note.id); } catch { /* attachments best-effort */ } }
      notify(`${label} #${note.invoiceNumber} created against bill #${selected.invoiceNumber}. Validate then submit it to FBR.`, "success");
      navigate(isCredit ? "/credit-notes" : "/debit-notes");
    } catch (err) {
      notify(err.response?.data?.error || "Failed to create note.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreate) {
    return <div style={{ padding: 24 }}>You don't have permission to create Credit/Debit Notes.</div>;
  }
  if (!selectedCompany?.id) {
    return <div style={{ padding: 24 }}>Select a company to create a {label}.</div>;
  }

  return (
    <div style={{ padding: "16px", maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, color: colors.textPrimary, margin: "0 0 4px" }}>
        <MdUndo style={{ color: isCredit ? colors.purple : colors.teal }} /> New {label}
      </h2>
      <p style={{ color: colors.textSecondary, marginTop: 0 }}>
        {isCredit
          ? "Reverse an FBR-submitted invoice — fully or partially. A Credit Note reduces the sale (goods returned, cancellation, discount) and re-enters stock only when goods physically come back."
          : "Record an upward adjustment against an FBR-submitted invoice (undercharge, rate change, extra goods). A Debit Note increases the sale and normally leaves stock untouched."}
        {" "}The note is created unsubmitted — validate and submit it to FBR from its tab.
      </p>

      {!selected ? (
        <>
          <div style={{ position: "relative", margin: "12px 0" }}>
            <MdSearch style={{ position: "absolute", left: 10, top: 12, color: colors.textSecondary }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search submitted invoices by #, client, or IRN…"
              style={{ width: "100%", padding: "10px 10px 10px 34px", borderRadius: 8, border: `1px solid ${colors.border}`, background: colors.inputBg, boxSizing: "border-box" }}
            />
          </div>
          {loading ? (
            <p style={{ color: colors.textSecondary }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p style={{ color: colors.textSecondary }}>No eligible FBR-submitted invoices.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 10 }}>
              {filtered.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => pickInvoice(inv)}
                  style={{ textAlign: "left", padding: 12, borderRadius: 10, border: `1px solid ${colors.border}`, background: "#fff", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: colors.textPrimary }}>
                    <MdReceipt style={{ color: colors.blue }} /> Bill #{inv.invoiceNumber}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: colors.textSecondary }}>{inv.clientName}</div>
                  <div style={{ fontSize: "0.8rem", color: colors.textSecondary }}>
                    {inv.date ? new Date(inv.date).toLocaleDateString() : ""} · Rs {Number(inv.grandTotal).toLocaleString()}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: colors.textSecondary, marginTop: 4, wordBreak: "break-all" }}>
                    IRN {inv.fbrIRN}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button onClick={clearSelection} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", color: colors.blue, cursor: "pointer", padding: 0, marginBottom: 8 }}>
            <MdArrowBack /> Choose a different invoice
          </button>

          <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.inputBg, marginBottom: 12 }}>
            <strong>Bill #{selected.invoiceNumber}</strong> · {selected.clientName}
            <div style={{ fontSize: "0.78rem", color: colors.textSecondary, wordBreak: "break-all" }}>IRN {selected.fbrIRN}</div>
          </div>

          {/* Lines */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: colors.textSecondary, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={{ padding: 6 }}>Incl.</th>
                  <th style={{ padding: 6 }}>Item</th>
                  <th style={{ padding: 6 }}>HS</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Invoiced</th>
                  <th style={{ padding: 6, textAlign: "right" }}>{isCredit ? "Return qty" : "Adjust qty"}</th>
                  <th style={{ padding: 6, textAlign: "right" }}>{isCredit ? "Rate (fixed)" : "Rate / delta"}</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const oQty = l.include && Number(l.noteQty) > Number(l.invoicedQty);
                  const oRate = l.include && Number(l.noteRate) > Number(l.invoicedRate);
                  return (
                    <tr key={l.id} style={{ borderBottom: "1px solid #eef1f5", opacity: l.include ? 1 : 0.5 }}>
                      <td style={{ padding: 6 }}>
                        <input type="checkbox" checked={l.include} onChange={(e) => updateLine(l.id, { include: e.target.checked })} />
                      </td>
                      <td style={{ padding: 6 }}>{l.description}</td>
                      <td style={{ padding: 6, color: colors.textSecondary }}>{l.hsCode || "—"}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {Number(l.invoicedQty).toLocaleString()} {l.uom} @ {Number(l.invoicedRate).toLocaleString()}
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        <input
                          type="number" min="0" step="any" disabled={!l.include}
                          value={l.noteQty}
                          onChange={(e) => updateLine(l.id, { noteQty: e.target.value })}
                          style={{ width: 84, padding: "4px 6px", textAlign: "right", borderRadius: 6, border: `1px solid ${oQty ? "#e53935" : colors.border}` }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {isCredit ? (
                          Number(l.noteRate).toLocaleString()
                        ) : (
                          <input
                            type="number" min="0" step="any" disabled={!l.include}
                            value={l.noteRate}
                            onChange={(e) => updateLine(l.id, { noteRate: e.target.value })}
                            title="Per-unit adjustment value — e.g. the undercharged amount per unit. Cannot exceed the invoiced rate."
                            style={{ width: 84, padding: "4px 6px", textAlign: "right", borderRadius: 6, border: `1px solid ${oRate ? "#e53935" : colors.border}` }}
                          />
                        )}
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {(Number(l.noteQty || 0) * Number(l.noteRate || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {overQty && <p style={{ color: "#e53935", fontSize: "0.8rem" }}>A quantity exceeds what was invoiced.</p>}
          {overRate && <p style={{ color: "#e53935", fontSize: "0.8rem" }}>An adjustment rate exceeds the invoiced rate (FBR caps the note at the original).</p>}

          {/* Reason + remarks + stock toggle */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12, marginTop: 12 }}>
            <label style={{ fontSize: "0.85rem", color: colors.textSecondary }}>
              Reason (FBR official list)
              <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 8, border: `1px solid ${colors.border}`, marginTop: 4 }}>
                <option value="">Select a reason…</option>
                {FBR_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label style={{ fontSize: "0.85rem", color: colors.textSecondary }}>
              Remarks {reason === "Others" && <span style={{ color: "#e53935" }}>*</span>}
              <input
                value={remarks} onChange={(e) => setRemarks(e.target.value)}
                placeholder={reason === "Others" ? "Required when reason is Others" : "Optional"}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: `1px solid ${needsRemarks ? "#e53935" : colors.border}`, marginTop: 4, boxSizing: "border-box" }}
              />
            </label>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: "0.88rem", color: colors.textPrimary }}>
            <input
              type="checkbox"
              checked={affectsStock}
              onChange={(e) => { setAffectsStock(e.target.checked); setStockTouched(true); }}
            />
            <span>
              Goods physically {isCredit ? "returned — add the quantities back to stock" : "shipped — deduct the quantities from stock"}
              <span style={{ color: colors.textSecondary }}> (off = value-only adjustment, inventory untouched)</span>
            </span>
          </label>

          <div style={{ marginTop: 16 }}>
            <AttachmentManager ref={attachmentRef} companyId={selectedCompany.id} entityType="Invoice" entityId={null} mode="edit" />
          </div>

          {/* Totals + submit */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 16 }}>
            <div style={{ fontSize: "0.9rem", color: colors.textPrimary }}>
              <div>Subtotal: <strong>Rs {subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
              <div style={{ color: colors.textSecondary }}>GST ({gstRate}%): Rs {gstAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div>Grand total: <strong>Rs {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
            </div>
            <button
              onClick={handleSubmit} disabled={!canSubmit}
              style={{
                padding: "12px 20px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: "0.95rem",
                cursor: canSubmit ? "pointer" : "not-allowed",
                background: canSubmit ? (isCredit ? colors.purple : colors.teal) : "#c5c9d1", color: "#fff",
              }}
            >
              {submitting ? "Creating…" : `Generate ${label}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
