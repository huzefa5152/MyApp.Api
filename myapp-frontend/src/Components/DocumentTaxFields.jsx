import { MdAdd, MdClose, MdInfoOutline } from "react-icons/md";
import { colors, formStyles } from "../theme";

/**
 * Optional document taxes — further tax (s.3(1A)) and withholding income tax
 * (s.153) — on a sales bill or a purchase bill.
 *
 * BOTH DEFAULT TO NONE, and neither field exists on the form until the operator
 * adds it. That is the whole point of the design: a tax that is charged by
 * default, or that shows an empty box inviting a value, ends up on documents
 * nobody meant to put it on. Removing a tax clears its value rather than
 * hiding a number that would still be sent.
 *
 * The figures shown here are a PREVIEW. The server resolves both taxes from the
 * rates and its own subtotal, so what is saved never depends on this arithmetic
 * — which is also why removing a tax sends null instead of 0.
 *
 * Props:
 *   subtotal, gstAmount   — for the preview only
 *   furtherTaxRate        — number | null   (omit the prop entirely on a purchase bill)
 *   onFurtherTaxRateChange(rateOrNull)
 *   withholdingTaxRate    — number | null
 *   withholdingTaxAmount  — number | null   (fixed-amount mode)
 *   onWithholdingChange({ rate, amount })
 *   disabled
 */
export default function DocumentTaxFields({
  subtotal = 0,
  gstAmount = 0,
  furtherTaxRate = undefined,
  onFurtherTaxRateChange,
  withholdingTaxRate = null,
  withholdingTaxAmount = null,
  onWithholdingChange,
  disabled = false,
}) {
  const supportsFurtherTax = furtherTaxRate !== undefined;

  const furtherTaxOn = supportsFurtherTax && furtherTaxRate !== null && furtherTaxRate !== "";
  const withholdingOn = withholdingTaxRate !== null && withholdingTaxRate !== ""
    || (withholdingTaxAmount !== null && withholdingTaxAmount !== "");
  const withholdingIsFixed = (withholdingTaxRate === null || withholdingTaxRate === "") && withholdingOn;

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const round2 = (n) => Math.round(n * 100) / 100;

  const furtherTaxAmount = furtherTaxOn ? round2(subtotal * num(furtherTaxRate) / 100) : 0;
  const grandTotal = round2(subtotal + gstAmount + furtherTaxAmount);
  const withheld = !withholdingOn
    ? 0
    : withholdingIsFixed
      ? Math.min(num(withholdingTaxAmount), grandTotal)
      : Math.min(round2(grandTotal * num(withholdingTaxRate) / 100), grandTotal);
  const collectible = round2(grandTotal - withheld);

  const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={st.wrap}>
      <div style={st.header}>
        <span style={st.title}>Additional taxes</span>
        {!furtherTaxOn && !withholdingOn && <span style={st.noneChip}>none</span>}
      </div>

      {!furtherTaxOn && !withholdingOn && (
        <p style={st.hint}>
          <MdInfoOutline size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          Nothing extra is charged or withheld unless you add it here.
        </p>
      )}

      <div style={st.chipRow}>
        {supportsFurtherTax && !furtherTaxOn && (
          <button type="button" style={st.addChip} disabled={disabled}
            onClick={() => onFurtherTaxRateChange?.(3)}>
            <MdAdd size={15} /> Further tax
          </button>
        )}
        {!withholdingOn && (
          <button type="button" style={st.addChip} disabled={disabled}
            onClick={() => onWithholdingChange?.({ rate: 0.5, amount: null })}>
            <MdAdd size={15} /> Withholding tax
          </button>
        )}
      </div>

      {furtherTaxOn && (
        <div style={st.taxRow}>
          <div style={{ flex: "1 1 190px", minWidth: 0 }}>
            <label style={st.label}>Further tax rate %</label>
            <input
              type="number" step="0.01" min="0" inputMode="decimal" disabled={disabled}
              style={formStyles.input}
              value={furtherTaxRate ?? ""}
              onChange={(e) => onFurtherTaxRateChange?.(e.target.value === "" ? null : e.target.value)}
            />
            <div style={st.fieldHint}>
              On the net value of supply. Adds Rs. {money(furtherTaxAmount)} to the bill.
            </div>
          </div>
          <button type="button" style={st.removeBtn} disabled={disabled}
            aria-label="Remove further tax" title="Remove further tax"
            onClick={() => onFurtherTaxRateChange?.(null)}>
            <MdClose size={16} />
          </button>
        </div>
      )}

      {withholdingOn && (
        <div style={st.taxRow}>
          <div style={{ flex: "1 1 190px", minWidth: 0 }}>
            <label style={st.label}>Withholding tax</label>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              <select
                style={{ ...formStyles.input, flex: "0 0 120px" }} disabled={disabled}
                value={withholdingIsFixed ? "amount" : "rate"}
                onChange={(e) => onWithholdingChange?.(
                  e.target.value === "amount" ? { rate: null, amount: 0 } : { rate: 0.5, amount: null })}
              >
                <option value="rate">Rate %</option>
                <option value="amount">Fixed amount</option>
              </select>
              <input
                type="number" step="0.01" min="0" inputMode="decimal" disabled={disabled}
                style={{ ...formStyles.input, flex: "1 1 110px", minWidth: 0 }}
                value={(withholdingIsFixed ? withholdingTaxAmount : withholdingTaxRate) ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : e.target.value;
                  onWithholdingChange?.(withholdingIsFixed ? { rate: null, amount: v } : { rate: v, amount: null });
                }}
              />
            </div>
            <div style={st.fieldHint}>
              Deducted by the payer and remitted to FBR. It does not change the bill total —
              it reduces what is collected to Rs. {money(collectible)}.
            </div>
          </div>
          <button type="button" style={st.removeBtn} disabled={disabled}
            aria-label="Remove withholding tax" title="Remove withholding tax"
            onClick={() => onWithholdingChange?.({ rate: null, amount: null })}>
            <MdClose size={16} />
          </button>
        </div>
      )}

      {(furtherTaxOn || withholdingOn) && (
        <div style={st.summary}>
          {furtherTaxOn && (
            <div style={st.summaryRow}>
              <span>Further tax</span><span>Rs. {money(furtherTaxAmount)}</span>
            </div>
          )}
          <div style={{ ...st.summaryRow, fontWeight: 800 }}>
            <span>Bill total</span><span>Rs. {money(grandTotal)}</span>
          </div>
          {withholdingOn && (
            <>
              <div style={st.summaryRow}>
                <span>Less withheld</span><span>− Rs. {money(withheld)}</span>
              </div>
              <div style={{ ...st.summaryRow, fontWeight: 800, color: colors.blue }}>
                <span>Collectible</span><span>Rs. {money(collectible)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const st = {
  wrap: { border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.7rem 0.85rem", background: colors.cardBg, marginTop: "0.75rem" },
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: "0.35rem" },
  title: { fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.textSecondary },
  noneChip: { fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase", background: colors.inputBg, color: colors.textSecondary, border: `1px solid ${colors.cardBorder}`, padding: "1px 7px", borderRadius: 10 },
  hint: { margin: "0 0 0.5rem", fontSize: "0.76rem", color: colors.textSecondary, lineHeight: 1.45 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: "0.45rem" },
  // Explicit height, not minHeight: the global `button` rule in index.css sets
  // its own padding and box sizing, which lands this two pixels under the 44px
  // tap target when the height is only a minimum.
  addChip: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0 0.9rem", height: 44, borderRadius: 999, border: `1px dashed ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  taxRow: { display: "flex", alignItems: "flex-start", gap: "0.5rem", marginTop: "0.65rem" },
  label: { display: "block", marginBottom: "0.3rem", fontWeight: 600, fontSize: "0.8rem", color: colors.textSecondary },
  fieldHint: { fontSize: "0.72rem", color: colors.textSecondary, marginTop: 4, lineHeight: 1.45 },
  removeBtn: { display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, marginTop: "1.4rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.textSecondary, cursor: "pointer", boxShadow: "none", flexShrink: 0 },
  summary: { marginTop: "0.7rem", paddingTop: "0.55rem", borderTop: `1px solid ${colors.cardBorder}`, display: "grid", gap: "0.2rem" },
  summaryRow: { display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.84rem", color: colors.textPrimary },
};
