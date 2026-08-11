/**
 * Shrink an image File in the browser before uploading it.
 *
 * Phone photos routinely land at 3–5 MB / 4000px wide — far more than a 90pt
 * print thumb or an on-screen preview needs, and enough to bump the server's
 * 5 MB upload cap. Resizing client-side keeps uploads ~100–300 KB with no new
 * dependency (plain canvas) and no server-side image library.
 *
 * Anything that isn't a raster image we can decode (or a GIF, which would lose
 * its animation through a canvas) is returned untouched — the server still
 * validates extension, size and magic bytes.
 */
const DEFAULT_MAX_EDGE = 1200;   // long edge in px — crisp at print thumb sizes
const DEFAULT_QUALITY = 0.85;    // JPEG quality when re-encoding

export default async function downscaleImage(
  file,
  { maxEdge = DEFAULT_MAX_EDGE, quality = DEFAULT_QUALITY } = {}
) {
  if (!file || !file.type?.startsWith("image/")) return file;
  // GIFs can animate; a canvas pass would flatten them to one frame.
  if (file.type === "image/gif") return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    // Already small enough — don't re-encode (avoids a needless quality loss).
    if (scale >= 1) {
      close(bitmap);
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) { close(bitmap); return file; }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    close(bitmap);

    // PNG in → PNG out so transparency survives (a logo on a clear background
    // would otherwise gain a black box). Everything else re-encodes to JPEG.
    const keepPng = file.type === "image/png";
    const mime = keepPng ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, mime, keepPng ? undefined : quality)
    );
    if (!blob) return file;
    // If our "shrunk" version is somehow bigger, keep the original.
    if (blob.size >= file.size) return file;

    const ext = keepPng ? "png" : "jpg";
    const base = (file.name || "image").replace(/\.[^./\\]+$/, "");
    return new File([blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() });
  } catch {
    return file;   // undecodable → let the server have the original + reject it
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") return await createImageBitmap(file);
  // Safari < 15 fallback.
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function close(bitmap) {
  if (bitmap && typeof bitmap.close === "function") bitmap.close();
}
