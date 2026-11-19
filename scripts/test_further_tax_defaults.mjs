import assert from "node:assert/strict";
import { defaultFurtherTaxRate, isUnregisteredBuyer } from "../myapp-frontend/src/utils/furtherTax.js";
import { furtherTaxFiled, furtherTaxFiledForAll } from "../myapp-frontend/src/utils/furtherTaxFiled.js";

let checks = 0;
for (const buyer of ["Registered", " registered ", "REGISTERED"]) {
  for (const scenario of ["SN001", "SN002", "SN026", ""]) {
    assert.equal(defaultFurtherTaxRate(scenario, buyer), null);
    checks++;
  }
}
for (const buyer of ["Unregistered", null, undefined, ""]) {
  assert.equal(defaultFurtherTaxRate("SN002", buyer), 4);
  checks++;
  for (const scenario of ["SN006", "SN007", "SN008", "SN026", "SN027", "SN028"]) {
    assert.equal(defaultFurtherTaxRate(scenario, buyer), null);
    checks++;
  }
}
// A statement on screen needs a buyer the record SAYS is unregistered.
for (const [type, want] of [["Unregistered", true], [" unregistered ", true], ["CNIC", true],
  ["Registered", false], ["FTN", false], ["", false], [null, false], [undefined, false]]) {
  assert.equal(isUnregisteredBuyer(type), want, String(type));
  checks++;
}

// What a submit confirmation says is being filed.
const four = { furtherTaxRate: 4, furtherTaxAmount: 400 };
const none = { furtherTaxRate: null, furtherTaxAmount: 0 };
assert.equal(furtherTaxFiled(four), "Further tax filed: 4% (Rs 400.00).");
assert.equal(furtherTaxFiled(none), "No further tax is filed on this one.");
assert.equal(furtherTaxFiledForAll([none, none]), "None of them carries further tax.");
assert.equal(furtherTaxFiledForAll([four, none, four]),
  "Further tax is filed on 2 (Rs 800.00 in all) and on none of the other 1.");
assert.equal(furtherTaxFiledForAll([four]), "Further tax is filed on 1 (Rs 400.00 in all).");
checks += 5;

console.log(`${checks} checks passed`);
