/** Opt-in measured pages. Existing templates keep their current print layout. */
export async function paginateInvoice(root) {
  const source = root.querySelector('[data-invoice-pages]:not([data-paginated])');
  if (!source) return [];
  const doc = source.ownerDocument;
  await doc.fonts?.ready;
  await Promise.all(Array.from(source.querySelectorAll('img')).map(img =>
    img.complete ? Promise.resolve() : new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 5000);
    })));
  const table = source.querySelector('[data-item-table]');
  const rows = Array.from(table.tBodies[0].rows);
  const pages = [];
  const host = doc.createElement('div');
  source.after(host);
  const copy = selector => source.querySelector(selector)?.cloneNode(true);
  function addPage() {
    const page = doc.createElement('section');
    page.className = 'invoice-sheet';
    const heading = copy(pages.length ? '[data-continuation]' : '[data-invoice-header]');
    if (heading) { heading.removeAttribute("hidden"); page.append(heading); }
    const grid = table.cloneNode(true);
    grid.tBodies[0].replaceChildren();
    grid.querySelectorAll('tfoot').forEach(el => el.remove());
    page.append(grid);
    const bottom = copy('[data-letter-footer]');
    if (bottom) page.append(bottom);
    host.append(page);
    const entry = { page, grid, bottom };
    pages.push(entry);
    return entry;
  }
  function fits(entry) {
    return entry.page.scrollHeight <= entry.page.clientHeight + 1;
  }
  try {
    let entry = addPage();
    for (const row of rows) {
      const clone = row.cloneNode(true);
      entry.grid.tBodies[0].append(clone);
      if (!fits(entry)) {
        clone.remove();
        if (!entry.grid.tBodies[0].rows.length) throw new Error('An invoice item is taller than the available page. Shorten its description or adjust the print layout.');
        entry = addPage(); entry.grid.tBodies[0].append(clone);
        if (!fits(entry)) throw new Error('An invoice item cannot fit intact on a continuation page.');
      }
    }
    const closing = copy('[data-invoice-closing]');
    const signature = copy('[data-final-signature]');
    const appendEnding = e => {
      if (closing) e.page.insertBefore(closing, e.bottom || null);
      if (signature) e.page.insertBefore(signature, e.bottom || null);
    };
    appendEnding(entry);
    if (!fits(entry)) {
      closing?.remove(); signature?.remove();
      entry = addPage(); appendEnding(entry);
      // Bring trailing rows forward when the final-page closing block leaves room.
      const previous = pages[pages.length - 2];
      while (previous.grid.tBodies[0].rows.length) {
        const row = previous.grid.tBodies[0].lastElementChild;
        entry.grid.tBodies[0].prepend(row);
        if (!fits(entry)) { previous.grid.tBodies[0].append(row); break; }
      }
      if (!fits(entry)) throw new Error('The invoice closing/signature area is too tall for one page.');
      if (!previous.grid.tBodies[0].rows.length && pages.length > 2) {
        previous.page.remove(); pages.splice(pages.length - 2, 1);
      }
    }
    pages.forEach((e, i) => {
      e.page.querySelectorAll('[data-page-number]').forEach(n => { n.textContent = `Page ${i + 1} of ${pages.length}`; });
      e.page.dataset.invoicePage = String(i + 1);
    });
    source.hidden = true;
    source.dataset.paginated = 'true';
    return pages.map(e => e.page);
  } catch (error) { host.remove(); throw error; }
}
