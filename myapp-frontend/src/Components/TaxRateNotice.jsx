import { colors } from "../theme";

/**
 * The bill-level notice for goods billed at a sales tax rate other than the one
 * they came in at. Shared by every bill form so the three can never disagree.
 *
 * Two levels, and they must stay visibly different:
 *
 *   enforced — the company's own GD / opening stock says one clear rate and the
 *              bill charges another. Saving is refused (here and on the server)
 *              until the scenario matches or a reason is written, so the reason
 *              box lives inside this card.
 *   advisory — the records contradict themselves (two rates, or a GD line under
 *              another HS code). Shown for review; never blocks, because refusing
 *              a sale on a record that disagrees with itself would stop a
 *              business billing over a typing error in an opening sheet.
 *
 * The messages are the server's (Helpers/ImportedTaxRate), passed through
 * verbatim — this component decides layout, never wording.
 */
export default function TaxRateNotice({
  enforced = [],
  advisory = [],
  billRate,
  suggestion = null,     // { label, onApply } — one-click switch to the matching scenario
  splitNeeded = false,   // the bill holds goods that came in at different rates
  reason = "",
  onReasonChange,
  readOnly = false,      // the View screen: findings and any stored reason, no input
}) {
  if (enforced.length === 0 && advisory.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: "0.6rem", margin: "0.75rem 0" }}>
      {enforced.length > 0 && (
        <div
          role="alert"
          style={{
            border: `1px solid ${colors.danger}55`,
            background: colors.dangerLight,
            borderRadius: 10,
            padding: "0.75rem 0.9rem",
          }}
        >
          <div style={{ fontWeight: 700, color: colors.danger, fontSize: "0.88rem", marginBottom: "0.35rem" }}>
            These goods came in at a different sales tax rate
          </div>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.1rem", fontSize: "0.82rem", color: colors.textPrimary }}>
            {enforced.map((w, i) => <li key={`${w.itemTypeId}-${i}`} style={{ marginBottom: 2 }}>{w.message}</li>)}
          </ul>

          {splitNeeded && (
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: colors.textPrimary }}>
              This bill holds goods that came in at different rates. A bill here carries one scenario and
              one rate, so raise them on separate bills.
            </p>
          )}

          {!readOnly && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            {suggestion && !splitNeeded && (
              <button
                type="button"
                onClick={suggestion.onApply}
                style={{
                  minHeight: 44, padding: "0.5rem 0.95rem",
                  border: "none", borderRadius: 8,
                  background: colors.danger, color: "#fff",
                  fontWeight: 600, fontSize: "0.82rem", boxShadow: "none", cursor: "pointer",
                }}
              >
                {suggestion.label}
              </button>
            )}
            {suggestion?.hint && !splitNeeded && (
              <span style={{ fontSize: "0.74rem", color: colors.textSecondary, flex: "1 1 220px" }}>
                {suggestion.hint}
              </span>
            )}
          </div>
          )}

          {readOnly ? (
            reason ? (
              <p style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: colors.textPrimary }}>
                <strong>Saved at {billRate}% with this reason:</strong> {reason}
              </p>
            ) : null
          ) : (
          <label style={{ display: "block", marginTop: "0.6rem", fontSize: "0.78rem", fontWeight: 600, color: colors.textPrimary }}>
            {suggestion && !splitNeeded ? "Or give a reason" : "Give a reason"} for charging {billRate}% anyway
            <span style={{ fontWeight: 400, color: colors.textSecondary }}> — kept on the bill and in the audit log</span>
            <textarea
              value={reason}
              onChange={(e) => onReasonChange?.(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. Tax adviser confirmed these are parts, not the complete appliance"
              style={{
                display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
                padding: "0.5rem 0.6rem", minHeight: 44,
                border: `1px solid ${colors.inputBorder}`, borderRadius: 8,
                fontSize: "0.82rem", fontFamily: "inherit", resize: "vertical",
                background: colors.cardBg,
              }}
            />
          </label>
          )}
        </div>
      )}

      {advisory.length > 0 && (
        <div
          style={{
            border: "1px solid #ffcc80",
            background: "#fff8e1",
            borderRadius: 10,
            padding: "0.7rem 0.9rem",
          }}
        >
          <div style={{ fontWeight: 700, color: "#b26a00", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
            Check the rate before saving
          </div>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", color: colors.textPrimary }}>
            {advisory.map((w, i) => <li key={`${w.itemTypeId}-${i}`} style={{ marginBottom: 2 }}>{w.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
