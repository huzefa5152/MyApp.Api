# UI kit guide — how every screen is built

The app has selectable themes (Profile > Appearance, account menu > Theme). **Classic** is
the original look and the default; **Workspace** is the compact look. Both render the SAME
screens and the SAME markup; the theme only changes the `--k-*` tokens in `ui/kit.css`
(and the `--ui-*` dialog tokens in `ui2/ui2.css` that `theme.js` `formStyles` reads).

So a screen is "themed" when it is built from the shared pieces below instead of
hard-coded inline sizes and colours. Classic tokens reproduce the original look; Workspace
tokens make the same markup compact.

## Shared pieces (import from `../ui/Kit` or `../../ui/Kit`)

| Need | Use |
|---|---|
| Page title row (icon tile, title, count, subtitle, actions) | `<PageHeader icon={MdX} tone="blue\|teal\|brand\|purple\|orange\|green\|red\|slate" title subtitle count actions />` |
| Per-page company dropdown | `<CompanyPicker />` (renders nothing in Workspace — the topbar switcher drives the same CompanyContext) |
| Buttons | `<Button variant="primary\|secondary\|teal\|ghost\|danger" size="sm" icon={MdAdd}>` · `<IconButton label icon danger />` |
| Filter/action row | `<Toolbar>` + `<SearchBox value onChange={(text)=>…} placeholder />` + `<select className="k-select">` + `<ToolbarSpacer />` |
| Labelled control | `<Field label hint error>` around `<input className="k-input">`, `<select className="k-select">`, `<textarea className="k-textarea">` |
| Form grid | `<div className="k-form-grid">` (auto-fit, collapses to 1 column on phones) |
| Surface / section | `<Card title icon tone actions flush>` |
| Table | `<TableWrap><table className="k-table">…</table></TableWrap>` — `th`/`td` get the theme look; use `className="k-num"` for numbers, `k-actions` for the action cell, `k-muted` for secondary text |
| Tabs | `<Tabs tabs={[{key,label,icon,count}]} value onChange />` |
| KPI tiles | `<StatGrid><StatCard label value hint icon tone /></StatGrid>` |
| Label/value details | `<Facts facts={[["PO", po], cond && ["Site", site]]} />` |
| States | `<Loading>Loading x…</Loading>` · `<EmptyState icon title action>text</EmptyState>` · `<Alert tone="info\|warn\|error\|success" icon>` |
| Client / supplier picker | `SearchableClientSelect` (`noun="suppliers"` for suppliers) |
| GL account picker | `AccountSelect` |
| Any other long id/name list | `SearchableSelect` |
| Dialogs | keep `formStyles.backdrop/modal/header/title/closeButton/body/footer/button/cancel/submit` from `theme.js` — already themed |
| Pagination | `Components/Pagination` (already themed) |

## Rules (non-negotiable)

1. **UI only.** Same fields, columns, actions, permission checks (`has(...)`, `<Can>`),
   validation, API calls, state and business flow. Never drop a piece of information.
2. **No ad-hoc sizes/colours for kit roles.** Delete inline style objects that duplicate a
   kit piece (page header, add button, search input, card, th/td, spinner, empty state).
   Keep genuinely page-specific layout (a two-column split, a chart size).
3. **Pickers.** Every `<select>` that lists clients or suppliers becomes
   `SearchableClientSelect`; GL accounts become `AccountSelect`. Adapt handlers:
   `onChange={(id) => handler({ target: { value: String(id) } })}` when the old handler read
   `e.target.value`; "" still means "All" / none. If the old `<select>` had `required`, keep
   that check in the submit validation. Small fixed enums (status, type) stay `k-select`.
4. **Responsive.** No horizontal page scroll at 375px. Grids use `k-form-grid` or
   `repeat(auto-fit, minmax(min(220px, 100%), 1fr))`. Wide tables go in `TableWrap`.
5. **Names.** Never `whiteSpace: nowrap` + `textOverflow: ellipsis` on user-supplied
   names; use a 2-line clamp.
6. **Print output is out of scope.** Never touch print templates, `exportUtils.js`,
   `printDocument.js` or anything rendered into a printed/PDF document.
