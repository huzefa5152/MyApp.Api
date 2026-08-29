/*
 * Render print templates at a range of line counts, with the real print-layout
 * transform applied in-page, ready for Chrome's print-to-PDF.
 *
 * Half of the pagination check in scripts/verify_print_pagination.py — this half
 * produces the HTML, that half prints it through real Chrome and asserts on the
 * resulting page geometry. Kept in Node so the templates go through the SAME
 * Handlebars helpers and the SAME utils/printLayout.js the app uses, rather than
 * a re-implementation that could drift.
 *
 * utils/printLayout.js needs a DOM, which Node has not got, so applyPrintLayout
 * is inlined into each page as a <script> and runs in the browser before the
 * print. Same source file either way.
 *
 * Usage (from repo root, Node 20+):
 *   node scripts/print_templates/pagination_render.mjs <templateDir> <outDir> [counts]
 *     templateDir  directory of <id>_<companyId>_<TemplateType>.html files
 *     outDir       where the rendered cases are written
 *     counts       comma-separated line counts, default 1,3,20,60
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const utils = path.join(repo, "myapp-frontend", "src", "utils");

function pathToUrl(p) {
  return "file:///" + p.replace(/\\/g, "/");
}

const { mergeTemplate } = await import(pathToUrl(path.join(utils, "templateEngine.js")));
const { SAMPLE_DATA } = await import(pathToUrl(path.join(utils, "templateSampleData.js")));

// Handlebars is CJS, so requiring it from the engine's own directory hands back
// the very instance templateEngine.js registered its helpers on — which is what
// lets --baseline put the old padding helpers back.
const H = createRequire(pathToUrl(path.join(utils, "templateEngine.js")))("handlebars");

// utils/printLayout.js, inlined so the browser applies the very same transform.
const layoutSrc = fs
  .readFileSync(path.join(utils, "printLayout.js"), "utf8")
  .replace(/^export\s+/gm, "");

// --baseline reproduces the PRE-FIX behaviour for the before/after matrix: the
// blank-row padding helpers as they were, and no print-layout transform.
const BASELINE = process.argv.includes("--baseline");
if (BASELINE) {
  H.registerHelper("emptyRows", (count, cols) => {
    let h = "";
    for (let i = 0; i < count; i++) {
      h += "<tr>";
      for (let j = 0; j < cols; j++) h += '<td class="cell">&nbsp;</td>';
      h += "</tr>";
    }
    return new H.SafeString(h);
  });
  H.registerHelper("billEmptyRows", (count) => {
    let h = "";
    for (let i = 0; i < count; i++) {
      h += '<tr><td class="cell c">&nbsp;</td><td class="cell c">&nbsp;</td>'
         + '<td class="cell">&nbsp;</td><td class="cell r">&nbsp;</td>'
         + '<td class="cell r">Rs &nbsp;&nbsp; -</td></tr>';
    }
    return new H.SafeString(h);
  });
  H.registerHelper("taxEmptyRows", (count) => {
    let h = "";
    for (let i = 0; i < count; i++) {
      h += "<tr><td></td><td></td><td></td><td class=\"right\">-</td>"
         + '<td class="center">-</td><td class="right">-</td><td class="right">-</td></tr>';
    }
    return new H.SafeString(h);
  });
}

const LONG_DESCRIPTION =
  "Heavy duty double acting pneumatic cylinder, bore 100mm x stroke 500mm, " +
  "ISO 15552 mounting, with adjustable end cushioning, magnetic piston, " +
  "stainless rod, supplied with two proximity sensors and mounting brackets " +
  "as per the customer's revised technical specification sheet rev. C";

// Templates carrying no signature at all by design — the Traditional Trading
// Co. set prints "A system-generated document does not require a signature or
// stamp". printLayout leaves those untouched, so the PDF check must not expect
// a pinned block. Mirrors the ANCHORS list in utils/printLayout.js.
const SIGNATURE_CLASSES = [
  "print-signature", "sig-row", "sigs", "signature-row", "signatures",
  "sig-table", "sig-box", "sig-cell", "sig-stamp", "sig-block",
  "company_signature", "signature", "sign", "sig",
];
const SIGNATURE_RE = new RegExp(
  'class\\s*=\\s*["\'][^"\']*\\b(' + SIGNATURE_CLASSES.join("|") + ')\\b', "i");
const ANCHORS_SELECTOR = SIGNATURE_CLASSES.map((c) => "." + c).join(",");

// The repeating collection differs by document type.
const LIST_KEYS = ["items", "lines", "allocations"];

function listKeyOf(data) {
  return LIST_KEYS.find((k) => Array.isArray(data[k]) && data[k].length) || null;
}

function expand(data, count, { longDescription = false } = {}) {
  const out = JSON.parse(JSON.stringify(data));
  const key = listKeyOf(out);
  if (!key) return out;
  const seed = out[key];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = { ...seed[i % seed.length] };
    if ("sNo" in row) row.sNo = i + 1;
    if ("description" in row) {
      row.description =
        longDescription && i % 3 === 0 ? LONG_DESCRIPTION : `${row.description} #${i + 1}`;
    }
    rows.push(row);
  }
  out[key] = rows;
  return out;
}

// Paint the pinned signature in a reserved colour so the PDF check can find it
// on each page — whatever the template calls its footer — and tell its own text
// apart from line items that have run underneath it. Colour only: marker spans
// were tried first and are useless here, because an absolutely-positioned
// element inside a repeated position:fixed block is not painted consistently by
// Blink on pages after the first.
const INK = "rgb(2,251,7)";
const PROBE = `
(function () {
  if (!document.querySelector(".mpl-fixed")) return;
  var st = document.createElement("style");
  st.textContent = ".mpl-fixed, .mpl-fixed * { color: ${INK} !important; }";
  document.head.appendChild(st);
})();`;

// --baseline measures where the signature prints TODAY: same probes, but marking
// the template's own signature block instead of a pinned wrapper, and without
// applying the layout. Gives the "before" column of the test matrix.
const BASELINE_PROBE = `
(function () {
  var all = document.body.querySelectorAll(ANCHORS);
  if (!all.length) return;
  var f = all[all.length - 1];
  var st = document.createElement("style");
  st.textContent = ".zqsig, .zqsig * { color: ${INK} !important; }";
  document.head.appendChild(st);
  f.className += " zqsig";
})();`;

function pageFor(html) {
  const body = BASELINE
    ? "\nvar ANCHORS = " + JSON.stringify(ANCHORS_SELECTOR) + ";" + BASELINE_PROBE
    : layoutSrc + "\ntry{applyPrintLayout(document);" + PROBE + "}"
      + "catch(e){document.title='LAYOUT_ERROR '+e.message;}";
  const script = "<script>\n" + body + "\n</script>";
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, script + "</body>")
    : html + script;
}

const [templateDir, outDir, countsArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!templateDir || !outDir) {
  console.error("usage: pagination_render.mjs <templateDir> <outDir> [counts]");
  process.exit(2);
}
const counts = (countsArg || "1,3,20,60").split(",").map((n) => Number(n.trim()));
fs.mkdirSync(outDir, { recursive: true });

const manifest = [];
let failures = 0;

for (const file of fs.readdirSync(templateDir).filter((f) => f.endsWith(".html"))) {
  const m = file.match(/^(\d+)_(\d+)_(.+)\.html$/);
  if (!m) continue;
  const [, id, companyId, type] = m;
  const sample = SAMPLE_DATA[type];
  if (!sample) {
    console.error(`no sample data for type ${type} (template ${id})`);
    failures++;
    continue;
  }
  const tpl = fs.readFileSync(path.join(templateDir, file), "utf8");

  const cases = counts.map((n) => ({ n, long: false }));
  cases.push({ n: 8, long: true });

  for (const c of cases) {
    const caseName = `${id}_${type}_n${c.n}${c.long ? "_long" : ""}`;
    let merged;
    try {
      merged = mergeTemplate(tpl, expand(sample, c.n, { longDescription: c.long }));
    } catch (e) {
      console.error(`RENDER FAILED ${caseName}: ${e.message}`);
      failures++;
      continue;
    }
    fs.writeFileSync(path.join(outDir, caseName + ".html"), pageFor(merged), "utf8");
    // A padding row is a <tr> whose cells are all blank / a lone dash.
    const blankRows = (merged.match(
      /<tr[^>]*>(?:\s*<td[^>]*>\s*(?:&nbsp;|-|Rs\s*(?:&nbsp;\s*)*-)?\s*<\/td>\s*)+<\/tr>/gi,
    ) || []).length;
    manifest.push({
      case: caseName,
      templateId: Number(id),
      companyId: Number(companyId),
      type,
      lineCount: c.n,
      longDescription: c.long,
      blankRows,
      hasSignature: SIGNATURE_RE.test(merged),
      unresolvedTokens: (merged.match(/\{\{/g) || []).length,
    });
  }
}

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`rendered ${manifest.length} cases from ${templateDir}`);
const withTokens = manifest.filter((c) => c.unresolvedTokens > 0);
if (withTokens.length) {
  console.log(`WARNING: ${withTokens.length} cases still contain {{tokens}}`);
}
process.exit(failures ? 1 : 0);
