import { describe, expect, it } from "vitest";
import { mergeTemplate } from "./templateEngine";
import { quoteStarters } from "./starters/quote";
import { defaultQuoteTemplate } from "./salesDocTemplates";

// The Image column prints only when some line has a photo (hasLineImages), and
// then only the lines with a photo show one.
const quote = {
  quoteNumber: 5, date: "2026-10-01", clientName: "Client", subtotal: 100, gstRate: 18, gstAmount: 18, grandTotal: 118, amountInWords: "words",
  items: [
    { sNo: 1, description: "One", quantity: 1, uom: "Pcs", unitPrice: 100, lineTotal: 100 },
    { sNo: 2, description: "Two", quantity: 1, uom: "Pcs", unitPrice: 0, lineTotal: 0 },
  ],
};
const withPhoto = { ...quote, hasLineImages: true, items: [{ ...quote.items[0], imagePath: "/photo/one.jpg" }, quote.items[1]] };
const headers = html => (html.match(/<th[ >]/g) || []).length;
const templates = [...quoteStarters.map(s => [s.name, s.html]), ["default", defaultQuoteTemplate]];

describe.each(templates)("%s", (_, html) => {
  it("has no Image column when no line has a photo", () => {
    const out = mergeTemplate(html, quote);
    expect(out).not.toContain(">Image</th>");
    expect(out).not.toContain("qpic\"");
  });

  it("adds one Image column, with a photo only on the line that has one", () => {
    const plain = mergeTemplate(html, quote), out = mergeTemplate(html, withPhoto);
    expect(headers(out)).toBe(headers(plain) + 1);
    expect(out.match(/qpic"/g)).toHaveLength(2);
    expect(out.match(/<img src="\/photo\/one\.jpg"/g)).toHaveLength(1);
  });
});
