// Templates that don't define their own @page get a sane print default: a
// top+bottom page margin (so a multi-page doc doesn't butt page-to-page —
// page 1 ends with a bottom margin, page 2 starts with a top margin), rows
// that won't split across a break, and a repeating table header. Skip this
// when the template already sets @page so we never fight its own layout.
// Break-avoidance is injected unconditionally — a template defining its own
// @page used to suppress it entirely, which is how the FBR box ended up
// split across pages. The @page default is still skipped when the template
// sets one, so we never fight its own page geometry.
export function withPrintCss(html) {
  const pageCss = /@page/i.test(html)
    ? ""
    : "@page{size:A4;margin:12mm;}thead{display:table-header-group;}";
  const printCss =
    "<style>@media print{" + pageCss
    + "tr,img,.no-break{page-break-inside:avoid;break-inside:avoid;}}</style>";
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, printCss + "</head>")
    : printCss + html;
}


// A big signature scan (multi-MB PNG) paints progressively in Chrome's print
// preview, so the stamp prints as only its top strip. Re-encode anything large
// to a small bitmap first; the printed size is a few mm, so nothing is lost.
const MAX_PRINT_IMG_PX = 700;
async function shrinkLargeImages(imgs) {
  await Promise.all(imgs.map(async (img) => {
    try {
      if (img.decode) await img.decode();
      const { naturalWidth: nw, naturalHeight: nh } = img;
      if (!nw || !nh || Math.max(nw, nh) <= MAX_PRINT_IMG_PX) return;
      const k = MAX_PRINT_IMG_PX / Math.max(nw, nh);
      const c = img.ownerDocument.createElement("canvas");
      c.width = Math.round(nw * k);
      c.height = Math.round(nh * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      img.src = c.toDataURL("image/png");
      if (img.decode) await img.decode();
    } catch { /* tainted or unreadable: print the original */ }
  }));
}

/**
 * Write merged print HTML into an already-open popup window and trigger the
 * browser print dialog only AFTER every image (logo) has finished loading.
 *
 * Why the wait matters: printing immediately after document.write() races the
 * asynchronous image load. A logo rendered as a full-width / auto-height <img>
 * has ZERO intrinsic height until its bytes arrive, so it lays out at 0px and
 * prints blank — while the surrounding text appears, because text lays out
 * synchronously.
 *
 * The caller opens the popup BEFORE awaiting print data (so the synchronous
 * user-gesture isn't swallowed by the popup blocker), then hands the window
 * here once the merged HTML is ready.
 *
 * @param {Window} w     popup window opened by the caller (may be null/closed)
 * @param {string} html  merged template HTML (already run through mergeTemplate)
 * @param {{timeoutMs?: number}} [opts]  max wait before printing anyway
 */
export function writeAndPrint(w, html, { timeoutMs = 5000 } = {}) {
  if (!w || w.closed) return;
  if (/data-print-letterhead-top\s*=/i.test(html)) {
    import("./exportUtils").then(({ prepareLetterheadPrint }) => prepareLetterheadPrint(html))
      .then(prepared => writeAndPrint(w, prepared, { timeoutMs }))
      .catch(() => { if (!w.closed) w.document.body.textContent = "This document could not fit the letterhead area. Adjust the template or shorten an oversized row and retry."; });
    return;
  }
  html = withPrintCss(html);
  w.document.open();
  w.document.write(html);
  w.document.close();

  const triggerPrint = () => {
    if (w.closed) return;
    w.focus();
    w.onafterprint = () => w.close();
    w.print();
  };

  const imgs = Array.from(w.document.images || []);
  const pending = imgs.filter((img) => !img.complete);
  if (pending.length === 0) {
    // `complete` can be true while a large image (the stamp) is only partly
    // decoded; printing then rasterises its top half. Wait for decode().
    if (imgs.length === 0) { triggerPrint(); return; }
    let done = false;
    const go = () => { if (!done) { done = true; triggerPrint(); } };
    shrinkLargeImages(imgs).then(go);
    w.setTimeout(go, timeoutMs);
    return;
  }

  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    triggerPrint();
  };
  let remaining = pending.length;
  const onSettled = () => {
    if (--remaining <= 0) {
      shrinkLargeImages(imgs).then(fire);
    }
  };
  pending.forEach((img) => {
    img.addEventListener("load", onSettled);
    img.addEventListener("error", onSettled);
  });
  // Safety net: a stalled or broken image must never hang the print dialog.
  w.setTimeout(fire, timeoutMs);
}
