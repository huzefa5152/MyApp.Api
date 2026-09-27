// Offline checks for the PO picture import's pure helpers.
//   node scripts/test_po_ocr.mjs
import assert from "node:assert/strict";
import { isImageFile, upscaleFactor, averageConfidence, mergeWordSets, OCR_ACCEPT } from "../myapp-frontend/src/utils/poOcr.js";

let passed = 0;
const t = (label, fn) => { fn(); passed++; };

t("a PNG is a picture", () => assert.equal(isImageFile({ name: "po.png", type: "image/png" }), true));
t("a JPG named without a type is a picture", () => assert.equal(isImageFile({ name: "IMG_2031.JPG", type: "" }), true));
t("a PDF is not a picture (it tries its text layer first)", () => assert.equal(isImageFile({ name: "po.pdf", type: "application/pdf" }), false));
t("nothing is not a picture", () => assert.equal(isImageFile(null), false));
t("the file picker offers PDFs and pictures", () => assert.equal(OCR_ACCEPT, ".pdf,.png,.jpg,.jpeg,.webp"));
t("a print-resolution page is not enlarged", () => assert.equal(upscaleFactor(2480), 1));
t("a phone screenshot is enlarged", () => assert.ok(upscaleFactor(738) > 1.9));
t("enlargement is capped at 2x", () => assert.equal(upscaleFactor(300), 2));
t("average confidence over every page", () => assert.equal(averageConfidence([[{ confidence: 90 }], [{ confidence: 70 }, { confidence: 80 }]]), 80));
t("average confidence of nothing is 0", () => assert.equal(averageConfidence([[]]), 0));

const box = (text, left, top, w = 40, h = 14) => ({ text, left, right: left + w, top, bottom: top + h, confidence: 90 });
t("merge keeps every primary word", () => {
  const m = mergeWordSets([box("3", 100, 10, 8), box("Widget", 10, 10)], []);
  assert.deepEqual(m.map((w) => w.text), ["3", "Widget"]);
});
t("merge adds a secondary word from a row the primary missed", () => {
  const m = mergeWordSets([box("Widget", 10, 10)], [box("PIECE", 300, 50)]);
  assert.deepEqual(m.map((w) => w.text), ["Widget", "PIECE"]);
});
t("merge keeps the primary word when it reads the spot as well or better", () => {
  const m = mergeWordSets([box("5.00", 300, 50)], [{ ...box("5.0O", 302, 51), confidence: 40 }]);
  assert.deepEqual(m.map((w) => w.text), ["5.00"]);
});
t("merge takes the secondary word where it read the spot with more confidence", () => {
  const m = mergeWordSets([{ ...box("DOVBERGTION.", 300, 50, 120), confidence: 26 }],
                          [{ ...box("DOUBLE", 300, 50, 60), confidence: 90 }]);
  assert.deepEqual(m.map((w) => w.text), ["DOUBLE"]);
});
t("merge keeps a secondary word that only touches a primary one", () => {
  const m = mergeWordSets([box("PIECE", 300, 50)], [box("Rs", 341, 50, 20)]);
  assert.equal(m.length, 2);
});

console.log(`${passed}/${passed} checks passed`);
