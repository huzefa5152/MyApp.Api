/**
 * The decisions every bill screen shares -- New Bill, New Bill (No Challan),
 * Edit and View -- kept in one pure, dependency-free module so the screens
 * cannot drift apart, and so node can test it (scripts/test_bill_entry.mjs).
 *
 * Nothing here computes a figure. The totals rows carry the amounts each form
 * already worked out; this module only decides which rows show, in what order,
 * with what explanation.
 */

// Where the checklist sends the operator. Every bill screen gives its steps
// these ids, and each line row lineAnchor(key).
export const BILL_ANCHORS = {
  scenario: "bill-step-scenario",
  buyer: "bill-step-buyer",
  challans: "bill-step-challans",
  details: "bill-step-details",
  items: "bill-step-items",
  taxes: "bill-step-taxes",
  attachments: "bill-step-attachments",
  rate: "bill-rate-notice",
};

export const lineAnchor = (key) => `bill-line-${key}`;

/**
 * Why a save is off while the goods came in at another rate and no reason is
 * written -- the one wording all three forms use.
 */
export function rateBlockText({ suggestion = null, splitNeeded = false } = {}) {
  if (splitNeeded)
    return "Goods on this bill came in at different sales tax rates: put them on separate bills, or write a reason.";
  if (suggestion)
    return `These goods came in at a different sales tax rate: press “${suggestion.label}”, or write a reason.`;
  return "These goods came in at a different sales tax rate: change the scenario, or write a reason.";
}

/**
 * What is left before this bill can be saved, in the order an operator meets
 * it on the screen. An empty list means ready.
 *
 * `lines` holds only the lines that still need something: { key, n, problem },
 * where `n` is the 1-based line number shown and `problem` the plain-words
 * need ("enter Qty"). `extra` carries screen-specific items, appended last.
 */
export function billChecklist({
  needsScenario = false,
  hasScenario = true,
  hasBuyer = true,
  billNumberOk = true,
  rateBlock = null,
  lines = [],
  extra = [],
} = {}) {
  const items = [];
  if (needsScenario && !hasScenario)
    items.push({ key: "scenario", label: "Pick an FBR scenario", target: BILL_ANCHORS.scenario });
  if (!hasBuyer)
    items.push({ key: "buyer", label: "Choose the buyer", target: BILL_ANCHORS.buyer });
  if (!billNumberOk)
    items.push({ key: "number", label: "Use a bill number that isn't taken, or switch back to Auto", target: BILL_ANCHORS.details });
  if (rateBlock)
    items.push({ key: "rate", label: rateBlock, target: BILL_ANCHORS.rate });
  for (const l of lines)
    items.push({ key: `line-${l.key}`, label: `Line ${l.n}: ${l.problem}`, target: lineAnchor(l.key) });
  return items.concat(extra);
}

/**
 * The value a bill's sales tax is charged on -- the screens' copy of the
 * server's rule (Helpers/SalesTaxBase). 3rd Schedule goods are taxed on their
 * printed retail price, MRP x Qty, not on the value they are sold at; every
 * other line, and a 3rd Schedule line with no retail price, on its value. So
 * for a bill without 3rd Schedule goods this is simply the subtotal.
 *
 * lines: [{ value, retail, thirdSchedule }]
 */
export function salesTaxBase(lines = []) {
  return lines.reduce(
    (sum, l) => sum + (l.thirdSchedule && Number(l.retail) > 0 ? Number(l.retail) : Number(l.value) || 0), 0);
}

export const THIRD_SCHEDULE_SALE_TYPE = "3rd Schedule Goods";
export const isThirdScheduleSaleType = (saleType) =>
  (saleType || "").trim().toLowerCase() === THIRD_SCHEDULE_SALE_TYPE.toLowerCase();

/**
 * The totals panel's rows -- the same rows, in the same order and with the
 * same amounts, that the bill forms printed before, each with a note saying
 * where the figure comes from.
 */
export function billTotalsRows({
  subtotal,
  gstRate,
  gstAmount,
  taxBase = null,
  scenarioCode = null,
  furtherTaxRate = 0,
  furtherTaxAmount = 0,
  buyerRegistered = null,
  grandTotal,
  withholdingAmount = 0,
  withholdingRate = null,
  balanceDue = null,
  advanceTaxAmount = 0,
  advanceTaxSection = null,
  advanceTaxRate = null,
  totalWithAdvance = null,
} = {}) {
  // 3rd Schedule: the tax is charged on the retail value, so show that value
  // and say so -- "GST 270 on a subtotal of 1,000" is otherwise a wrong-looking sum.
  const onRetail = taxBase != null && Math.abs(Number(taxBase) - Number(subtotal)) >= 0.005;
  const rows = [
    { key: "subtotal", label: "Subtotal", amount: subtotal, note: "Value of the lines, before tax" },
  ];
  if (onRetail)
    rows.push({ key: "retail", label: "Retail value (MRP × Qty)", amount: taxBase, note: "3rd Schedule goods: sales tax is charged on this" });
  rows.push({
    key: "gst", label: `GST (${gstRate}%)`, amount: gstAmount,
    note: onRetail
      ? `${gstRate}% of the retail value${scenarioCode ? `, scenario ${scenarioCode}` : ""}`
      : scenarioCode ? `Rate set by scenario ${scenarioCode}` : "Rate charged on this bill",
  });
  if (furtherTaxAmount > 0)
    rows.push({
      key: "further", label: `Further Tax (${furtherTaxRate}%)`, amount: furtherTaxAmount,
      note: buyerRegistered === false
        ? "Buyer is unregistered: s.3(1A), on the value before tax"
        : "s.3(1A), on the value before tax",
    });
  rows.push({ key: "grand", label: "Grand Total", amount: grandTotal, strong: true, note: "Value plus sales tax: the invoice total" });
  if (withholdingAmount > 0) {
    rows.push({
      key: "wht", label: `Withholding tax${withholdingRate != null ? ` (${withholdingRate}%)` : ""}`,
      amount: withholdingAmount, note: "Deducted by the buyer (s.153)",
    });
    rows.push({ key: "balance", label: "Balance due", amount: balanceDue, strong: true, note: "What the buyer pays you" });
  }
  if (advanceTaxAmount > 0) {
    rows.push({
      key: "advance", label: `Advance income tax ${advanceTaxSection} (${advanceTaxRate}%)`,
      amount: advanceTaxAmount, note: "Collected on top, outside the FBR invoice",
    });
    rows.push({ key: "total-adv", label: "Total", amount: totalWithAdvance, strong: true, note: "Grand total plus advance income tax" });
  }
  return rows;
}
