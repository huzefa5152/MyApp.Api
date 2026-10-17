// Pure: the rows of the Tax position panel (spec §7). No React, so node can test it.
// kind: "line" (working), "result" (bold, sales tax payable), "payable", "total" (bold),
// "recoverable". drill = onDrill key, or null (not drillable). gl = value comes from the ledger.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function taxPanelRows(d) {
  const rows = [
    { key: "output", label: "Output tax", value: d.outputTax, kind: "line", drill: "output" },
    { key: "further", label: "Further tax", value: d.furtherTax, kind: "line", drill: "further" },
    { key: "input", label: d.inputBasis === "gl-before-cap" ? "Input tax claimed (before 8B cap)" : "Input tax claimed", value: -d.inputTaxClaimed, kind: "line", drill: "input" },
    { key: "salesTaxPayable", label: "Sales tax payable", value: d.salesTaxPayable, kind: "result", drill: null },
  ];
  if (Math.abs(r2(d.salesTaxPayable - (d.outputTax + d.furtherTax - d.inputTaxClaimed))) > 0.005) {
    rows[3].note = "After 8B cap / carry-forward (Import Tax Desk)";
  }
  rows.push(
    { key: "236G", label: "Advance tax 236G", value: d.adv236G, kind: "payable", drill: "236G" },
    { key: "236H", label: "Advance tax 236H", value: d.adv236H, kind: "payable", drill: "236H" },
    { key: "wht", label: "WHT payable", value: d.whtPayable, kind: "payable", drill: "wht", gl: true },
    { key: "total", label: "Total payable", value: r2(d.salesTaxPayable + d.adv236G + d.adv236H + d.whtPayable), kind: "total", drill: null },
    { key: "recImport", label: "Advance tax on imports", value: d.recoverableImportAdvanceTax, kind: "recoverable", drill: null, gl: true },
    { key: "recWht", label: "Withholding deducted by customers", value: d.recoverableWhtDeducted, kind: "recoverable", drill: null, gl: true },
  );
  // Only WHT payable and the two recoverables are ledger lines; 236G/H come from invoices.
  return rows.map((x) => (x.gl && !d.ledgerEnabled ? { ...x, value: null, unavailable: "Ledger not enabled" } : x));
}
