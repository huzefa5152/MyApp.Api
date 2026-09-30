// Copies the OCR engine (tesseract.js worker + LSTM wasm cores) and the English
// language data from node_modules into public/ocr, so the PO image import runs
// entirely from this site: no third-party CDN at runtime, and the same files
// in every environment. public/ocr is gitignored — npm ci + this script rebuild
// it on every build. Runs as part of predev / prebuild.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const out = join(root, "public", "ocr");
mkdirSync(out, { recursive: true });

const files = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  // OEM 1 (LSTM only) loads just the -lstm cores; the simd one is picked when
  // the browser supports WebAssembly SIMD.
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm", "tesseract-core-lstm.wasm"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
];

for (const [from, to] of files) {
  const src = join(nm, from);
  if (!existsSync(src)) throw new Error(`OCR asset missing: ${from} — run npm install`);
  copyFileSync(src, join(out, to));
}
console.log(`OCR assets copied to public/ocr (${files.length} files)`);
