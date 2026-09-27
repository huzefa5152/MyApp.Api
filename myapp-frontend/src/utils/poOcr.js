// Read a purchase order from a picture: a phone photo, a screenshot, or a
// scanned PDF with no text layer. Runs in the browser with tesseract.js, whose
// engine and English data this site serves itself (public/ocr, copied from
// node_modules by scripts/copy-ocr-assets.mjs) — no third-party CDN.
//
// Only the words and their boxes leave the browser. The server lays them out
// into lines by the same rule a PDF gets, so an image matches the same saved
// PO format as the PDF of that PO (Helpers/PoLayoutText.cs).
//
// Measured on real production POs, and kept that way deliberately:
//  - tesseract is handed a PNG BLOB, never a canvas. The same pixels passed as
//    a canvas read a ruled quotation table as garbage (the rows vanished);
//    passed as a PNG they read at 91% with every row right.
//  - no clean-up of our own. Tesseract's own binarisation, and its re-read of
//    white-on-dark text, beat a hand-rolled threshold + band inversion on every
//    sample (84% and 88% against 69% and 81%).
//  - TWO reads per page, merged (mergeWordSets). Page segmentation mode 4
//    (one column of varying-size text) reads small tokens reliably — a
//    single-digit quantity, an empty column's "-" — but on a low-resolution
//    scan it skipped whole table rows. Mode 11 (sparse text) finds every row
//    but drops one-character words, and with them quantities like "3". The
//    server builds lines from word boxes, so it can use either; together they
//    cover each other. The automatic mode (3) broke ruled tables apart.

export const OCR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const OCR_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
export const MAX_OCR_PAGES = 10;

export const isImageFile = (file) =>
  !!file && (OCR_IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name || ""));

/**
 * How much to enlarge a small image before OCR. Tesseract reads best with text
 * around 25-35 px tall; a phone screenshot of an e-mail is often half that.
 * Anything already 1600 px wide or more is left alone; nothing grows past 2x.
 */
export function upscaleFactor(width) {
  if (!width || width >= 1600) return 1;
  return Math.min(2, 2000 / width);
}

const boxArea = (w) => Math.max(0, w.right - w.left) * Math.max(0, w.bottom - w.top);

/** Share of the smaller box that the two boxes have in common. */
function overlapShare(a, b) {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const smaller = Math.min(boxArea(a), boxArea(b));
  return smaller > 0 ? (x * y) / smaller : 0;
}

/**
 * Both reads of a page, one word per spot. A word of `secondary` that sits on
 * top of a `primary` word (more than 30% of the smaller box shared) replaces it
 * only when it was read with more confidence — the same wrapped description
 * read "AEH DOVBERGTION." (11-26%) by one mode and "40X10 DOUBLE ACTION"
 * (66-97%) by the other. A secondary word on a spot primary never read is
 * added: that is the row primary missed.
 */
export function mergeWordSets(primary, secondary) {
  const merged = [...primary];
  for (const w of secondary) {
    const hits = merged.map((p, i) => [p, i]).filter(([p]) => overlapShare(p, w) > 0.3);
    if (hits.length === 0) { merged.push(w); continue; }
    if (hits.every(([p]) => (w.confidence || 0) > (p.confidence || 0))) {
      for (const [, i] of hits.sort((a, b) => b[1] - a[1])) merged.splice(i, 1);
      merged.push(w);
    }
  }
  return merged;
}

const assetUrl = (name) =>
  new URL(`${import.meta.env.BASE_URL || "/"}ocr/${name}`, window.location.origin).href;

const toPngBlob = (canvas) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not prepare the image."))), "image/png"));

function canvasOf(width, height) {
  const c = document.createElement("canvas");
  c.width = Math.round(width);
  c.height = Math.round(height);
  return c;
}

async function imageToBlob(file) {
  const bitmap = await createImageBitmap(file);
  const s = upscaleFactor(bitmap.width);
  if (s === 1) { bitmap.close?.(); return file; }
  const c = canvasOf(bitmap.width * s, bitmap.height * s);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close?.();
  return toPngBlob(c);
}

// A scanned PDF: its page is usually ONE embedded photo. Enlarging that photo
// ourselves, with high-quality smoothing, read much better than letting the
// PDF renderer stretch it (a 1211-px scan: rows went missing). Any other page
// is rendered at about print resolution (~300 DPI).
async function scanImageBlob(page, pdfjs) {
  const ops = await page.getOperatorList();
  const ids = [];
  for (let i = 0; i < ops.fnArray.length; i++)
    if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) ids.push(ops.argsArray[i][0]);
  if (ids.length !== 1) return null;
  const img = await new Promise((resolve) => page.objs.get(ids[0], resolve));
  if (!img?.bitmap || !img.width) return null;
  const s = upscaleFactor(img.width);
  const c = canvasOf(img.width * s, img.height * s);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img.bitmap, 0, 0, c.width, c.height);
  return toPngBlob(c);
}

async function pdfToBlobs(file) {
  const pdfjs = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const blobs = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_OCR_PAGES); n++) {
      const page = await doc.getPage(n);
      const scan = await scanImageBlob(page, pdfjs);
      if (scan) { blobs.push(scan); continue; }
      const viewport = page.getViewport({ scale: 300 / 72 });
      const c = canvasOf(viewport.width, viewport.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";                     // a scan's page is paper, not transparency
      ctx.fillRect(0, 0, c.width, c.height);
      // intent "print": the display intent paces rendering with
      // requestAnimationFrame, which stops firing when the tab is in the
      // background — an import started and left to run would stall.
      await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
      blobs.push(await toPngBlob(c));
    }
  } finally {
    await doc.destroy();
  }
  return blobs;
}

/**
 * OCR a PO file into pages of words: [[{ text, left, right, top, bottom, confidence }]].
 * `onProgress(fraction 0..1, label)` reports what is happening.
 */
export async function readPoFile(file, onProgress = () => {}) {
  onProgress(0.02, "Preparing the image…");
  const images = isImageFile(file) ? [await imageToBlob(file)] : await pdfToBlobs(file);
  if (images.length === 0) return [];

  onProgress(0.08, "Loading the text reader…");
  const { createWorker } = await import("tesseract.js");
  let page = 0;
  const worker = await createWorker("eng", 1, {
    workerPath: assetUrl("worker.min.js"),
    corePath: assetUrl(""),
    langPath: assetUrl(""),
    gzip: true,
    logger: (m) => {
      if (m.status === "recognizing text")
        onProgress(0.1 + 0.88 * ((step + (m.progress || 0)) / (images.length * 2)),
          images.length > 1 ? `Reading page ${page + 1} of ${images.length}…` : "Reading the text…");
    },
  });
  let step = 0;
  const read = async (image, psm) => {
    await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(image, {}, { blocks: true });
    step++;
    const words = [];
    for (const b of data.blocks || [])
      for (const p of b.paragraphs || [])
        for (const l of p.lines || [])
          for (const w of l.words || [])
            if (w.text && w.text.trim())
              words.push({ text: w.text, left: w.bbox.x0, right: w.bbox.x1, top: w.bbox.y0, bottom: w.bbox.y1, confidence: w.confidence });
    return words;
  };
  try {
    const pages = [];
    for (page = 0; page < images.length; page++)
      pages.push(mergeWordSets(await read(images[page], "4"), await read(images[page], "11")));
    onProgress(1, "Done");
    return pages;
  } finally {
    await worker.terminate();
  }
}

/** Average confidence of the words read, 0-100. */
export const averageConfidence = (pages) => {
  const all = pages.flat();
  return all.length ? Math.round(all.reduce((s, w) => s + (w.confidence || 0), 0) / all.length) : 0;
};
