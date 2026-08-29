/*
 * Build a browser page that runs mergeTemplate()'s real print-layout step —
 * applyPrintLayoutToHtml(), the DOMParser string path — over every stored
 * template, and reports per-template assertions.
 *
 * The PDF harness (pagination_render.mjs) exercises applyPrintLayout(document)
 * against a live DOM; this covers the OTHER entry point, which is the one the
 * app actually calls, and which Node cannot run because it has no DOMParser.
 *
 * Usage:
 *   node --import ./scripts/print_templates/register-hooks.mjs \
 *        scripts/print_templates/build_domparser_check.mjs <templateDir> <out.html>
 * then open the file and read window.__RESULTS__.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const utils = path.join(repo, "myapp-frontend", "src", "utils");
const url = (p) => "file:///" + p.replace(/\\/g, "/");

const { mergeTemplate } = await import(url(path.join(utils, "templateEngine.js")));
const { SAMPLE_DATA } = await import(url(path.join(utils, "templateSampleData.js")));

const layoutSrc = fs
  .readFileSync(path.join(utils, "printLayout.js"), "utf8")
  .replace(/^export\s+/gm, "");

const [templateDir, outFile] = process.argv.slice(2);
if (!templateDir || !outFile) {
  console.error("usage: build_domparser_check.mjs <templateDir> <out.html>");
  process.exit(2);
}

const cases = [];
for (const file of fs.readdirSync(templateDir).filter((f) => f.endsWith(".html"))) {
  const m = file.match(/^(\d+)_(\d+)_(.+)\.html$/);
  if (!m) continue;
  const [, id, companyId, type] = m;
  const sample = SAMPLE_DATA[type];
  if (!sample) continue;
  const tpl = fs.readFileSync(path.join(templateDir, file), "utf8");
  // Three real line counts, since the transform reads the item table.
  for (const n of [1, 3, 25]) {
    const data = JSON.parse(JSON.stringify(sample));
    for (const key of ["items", "lines", "allocations"]) {
      if (Array.isArray(data[key]) && data[key].length) {
        const seed = data[key];
        data[key] = Array.from({ length: n }, (_, i) => {
          const row = { ...seed[i % seed.length] };
          if ("sNo" in row) row.sNo = i + 1;
          return row;
        });
      }
    }
    cases.push({ id: Number(id), companyId: Number(companyId), type, n, html: mergeTemplate(tpl, data) });
  }
}

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>printLayout DOMParser check</title></head>
<body><pre id="out">running…</pre>
<script id="cases" type="application/json">${JSON.stringify(cases).replace(/</g, "\\u003c")}</script>
<script>
${layoutSrc}
(function () {
  var cases = JSON.parse(document.getElementById("cases").textContent);
  var results = [];
  cases.forEach(function (c) {
    var r = { id: c.id, type: c.type, n: c.n, ok: true, problems: [] };
    var out;
    try {
      out = applyPrintLayoutToHtml(c.html);
    } catch (e) {
      r.ok = false; r.problems.push("threw: " + e.message); results.push(r); return;
    }
    // Some templates carry no signature at all by design (the Traditional
    // Trading Co. set prints "A system-generated document does not require a
    // signature or stamp"). Those must come back untouched, not half-changed.
    var probe = new DOMParser().parseFromString(c.html, "text/html");
    if (!probe.body.querySelector(ANCHORS)) {
      r.skipped = true;
      if (out !== c.html) { r.ok = false; r.problems.push("no signature, but the html was modified"); }
      results.push(r);
      return;
    }
    var doc = new DOMParser().parseFromString(out, "text/html");
    var fixed = doc.querySelectorAll(".mpl-fixed");
    var spacers = doc.querySelectorAll(".mpl-spacer");
    if (fixed.length !== 1) { r.ok = false; r.problems.push("mpl-fixed count " + fixed.length); }
    if (spacers.length !== 1) { r.ok = false; r.problems.push("mpl-spacer count " + spacers.length); }
    if (fixed.length && !(fixed[0].textContent || "").trim() && !fixed[0].querySelector("img")) {
      r.ok = false; r.problems.push("pinned block is empty");
    }
    // The reservation must land in the item table when there is one.
    var srcDoc = new DOMParser().parseFromString(c.html, "text/html");
    r.hadTable = srcDoc.querySelectorAll("table").length > 0;
    if (r.hadTable && spacers.length && !spacers[0].closest("tfoot")) {
      r.ok = false; r.problems.push("spacer not inside a tfoot");
    }
    if (doc.querySelectorAll("tfoot").length !== new Set(
        Array.prototype.map.call(doc.querySelectorAll("tfoot"), function (t) { return t.parentElement; })).size) {
      r.ok = false; r.problems.push("a table has more than one tfoot");
    }
    // The document's own words must survive untouched.
    var words = function (d) {
      return (d.body.textContent || "").replace(/\\s+/g, " ").trim();
    };
    var before = words(srcDoc);
    var after = words(doc);
    // The signature is duplicated into the hidden spacer, so strip that copy.
    if (spacers.length) { spacers[0].remove(); }
    var afterNoSpacer = words(doc);
    if (afterNoSpacer !== before) {
      r.ok = false;
      r.problems.push("text changed (" + before.length + " -> " + afterNoSpacer.length + ")");
    }
    if (after === afterNoSpacer && spacers.length) {
      r.ok = false; r.problems.push("spacer contributed no content");
    }
    results.push(r);
  });
  window.__RESULTS__ = results;
  var bad = results.filter(function (r) { return !r.ok; });
  var skipped = results.filter(function (r) { return r.skipped; });
  window.__SUMMARY__ = {
    total: results.length,
    pinned: results.length - bad.length - skipped.length,
    noSignatureByDesign: skipped.length,
    noSignatureTemplates: Array.from(new Set(skipped.map(function (r) { return r.id; }))),
    failed: bad.length,
    failures: bad.slice(0, 40),
  };
  document.getElementById("out").textContent = JSON.stringify(window.__SUMMARY__, null, 1);
})();
</script></body></html>`;

fs.writeFileSync(outFile, page, "utf8");
console.log("wrote " + outFile + " with " + cases.length + " cases");
