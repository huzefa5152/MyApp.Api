// Advance income tax collected FROM the buyer on a sale, under sections 236G
// (distributors / dealers / wholesalers) and 236H (retailers).
//
// Mirrors Helpers/AdvanceTaxRates.cs on the server, which is the authority:
// the form only proposes a section and a filer status, and the server resolves
// the rate and the amount. Keeping the table in both places means the operator
// sees the figure before saving; keeping the SERVER as the one that computes it
// means a stale frontend can never charge a buyer the wrong amount.
//
// Charged on the amount INCLUDING sales tax, and ADDED to what is collectible:
//   100,000 + 18,000 sales tax = 118,000, and 236G at 0.1% collects 118.
export const ADVANCE_TAX_OPTIONS = [
  { key: "236G:1", section: "236G", filerActive: true, rate: 0.1 },
  { key: "236H:1", section: "236H", filerActive: true, rate: 0.5 },
  { key: "236G:0", section: "236G", filerActive: false, rate: 2 },
  { key: "236H:0", section: "236H", filerActive: false, rate: 2.5 },
];

export const advanceTaxLabel = (o) =>
  `${o.section} — ${o.rate}% (${o.filerActive ? "Active" : "Non-Active"})`;

export const findAdvanceTax = (key) =>
  ADVANCE_TAX_OPTIONS.find((o) => o.key === key) || null;

// Same rounding the server applies: 2dp, away from zero.
export const advanceTaxAmount = (amountIncludingSalesTax, rate) => {
  if (!(rate > 0) || !(amountIncludingSalesTax > 0)) return 0;
  return Math.round(amountIncludingSalesTax * rate) / 100;
};

// Rebuilds the dropdown key from what a saved bill carries, so opening one for
// edit shows the choice that was made rather than an empty box.
export const advanceTaxKeyOf = (section, filerActive) => {
  if (!section || filerActive === null || filerActive === undefined) return "";
  return `${String(section).toUpperCase()}:${filerActive ? 1 : 0}`;
};
