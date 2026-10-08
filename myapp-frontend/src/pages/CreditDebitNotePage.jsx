import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import RichText from "../Components/RichText";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MdUndo, MdReceipt, MdArrowBack, MdBlock, MdBusiness } from "react-icons/md";
import { getInvoicesByCompany, createNote } from "../api/invoiceApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import AttachmentManager from "../Components/AttachmentManager";
import { PageHeader, Toolbar, SearchBox, Button, Card, Facts, TableWrap, Field, Loading, EmptyState } from "../ui/Kit";

// Note-kind accent (Credit = purple, Debit = teal) for the Generate button.
const colors = {
  purple: "#5e35b1",
  teal: "#00695c",
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
    return <EmptyState icon={MdBlock}>You don't have permission to create Credit/Debit Notes.</EmptyState>;
  }
  if (!selectedCompany?.id) {
    return <EmptyState icon={MdBusiness}>Select a company to create a {label}.</EmptyState>;
  }

  const tint = isCredit ? colors.purple : colors.teal;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        icon={MdUndo}
        tone={isCredit ? "purple" : "teal"}
        title={`New ${label}`}
        subtitle={<>
          {isCredit
            ? "Reverse an FBR-submitted invoice — fully or partially. A Credit Note reduces the sale (goods returned, cancellation, discount) and re-enters stock only when goods physically come back."
            : "Record an upward adjustment against an FBR-submitted invoice (undercharge, rate change, extra goods). A Debit Note increases the sale and normally leaves stock untouched."}
          {" "}The note is created unsubmitted — validate and submit it to FBR from its tab.
        </>}
      />

      {!selected ? (
        <>
          <Toolbar>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search submitted invoices by #, client, or IRN…"
            />
          </Toolbar>
          {loading ? (
            <Loading>Loading…</Loading>
          ) : filtered.length === 0 ? (
            <EmptyState icon={MdReceipt}>No eligible FBR-submitted invoices.</EmptyState>
          ) : (
            <div className="k-grid-cards" style={{ gap: 10 }}>
              {filtered.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => pickInvoice(inv)}
                  className="k-card"
                  style={styles.pickCard}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "var(--k-ink)" }}>
                    <MdReceipt style={{ color: "var(--k-blue)" }} /> Bill #{inv.invoiceNumber}
                  </div>
                  <div style={styles.pickClient}>{inv.clientName}</div>
                  <div style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)" }}>
                    {inv.date ? new Date(inv.date).toLocaleDateString() : ""} · Rs {Number(inv.grandTotal).toLocaleString()}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--k-muted)", marginTop: 4, wordBreak: "break-all" }}>
                    IRN {inv.fbrIRN}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <Button variant="secondary" size="sm" icon={MdArrowBack} onClick={clearSelection}>
              Choose a different invoice
            </Button>
          </div>

          <Card style={{ marginBottom: "var(--k-gap)", background: "var(--k-surface-2)" }}>
            <Facts facts={[
              ["Bill", `#${selected.invoiceNumber}`],
              ["Client", selected.clientName],
              ["IRN", <span style={{ wordBreak: "break-all", fontWeight: 500 }}>{selected.fbrIRN}</span>],
            ]} />
          </Card>

          {/* Lines */}
          <TableWrap data-admin-table-region="">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Incl.</th>
                  <th>Item</th>
                  <th>HS</th>
                  <th className="k-num">Invoiced</th>
                  <th className="k-num">{isCredit ? "Return qty" : "Adjust qty"}</th>
                  <th className="k-num">{isCredit ? "Rate (fixed)" : "Rate / delta"}</th>
                  <th className="k-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const oQty = l.include && Number(l.noteQty) > Number(l.invoicedQty);
                  const oRate = l.include && Number(l.noteRate) > Number(l.invoicedRate);
                  return (
                    <tr key={l.id} style={{ opacity: l.include ? 1 : 0.5 }}>
                      <td>
                        <input type="checkbox" checked={l.include} onChange={(e) => updateLine(l.id, { include: e.target.checked })} />
                      </td>
                      <td><RichText text={l.description} /></td>
                      <td className="k-muted">{l.hsCode || "—"}</td>
                      <td className="k-num">
                        {Number(l.invoicedQty).toLocaleString()} {l.uom} @ {Number(l.invoicedRate).toLocaleString()}
                      </td>
                      <td className="k-num">
                        <input
                          type="number" min="0" step="any" disabled={!l.include}
                          value={l.noteQty}
                          onChange={(e) => updateLine(l.id, { noteQty: e.target.value })}
                          className="k-input"
                          style={{ ...styles.numInput, ...(oQty ? styles.invalid : null) }}
                        />
                      </td>
                      <td className="k-num">
                        {isCredit ? (
                          Number(l.noteRate).toLocaleString()
                        ) : (
                          <input
                            type="number" min="0" step="any" disabled={!l.include}
                            value={l.noteRate}
                            onChange={(e) => updateLine(l.id, { noteRate: e.target.value })}
                            title="Per-unit adjustment value — e.g. the undercharged amount per unit. Cannot exceed the invoiced rate."
                            className="k-input"
                            style={{ ...styles.numInput, ...(oRate ? styles.invalid : null) }}
                          />
                        )}
                      </td>
                      <td className="k-num">
                        {(Number(l.noteQty || 0) * Number(l.noteRate || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          {overQty && <p style={styles.errorText}>A quantity exceeds what was invoiced.</p>}
          {overRate && <p style={styles.errorText}>An adjustment rate exceeds the invoiced rate (FBR caps the note at the original).</p>}

          {/* Reason + remarks + stock toggle */}
          <div className="k-form-grid" style={{ marginTop: 12 }}>
            <Field label="Reason (FBR official list)" htmlFor="cdn-reason">
              <select id="cdn-reason" className="k-select" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Select a reason…</option>
                {FBR_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label={<>Remarks {reason === "Others" && <span style={{ color: "var(--k-danger)" }}>*</span>}</>} htmlFor="cdn-remarks">
              <input
                id="cdn-remarks"
                className="k-input"
                value={remarks} onChange={(e) => setRemarks(e.target.value)}
                placeholder={reason === "Others" ? "Required when reason is Others" : "Optional"}
                style={needsRemarks ? styles.invalid : undefined}
              />
            </Field>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: "var(--k-font)", color: "var(--k-ink)" }}>
            <input
              type="checkbox"
              checked={affectsStock}
              onChange={(e) => { setAffectsStock(e.target.checked); setStockTouched(true); }}
            />
            <span>
              Goods physically {isCredit ? "returned — add the quantities back to stock" : "shipped — deduct the quantities from stock"}
              <span style={{ color: "var(--k-muted)" }}> (off = value-only adjustment, inventory untouched)</span>
            </span>
          </label>

          <div style={{ marginTop: 16 }}>
            <AttachmentManager ref={attachmentRef} companyId={selectedCompany.id} entityType="Invoice" entityId={null} mode="edit" />
          </div>

          {/* Totals + submit */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 16 }}>
            <div style={{ fontSize: "var(--k-font)", color: "var(--k-ink)", fontVariantNumeric: "tabular-nums" }}>
              <div>Subtotal: <strong>Rs {subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
              <div style={{ color: "var(--k-muted)" }}>GST ({gstRate}%): Rs {gstAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div>Grand total: <strong>Rs {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
            </div>
            <Button
              variant="primary"
              onClick={handleSubmit} disabled={!canSubmit}
              // Credit = purple, Debit = teal — the note kind's colour, as before.
              style={{ background: canSubmit ? tint : "#c5c9d1", boxShadow: "none" }}
            >
              {submitting ? "Creating…" : `Generate ${label}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  // Invoice pick tiles — a k-card surface rendered as a button; the overrides
  // neutralise the global `button` rule (index.css padding / shadow / weight).
  pickCard: { display: "block", width: "100%", textAlign: "left", padding: "0.75rem", margin: 0, fontFamily: "inherit", fontWeight: 400, cursor: "pointer", color: "var(--k-ink)", boxShadow: "var(--k-card-shadow)" },
  // Client name: 2-line clamp, never a single-line ellipsis.
  pickClient: { fontSize: "var(--k-font)", color: "var(--k-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  numInput: { width: 84, minHeight: "calc(var(--k-h) - 6px)", padding: "0 6px", textAlign: "right" },
  invalid: { borderColor: "#e53935" },
  errorText: { color: "#e53935", fontSize: "var(--k-font-sm)" },
};
