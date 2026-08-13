# Stamps on print templates — implementation guide

How a company stamp gets attached to a print template, changed, previewed and
carried through copy / starter / import — and how to build it so the **same
change lands on `master` and on `customize-solution-for-other`** with minimal
per-branch work.

Base stamps feature (upload / rename / delete, `{{stamps.<slug>}}`) already
exists on both branches. This guide covers only what sits on top of it.

---

## 1. What we are building

| # | Requirement | Surface |
|---|---|---|
| 1 | Existing templates start with **no stamp**; the operator opts in | template list + editor |
| 2 | Change which stamp a template uses, without editing HTML | list card + editor header |
| 3 | Preview the template **with** the stamp before saving | preview pane / A4 frame |
| 4 | Starter apply offers a stamp choice | apply / create-from-starter modal |
| 5 | HTML import offers a stamp choice | editor import handler |
| 6 | Copy of a template keeps the original's stamp state, then is independently changeable | copy modal |
| 7 | Multiple stamps per company are selectable everywhere a stamp is chosen | shared picker |

**Explicitly not in scope:** no backfill. Every existing row keeps
`StampId = NULL`. The two production templates already converted by
`scripts/convert_template_stamps.py` (ids 15 and 14) reference
`{{stamps.signature_one}}` directly — they are `pinned` (§4) and keep working
untouched.

---

## 2. Portability strategy (read this before writing code)

The two branches have diverged hard on exactly the files this touches:

| File | master | customize-solution-for-other |
|---|---|---|
| `Models/PrintTemplate.cs` | no scope column | has `DivisionId` (division-scoped templates) |
| `hooks/usePrintTemplates.js` | simple | module cache, cross-screen invalidation, division scope |
| `pages/PrintTemplatesPage.jsx` | 467 lines | 661 lines |
| `pages/TemplateEditorPage.jsx` | 881 lines | 907+ lines, restructured |

**Rule: all behaviour goes in new files that are byte-identical on both
branches. Per-branch work is limited to short wiring edits at documented
anchors.** Anything that needs a branch-specific `if` is a design smell — push
it behind a parameter instead.

Two hard constraints that follow:

- **Nothing new may reference `DivisionId`.** Scope is a `PrintTemplate`
  concern, not a stamp concern. If stamp code never reads scope, the same code
  compiles on both branches.
- **Nothing new may assume page structure.** The picker is a component that
  takes props; the pages just render it.

### New shared files (identical bytes on both branches)

| File | Contains |
|---|---|
| `Helpers/StampSlot.cs` | server-side: detect state, inject block, pinned→slot conversion. Pure string ops, no EF, no DbContext |
| `myapp-frontend/src/utils/stampSlot.js` | client-side twin: `detectStampState`, `injectSignatureBlock`, `convertPinnedToSlot`, `materializeStamp` |
| `myapp-frontend/src/Components/templateEditor/StampPicker.jsx` | the "None + thumbnails" control, used by all four surfaces |
| `myapp-frontend/src/Components/templateEditor/AddSignatureBlockModal.jsx` | preview-before-apply for block injection |
| `scripts/test_stamp_slots.py` | integration tests for the new endpoints |

### Per-branch wiring points (short, listed in §9)

`Models/PrintTemplate.cs`, the DTOs, `PrintTemplatesController`, one line in
`usePrintTemplates.js`, and the three UI call sites. Everything else is shared.

---

## 3. Data model

Two additive columns. Both nullable / defaulted, so no backfill and no
downtime.

```csharp
// Models/PrintTemplate.cs  (+1 property, per branch)
// The stamp this template renders in its {{stamp}} slot. NULL = no stamp,
// which is the state every pre-existing template starts in.
public int? StampId { get; set; }
public CompanyStamp? Stamp { get; set; }
```

```csharp
// Models/CompanyStamp.cs  (+1 property, shared)
// Exactly one default per company. Used when a template has no explicit
// StampId but the design has a slot — notably the built-in fallback
// templates in defaultTemplates.js, which have no PrintTemplate row at all.
public bool IsDefault { get; set; }
```

`AppDbContext` (per branch — the surrounding block differs):

```csharp
modelBuilder.Entity<PrintTemplate>()
    .HasOne(pt => pt.Stamp)
    .WithMany()
    .HasForeignKey(pt => pt.StampId)
    .OnDelete(DeleteBehavior.SetNull);   // deleting a stamp must not delete templates

modelBuilder.Entity<CompanyStamp>()
    .HasIndex(s => s.CompanyId, "UX_CompanyStamps_DefaultPerCompany")
    .IsUnique()
    .HasFilter("[IsDefault] = 1");
```

`SetNull` is the important one: deleting a stamp degrades affected templates to
"no signature" instead of leaving a broken image on every print. That is
strictly better than today's `{{stamps.<slug>}}`, which silently 404s.

> **Migration must be generated separately on each branch.** The model
> snapshots differ (`DivisionId`). Never copy a migration file across —
> `dotnet ef migrations add AddPrintTemplateStamp` on each. Build first;
> `--no-build` against a stale assembly produces an empty or wrong migration.

---

## 4. The token model and the three states

Two tokens, deliberately:

| Token | Meaning | Who uses it |
|---|---|---|
| `{{stamp}}` | "the stamp assigned to this template" | the normal case; dropdown-controlled |
| `{{stamps.<slug>}}` | one specific named stamp | documents needing **two** signatures (director *and* accountant), and already-converted templates |

Every template is in exactly one state, derived from its HTML:

| State | Detected by | UI behaviour |
|---|---|---|
| `slotted` | contains `{{stamp}}` | picker live: assign / change / none, instant |
| `pinned` | contains `{{stamps.<slug>}}` and no `{{stamp}}` | shows the named stamp; offers **Convert to slot** |
| `none` | neither | picker disabled; offers **Add signature block** |

Detection is a regex, computed server-side and returned on the DTO so the UI
never has to parse HTML it may not have loaded (the branch's list endpoint
returns metadata only — see §7).

```csharp
// Helpers/StampSlot.cs  — shared, pure
public static readonly Regex SlotToken   = new(@"\{\{\s*stamp\s*\}\}", RegexOptions.Compiled);
public static readonly Regex PinnedToken = new(@"\{\{\s*stamps\.([a-z0-9_]+)\s*\}\}", RegexOptions.Compiled);

public static string Detect(string html) =>
    string.IsNullOrEmpty(html)      ? "none"
    : SlotToken.IsMatch(html)       ? "slotted"
    : PinnedToken.IsMatch(html)     ? "pinned"
                                    : "none";
```

The standard block injected into starters and by "Add signature block":

```html
{{#if stamp}}<img class="stamp-img" src="{{stamp}}" alt="">{{/if}}
```

with, in the template's CSS:

```css
.stamp-img { height: 90px; max-width: 220px; object-fit: contain; }
```

The `max-width` + `object-fit` matter — the two production stamps are 360×139
and 340×138, but nothing stops the next upload being 1200px wide and blowing
out the signature row.

---

## 5. Rendering — the single chokepoint

**This is what makes the feature portable.** All 21 `mergeTemplate(...)` call
sites on master (and the equivalent set on the branch) obtain their template
through `resolveTemplate(...)` in `hooks/usePrintTemplates.js`. Both branches
export the same contract despite very different internals.

So materialize there, once:

```js
// hooks/usePrintTemplates.js — ONE wiring edit per branch
const resolveTemplate = useCallback((doc) => {
  const tpl = /* existing branch-specific resolution, unchanged */;
  return withStamp(tpl, stampsBySlug);   // from utils/stampSlot.js
}, [/* existing deps */, stampsBySlug]);
```

```js
// utils/stampSlot.js — shared
// Replace {{stamp}} with the assigned stamp's URL before the template reaches
// Handlebars, so every print / PDF / Excel path resolves it without knowing
// stamps exist. Returns the template unchanged when there is nothing to do.
export function withStamp(tpl, stampsBySlug) {
  if (!tpl?.htmlContent) return tpl;
  const url = tpl.stampSlug ? stampsBySlug[tpl.stampSlug] : null;
  return { ...tpl, htmlContent: materializeStamp(tpl.htmlContent, url) };
}
```

Consequences worth stating plainly:

- **Zero changes to the 21 call sites, on either branch.**
- `{{#if stamp}}` collapses to nothing when unassigned, so "without stamp" needs
  no separate HTML.
- The **editor must bypass this** and load the raw HTML, or saving would bake
  the URL in permanently. Load the editor's copy from the by-id endpoint
  without materialization (§7).

---

## 6. Behaviour per surface

### 6.1 Existing templates — opt in, never automatic

Every existing row is `StampId = NULL`. The list card shows no stamp chip. The
picker is present but, for a `none`-state template, disabled with an
**Add signature block** action next to it.

"Add signature block" opens `AddSignatureBlockModal`, which:

1. runs `injectSignatureBlock(html)` using ordered anchors —
   (a) an element whose class matches `sig-row|sign-row|sig-block|signature`,
   (b) an element whose text contains "Signature",
   (c) fallback: a new signature row appended before `</body>`;
2. renders the result in the existing A4 preview with the inserted block
   highlighted;
3. states which anchor matched, in words — *"added inside the existing
   signature row"* vs *"no signature row found, added one at the end"*;
4. only writes on **Apply**.

Never inject silently. A heuristic that quietly rewrites an operator's HTML is
how you lose trust in the whole feature.

### 6.2 Change the stamp + preview

On the list card and in the editor header: `Signature: [ Signature one ▾ ]`.
Changing it is a `PUT` of `stampId` only — no HTML round-trip — then the
preview re-renders through the same materialization as printing, so **what the
preview shows is what prints**. Preview is not a separate rendering path.

For a `pinned` template, the picker shows the pinned stamp name with a
**Convert to slot** action: rewrite `{{stamps.<slug>}}` → `{{stamp}}`, set
`StampId` to that stamp. One click, reversible, no manual editing. This is the
upgrade path for production templates 15 and 14.

### 6.3 Starter apply

The apply / create-from-starter modal gains a `Signature` row rendering
`StampPicker`: `None` plus a thumbnail per company stamp. Default selection:
the company's `IsDefault` stamp, else `None` when the company has zero stamps
(with an inline link to the Stamps tab).

All starters carry the `{{#if stamp}}` block, so a starter is `slotted` from
birth and the choice is a pure `StampId` write.

### 6.4 HTML import

`TemplateEditorPage` already accepts `.html,.htm`. On import, run
`detectStampState` plus a `data:image` scan and offer, in the import step:

- **no slot** → "Add signature block?" (same preview modal as §6.1)
- **base64 image found** → "This template embeds an image. Extract it as a
  reusable stamp?" — create the `CompanyStamp`, replace the data URI with
  `{{stamp}}`, assign it.

Build the second one. It is the same conversion
`scripts/extract_template_stamps.py` does offline, moved into the flow — without
it, every future import re-introduces the base64 bloat this feature exists to
remove.

### 6.5 Copy / duplicate

The copy carries `StampId` and the HTML verbatim, so a copy of a stamped
template is stamped and a copy of a stampless one is not — then the copy is
independently changeable, because `StampId` lives on the row, not in the HTML.

One guard: **copying across companies must drop the stamp.** Stamps are
company-scoped; a copied `StampId` pointing at another tenant's stamp is a
cross-tenant link, which `CLAUDE.md` forbids outright. In the copy handler:

```csharp
// stamp is company-scoped — never carry it across a company boundary
copy.StampId = (source.CompanyId == target.CompanyId) ? source.StampId : null;
```

If the branch's copy flow also crosses divisions, the stamp still carries —
stamps are per company, not per division.

### 6.6 Built-in fallback templates

`defaultTemplates.js` renders when a company has no saved template
(`resolveTemplate(...) || defaultChallanTemplate`). There is no row, so no
`StampId` — this is why `CompanyStamp.IsDefault` exists. Add the `{{#if stamp}}`
block to each default template and resolve the company default in `withStamp`
when `tpl` is null.

### 6.7 Deleting a stamp that is in use

`SetNull` handles the data. The UI must handle the surprise: the delete
confirmation shows the usage count — *"Signature one is used by 3 templates.
They will print without a signature."* Query is a single `COUNT` on
`PrintTemplates WHERE StampId = @id`.

---

## 7. API surface

| Endpoint | Change |
|---|---|
| `GET /api/printtemplates/company/{id}` | add `stampId`, `stampSlug`, `stampState` to each row. **Do not** add HTML — the branch deliberately made this metadata-only |
| `GET /api/printtemplates/{id}` | returns **raw** HTML (un-materialized) for the editor |
| `PUT /api/printtemplates/{id}` | accept `stampId` (nullable). Validate the stamp belongs to the template's company — a forged `stampId` must 400, not link cross-tenant |
| `POST /api/printtemplates/{id}/signature-block` | inject the block; returns the new HTML for preview. `printtemplates.manage.update` |
| `POST /api/printtemplates/{id}/convert-stamp` | `pinned` → `slotted` + set `StampId` |
| `PUT /api/companies/{cid}/stamps/{id}/default` | set the company default stamp |

Tenant rule, non-negotiable per `CLAUDE.md`: every one of these asserts via
`_access.AssertAccessAsync(CurrentUserId, companyId)` **and** validates that
`stampId` resolves to a stamp in that same company. Never trust `dto.StampId`.

---

## 8. Test plan

Extend `scripts/test_company_stamps.py` and add `scripts/test_stamp_slots.py`:

| Case | Assert |
|---|---|
| assign stamp to `slotted` template | `stampId` persists, `stampState = slotted` |
| render assigned template | output contains the stamp URL, no `{{stamp}}` token, no `data:image` |
| assign `None` | `{{#if stamp}}` collapses; no empty `<img>`, no broken src |
| `pinned` → convert | HTML now has `{{stamp}}`, `stampId` set, old token gone |
| `none` + inject block | HTML gains exactly one block; **rest of the HTML byte-identical** |
| copy within company | copy has same `stampId`; changing the copy leaves the original untouched |
| copy across companies | copy's `stampId` is `NULL` |
| forged `stampId` from another company | 400/403, no link created |
| delete stamp in use | templates survive, `stampId` becomes `NULL`, usage count was reported |
| existing rows | still `stampId = NULL`, `stampState = none` after migration |

Plus a Node unit pass over `utils/stampSlot.js` (pure functions, no browser) for
detection and injection anchors — the same shape as the merge-engine check
already used for `{{stamps.*}}`.

Regression gate before any push, per `CLAUDE.md`:

```bash
python scripts/test_stock_itemtype_reflow.py    # 140/140 — hard gate
python scripts/test_company_stamps.py
python scripts/test_stamp_slots.py
python scripts/test_tenant_isolation.py
python scripts/test_pdf_pagination.py
```

---

## 9. Build order

Each phase is independently shippable and leaves the app working.

| Phase | Work | Done when |
|---|---|---|
| 1 | `StampSlot.cs` + `stampSlot.js` + unit tests | detection/injection correct on real template HTML |
| 2 | Migration, DTO fields, `PUT stampId`, tenant validation | `test_stamp_slots.py` assignment cases pass |
| 3 | `withStamp` in `usePrintTemplates.js` | assigned template prints with the image; nothing else changed |
| 4 | `StampPicker.jsx` + editor header + list card | change + preview works end to end |
| 5 | Starters + defaults get the `{{#if stamp}}` block (scripted sweep, 153 starters) | every starter is `slotted` |
| 6 | Apply modal + copy carry-over + cross-company guard | copy cases pass |
| 7 | `AddSignatureBlockModal` + import detection + base64 extraction | `none` and import cases pass |

Phase 5 is a mechanical sweep — same approach as the FBR break-rule sweep that
covered 15 templates in one script. Do not hand-edit 153 starters.

---

## 10. Porting to `customize-solution-for-other`

Do master first, then port. The shared files copy across unchanged; only the
wiring differs.

**Copy verbatim (no edits):**

```
Helpers/StampSlot.cs
myapp-frontend/src/utils/stampSlot.js
myapp-frontend/src/Components/templateEditor/StampPicker.jsx
myapp-frontend/src/Components/templateEditor/AddSignatureBlockModal.jsx
scripts/test_stamp_slots.py
```

**Redo per branch (small, listed):**

1. `Models/PrintTemplate.cs` — add the two properties (branch file also has `DivisionId`; leave it alone)
2. `Data/AppDbContext.cs` — the two `modelBuilder` blocks
3. **Generate a fresh migration on the branch.** Never copy the file
4. DTOs + `PrintTemplatesController` — same fields and endpoints; branch signatures may carry `divisionId`, which stamp code ignores
5. `hooks/usePrintTemplates.js` — the single `withStamp(...)` wrap. Branch version caches and scopes by division; wrap the *return value*, leave the resolution logic alone
6. `PrintTemplatesPage.jsx` / `TemplateEditorPage.jsx` — render `StampPicker`. Branch has `SavedTemplatesManager.jsx` and `usePrintTemplates` restructuring, so the anchors differ; the component does not
7. Starter sweep — rerun the script on the branch's starter files (branch has extra doc types)

**Do not cherry-pick the master commit.** The overlapping files conflict on
divergence that has nothing to do with stamps. Port by copying the shared files
and redoing the seven wiring edits — it is faster and produces a clean diff.

Port verification: same suites as §8, on the branch, plus a print of one
document per type that has a stamped template.

---

## 11. Open decisions

1. **Picker on the list card, or editor-only?** Assignment on the card is
   faster for "swap the signature on all my challans". Block *injection* should
   stay editor-only — it rewrites HTML and deserves the preview.
2. **Auto-assign the company default to new templates?** Convenient, but it
   means creating a template silently adds a signature. Leaning: pre-select it
   in the apply modal (visible, overridable) rather than applying it silently.
3. **Multi-signature documents** — `{{stamps.<slug>}}` stays the escape hatch. If
   two-signature documents become common, a second slot (`{{stamp2}}`) beats
   asking operators to hand-write tokens.
