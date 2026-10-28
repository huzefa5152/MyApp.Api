import { colors, formStyles } from "../theme";
import BillStep from "./bill/BillStep";
import { stockGroups } from "../utils/invoiceActions";

/**
 * "Already filed by hand on FBR's portal?" on the New invoice forms (with and
 * without challans), 2026-10-29. Ticked, the invoice is saved AND recorded as
 * filed in one request (CreateInvoiceDto.ManualFbrFiling): never sent to FBR
 * from here, with the portal's number, and each HS code either leaves stock
 * (default) or stays. The server checks invoices.fbr.reset; the form shows the
 * step only to holders, and only when FBR is on for the company.
 *
 * value = { on, portalNumber, deduct: { [hsCode]: false } } -- a code absent
 * from `deduct` leaves stock.
 */
export const emptyManualFiling = { on: false, portalNumber: "", deduct: {} };

/** HS codes the operator chose to keep in stock. */
export const keptCodes = (value) =>
  new Set(value?.on ? Object.keys(value.deduct || {}).filter((c) => value.deduct[c] === false) : []);

/** The request's manualFbrFiling, or null when the invoice is to be filed from here. */
export const manualFilingPayload = (value, lines) => {
  if (!value?.on) return null;
  const onInvoice = new Set(stockGroups(lines).map((g) => g.code));
  return {
    portalInvoiceNumber: value.portalNumber.trim(),
    keepInStockHsCodes: [...keptCodes(value)].filter((c) => onInvoice.has(c)),
  };
};

/** One tickable row per HS code: ticked = the goods leave stock. */
export function StockChoiceList({ groups, isDeducted, onToggle, disabled }) {
  return groups.map((g) => {
    const on = isDeducted(g.code);
    return (
      <label key={g.code} style={{
        display: "flex", gap: 10, alignItems: "flex-start", padding: "0.55rem 0.2rem", minHeight: 44,
        borderTop: `1px solid ${colors.cardBorder}`, cursor: disabled ? "default" : "pointer",
      }}>
        <input type="checkbox" checked={on} disabled={disabled}
          onChange={(e) => onToggle(g.code, e.target.checked)}
          style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0, accentColor: colors.blue }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem 0.6rem", alignItems: "baseline" }}>
            <b style={{ fontSize: "0.86rem", fontVariantNumeric: "tabular-nums" }}>HS {g.code}</b>
            <span style={{ fontSize: "0.8rem", color: colors.textSecondary }}>{g.qtyLabel}</span>
            <span style={{ marginLeft: "auto", fontSize: "0.75rem", fontWeight: 600, color: on ? colors.successInk : colors.warnInk }}>
              {on ? "Take out of stock" : "Keep in stock"}
            </span>
          </span>
          <span style={{
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            fontSize: "0.78rem", color: colors.textSecondary, overflowWrap: "anywhere",
          }}>{g.names.join(", ")}</span>
        </span>
      </label>
    );
  });
}

export default function ManualFilingStep({ n, value, onChange, lines, trackStock, disabled }) {
  const groups = trackStock ? stockGroups(lines) : [];
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <BillStep
      id="bill-step-fbr-filing"
      n={n}
      title="Already filed on FBR's portal?"
      status={value.on ? (value.portalNumber.trim() ? "done" : "todo") : "optional"}
      help="Only for an invoice you already filed by hand on FBR's portal. Leave it unticked to file from here as usual."
    >
      <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, cursor: disabled ? "default" : "pointer" }}>
        <input type="checkbox" checked={value.on} disabled={disabled}
          onChange={(e) => set({ on: e.target.checked })}
          style={{ width: 20, height: 20, flexShrink: 0, accentColor: colors.blue }} />
        <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>Yes, it is already filed by hand on FBR's portal</span>
      </label>

      {value.on && (
        <div style={{ marginTop: "0.5rem" }}>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: colors.textSecondary }}>
            It is saved as filed, with no IRN, and is never sent to FBR from here. You can still edit it.
          </p>
          <div style={{ ...formStyles.formGroup, maxWidth: 420 }}>
            <label style={formStyles.label} htmlFor="manual-fbr-portal-number">Invoice number used on FBR's portal *</label>
            <input id="manual-fbr-portal-number" style={formStyles.input} value={value.portalNumber} maxLength={100}
              disabled={disabled} onChange={(e) => set({ portalNumber: e.target.value })}
              placeholder="As typed on the portal, e.g. ABC-123" />
          </div>
          {groups.length > 0 && (
            <fieldset style={{ border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: "0.65rem 0.85rem 0.4rem", margin: 0, minWidth: 0 }}>
              <legend style={{ ...formStyles.label, padding: "0 0.3rem", margin: 0 }}>Stock</legend>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: colors.textSecondary }}>
                Ticked goods leave stock when the invoice is saved. Untick an HS code to keep its goods in stock.
              </p>
              <StockChoiceList
                groups={groups}
                isDeducted={(code) => value.deduct?.[code] !== false}
                onToggle={(code, on) => set({ deduct: { ...value.deduct, [code]: on } })}
                disabled={disabled}
              />
            </fieldset>
          )}
        </div>
      )}
    </BillStep>
  );
}
