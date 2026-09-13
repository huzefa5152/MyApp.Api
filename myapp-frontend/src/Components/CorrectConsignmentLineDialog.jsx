import { useState, useMemo } from "react";
import { MdClose } from "react-icons/md";
import { formStyles, modalSizes, colors } from "../theme";
import useScrollToError from "../hooks/useScrollToError";
import { updateImportConsignmentLine } from "../api/importConsignmentApi";

const money = (n) => (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => (v === "" || v == null ? 0 : Number(v) || 0);

/**
 * Correct ONE line of a recorded GD — Purchases → Consignments → a line's
 * Correct action.
 *
 * The alternative used to be deleting the whole consignment and re-importing
 * the sheet, which a SETTLED consignment cannot do at all (a payment against
 * its Import Clearing liability blocks the delete). One duty typed wrong on
 * one row of an 83-line sheet does not deserve that.
 *
 * Only the costing INPUTS are editable, because only they can be corrected in
 * place: what the line MATCHED (its item, its balance, its disposition) is a
 * different item's stock to unwind and load, which is what a re-import is for.
 *
 * The cost and selling value shown here are a PREVIEW — the server recomputes
 * both from these same inputs through ImportCostingCalculator, exactly as the
 * commit path does, and its answer is the one that lands. Never send a figure
 * computed here and expect it to be trusted.
 */

// Cost = assessed + customs duty + ACD + RD. Others and the taxes sit outside
// it (they are input tax and advance income tax, recoverable, not cost) —
// Helpers/ImportCostingCalculator carries the whole chain and its reasoning.
function previewCosting(f) {
  const cost = num(f.assessedValue) + num(f.customsDuty) + num(f.acd) + num(f.regulatoryDuty);
  const stRate = num(f.salesTaxRate);
  const astRate = num(f.astRate);
  // Selling = (sales tax + AST) / ST rate + add-on profit, which reduces to
  // cost x (1 + AST/ST). A zero ST rate has no uplift to unwind, so the
  // calculator falls back to cost + profit rather than dividing by zero.
  const selling = stRate > 0
    ? cost * (1 + astRate / stRate) + num(f.addOnProfit)
    : cost + num(f.addOnProfit);
  return { cost: Math.round(cost * 100) / 100, selling: Math.round(selling * 100) / 100 };
}

export default function CorrectConsignmentLineDialog({ consignment, line, onClose, onSaved }) {
  const [form, setForm] = useState({
    quantity: String(line.quantity ?? ""),
    assessedValue: String(line.assessedValue ?? ""),
    customsDuty: String(line.customsDuty ?? ""),
    acd: String(line.acd ?? ""),
    regulatoryDuty: String(line.regulatoryDuty ?? ""),
    others: String(line.others ?? ""),
    salesTaxRate: String(line.salesTaxRate ?? ""),
    astRate: String(line.astRate ?? ""),
    incomeTaxRate: String(line.incomeTaxRate ?? ""),
    addOnProfit: String(line.addOnProfit ?? ""),
    descriptionOnSheet: line.descriptionOnSheet || "",
    reason: "",
  });
  // Empty = derive from the chain. Pre-filled ONLY when the stored value
  // already differs from what the chain produces, i.e. the sheet stated an
  // override — otherwise opening this dialog and pressing Save would turn a
  // derived figure into a pinned one.
  const derivedNow = useMemo(() => previewCosting({
    assessedValue: line.assessedValue, customsDuty: line.customsDuty, acd: line.acd,
    regulatoryDuty: line.regulatoryDuty, salesTaxRate: line.salesTaxRate,
    astRate: line.astRate, addOnProfit: line.addOnProfit,
  }), [line]);
  const storedIsOverride = Math.abs((line.sellingValueExcludingTax ?? 0) - derivedNow.selling) > 0.005;
  const [sellingOverride, setSellingOverride] = useState(
    storedIsOverride ? String(line.sellingValueExcludingTax ?? "") : "");

  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const preview = previewCosting(form);
  const effectiveSelling = sellingOverride === "" ? preview.selling : Math.round(num(sellingOverride) * 100) / 100;

  const badRate = [form.salesTaxRate, form.astRate, form.incomeTaxRate]
    .some((r) => num(r) < 0 || num(r) > 100);
  const canSave = !saving && num(form.quantity) > 0 && !badRate;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await updateImportConsignmentLine(consignment.id, line.id, {
        quantity: num(form.quantity),
        assessedValue: num(form.assessedValue),
        customsDuty: num(form.customsDuty),
        acd: num(form.acd),
        regulatoryDuty: num(form.regulatoryDuty),
        others: num(form.others),
        salesTaxRate: num(form.salesTaxRate),
        astRate: num(form.astRate),
        incomeTaxRate: num(form.incomeTaxRate),
        addOnProfit: num(form.addOnProfit),
        sellingValueExcludingTax: sellingOverride === "" ? null : num(sellingOverride),
        descriptionOnSheet: form.descriptionOnSheet.trim() || null,
        reason: form.reason.trim() || null,
      });
      onSaved?.(data);
    } catch (err) {
      setError(err.response?.data?.message
        || "Could not correct this line. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, opts = {}) => (
    <div style={formStyles.formGroup}>
      <label style={formStyles.label}>{label}</label>
      <input
        type="number" step={opts.step || "0.01"} min="0"
        style={formStyles.input} value={form[key]} onChange={set(key)}
      />
    </div>
  );

  return (
    <div style={formStyles.backdrop} onMouseDown={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>Correct line — GD {consignment.gdNumber}</h3>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close">
            <MdClose size={18} />
          </button>
        </div>

        <div style={formStyles.body}>
          {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

          <div style={{
            background: "#f5f7fa", border: `1px solid ${colors.cardBorder}`, borderRadius: 10,
            padding: "0.7rem 0.9rem", marginBottom: "1.1rem", fontSize: 13, lineHeight: 1.5,
          }}>
            <div><strong>{line.hsCode || "no HS code"}</strong> — {line.descriptionOnSheet || "—"}</div>
            <div style={{ color: colors.textSecondary, marginTop: 4 }}>
              Matched: {line.itemTypeName || "nothing"}. Which item this line feeds cannot be
              changed here — that needs the consignment deleted and the sheet re-imported.
            </div>
          </div>

          <div style={{
            display: "grid", gap: "0.75rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
          }}>
            {field("Quantity", "quantity", { step: "0.0001" })}
            {field("Assessed value", "assessedValue")}
            {field("Customs duty", "customsDuty")}
            {field("ACD", "acd")}
            {field("Regulatory duty", "regulatoryDuty")}
            {field("Others", "others")}
            {field("Sales tax rate %", "salesTaxRate")}
            {field("AST rate %", "astRate")}
            {field("Income tax rate %", "incomeTaxRate")}
            {field("Add-on profit", "addOnProfit")}
          </div>
          {badRate && (
            <div style={{ fontSize: 12.5, color: colors.danger, marginBottom: "0.8rem" }}>
              Every rate is a percentage between 0 and 100.
            </div>
          )}

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Selling value (leave blank to derive)</label>
            <input
              type="number" step="0.01" min="0" style={formStyles.input}
              value={sellingOverride} onChange={(e) => setSellingOverride(e.target.value)}
              placeholder={`Derived: ${money(preview.selling)}`}
            />
            <div style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 4 }}>
              The sheet's own override column. Blank means the costing chain decides.
            </div>
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Description on the sheet</label>
            <input
              style={formStyles.input} value={form.descriptionOnSheet}
              onChange={set("descriptionOnSheet")}
            />
          </div>

          <div style={formStyles.formGroup}>
            <label style={formStyles.label}>Why (kept in the cost history)</label>
            <input
              style={formStyles.input} value={form.reason} onChange={set("reason")}
              placeholder="e.g. regulatory duty was typed as 34,000 instead of 3,400"
            />
          </div>

          <div style={{
            border: `1px solid ${colors.cardBorder}`, borderRadius: 10,
            padding: "0.75rem 0.9rem", background: "#fbfcfe", fontSize: 13.5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>What this line will become</div>
            <Row label="Landed cost" was={line.costExcludingTax} now={preview.cost} />
            <Row label="Selling value" was={line.sellingValueExcludingTax} now={effectiveSelling} />
            <div style={{ color: colors.textSecondary, marginTop: 6, fontSize: 12.5 }}>
              A preview. The server recomputes both from the same inputs and its figures
              are what land — along with the balance this line feeds and, in New Arrivals
              mode, the journal entry behind it.
            </div>
          </div>
        </div>

        <div style={formStyles.footer}>
          <button style={{ ...formStyles.button, ...formStyles.cancel, minHeight: 40 }} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            style={{ ...formStyles.button, ...formStyles.submit, minHeight: 40, opacity: canSave ? 1 : 0.55 }}
            onClick={submit} disabled={!canSave}
          >
            {saving ? "Saving…" : "Correct the line"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, was, now }) {
  const moved = Math.abs((was ?? 0) - (now ?? 0)) > 0.005;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
      <span style={{ color: colors.textSecondary }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        <span style={{ textDecoration: moved ? "line-through" : "none", color: colors.textSecondary }}>
          {money(was)}
        </span>
        {moved && <strong style={{ marginLeft: 8 }}>{money(now)}</strong>}
      </span>
    </div>
  );
}
