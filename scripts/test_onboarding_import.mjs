// Offline checks for the Import Data screen's decisions.
//   node scripts/test_onboarding_import.mjs
import assert from "node:assert/strict";
import {
  SHEETS, allowedSheets, sheetsFromQuery, sheetsParam, importLinkFor, summarise, rowsFor,
  issueLine, missingSheets, checklist, canImport, sampleFileName, fileProblem,
} from "../myapp-frontend/src/utils/onboardingImport.js";

let passed = 0;
const t = (label, fn) => { fn(); passed++; };

const all = SHEETS.map((s) => s.key);
const hasAll = () => true;
const hasItemsOnly = (k) => k === "itemtypes.manage.create";

t("every sheet allowed with every permission", () => assert.deepEqual(allowedSheets(hasAll).map((s) => s.key), all));
t("a missing create permission hides that sheet", () => assert.deepEqual(allowedSheets(hasItemsOnly).map((s) => s.key), ["items"]));
t("no ?sheets selects everything allowed", () => assert.deepEqual(sheetsFromQuery("", all), all));
t("?sheets=customers selects customers", () => assert.deepEqual(sheetsFromQuery("?sheets=customers", all), ["customers"]));
t("?sheets is case-insensitive and order follows display", () => assert.deepEqual(sheetsFromQuery("?sheets=OPENINGSTOCK,items", all), ["items", "openingStock"]));
t("?sheets naming only forbidden sheets falls back to allowed", () => assert.deepEqual(sheetsFromQuery("?sheets=customers", ["items"]), ["items"]));
t("sheetsParam keeps display order", () => assert.equal(sheetsParam(["openingStock", "customers"]), "customers,openingStock"));
t("import link", () => assert.equal(importLinkFor("items"), "/import-data?sheets=items"));

const preview = {
  totalToImport: 5,
  sheets: [
    { key: "customers", title: "Customers", present: true, toImport: 2, withWarnings: 1, existing: 1, errors: 2,
      rows: [
        { rowNumber: 5, status: "import", label: "E", issues: [] },
        { rowNumber: 3, status: "error", label: "A", issues: [{ column: "NTN", message: "required", isError: true }] },
        { rowNumber: 4, status: "exists", label: "B", issues: [] },
        { rowNumber: 6, status: "warning", label: "C", issues: [{ column: null, message: "note", isError: false }] },
        { rowNumber: 7, status: "error", label: "D", issues: [] },
      ] },
    { key: "items", title: "Items", present: false, toImport: 2, withWarnings: 0, existing: 0, errors: 0, rows: [] },
  ],
};
t("summarise adds the sheets", () => {
  const s = summarise(preview);
  assert.equal(s.toImport, 4); assert.equal(s.withWarnings, 1); assert.equal(s.existing, 1);
  assert.equal(s.errors, 2); assert.equal(s.willCreate, 5); assert.equal(s.rows, 5);
});
t("rowsFor puts refused rows first, then by row number", () =>
  assert.deepEqual(rowsFor(preview.sheets[0]).map((r) => r.rowNumber), [3, 7, 6, 5, 4]));
t("rowsFor filters by status", () => assert.deepEqual(rowsFor(preview.sheets[0], "error").map((r) => r.rowNumber), [3, 7]));
t("issueLine names the column", () => assert.equal(issueLine({ column: "NTN", message: "required" }), "NTN: required"));
t("issueLine without a column", () => assert.equal(issueLine({ column: null, message: "note" }), "note"));
t("missingSheets lists chosen sheets absent from the file", () => assert.deepEqual(missingSheets(preview), ["Items"]));

t("checklist before anything", () => {
  const c = checklist({ selected: [], file: null, preview: null });
  assert.equal(c[0].done, false); assert.equal(c[1].done, false);
});
t("checklist with a preview reports errors and rows to import", () => {
  const c = checklist({ selected: ["customers"], file: { name: "a.xlsx" }, preview });
  assert.ok(c.some((i) => i.text === "2 rows need fixing; they will be skipped"));
  assert.ok(c.some((i) => i.done && i.text === "5 rows ready to import"));
});
t("checklist after import", () => assert.equal(checklist({ selected: [], file: null, preview: null, result: { totalCreated: 1 } })[0].text, "Imported 1 record"));
t("canImport needs something to create and not busy", () => {
  assert.equal(canImport(preview, false), true);
  assert.equal(canImport(preview, true), false);
  assert.equal(canImport({ sheets: [{ toImport: 0, withWarnings: 0, rows: [] }] }, false), false);
});
t("sample file name", () => assert.equal(sampleFileName("Hakimi Traders (Pvt.)"), "import-data-hakimi-traders-pvt.xlsx"));
t("sample file name without a company", () => assert.equal(sampleFileName(""), "import-data.xlsx"));
t("fileProblem accepts xlsx", () => assert.equal(fileProblem({ name: "Data.XLSX", size: 10 }), null));
t("fileProblem refuses csv", () => assert.match(fileProblem({ name: "data.csv", size: 10 }), /Excel/));
t("fileProblem refuses over 10 MB", () => assert.match(fileProblem({ name: "a.xlsx", size: 11 * 1024 * 1024 }), /10 MB/));

console.log(`${passed}/${passed} checks passed`);
