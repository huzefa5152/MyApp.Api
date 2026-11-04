/**
 * Stamp images are private, so the server sends them no-store and checks the company on every request:
 * a signature must not sit in the browser's disk cache after logout. That made every preview and print
 * download the stamp again. Holding the bytes in page memory avoids that without weakening the server:
 * nothing reaches disk, a reload or new login starts empty, and an image is only reused for a stamp the
 * company's stamp list, re-checked on each load, still returns.
 */

// Beyond this the page keeps using the URL: a data URL this size would be copied into every document.
export const MAX_INLINE_STAMP_BYTES = 1024 * 1024;

const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** The stamp's image as a data URL, from `cache` when this version is held; null to keep using its URL. */
export async function loadStampImage(stamp, cache, fetchImage = fetch) {
  const key = `${stamp.id}|${stamp.url}|${stamp.updatedAt}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const response = await fetchImage(stamp.url, { credentials: "same-origin" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > MAX_INLINE_STAMP_BYTES) return null;
    const dataUrl = await readAsDataUrl(blob);
    cache.set(key, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/** What an <img> or a print should use: the held image, else the URL. `v` shows a replaced image. */
export const stampImageSrc = (stamp) =>
  stamp?.image ||
  (stamp?.url && stamp.updatedAt
    ? `${stamp.url}?v=${encodeURIComponent(stamp.updatedAt)}`
    : stamp?.url || null);
