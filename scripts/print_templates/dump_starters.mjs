/*
 * Write every starter template out as a standalone .html file, named the way
 * the pagination harness expects (<id>_<companyId>_<TemplateType>.html), so the
 * starter catalog can be checked with exactly the same tooling as the templates
 * stored in the database.
 *
 * Usage:
 *   node --import ./scripts/print_templates/register-hooks.mjs \
 *        scripts/print_templates/dump_starters.mjs <outDir>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const utils = path.resolve(here, "..", "..", "myapp-frontend", "src", "utils");
const url = (p) => "file:///" + p.replace(/\\/g, "/");

const { STARTER_TEMPLATES } = await import(url(path.join(utils, "starterTemplates.js")));

const outDir = process.argv.slice(2)[0];
if (!outDir) {
  console.error("usage: dump_starters.mjs <outDir>");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

const index = [];
STARTER_TEMPLATES.forEach((t, i) => {
  // Company id 0 marks these as catalog entries rather than stored rows.
  const name = `${900 + i}_0_${t.type}.html`;
  fs.writeFileSync(path.join(outDir, name), t.html, "utf8");
  index.push({ file: name, id: 900 + i, starterId: t.id, type: t.type, name: t.name });
});
fs.writeFileSync(path.join(outDir, "starters.json"), JSON.stringify(index, null, 1));
console.log(`dumped ${index.length} starter templates to ${outDir}`);
const byType = {};
for (const e of index) byType[e.type] = (byType[e.type] || 0) + 1;
console.log(Object.entries(byType).map(([t, n]) => `${t}=${n}`).join("  "));
