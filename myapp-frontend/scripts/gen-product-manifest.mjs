// Generates src/generated/product-manifest.json from public/images/products.
// The landing page uses this as a static fallback when /api/product-images
// is unreachable (e.g. frontend-only dev, or an API hiccup in prod).
// Runs automatically via the predev / prebuild npm hooks.
import { readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const productsDir = path.join(here, "..", "public", "images", "products");
const outDir = path.join(here, "..", "src", "generated");
const outFile = path.join(outDir, "product-manifest.json");

const exts = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"]);
const manifest = {};

try {
  for (const entry of readdirSync(productsDir)) {
    const full = path.join(productsDir, entry);
    if (!statSync(full).isDirectory()) continue;
    const images = readdirSync(full)
      .filter((f) => exts.has(path.extname(f).toLowerCase()))
      .sort()
      .map((f) => `/images/products/${entry}/${f}`);
    if (images.length > 0) manifest[entry] = images;
  }
} catch {
  // products folder missing — emit an empty manifest so the import never breaks
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `product-manifest.json: ${Object.keys(manifest).length} categories, ` +
    `${Object.values(manifest).reduce((n, a) => n + a.length, 0)} images`
);
