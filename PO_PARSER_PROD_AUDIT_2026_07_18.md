# PO Parser — Production PDF Audit & Fix (2026-07-18)

**Scope:** every PO PDF ever uploaded to production (`hakimitraders.runasp.net`) —
**124 `ok` + 1 `no-format` = 125 archives** — re-parsed read-only against a local
backend on the prod-replica DB `db46684`, comparing the **new generic
(column-primary) parser** on `master` HEAD `77cefb5` against the **parser
production currently runs** (parent `2577301`, adjacency-primary).

**Verdict:** the generic commit, as cherry-picked, **regresses 98 of 125
historical POs** (78%). Root cause identified; a targeted fix is implemented and
validated. After the fix, **124/125 match the production-proven output exactly and
1 is a genuine improvement — 0 regressions**, with the offline corpus still green.

---

## 1. Headline numbers

Re-parsing all 125 archived PDFs, **NEW (column-primary, `77cefb5`)** vs
**OLD (adjacency, what prod runs today):**

| Verdict | Count |
|---|---:|
| **NEW regressed** (wrong description and/or wrong quantity, or rows dropped) | **98** |
| OK — NEW identical to OLD | 26 |
| NEW improved over OLD | 1 |
| **Total** | **125** |

By matched format:

| Format | PDFs | Regressed by NEW | Notes |
|---|---:|---:|---|
| **Meko Denim/Fabrics PO** | 75 | **75** | all garbled |
| **Meko Fabric PO** | 9 | **9** | all garbled |
| **Meko Fabric Pvt Ltd** | 5 | **5** | all garbled |
| **Innovative Aqua** | 6 | **6** | all garbled |
| **Lotte Kolson PO** | 30 | 3 | only the "Non-Inventory Items" sub-layout; other 26 identical, 1 improved |
| Soorty Enterprises PO | 0 | — | no Soorty POs in the archive |

Companies: Hakimi (1) = 53, Roshan (2) = 71, other (3) = 1.

---

## 2. What "regressed" looks like (concrete rows)

The column reader mis-maps the **description onto the Unit column** and the
**quantity onto the Rate column**:

```
#123 Meko Denim   NEW: 'PC'#215      'TIN'#5640    'PC'#180
                  OLD: 'S.S JUBLEE CLIP 2"'#10   'SAMAD'#3   'S.S JUBLEE CLIP 1 1/2"'#10
#4   Meko Denim   NEW: 'PC'#1050  'PKT'#1200  'KG'#240  'PC'#550  'LTR'#140 …
                  OLD: 'PIPETTE SUCKER'#1  'SURGICAL GLOVES'#3  'MOLASSES GURH'#100 …
#25  Innovative   NEW: 'PCS'#58000
                  OLD: 'AC GAS R 410 (HONEYWELL)'#1
#77  Meko Fab Pvt NEW: 'RFT'#28
                  OLD: 'PNEUMATIC PIPE 6X4MM'#50
#79  Lotte NonInv NEW: 2 items (both wrong qty)   OLD: 9 correct items
```

Every regressed row has **both** a wrong description and a wrong quantity — exactly
the "wrong description / wrong quantity" complaint this audit was asked to hunt.

---

## 3. Root cause

The generic reader (`ExtractSimpleItemsByColumns`) reads each field by the **column
index of its header** and assumes **every header column is also present in every
data row**. Real production layouts break that assumption and shift the data
columns left of the header:

1. **Meko Denim/Fabric + Innovative Aqua** — the header prints `Code | Item Name`
   as two columns, but data rows print the item **code merged into the name cell**
   (`33010072 S.S JUBLEE CLIP 2"` — single space, no column boundary). So the
   header's `Item Name` index lands on the **Unit** cell (`PC`) and the `Qty`
   index lands on the **Rate** cell (`215.00`).
2. **Lotte "Non-Inventory Items"** — the header has a `Required Delivery Date`
   column that is **blank in the data rows**, so everything after the description
   shifts one column left; `Qty` lands on the `Unit` cell. Rows whose unit is a
   recognised UOM get skipped entirely (9 → 2).

Both Rate and Qty are numbers, so the reader's "is the quantity cell a number?"
guard passes on the *wrong* cell and never notices the shift. The tuned
**adjacency scanner** (`ExtractSimpleItems`) is immune because it anchors on the
**Unit↔Quantity adjacency** (`PC 10`), not on header positions — which is why
production, running the adjacency scanner, has always parsed these correctly.

Why it was silent: `77cefb5` made the column reader **primary** and demoted
adjacency to a fallback that only runs when the column reader returns **zero**
items. Meko returns 3 (garbage) items, so the fallback never fired.

A second, latent bug surfaced while validating the fix: the `77cefb5` rewrite of
`SimpleStopRegex` dropped the bare `Total <amount>` (line-end) and
`Sales Tax Amount` footer markers, so those totals **leaked into the last item's
description** in the adjacency path. Masked before (adjacency wasn't used for
Meko); fixed here too.

---

## 4. Decision & fix

Options considered:

- **(a) keep column-primary everywhere** — rejected: regresses 98/125.
- **(b) fix the column mapping for the offending formats** — rejected: the shift
  is caused by *blank/merged data cells*, which are unknowable from the header; a
  robust generic realignment is fragile and high-risk against the 262-case corpus.
- **(c) prefer the tuned adjacency scanner for the production-shaped layouts,
  column-primary elsewhere** — **chosen**, implemented automatically (no
  hard-coded format IDs, portable across branches):

**Implementation** (`Services/Implementations/RuleBasedPOParser.cs`):
when a unit header is configured, run **both** extractors and keep whichever
produces **more plausible items** — a description that reads as a real product
name rather than a bare UOM token (`PC`/`PCS`/`TIN`/`RFT`), a UOM-led string, or a
leaked price run. On a well-aligned table both agree, so the column reader (and
its wins, e.g. a quantity buried in the description) is preserved; only when the
column reader is degenerate does adjacency win. Plus the two footer stop-markers
restored.

This keeps the generic reader's benefit for varied/customer PDFs while restoring
the production-proven behaviour on the tuned formats — the best of both.

---

## 5. Validation (all local, nothing pushed)

| Check | Result |
|---|---|
| Backend compiles (`dotnet build MyApp.Api.csproj -c Release`) | **0 errors** |
| Offline corpus harness (`scripts/po_parser_harness`) | **ALL PASSED** — 197/197 diverse, 57/65 adversarial (8 tolerated, unchanged), **8/8 new production-format cases**, 3/3 real |
| Fixed parser vs OLD across all 125 prod PDFs (source-linked offline reparse) | **124 identical to prod-proven output, 1 improved (#101), 0 regressions** |

The single "improvement" (#101, Lotte) is preserved by the fix: NEW correctly
reads a quantity buried in the description — `Polyfax Skin Ointment Tube 20 Gram`
**×6** where OLD wrongly returned `Polyfax Skin Ointment Tube` **×20**.

Verified via a source-linked offline reparse tool (same `RuleBasedPOParser.cs`,
same custom PdfPig extraction as the backend) so the running dev backend did **not**
need restarting. **Deploying the fix requires a normal rebuild + backend restart.**

---

## 6. Did the generic commit fix the historical complaints?

**No — the opposite.** Production's current adjacency parser already returns
correct descriptions/quantities for **all 125** archived POs. The generic commit,
deployed as-is, would have **broken 98** of them (garbled descriptions + wrong
quantities on every Meko/Innovative import and the Lotte non-inventory layout).
The value of the generic commit is for **new / varied customer layouts** the
adjacency scanner can't handle — not the existing tuned formats. The fix in §4
unlocks that value without the regression.

---

## 7. Recommendation

1. **Adopt the fix** (option c, already implemented + validated) before this
   parser change ever reaches production. Do **not** deploy `77cefb5`'s parser
   without it.
2. **Pre-deploy gate** (per `CLAUDE.md`): rebuild, restart the backend, and re-run
   both the offline harness *and* the production read-only check (now with full
   per-item output) — both green.
3. Long term, consider teaching the column reader to detect the header/data
   column-count shift directly (a leading `Code` column merged into the name, or a
   blank middle column) so it degrades gracefully rather than relying on the
   adjacency fallback — but that is an enhancement, not required for correctness.

---

## 8. Tooling produced (local, git-ignored where it holds customer PDFs)

| Path | Purpose |
|---|---|
| `scripts/po_parser_prod_dump.py` | Extends the mandated §5b check: downloads every prod PDF (read-only) and dumps the **full per-item** output (desc/qty/unit/format) for NEW, and optionally a second OLD backend, with new-vs-old diffs. Rate-limit aware. |
| `scripts/po_parser_prod_classify.py` | Classifies every PDF (OK / regressed / improved) and groups by format with concrete bad rows. |
| `scripts/pdf_text_dump/` | Offline PdfPig text extractor (verbatim copy of `POParserService`, same custom PdfPig) — inspect any PDF's exact column text without the rate-limited endpoint. |
| `scripts/po_parser_offline_reparse/` | Runs the **source-linked** parser against real PDFs offline — verify a parser change against production PDFs with no backend restart. |
| `scripts/po_parser_harness/corpus/production_formats_corpus.json` | 8 new regression cases (Meko Denim/Fabric, Meko Fabric Pvt, Innovative, Lotte non-inventory) pinned to the correct output. |
| `scripts/_prod_dump_out/` | Downloaded PDFs + `dump.json` / `classified.json` / `report.txt`. **git-ignored** (client-confidential). |

### Measurement note (important for anyone re-running)
The first bulk run appeared to show 105 PDFs matching **no format**. That was a
**false alarm**: `parse-pdf` is rate-limited (`import` policy = 10 req / 1-min
window, `QueueLimit 0`), and the burst of 125 requests hit `429`s that the naive
script miscounted as misses. The dump script now paces requests and retries `429`.
Format matching is fine — all 125 match.

### Cleanup pending your OK
- The read-only re-parse wrote ~246 append-only rows to `db46684.PoImportArchives`
  (Id > 125). Harmless (the analysis lists from prod, not local; this is the
  documented behaviour of the prod-check tool) but I can delete `Id > 125` to
  restore the replica if you want.
