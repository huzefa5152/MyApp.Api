// Trader: classify bills' FBR filing rows from an HS-code sheet, inside the signed-in app.
// Paste this whole file into javascript_tool once, then call (each returns a SHORT summary):
//   await HSC.plan({ companyId, rows })   rows = sheet_to_rows.py output [[inv, hs, desc, excl], ...]
//     options: names: { "7217.1000": "Iron and steel wire" }  name for an HS code with no catalog item
//              units: { "8544.6020": 48 }   FBR unit id for a NEW code (default: KG if offered, else first)
//              items: { "8302.1090": 123 }  force a catalog item when several share the code
//              overwrite: true              re-classify bills that already have filing rows
//   await HSC.apply({ only: [101] })       saves; omit `only` for every planned bill; stops at first refusal
//   await HSC.verify()                    re-reads every planned bill
// Uses the Invoices screen's own save (PUT /api/invoices/{id}/tax-filing): same server checks, never
// changes the commercial bill, stock or the GL, never sends anything to FBR.
window.HSC = (() => {
  let P = null;
  const H = () => ({
    Authorization: `Bearer ${localStorage.getItem("token")}`,
    "X-Company-Id": String(P.companyId),
    "Content-Type": "application/json",
  });
  const get = (u) =>
    fetch(u, { headers: H() }).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${u}`)),
    );
  const norm = (s) =>
    String(s || "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  const near = (a, b) => b == null || Math.abs(Number(a) - Number(b)) < 0.02;
  const r2 = (x) => Math.round(x * 100) / 100;

  async function plan({ companyId, rows, names = {}, units = {}, items = {}, overwrite = false }) {
    P = {
      companyId,
      bills: [],
      skipped: { classified: [], filed: [], notFound: [], blankHs: [] },
      problems: [],
      codes: {},
    };
    const bills = [];
    for (let p = 1; ; p++) {
      const d = await get(`/api/invoices/company/${companyId}/paged?page=${p}&pageSize=200`);
      bills.push(...d.items);
      if (p >= (d.totalPages || 1)) break;
    }
    const byNo = new Map(bills.map((b) => [b.invoiceNumber, b]));
    const catalog = (await get(`/api/itemtypes?companyId=${companyId}`)).filter((i) =>
      (i.hsCode || "").trim(),
    );
    const sheet = new Map();
    rows.forEach((r) => (sheet.get(r[0]) || sheet.set(r[0], []).get(r[0])).push(r));
    for (const [no, lines] of sheet) {
      if (lines.some((l) => !l[1])) {
        P.skipped.blankHs.push(no);
        continue;
      }
      const b = byNo.get(no);
      if (!b) {
        P.skipped.notFound.push(no);
        continue;
      }
      if (b.fbrStatus === "Submitted" || b.fbrIRN || b.isCancelled) {
        P.skipped.filed.push(no);
        continue;
      }
      const ed = await get(`/api/invoices/${b.id}/tax-filing`);
      if (ed.hasSavedRows && !overwrite) {
        P.skipped.classified.push(no);
        continue;
      }
      const free = [...ed.bill.items],
        groups = {};
      let bad = false;
      for (const [, hs, desc, excl] of lines) {
        let i = free.findIndex(
          (l) => norm(l.description) === norm(desc) && near(l.lineTotal, excl),
        );
        if (i < 0) i = free.findIndex((l) => norm(l.description) === norm(desc));
        if (i < 0) i = free.findIndex((l) => excl != null && near(l.lineTotal, excl));
        if (i < 0) {
          P.problems.push(`${no}: no bill line for "${desc}" ${excl ?? ""}`);
          bad = true;
          break;
        }
        (groups[hs] = groups[hs] || []).push(free.splice(i, 1)[0]);
      }
      if (!bad && free.length) {
        P.problems.push(
          `${no}: bill lines not in the sheet: ${free.map((l) => `"${l.description}" ${l.lineTotal}`).join(", ")}`,
        );
        bad = true;
      }
      if (bad) continue;
      Object.keys(groups).forEach((hs) => (P.codes[hs] = P.codes[hs] || { bills: 0, lines: 0 }));
      Object.entries(groups).forEach(([hs, ls]) => {
        P.codes[hs].bills++;
        P.codes[hs].lines += ls.length;
      });
      P.bills.push({
        no,
        id: b.id,
        groups: Object.fromEntries(
          Object.entries(groups).map(([hs, ls]) => [hs, ls.map((l) => l.id)]),
        ),
      });
    }
    for (const hs of Object.keys(P.codes)) {
      const c = P.codes[hs];
      const match = catalog.filter((i) => i.hsCode.trim() === hs).sort((a, b) => a.id - b.id);
      const it = items[hs] ? match.find((i) => i.id === items[hs]) : match[0];
      if (it)
        Object.assign(c, {
          itemTypeId: it.id,
          item: it.name,
          uom: it.uom,
          fbrUOMId: it.fbrUOMId,
          others: match.length - 1,
        });
      else {
        const hints = await get(`/api/itemtypes/fbr-hints?hsCode=${hs}&companyId=${companyId}`);
        const opts = (hints.uoms || []).map((u) => ({
          id: u.uoM_ID ?? u.uom_ID ?? u.UOM_ID,
          d: u.description,
        }));
        const u =
          opts.find((o) => o.id === units[hs]) || opts.find((o) => /^KG$/i.test(o.d)) || opts[0];
        if (!u) {
          P.problems.push(`${hs}: FBR lists no unit for this code`);
          continue;
        }
        Object.assign(c, {
          itemTypeId: null,
          item: `NEW: ${names[hs] || `Goods under HS ${hs}`}`,
          name: names[hs] || `Goods under HS ${hs}`,
          uom: u.d,
          fbrUOMId: u.id,
          unitChoices: opts.map((o) => `${o.id}:${o.d}`).join(" "),
        });
      }
    }
    return summary();
  }

  const summary = () => ({
    bills: P.bills.length,
    lines: P.bills.reduce((s, b) => s + Object.values(b.groups).flat().length, 0),
    filingRows: P.bills.reduce((s, b) => s + Object.keys(b.groups).length, 0),
    invoices: P.bills.map((b) => b.no).join(","),
    codes: Object.fromEntries(
      Object.entries(P.codes).map(([hs, c]) => [
        hs,
        `${c.bills} bills/${c.lines} lines -> ${c.item} [${c.uom}]${c.others ? ` (+${c.others} other items share this code)` : ""}${c.unitChoices ? ` units: ${c.unitChoices}` : ""}`,
      ]),
    ),
    skipped: Object.fromEntries(
      Object.entries(P.skipped)
        .filter(([, v]) => v.length)
        .map(([k, v]) => [k, v.join(",")]),
    ),
    problems: P.problems,
  });

  async function save(b) {
    const ed = await get(`/api/invoices/${b.id}/tax-filing`);
    const live = new Map(ed.bill.items.map((l) => [l.id, l]));
    const ids = Object.values(b.groups).flat();
    if (ids.length !== live.size || ids.some((id) => !live.has(id)))
      return `${b.no}: the bill's lines changed since the plan`;
    const rows = Object.entries(b.groups).map(([hs, lineIds]) => {
      const c = P.codes[hs],
        ls = lineIds.map((id) => live.get(id));
      return {
        sourceLineIds: lineIds,
        itemTypeId: c.itemTypeId,
        hsCode: hs,
        description: c.name || ls[0].description,
        uom: c.uom,
        fbrUOMId: c.fbrUOMId,
        quantity: ls.reduce((s, l) => s + Number(l.quantity), 0),
        valueExclTax: r2(ls.reduce((s, l) => s + Number(l.lineTotal), 0)),
      };
    });
    const r = await fetch(`/api/invoices/${b.id}/tax-filing`, {
      method: "PUT",
      headers: H(),
      body: JSON.stringify({ version: ed.version, rows }),
    });
    if (r.ok) {
      const saved = await r.json(); // a new code's item now exists: reuse it for the remaining bills
      saved.rows.forEach((x) => {
        const c = P.codes[x.hsCode];
        if (c && !c.itemTypeId) {
          c.itemTypeId = x.itemTypeId;
          delete c.name;
        }
      });
      return null;
    }
    const e = await r.json().catch(() => ({}));
    return `${b.no}: ${r.status} ${e.error || e.message || JSON.stringify(e).slice(0, 200)}`;
  }

  async function apply({ only } = {}) {
    const todo = P.bills.filter((b) => !only || only.includes(b.no));
    let saved = 0;
    for (const b of todo) {
      const err = await save(b).catch((e) => `${b.no}: ${e.message}`);
      if (err) return { saved, stoppedAt: err, notTried: todo.length - saved - 1 };
      saved++;
    }
    return {
      saved,
      newItems: Object.entries(P.codes)
        .filter(([, c]) => c.item.startsWith("NEW"))
        .map(([hs, c]) => `${hs} -> item ${c.itemTypeId}`),
    };
  }

  async function verify() {
    const bad = [];
    for (const b of P.bills) {
      const ed = await get(`/api/invoices/${b.id}/tax-filing`);
      const want = new Map(
        Object.entries(b.groups).flatMap(([hs, ids]) => ids.map((id) => [id, hs])),
      );
      const ok =
        ed.hasSavedRows &&
        !ed.requiresReview &&
        ed.bill.fbrReady &&
        ed.rows.every((r) => r.sourceLineIds.every((id) => want.get(id) === r.hsCode)) &&
        ed.rows.flatMap((r) => r.sourceLineIds).length === want.size &&
        near(
          ed.rows.reduce((s, r) => s + r.valueExclTax, 0),
          ed.bill.subtotal,
        );
      if (!ok)
        bad.push(
          `${b.no}${ed.hasSavedRows ? "" : " (not saved)"}${ed.bill.fbrReady ? "" : " (not FBR-ready)"}`,
        );
    }
    return { checked: P.bills.length, bad };
  }

  return {
    plan,
    apply,
    verify,
    get state() {
      return P;
    },
  };
})();
("HSC ready");
