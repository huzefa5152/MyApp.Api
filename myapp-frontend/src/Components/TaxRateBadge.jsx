import StatusBadge from "./StatusBadge";

/**
 * A bill's sales tax rate, measured against the rate its goods came in at —
 * one badge for the bill list, table and cards alike. The findings come from
 * the server (InvoiceDto.TaxRateWarnings, Helpers/ImportedTaxRate), so the list
 * flags exactly the bills an edit would refuse, plus those to review:
 *
 *   Rate conflict   — unambiguous evidence, no reason given. Editing it will be
 *                     refused until the scenario matches or a reason is written;
 *                     filed already, it may need a debit note.
 *   Rate overridden — saved with a reason, which the tooltip shows.
 *   Check rate      — the records contradict themselves; never blocks.
 */
export default function TaxRateBadge({ inv }) {
  const warnings = inv?.taxRateWarnings || [];
  if (warnings.length === 0) return null;

  const enforced = warnings.some((w) => w.enforce);
  const reason = (inv.taxRateOverrideReason || "").trim();
  const title = warnings.map((w) => w.message).join("\n")
    + (reason ? `\n\nReason given: ${reason}` : "");

  if (enforced && !reason) return <StatusBadge tone="danger" title={title}>Rate conflict</StatusBadge>;
  if (enforced) return <StatusBadge tone="neutral" title={title}>Rate overridden</StatusBadge>;
  return <StatusBadge tone="warning" title={title}>Check rate</StatusBadge>;
}
