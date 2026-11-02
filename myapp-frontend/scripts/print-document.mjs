// Print a document through MCP exactly as its Print button would, N copies.
//
//   node scripts/print-document.mjs --site trader --company 1 --type Challan --id 1 --copies 3 --signed
//
// The site's MCP token comes from MYAPP_MCP_TOKEN_<SITE> or scripts/.print-sites.local.json
// ({ "trader": { "base": "https://…", "token": "…" } }, gitignored). It needs the
// documents.read scope. The bundle is merged with the app's own templateEngine,
// turned into a PDF by headless Edge, and printed by SumatraPDF.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { mergeTemplate } from "../src/utils/templateEngine.js";
import { withPrintCss } from "../src/utils/printDocument.js";

const here = dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({ options: {
  site: { type: "string" }, base: { type: "string" },
  company: { type: "string" }, type: { type: "string" }, id: { type: "string" },
  template: { type: "string" }, signed: { type: "boolean" }, unsigned: { type: "boolean" },
  copies: { type: "string", default: "1" }, printer: { type: "string" },
  out: { type: "string", default: join(tmpdir(), "myapp-print") }, "pdf-only": { type: "boolean" },
} });
const fail = (msg) => { console.error(msg); process.exit(1); };
if (!a.company || !a.type || !a.id) fail("Need --company, --type and --id.");
if (a.signed && a.unsigned) fail("Choose --signed or --unsigned, not both.");
const copies = Number(a.copies);
if (!Number.isInteger(copies) || copies < 1 || copies > 20) fail("--copies must be 1 to 20.");

const sitesFile = join(here, ".print-sites.local.json");
const site = (existsSync(sitesFile) ? JSON.parse(readFileSync(sitesFile, "utf8")) : {})[a.site] || {};
const base = (a.base || site.base || "").replace(/\/+$/, "");
const token = process.env[`MYAPP_MCP_TOKEN_${(a.site || "").toUpperCase()}`] || site.token;
if (!base || !token) fail(`No base URL or token for site "${a.site}". Add it to ${sitesFile}.`);

let rpcId = 0;
async function tool(name, args) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) fail(`MCP ${name} failed: ${body?.error?.message || `HTTP ${res.status}`}`);
  const text = body.result.content[0].text;
  if (body.result.isError) fail(text);
  return JSON.parse(text);
}

const args = { companyId: Number(a.company), documentType: a.type, documentId: Number(a.id) };
if (a.template) args.templateId = Number(a.template);
if (a.signed || a.unsigned) args.signed = !!a.signed;
let text = "", sha = null;
for (let offset = 0; offset !== null;) {
  const chunk = await tool("get_document_render_bundle", { ...args, offset });
  if (sha && chunk.sha256 !== sha) fail("The document changed while it was being read. Run again.");
  sha = chunk.sha256;
  text += chunk.content;
  offset = chunk.nextOffset;
}
if (createHash("sha256").update(text, "utf8").digest("hex") !== sha) fail("The bundle arrived damaged. Run again.");
const bundle = JSON.parse(text);

const merged = mergeTemplate(bundle.html, { ...bundle.data, stamp: bundle.stamp, stamps: bundle.stamps });
// ponytail: letterhead templates need the browser's layout pass (prepareLetterheadPrint); print those from the screen.
if (/data-print-letterhead-top\s*=/i.test(merged)) fail("This template uses a fitted letterhead. Print it from the screen for now.");

mkdirSync(a.out, { recursive: true });
const stem = join(a.out, `${a.site || "site"}-${bundle.companyId}-${bundle.documentType}-${bundle.documentId}-${bundle.signed ? "signed" : "unsigned"}`);
writeFileSync(`${stem}.html`, withPrintCss(merged));
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!edge) fail("Microsoft Edge was not found; it turns the page into a PDF.");
execFileSync(edge, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer",
  `--user-data-dir=${join(a.out, ".edge")}`, `--print-to-pdf=${stem}.pdf`, pathToFileURL(`${stem}.html`).href], { stdio: "ignore" });
if (!existsSync(`${stem}.pdf`)) fail("Edge did not produce a PDF.");
console.log(`PDF: ${stem}.pdf  (template #${bundle.template.id} "${bundle.template.name}", ${bundle.signed ? "signed" : "unsigned"})`);
if (a["pdf-only"]) process.exit(0);

const sumatra = [process.env.SUMATRA_PDF, join(process.env.LOCALAPPDATA || "", "SumatraPDF/SumatraPDF.exe"),
  "C:/Program Files/SumatraPDF/SumatraPDF.exe", "C:/Program Files (x86)/SumatraPDF/SumatraPDF.exe"].filter(Boolean).find(existsSync);
if (!sumatra) fail("SumatraPDF is needed to print copies silently (winget install SumatraPDF.SumatraPDF). The PDF is saved above.");
execFileSync(sumatra, [...(a.printer ? ["-print-to", a.printer] : ["-print-to-default"]),
  "-print-settings", `${copies}x`, "-silent", `${stem}.pdf`]);
console.log(`Sent ${copies} ${copies === 1 ? "copy" : "copies"} to ${a.printer || "the default printer"}.`);
