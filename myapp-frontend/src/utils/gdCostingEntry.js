/**
 * The Import Costing screen's decisions, in one pure, dependency-free module so
 * node can test them (scripts/test_gd_costing_entry.mjs).
 *
 * `lineProblems` mirrors Helpers/GdLineRules.cs WORD FOR WORD. It exists for
 * instant feedback while a line is typed; the server re-checks every line at
 * preview and at commit, and its `problems` are the ones that count. Change a
 * rule or a message in both places, or the screen and the refusal disagree.
 *
 * Nothing here computes stock or cost the server will write. `computeCosting`
 * is the costing chain's instant estimate (Helpers/ImportCostingCalculator.cs
 * is the real one); every other function only reads what the preview returned.
 */

export const MODE_NEW_ARRIVALS = "new-arrivals";
export const MODE_BACKFILL = "backfill";

/** The line editor's field names -- Helpers/GdLineRules.Fields. */
export const FIELDS = {
  gdNumber: "gdNumber",
  gdDate: "gdDate",
  description: "description",
  hsCode: "hsCode",
  quantity: "quantity",
  unit: "unit",
  assessedValue: "assessedValue",
  amounts: "amounts",
  rates: "rates",
  sellingValue: "sellingValue",
  item: "item",
};

/** Where the footer checklist sends the operator. */
export const COSTING_ANCHORS = {
  company: "costing-step-company",
  gd: "costing-step-gd",
  review: "costing-step-review",
  commit: "costing-step-commit",
};

export const lineAnchor = (row) => `costing-line-${row}`;

const EARLIEST_GD_DATE = "2000-01-01";

// A form value as a number: blank and junk are NaN, so a comparison against
// them is false -- "blank" is caught by the explicit required checks.
const num = (v) => {
  if (v === "" || v == null) return NaN;
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const blank = (v) => String(v ?? "").trim().length === 0;

/** Helpers/ExcelImport/GdCostingMapping.CleanHsCode: digits and dots only. */
export const cleanHsCode = (raw) => String(raw ?? "").replace(/[^0-9.]/g, "").replace(/^\.+|\.+$/g, "");

/** "YYYY-MM-DD" of a date string the form or the server holds. */
export const isoDay = (v) => (v ? String(v).slice(0, 10) : "");

/** The day after `todayIso`, as "YYYY-MM-DD" (UTC, like the server). */
function tomorrowOf(todayIso) {
  const d = new Date(`${todayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Today in UTC -- the server's clock (Pakistan runs five hours ahead, hence the day's grace). */
export const todayUtcIso = () => new Date().toISOString().slice(0, 10);

/**
 * Every rule `line` breaks, in form order; empty when complete. Mirror of
 * GdLineRules.Check -- same fields, same bounds, same words.
 */
export function lineProblems(line, todayIso = todayUtcIso()) {
  const p = [];
  const add = (field, message) => p.push({ field, message });
  const m = line || {};

  if (blank(m.gdNumber)) add(FIELDS.gdNumber, "Enter the GD number.");

  const day = isoDay(m.gdDate);
  if (!day) add(FIELDS.gdDate, "Enter the GD date.");
  else if (day < EARLIEST_GD_DATE) add(FIELDS.gdDate, "The GD date is before 2000. Check the year.");
  else if (day > tomorrowOf(todayIso)) add(FIELDS.gdDate, "The GD date is in the future.");

  if (blank(m.description)) add(FIELDS.description, "Enter what the goods are (the item name).");
  if (cleanHsCode(m.hsCode).length === 0) add(FIELDS.hsCode, "Enter the HS code.");
  if (!(num(m.quantity) > 0)) add(FIELDS.quantity, "Enter a quantity above zero.");
  if (blank(m.unit)) add(FIELDS.unit, "Enter the unit (Pcs, Kg, ...).");
  if (!(num(m.assessedValue) > 0)) add(FIELDS.assessedValue, "Enter the assessed value from the GD.");

  if ([m.customsDuty, m.acd, m.regulatoryDuty, m.others, m.addOnProfit].some((v) => num(v) < 0))
    add(FIELDS.amounts, "Duties, other charges and add-on profit cannot be negative.");

  const notAPercentage = (v) => num(v) < 0 || num(v) >= 100;
  if ([m.salesTaxRate, m.astRate, m.incomeTaxRate].some(notAPercentage))
    add(FIELDS.rates, "Each rate is a percentage from 0 to 100 (write 1% as 1).");

  if (!blank(m.sellingValue) && num(m.sellingValue) < 0)
    add(FIELDS.sellingValue, "The stated selling value cannot be negative.");

  return p;
}

/** The messages for one field, from any list of `{ field, message }`. */
export const messagesFor = (problems, field) =>
  (problems || []).filter((x) => x.field === field).map((x) => x.message);

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * The costing chain, instantly, as the operator types -- the same formula as
 * Helpers/ImportCostingCalculator.cs, which is the one that counts.
 */
export function computeCosting(m) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const cost = round2(n(m.assessedValue) + n(m.customsDuty) + n(m.acd) + n(m.regulatoryDuty));
  const st = Math.max(0, n(m.salesTaxRate));
  const ast = Math.max(0, n(m.astRate));
  const it = Math.max(0, n(m.incomeTaxRate));
  const salesTax = round2(cost * st / 100);
  const astAmount = round2(cost * ast / 100);
  const subtotal = round2(cost + salesTax + astAmount + n(m.others));
  const incomeTax = round2(subtotal * it / 100);
  const inputTax = round2(salesTax + astAmount);
  const sellingValue = st > 0
    ? round2((inputTax * 100 / st) + round2(n(m.addOnProfit)))
    : round2(cost + round2(n(m.addOnProfit)));
  return { cost, salesTax, ast: astAmount, subtotal, incomeTax, inputTax, sellingValue };
}

/** A fresh line in the editor. The 18/3/6 rates are what every real GD costing sheet uses. */
export const blankLine = () => ({
  gdNumber: "", gdDate: "", description: "", hsCode: "", quantity: "", unit: "",
  assessedValue: "", customsDuty: "0", acd: "0", regulatoryDuty: "0", others: "0",
  salesTaxRate: "18", astRate: "3", incomeTaxRate: "6", addOnProfit: "0", sellingValue: "",
});

/** The next typed line: the GD, its date, the unit and the rates carry over -- retyping them 26 times is how a sheet gets typed wrong. */
export const nextLineFrom = (m) => ({
  ...blankLine(),
  gdNumber: m.gdNumber, gdDate: m.gdDate, unit: m.unit,
  salesTaxRate: m.salesTaxRate, astRate: m.astRate, incomeTaxRate: m.incomeTaxRate,
});

/** A preview line, back in the editor's shape (strings), for Fix. */
export function editorLineFrom(l) {
  const s = (v) => (v == null ? "" : String(v));
  return {
    sourceRow: l.sourceRow,
    gdNumber: s(l.gdNumber), gdDate: isoDay(l.gdDate), description: s(l.description),
    hsCode: s(l.hsCode), quantity: s(l.quantity), unit: s(l.unit),
    assessedValue: s(l.assessedValue), customsDuty: s(l.customsDuty), acd: s(l.acd),
    regulatoryDuty: s(l.regulatoryDuty), others: s(l.others), salesTaxRate: s(l.salesTaxRate),
    astRate: s(l.astRate), incomeTaxRate: s(l.incomeTaxRate), addOnProfit: s(l.addOnProfit),
    sellingValue: s(l.sheetSellingValue),
  };
}

/**
 * One line for the server's re-check (GdCostingManualLineDto), from the
 * editor's strings. `extra` carries the review's decisions: sourceRow,
 * leaveOut, chosenOpeningStockBalanceId.
 */
export function toLinePayload(m, extra = {}) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  return {
    sourceRow: extra.sourceRow ?? m.sourceRow ?? null,
    leaveOut: extra.leaveOut ?? null,
    chosenOpeningStockBalanceId: extra.chosenOpeningStockBalanceId ?? null,
    gdNumber: String(m.gdNumber ?? "").trim(),
    gdDate: isoDay(m.gdDate) || null,
    description: String(m.description ?? "").trim(),
    hsCode: String(m.hsCode ?? "").trim(),
    quantity: n(m.quantity),
    unit: String(m.unit ?? "").trim() || null,
    assessedValue: n(m.assessedValue),
    customsDuty: n(m.customsDuty),
    acd: n(m.acd),
    regulatoryDuty: n(m.regulatoryDuty),
    others: n(m.others),
    salesTaxRate: n(m.salesTaxRate),
    astRate: n(m.astRate),
    incomeTaxRate: n(m.incomeTaxRate),
    addOnProfit: n(m.addOnProfit),
    sellingValue: blank(m.sellingValue) ? null : n(m.sellingValue),
  };
}

/** A preview line straight back to the server (no editing), with the review's decisions. */
export const previewLineToPayload = (l, extra = {}) =>
  toLinePayload(editorLineFrom(l), { sourceRow: l.sourceRow, ...extra });

/**
 * The screen's own leave-out default, applied when the operator has not
 * decided: on Backfill a line with nothing on the books to price is left out
 * until the operator brings it in as new stock. On New Arrivals it IS new stock
 * and comes in. The server never assumes either.
 */
export const defaultLeaveOut = (line, mode) =>
  mode === MODE_BACKFILL && line?.disposition === "stock-posted";

export const effectiveLeaveOut = (line, mode, choices = {}) =>
  choices[line.sourceRow] ?? defaultLeaveOut(line, mode);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const qtyText = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
export const moneyText = (n) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What will happen to stock for one reviewed line, in the operator's words.
 *   kind  "adds"     -- new arrivals onto an item on the books
 *         "cost"     -- Backfill: sets an item's actual cost
 *         "new"      -- becomes a new item (or first stock of a catalog one)
 *         "choose"   -- several items share the code: the operator must pick
 *         "left-out" -- recorded, nothing written
 * `blocking` is true while the line would come in with a problem.
 */
export function lineOutcome(l, mode) {
  const problems = l.problems || [];
  const unit = l.unit ? ` ${l.unit}` : "";
  const blocking = !l.leaveOut && problems.length > 0;
  if (l.leaveOut)
    return { kind: "left-out", title: "Left out", detail: "Its goods will not come into stock.", blocking: false };
  if (l.disposition === "ambiguous") {
    const n = (l.candidates || []).length;
    return {
      kind: "choose",
      title: "Choose the item",
      detail: `${n > 0 ? plural(n, "item") : "Several items"} on your books share HS code ${l.hsCode}. Pick which one these goods are.`,
      blocking,
    };
  }
  if (l.disposition === "cost-only") {
    const item = l.itemTypeName || "the item";
    const onBooks = Number(l.matchedBalanceQuantity) || 0;
    if (mode === MODE_NEW_ARRIVALS)
      return {
        kind: "adds",
        title: `Adds ${qtyText(l.quantity)}${unit} to ${item}`,
        detail: `On the books: ${qtyText(onBooks)} → ${qtyText(onBooks + (Number(l.quantity) || 0))}`,
        blocking,
      };
    return {
      kind: "cost",
      title: `Sets the cost of ${item}`,
      detail: `${qtyText(onBooks)} on the books; this GD's unit cost is applied to all of them.`,
      blocking,
    };
  }
  // stock-posted: nothing on the books under this code.
  const name = l.newItemName || l.description || "a new item";
  const kept = l.newItemUnit ? `kept in ${l.newItemUnit}` : "no unit yet";
  if (l.newItemResolution === "reuse")
    return { kind: "new", title: `First stock of ${name}`, detail: `An item already in the catalog under ${l.hsCode}, ${kept}.`, blocking };
  if (l.newItemResolution === "adopt")
    return { kind: "new", title: `Adopts the tariff item ${name}`, detail: `HS code ${l.hsCode}, ${kept}.`, blocking };
  return { kind: "new", title: `New item: ${name}`, detail: `HS code ${l.hsCode || "—"}, ${kept}. Created with its opening stock.`, blocking };
}

/**
 * What is left before the GD can be brought in, in the order the screen shows
 * it. Empty means ready. Items are `{ key, label, target }` for BillChecklist.
 */
export function entryChecklist({ companyId, preview, stale = false } = {}) {
  const items = [];
  if (!companyId) {
    items.push({ key: "company", label: "Choose the company", target: COSTING_ANCHORS.company });
    return items;
  }
  if (!preview) {
    items.push({ key: "gd", label: "Upload the costing sheet or type the GD, then press Check", target: COSTING_ANCHORS.gd });
    return items;
  }
  if (stale) {
    items.push({ key: "stale", label: "Lines changed: press Check again", target: COSTING_ANCHORS.gd });
    return items;
  }
  (preview.blockingErrors || []).forEach((e, i) =>
    items.push({ key: `blocking-${i}`, label: e, target: COSTING_ANCHORS.review }));
  const lines = preview.lines || [];
  for (const l of lines) {
    if (l.leaveOut) continue;
    const first = (l.problems || [])[0];
    if (first) items.push({ key: `line-${l.sourceRow}`, label: `Row ${l.sourceRow}: ${first.message}`, target: lineAnchor(l.sourceRow) });
    else if (l.disposition === "ambiguous")
      items.push({ key: `line-${l.sourceRow}`, label: `Row ${l.sourceRow}: choose the item, or leave the line out`, target: lineAnchor(l.sourceRow) });
  }
  if (lines.length > 0 && lines.every((l) => l.leaveOut))
    items.push({ key: "all-out", label: "Every line is left out: include at least one", target: COSTING_ANCHORS.review });
  return items;
}

/** The figures the "Bring it in" step states, from the reviewed lines. */
export function commitSummary(preview, mode) {
  const lines = preview?.lines || [];
  const kept = lines.filter((l) => !l.leaveOut && l.disposition !== "ambiguous");
  const matched = kept.filter((l) => l.disposition === "cost-only");
  const fresh = kept.filter((l) => l.disposition === "stock-posted");
  const key = (l) => `${cleanHsCode(l.hsCode)}|${String(l.description || "").trim().toUpperCase()}`;
  return {
    mode,
    lineCount: kept.length,
    itemsTouched: new Set(matched.map((l) => l.itemTypeId)).size,
    unitsAdded: mode === MODE_NEW_ARRIVALS ? matched.reduce((a, l) => a + (Number(l.quantity) || 0), 0) : 0,
    newItems: new Set(fresh.map(key)).size,
    newUnits: fresh.reduce((a, l) => a + (Number(l.quantity) || 0), 0),
    leftOut: lines.filter((l) => l.leaveOut).length,
    undecided: lines.filter((l) => !l.leaveOut && l.disposition === "ambiguous").length,
    totalCost: round2(kept.reduce((a, l) => a + (Number(l.cost) || 0), 0)),
    totalSelling: round2(kept.reduce((a, l) => a + (Number(l.sheetSellingValue ?? l.sellingValue) || 0), 0)),
  };
}

/** The summary as sentences, most consequential first. */
export function summarySentences(s) {
  const out = [];
  const one = (n) => n === 1;
  if (s.itemsTouched > 0)
    out.push(s.mode === MODE_NEW_ARRIVALS
      ? `${plural(s.itemsTouched, "item")} on the books ${one(s.itemsTouched) ? "gets" : "get"} more stock: ${qtyText(s.unitsAdded)} units in all.`
      : `${plural(s.itemsTouched, "item")} ${one(s.itemsTouched) ? "gets its" : "get their"} actual cost set. Quantities stay as they are.`);
  if (s.newItems > 0)
    out.push(`${plural(s.newItems, "new item")} created with ${qtyText(s.newUnits)} units of opening stock.`);
  if (s.leftOut > 0)
    out.push(`${plural(s.leftOut, "line")} left out: ${one(s.leftOut) ? "its" : "their"} goods will NOT come into stock.`);
  if (s.undecided > 0)
    out.push(`${plural(s.undecided, "line")} still ${one(s.undecided) ? "needs" : "need"} an item chosen.`);
  return out;
}

/** The commit button's words. */
export const commitLabel = (s) =>
  s.mode === MODE_NEW_ARRIVALS
    ? `Bring ${plural(s.lineCount, "line")} into stock`
    : `Record ${plural(s.lineCount, "line")}`;
