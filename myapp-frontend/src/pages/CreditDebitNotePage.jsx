import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MdUndo, MdSearch, MdReceipt, MdArrowBack } from "react-icons/md";
import { getInvoicesByCompany, createNote } from "../api/invoiceApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";

const colors = {
  blue: "#0d47a1",
  purple: "#5e35b1",
  teal: "#00695c",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  border: "#d0d7e2",
  inputBg: "#f8f9fb",
};

// FBR's Digital Invoicing exposes only "Sale Invoice" and "Debit Note" to a
// wholesaler (doctypecode) — a return/reversal is filed as a DEBIT NOTE, capped
// at the original invoice (FBR 0067). These are the return reasons.
const RETURN_REASONS = [
  "Goods Returned", "Order Cancellation", "Post-Sale Discount",
  "Quantity Short", "Defective Goods", "Others",
];

// Effective (FBR-facing) line values — mirror the server's overlay-first logic
// so the partial-return quantities the operator sees match what was filed.
const effQty  = (it) => it.adjustment?.adjustedQuantity  ?? it.quantity;
const effPrice = (it) => it.adjustment?.adjustedUnitPrice ?? it.unitPrice;
const effDesc = (it) => it.adjustment?.adjustedDescription ?? it.description;
const effHs   = (it) => it.adjustment?.adjustedHSCode ?? it.hsCode;

export default function CreditDebitNotePage() {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("invoices.note.create");

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);  // the chosen original invoice
  const [lines, setLines] = useState([]);          // [{ id, include, returnQty, ... }]
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchInvoices = useCallback(async () => {
    if (!selectedCompany?.id) return;
    setLoading(true);
    try {
      const { data } = await getInvoicesByCompany(selectedCompany.id);
      // Only FBR-submitted SALE invoices that aren't already reversed.
      setInvoices((data || []).filter(
        (i) => i.fbrStatus === "Submitted" && i.documentType !== 9 && i.documentType !== 10 && !i.reversedByInvoiceNumber
      ));
    } catch {
      notify("Failed to load invoices.", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedCompany?.id]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices.slice(0, 50);
    return invoices.filter((i) =>
      String(i.invoiceNumber).includes(q) ||
      (i.clientName || "").toLowerCase().includes(q) ||
      (i.fbrIRN || "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [invoices, search]);

  const pickInvoice = (inv) => {
    setSelected(inv);
    setLines((inv.items || []).map((it) => ({
      id: it.id,
      description: effDesc(it),
      hsCode: effHs(it),
      uom: it.uom,
      invoicedQty: effQty(it),
      unitPrice: effPrice(it),
      include: true,
      returnQty: effQty(it),
    })));
  };

  const clearSelection = () => { setSelected(null); setLines([]); setReason(""); setRemarks(""); };

  const updateLine = (id, patch) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const chosen = lines.filter((l) => l.include && Number(l.returnQty) > 0);
  const subtotal = chosen.reduce((s, l) => s + Number(l.returnQty) * Number(l.unitPrice), 0);
  const gstRate = selected?.gstRate ?? 0;
  const gstAmount = Math.round(subtotal * gstRate) / 100;
  const grandTotal = subtotal + gstAmount;

  const overQty = lines.some((l) => l.include && Number(l.returnQty) > Number(l.invoicedQty));
  const needsRemarks = reason === "Others" && !remarks.trim();
  const canSubmit =
    canCreate && selected && chosen.length > 0 && reason && !needsRemarks && !overQty && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // If every line is fully included, send empty lines = full reversal;
      // otherwise send the explicit partial selection.
      const fullReversal =
        chosen.length === lines.length &&
        lines.every((l) => Number(l.returnQty) === Number(l.invoicedQty));
      const payload = {
        originalInvoiceId: selected.id,
        documentType: 9,   // Debit Note — the FBR-accepted reversal document
        reason,
        remarks: reason === "Others" ? remarks.trim() : (remarks.trim() || null),
        lines: fullReversal ? [] : chosen.map((l) => ({ invoiceItemId: l.id, quantity: Number(l.returnQty) })),
      };
      const { data: note } = await createNote(payload);
      notify(`Debit Note #${note.invoiceNumber} created against bill #${selected.invoiceNumber}. Validate then submit it to FBR.`, "success");
      navigate("/invoices");
    } catch (err) {
      notify(err.response?.data?.error || "Failed to create note.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreate) {
    return <div style={{ padding: 24 }}>You don't have permission to create Debit Notes.</div>;
  }
  if (!selectedCompany?.id) {
    return <div style={{ padding: 24 }}>Select a company to create a Debit Note.</div>;
  }

  return (
    <div style={{ padding: "16px", maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, color: colors.textPrimary, margin: "0 0 4px" }}>
        <MdUndo style={{ color: colors.purple }} /> Debit Notes (Returns)
      </h2>
      <p style={{ color: colors.textSecondary, marginTop: 0 }}>
        Reference an FBR-submitted invoice to reverse it — fully or partially. FBR's Digital
        Invoicing files a return as a <strong>Debit Note</strong> against the original invoice
        (capped at its value). The note is created unsubmitted — validate and submit it to FBR
        from the Invoices tab. One debit note is allowed per invoice.
      </p>

      {!selected ? (
        <>
          {/* Invoice picker */}
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
            <p style={{ color: colors.textSecondary }}>No FBR-submitted invoices available to reverse.</p>
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
                  <th style={{ padding: 6, textAlign: "right" }}>Return qty</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Unit</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const over = l.include && Number(l.returnQty) > Number(l.invoicedQty);
                  return (
                    <tr key={l.id} style={{ borderBottom: "1px solid #eef1f5", opacity: l.include ? 1 : 0.5 }}>
                      <td style={{ padding: 6 }}>
                        <input type="checkbox" checked={l.include} onChange={(e) => updateLine(l.id, { include: e.target.checked })} />
                      </td>
                      <td style={{ padding: 6 }}>{l.description}</td>
                      <td style={{ padding: 6, color: colors.textSecondary }}>{l.hsCode || "—"}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{Number(l.invoicedQty).toLocaleString()} {l.uom}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        <input
                          type="number" min="0" step="any" disabled={!l.include}
                          value={l.returnQty}
                          onChange={(e) => updateLine(l.id, { returnQty: e.target.value })}
                          style={{ width: 90, padding: "4px 6px", textAlign: "right", borderRadius: 6, border: `1px solid ${over ? "#e53935" : colors.border}` }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>{Number(l.unitPrice).toLocaleString()}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {(Number(l.returnQty || 0) * Number(l.unitPrice)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {overQty && <p style={{ color: "#e53935", fontSize: "0.8rem" }}>A return quantity exceeds what was invoiced.</p>}

          {/* Reason + remarks */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12, marginTop: 12 }}>
            <label style={{ fontSize: "0.85rem", color: colors.textSecondary }}>
              Reason
              <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 8, border: `1px solid ${colors.border}`, marginTop: 4 }}>
                <option value="">Select a reason…</option>
                {RETURN_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
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
                background: canSubmit ? colors.purple : "#c5c9d1", color: "#fff",
              }}
            >
              {submitting ? "Creating…" : "Generate Debit Note"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
