import { expect, it } from "vitest";
import { mergeTemplate, MERGE_FIELDS } from "./templateEngine";
const template = '<html><head></head><body>{{#if challanNumbers}}DC: {{join challanNumbers}}{{/if}}<p>{{manualChallanNumber}}</p></body></html>';
it("existing challan fields render a standalone reference without changing a saved template", () => {
  const html = mergeTemplate(template, { challanNumbers: ["DC-00212"], manualChallanNumber: "DC-00212" });
  expect(html).toContain("DC: DC-00212");
  expect(html).toContain("<p>DC-00212</p>");
  expect(mergeTemplate(template, { challanNumbers: [] })).not.toContain("DC:");
  expect(mergeTemplate(template, { challanNumbers: [12, 13] })).toContain("DC: 12, 13");
});
it("manual references are escaped and both template pickers expose the field", () => {
  expect(mergeTemplate(template, { challanNumbers: ['<b>212</b>'] })).toContain("&lt;b&gt;212&lt;/b&gt;");
  for (const type of ['Bill', 'TaxInvoice']) expect(MERGE_FIELDS[type].some(f => f.field === '{{manualChallanNumber}}')).toBe(true);
});
