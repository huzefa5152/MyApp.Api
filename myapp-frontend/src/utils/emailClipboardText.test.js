// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { emailClipboardText } from "./emailClipboardText";
describe("email clipboard", () => {
  it("preserves blank price and brand cells", () => {
    expect(emailClipboardText('<table><tr><td>Item</td><td>Qty</td><td>Brand</td><td>Rate</td></tr><tr><td>Bolt 16 mm</td><td>20</td><td></td><td></td></tr></table>')).toContain('Bolt 16 mm\t20\t\t');
  });
  it("does not run scripts or copy tracking images", () => {
    expect(emailClipboardText('<table><tr><td>Item<script>throw 1</script><img src="https://example.invalid/pixel"></td><td>Qty</td></tr><tr><td>Nut</td><td>5</td></tr></table>')).toBe('\nItem\tQty\nNut\t5');
  });
  it("keeps subject and brand requirements", () => {
    expect(emailClipboardText('<table><tr><td>Item</td><td>Qty</td></tr></table>', 'Subject: Enquiry 99\nPlease mention brand name\nRegards')).toContain('Subject: Enquiry 99\nPlease mention brand name');
  });
  it("leaves plain paste unchanged", () => { expect(emailClipboardText('', '1. Nut - 5 Pcs')).toBeNull(); });
  it("leaves unrelated HTML unchanged", () => { expect(emailClipboardText('<p>Hello</p>')).toBeNull(); });
});
