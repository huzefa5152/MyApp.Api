// Bill-form item pickers: which catalog rows a locked scenario shows (offline).
import assert from "node:assert/strict";
import { matchesScenarioSaleType as m } from "../myapp-frontend/src/utils/saleType.js";

const blank = { saleType: null };
const exempt = { saleType: "Exempt Goods" };
const std = { saleType: "Goods at Standard Rate (default)" };

assert.ok(m(blank, "Exempt Goods"), "no sale type fits SN006");
assert.ok(m(blank, "Goods at zero-rate"), "no sale type fits SN007");
assert.ok(m({ saleType: "  " }, "Goods at Reduced Rate"), "whitespace counts as none");
assert.ok(m(exempt, "exempt goods"), "own sale type matches, case-insensitive");
assert.ok(!m(std, "Exempt Goods"), "another scenario's sale type stays out");
assert.ok(!m(exempt, "Goods at Standard Rate (default)"), "exempt item stays out of SN001");
assert.ok(m(std, ""), "no scenario shows everything");
console.log("7 passed, 0 failed");
