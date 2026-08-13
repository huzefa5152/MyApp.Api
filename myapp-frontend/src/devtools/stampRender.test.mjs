/**
 * Stamp slot rendering — the two-pass path, end to end.
 *
 * Run from myapp-frontend (bare imports resolve against its node_modules):
 *     node src/devtools/stampRender.test.mjs
 *
 * Why this exists: the stamp is resolved TWICE on a real print. First
 * withStamp() swaps {{stamp}} for the assigned URL inside resolveTemplate();
 * then mergeTemplate() runs its own safety net for any path that skipped the
 * resolver. A first cut of that net stripped every .stamp-slot unconditionally,
 * which deleted the <img> the first pass had just resolved — so an assigned
 * stamp silently vanished from every printed document, and from the Print
 * Templates preview.
 *
 * The API tests could not catch it (they assert on stored rows, not rendering)
 * and the earlier ad-hoc render checks passed `stamp` in the merge data, which
 * the real print path never does. Hence: assert the actual composition.
 */

import { withStamp, materializeStamp, slotMarkup, detectStampState } from "../utils/stampSlot.js";
import { mergeTemplate } from "../utils/templateEngine.js";
import { defaultChallanTemplate, defaultTaxInvoiceTemplate } from "../utils/defaultTemplates.js";
import { taxInvoiceStarters } from "../utils/starters/taxInvoice.js";

let passed = 0;
const failures = [];

function check(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++;
  } else {
    failures.push(`${label}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
  }
}

const URL_ = "/data/uploads/stamps/company_1/sig.png";
const TPL = `<html><body><div class="sig">${slotMarkup()}</div></body></html>`;
const hasEmptySrc = (html) => /<img[^>]*src=(["'])\s*\1/.test(html);

// ── The regression: resolve upstream, then render ──
const assigned = mergeTemplate(
  withStamp({ htmlContent: TPL, stampSlug: "sig" }, { sig: URL_ }).htmlContent,
  { items: [] },
);
check("assigned stamp survives withStamp -> mergeTemplate", assigned.includes(`src="${URL_}"`), true);
check("assigned leaves no raw token", assigned.includes("{{stamp}}"), false);

const unassigned = mergeTemplate(withStamp({ htmlContent: TPL }, {}).htmlContent, { items: [] });
check("unassigned removes the slot", unassigned.includes("stamp-slot"), false);
check("unassigned leaves no empty src", hasEmptySrc(unassigned), false);
check("unassigned leaves no raw token", unassigned.includes("{{stamp}}"), false);

// ── Idempotence: the net may run over already-resolved markup ──
const once = materializeStamp(TPL, URL_);
check("materialize is idempotent when resolved", materializeStamp(once, null), once);
check("materialize is idempotent when stripped",
  materializeStamp(materializeStamp(TPL, null), null),
  '<html><body><div class="sig"></div></body></html>');

// ── Mixed: one resolved slot, one not ──
const mixed = `<div>${slotMarkup()}</div><div><span class="stamp-slot"><img src="/keep.png"></span></div>`;
const swept = materializeStamp(mixed, null);
check("keeps the already-resolved slot", swept.includes("/keep.png"), true);
check("drops the unresolved slot", swept.includes("{{stamp}}"), false);

// ── Every shipped template behaves the same ──
const shipped = [
  ["defaultChallan", defaultChallanTemplate],
  ["defaultTaxInvoice", defaultTaxInvoiceTemplate],
  ["starter:" + taxInvoiceStarters[0].id, taxInvoiceStarters[0].html],
];
for (const [name, tpl] of shipped) {
  check(`${name} is slotted`, detectStampState(tpl), "slotted");
  const on = mergeTemplate(withStamp({ htmlContent: tpl, stampSlug: "sig" }, { sig: URL_ }).htmlContent, { items: [] });
  const off = mergeTemplate(withStamp({ htmlContent: tpl }, {}).htmlContent, { items: [] });
  check(`${name} renders the stamp when assigned`, on.includes(`src="${URL_}"`), true);
  check(`${name} renders nothing when unassigned`, off.includes("stamp-slot"), false);
  check(`${name} never leaves an empty src`, hasEmptySrc(off), false);
}

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("all checks passed");
