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
  // Templates that don't define their own @page get a sane print default: a
  // top+bottom page margin (so a multi-page doc doesn't butt page-to-page —
  // page 1 ends with a bottom margin, page 2 starts with a top margin), rows
  // that won't split across a break, and a repeating table header. Skip this
  // when the template already sets @page so we never fight its own layout.
  if (!/@page/i.test(html)) {
    const printCss =
      "<style>@media print{@page{size:A4;margin:12mm;}thead{display:table-header-group;}"
      + "tr,.no-break{page-break-inside:avoid;}}</style>";
    html = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, printCss + "</head>")
      : printCss + html;
  }
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
    triggerPrint();
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
    if (--remaining <= 0) fire();
  };
  pending.forEach((img) => {
    img.addEventListener("load", onSettled);
    img.addEventListener("error", onSettled);
  });
  // Safety net: a stalled or broken image must never hang the print dialog.
  w.setTimeout(fire, timeoutMs);
}
