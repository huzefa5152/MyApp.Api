import { colors } from "../theme";

/**
 * Why a bill's save button is off while its goods came in at a different
 * sales tax rate -- shown BESIDE the button, in the one wording all three bill
 * forms share. The red card above says it too, but an operator at the foot of
 * a long form never saw it: the button looked live, and a refusal that
 * scrolled away to the top of the form read as "it let me save".
 *
 * "Show" brings the card (TaxRateNotice, data-rate-notice) into view, since the
 * one-click switch and the reason box both live there.
 */
export default function TaxRateBlockHint({ suggestion = null, splitNeeded = false }) {
  const what = splitNeeded
    ? "Goods on this bill came in at different sales tax rates: put them on separate bills, or write a reason."
    : suggestion
      ? `These goods came in at a different sales tax rate: press “${suggestion.label}”, or write a reason.`
      : "These goods came in at a different sales tax rate: change the scenario, or write a reason.";
  return (
    <span role="status" style={{ fontSize: "0.8rem", color: colors.danger, marginRight: "auto", lineHeight: 1.35 }}>
      {what}{" "}
      <button
        type="button"
        onClick={() => document.querySelector("[data-rate-notice]")
          ?.scrollIntoView({ behavior: "smooth", block: "center" })}
        style={{
          minHeight: 44, display: "inline-flex", alignItems: "center", verticalAlign: "middle",
          background: "none", border: "none", padding: "0 0.35rem", boxShadow: "none",
          color: colors.danger, fontWeight: 700, textDecoration: "underline",
          fontSize: "inherit", cursor: "pointer",
        }}
      >
        Show
      </button>
    </span>
  );
}
