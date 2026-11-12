// Bill-form item pickers: which catalog rows a locked scenario shows (offline).
import assert from "node:assert/strict";
import { matchesScenarioSaleType as m } from "../myapp-frontend/src/utils/saleType.js";

const blank = { saleType: null };
const exempt = { saleType: "Exempt Goods" };
const std = { saleType: "Goods at Standard Rate (default)" };
const stdForm = { saleType: "Goods at standard rate (default)" }; // the Item Type form's casing

assert.ok(m(blank, "Exempt Goods"), "no sale type fits SN006");
assert.ok(m(blank, "Goods at zero-rate"), "no sale type fits SN007");
assert.ok(m({ saleType: "  " }, "Goods at Reduced Rate"), "whitespace counts as none");
assert.ok(m(std, "Exempt Goods"), "standard-rate default fits SN006");
assert.ok(m(stdForm, "Goods as per SRO.297(|)/2023"), "form's default casing fits SN024");
assert.ok(m(exempt, "exempt goods"), "own sale type matches, case-insensitive");
assert.ok(!m(exempt, "Goods as per SRO.297(|)/2023"), "another special sale type stays out");
assert.ok(
  m(exempt, "Goods at Standard Rate (default)") === false,
  "exempt item stays out of SN001",
);
assert.ok(m(std, ""), "no scenario shows everything");
console.log("9 passed, 0 failed");
