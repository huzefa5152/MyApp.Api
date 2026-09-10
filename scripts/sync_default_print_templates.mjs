// Copies the built-in print templates the FRONTEND ships
// (myapp-frontend/src/utils/defaultTemplates.js) into
// Data/DefaultPrintTemplates/*.html, which the API embeds so it can give a new
// company its default Challan / Bill / Tax Invoice templates and print a
// document for a company that has none.
//
// The JS module is the single source of truth; this file keeps the server copy
// honest. Run it after editing a default template:
//
//   node scripts/sync_default_print_templates.mjs          # rewrite the .html files
//   node scripts/sync_default_print_templates.mjs --check  # exit 1 when out of sync
//
// The --check form is part of the test discipline in CLAUDE.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "Data", "DefaultPrintTemplates");

const mod = await import(
  new URL("../myapp-frontend/src/utils/defaultTemplates.js", import.meta.url).href
);

// templateType (Helpers/PrintTemplateTypes) -> export name in defaultTemplates.js
const MAP = {
  Challan: "defaultChallanTemplate",
  Bill: "defaultBillTemplate",
  TaxInvoice: "defaultTaxInvoiceTemplate",
};

const check = process.argv.includes("--check");
let drift = 0;
mkdirSync(outDir, { recursive: true });
for (const [type, exportName] of Object.entries(MAP)) {
  const html = mod[exportName];
  if (typeof html !== "string" || !html.trim()) {
    console.error(`defaultTemplates.js does not export ${exportName}`);
    process.exit(1);
  }
  const file = join(outDir, `${type}.html`);
  // Compare with line endings normalised: git's autocrlf may hand us CRLF
  // copies on Windows, and that is not drift.
  const norm = (t) => t.replace(/
/g, "
");
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (current != null && norm(current) === norm(html)) {
    console.log(`${type}.html  in sync`);
    continue;
  }
  if (check) {
    console.error(`${type}.html  OUT OF SYNC with ${exportName} — run without --check to regenerate`);
    drift++;
  } else {
    writeFileSync(file, html, "utf8");
    console.log(`${type}.html  written (${html.length} chars)`);
  }
}
if (drift) process.exit(1);
console.log(check ? "default print templates are in sync" : "default print templates synced");
