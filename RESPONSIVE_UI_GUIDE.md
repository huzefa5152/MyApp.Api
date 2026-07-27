# Responsive UI Guide — the standard for every screen

**Status: MANDATORY.** Every new feature screen, form, modal, table and list in
`myapp-frontend/` must work — and give the *best UX for the flow* — on all
three breakpoints. Retrofits of old screens should follow the same patterns.
This guide is referenced from `CLAUDE.md` §3; read it before building any UI.

## Breakpoints & the golden rule

| Target | Width | Notes |
|---|---|---|
| Phone | **375px** | The hard floor. **No horizontal page scroll, ever.** |
| Tablet | **768px** | Two-column where it helps; touch-first. |
| Desktop | **1280px** | Dense layouts, keyboard-fast entry. |

The internal breakpoint for "switch to a stacked/mobile layout" is **760px**
(`window.innerWidth < 760`). Verify at all three widths before shipping —
compile ≠ verified.

## 1. Form field grids

Never hardcode a fixed column count. Use auto-fit so columns collapse to one on
a phone with no media query:

```jsx
<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
```

`min(220px, 100%)` is the key — it lets a column shrink below 220px on a 375px
screen instead of forcing overflow.

## 2. Line-item entry → the shared editor first

For any new quote / order / challan-style line grid, **use
`Components/LineItemsEditor.jsx`**. It is a controlled component that already
gives you: desktop dense table, mobile stacked cards (<760px), and keyboard
quick-add (Enter commits + advances, Repeat-last = full-line duplicate, Paste
list). The parent keeps totals/tax/submit and its own row shape.

```jsx
<LineItemsEditor
  items={items} onItemsChange={setItems} makeBlankItem={blankItem} units={units}
  showItemType itemTypes={nonHsItemTypes}      // optional item-type picker + bulk-apply
  showUnitPrice getRate={getRate}              // optional price column + last-rate auto-fill
  isRowLocked={fn} rowLockHint={fn}            // optional per-row lock (e.g. delivered qty)
  itemsLabel="Items" itemsHint="…" />
```

Live in: SalesQuote, SalesOrder, ChallanForm, ChallanEditForm.

## 3. Tables that can't adopt the shared editor → responsive branch

FBR/complex tables (bill/invoice/purchase forms) keep their bespoke logic but
must still render as **cards on a phone**. Add an `isNarrow` branch and bracket
the existing table — **reuse the existing cells/handlers, change no logic, keep
the desktop `<table>` byte-for-byte in the `else`:**

```jsx
const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
useEffect(() => {
  const onResize = () => setIsNarrow(window.innerWidth < 760);
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}, []);
```

```jsx
{isNarrow ? (
  <div style={mCards}>{rows.map(r => (/* stacked card mirroring the same cells */))}</div>
) : (
  <div style={styles.tableWrap}><table>…existing table, unchanged…</table></div>
)}
```

Card anatomy: a number/id badge + the primary picker in the header (with the
remove button if the row has one), description full-width, then a 2–3 column
grid for Qty / Unit / Price, then read-only fields (HS, sale type, line total)
each with a small uppercase label, and a dashed-top footer for the amount.
Applied in: InvoiceForm, StandaloneInvoiceForm, EditBillForm, PurchaseBillForm,
GoodsReceiptForm, POImportForm, PaymentForm (settle grid).

**Gotcha — nested ternary:** if the table already sits inside another JSX
ternary branch (`{cond ? (a) : (table)}`), write the new branch WITHOUT braces
(`cond ? (cards) : (table)`) — a `{…}` there is a syntax error ("Expected }").

**Never** ship a phone view that horizontally scrolls a wide table
(`overflowX:auto` + `minWidth:1000`) as the only option.

## 4. Modals — use the shared `formStyles`

Import `formStyles` from `theme.js`. Its backdrop/modal/body are already
bulletproof: backdrop `position:fixed; inset:0; display:flex; alignItems:center;
justifyContent:center; overflowY:auto; padding:2vh 1rem; zIndex:1100`; modal
`maxHeight:96vh; display:flex; flexDirection:column`; body `overflowY:auto;
flex:1 1 auto; minHeight:0`. Header/footer `flexShrink:0` so they stay visible.

If you must hand-roll an overlay:
- **Do**: `display:flex; overflowY:auto` on the overlay + `margin:auto` on the
  card — centres when it fits, pins to the top and scrolls when taller than the
  viewport.
- **Don't**: `display:grid; placeItems:center` with no `overflowY` — a card
  taller than the viewport has its **top clipped and unreachable**
  (CorrectionWizard bug, fixed 2026-07-27).
- Modal max width on phone: `width:"96vw"` / a `maxWidth` guard so it never
  exceeds the viewport.

## 5. Icon buttons

index.css has a global `button { padding: 0.8em 1.6em; box-shadow: … }` rule
that will stretch and off-centre any icon button. Always override:

```jsx
const iconBtn = { display: "grid", placeItems: "center", width: 34, height: 34, padding: 0, boxShadow: "none", border: "1px solid #dce2e8", borderRadius: 8, cursor: "pointer" };
```

Tap targets ≥ **44×44px** for primary/touch actions.

## 6. Text & pickers

- Long user strings: `display:"-webkit-box"; WebkitLineClamp:2; WebkitBoxOrient:"vertical"`. NEVER `whiteSpace:"nowrap"` + `textOverflow:"ellipsis"` on user data (collapses "MEKO FABRICS"/"MEKO DENIM" to look identical — dashboard incident 2026-05-13).
- Picker dropdowns: full-width on phone (`flex:1`), capped on desktop (`maxWidth:260`).

## 7. Verification checklist (before "done")

- [ ] 375px: no horizontal scroll; every field/action reachable and ≥44px.
- [ ] 768px: layout uses the width sensibly (not a stretched phone view).
- [ ] 1280px: dense, keyboard-fast where the flow is data entry.
- [ ] Modals: open on a short viewport — header, body (scrolls), footer all reachable; close icon centred.
- [ ] `npm run build` (via Node 20) is green.
