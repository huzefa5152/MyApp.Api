import assert from 'node:assert/strict';
import { defaultFurtherTaxRate } from '../myapp-frontend/src/utils/furtherTax.js';

let checks = 0;
for (const buyer of ['Registered', ' registered ', 'REGISTERED']) {
  for (const scenario of ['SN001', 'SN002', 'SN026', '']) {
    assert.equal(defaultFurtherTaxRate(scenario, buyer), null);
    checks++;
  }
}
for (const buyer of ['Unregistered', null, undefined, '']) {
  assert.equal(defaultFurtherTaxRate('SN002', buyer), 4);
  checks++;
  for (const scenario of ['SN006', 'SN007', 'SN008', 'SN026', 'SN027', 'SN028']) {
    assert.equal(defaultFurtherTaxRate(scenario, buyer), null);
    checks++;
  }
}
console.log(`${checks} checks passed`);
