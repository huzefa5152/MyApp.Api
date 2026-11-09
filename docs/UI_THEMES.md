# UI themes — architecture and how to change them

Read this before changing how any admin screen LOOKS. It is written for the next
Claude / Codex agent as much as for people.

Status (2026-10-03): built on branch `feat/trader-ui-themes` (off
`TraderFbrInvoicingSystem`). **Not deployed.** The branch has no deploy workflow
(`deploy-trader.yml` only runs on pushes to `TraderFbrInvoicingSystem`), so
pushing it is safe. It reaches production only when the maintainer merges it.

Coverage (2026-11-08): admin screens and dialogs read the `--k-*` tokens for the app palette,
neutrals, control heights and card shadows. Bank & Cash, Transfers and Purchase Debit Notes are
built from the kit components; the bill, invoice and line item forms use the kit button classes
and `formStyles` for their fields, which is what KIT_GUIDE prescribes for dialogs.

Status and accent colours (paid, warning, info, purple, teal tints) are tokens too:
`--k-success*`, `--k-warn*`, `--k-info*`, `--k-danger-ink*`, `--k-purple*`, `--k-teal-*`,
`--k-slate*` in `ui/kit.css`. They hold one value in every theme today, so a new theme (a dark
one) overrides them in its CSS block instead of editing screens. They were introduced with a
computed-style comparison of all 54 routes in both themes before and after: no visible colour
changed.

Fixed on purpose: print output and report print templates (the printed document must not follow
the screen theme), public pages, charts drawn in SVG, and the sidebar's own gradient colours in
`layouts/DashboardLayout.css` (its palette colours are tokens; the dark navigation shades are not).
Hex-alpha tints built in code use `color-mix()` so they work with token values.

Checked on 2026-11-08 at 375px and 1280px in Classic and Workspace: 54 routes with no error and no
sideways page scroll, and 44 to 48 dialogs per combination opened from New / Add / Record / View /
Edit buttons and row menus (destructive actions such as Delete or Submit are never opened).

Scales (2026-11-09): every theme shares one type scale and one radius scale,
defined once at the top of `ui/kit.css`.

- Type: `--k-fs-2xs` 11px, `xs` 12, `sm` 13, `base` 14, `md` 16, `lg` 18,
  `xl` 20, `2xl` 24, `3xl` 32. Kit role tokens (`--k-font`, `--k-title`,
  `--k-th-font`, `--k-stat-value` …) point at steps; Workspace picks one step
  smaller for body text, it never uses a value of its own. Screens use the steps.
  Rendered result on 15 representative screens: 7 sizes in every theme (was 34).
- Radius: `--k-r-xs` 4, `--k-r-sm` 6, `--k-radius` (controls, per theme),
  `--k-card-radius` (cards, per theme), `--k-r-lg` 12, `--k-r-xl` 16,
  `--k-r-pill` 999. 5-6 rendered values per theme (was 10-13).
- Charts: `--k-chart-1..8`, `--k-chart-other`, `-muted`, `-track`, `-good`,
  `-warn`, `-aging-2..4`. Series keep their order in every theme so a legend row
  and its segment always match; Aurora and Midnight override the values. SVG
  `fill`/`stroke` attributes accept `var()`.
- Sign-in page: its own `--lg-*` tokens; Aurora and Midnight override them, so
  the login follows the device's last theme.

Design audit (2026-11-09): all four themes were measured on 14 real screens for
text contrast (WCAG 2.2 AA), focus visibility, target size and consistency, then
fixed. Text below 4.5:1 went from 5-7% of all text to about 1% in every theme;
what remains are a few gradient fills the measurement cannot judge reliably.
Rules that came out of it:

- `--k-faint` is still body text (meta, captions, placeholders), so it must reach
  4.5:1 on `--k-surface-2`. Do not lighten it for subtlety.
- A token that is used as TEXT on a dark theme is too light to carry white text,
  so solid fills that hold white text read `--k-accent-solid` / `--u2-accent-solid`
  / `--k-teal-solid` with the text colour as the fallback.
- `layouts/AdminDensity.css` sizes controls from `--admin-control-height`, which
  only the Classic layout defines; every use needs `var(--k-h)` as its fallback,
  or inputs in the other themes collapse to their text height.
- Status chips on bills and invoices read `--k-chip-*`; a theme with dark surfaces
  sets them, light themes keep the original values through the fallback.
- Aurora keeps gradients to the page-header icon tiles; Midnight uses solid
  primary fills. Gradients on working surfaces read as decoration, not hierarchy.

Trader integration (2026-10-09): includes the current Trader security and business workflows. Admin density overrides apply to Classic; Workspace keeps its theme tokens. Dialog focus handling and popup accessibility apply to both layouts. This integration remains local until explicitly pushed.

## What a user sees

- Four themes: **Classic** (default — the original look, tidied so every screen
  uses the same header / button / card / table style), **Workspace** (the same
  screens, compact: 32px controls, flat cards, denser tables, company switcher and
  "Search or go to…" in the topbar, slimmer sidebar), **Aurora** (Workspace layout
  in violet and magenta, rounder cards, soft tinted shadows, gradient sidebar and
  primary buttons; `ui2/theme-aurora.css`) and **Midnight** (Workspace layout,
  dark surfaces and light text, dark status shades, `color-scheme: dark`;
  `ui2/theme-midnight.css`).
- A colour theme is one CSS file of token overrides under
  `:root[data-ui-theme="<id>"]`, imported in `main.jsx`. Shared styles keep their
  original value as the `var()` fallback, so Classic and Workspace are unchanged.
- Pick in the account menu → **Theme**, or **Profile → Appearance**.
- The choice is stored **per user, per browser** (`localStorage` key
  `ui.theme:<userId>`) and never changes until that user picks again. Another user
  on the same browser keeps their own. `ui.theme:last` holds the device's last
  choice so the page does not flash Classic before sign-in resolves.
- A theme changes looks only. Every field, column, action, permission check,
  validation and API call is identical in every theme.

## The pieces

| Piece | File | Role |
|---|---|---|
| Theme registry | `myapp-frontend/src/ui2/themes.js` | `{ id, label, description, layout, swatch }` per theme; `DEFAULT_THEME` |
| Theme state | `myapp-frontend/src/ui2/UiThemeContext.jsx` | per-user storage; writes `<html data-ui-theme="id" data-ui-layout="classic\|workspace">` |
| Layout switch | `myapp-frontend/src/ui2/useUi2.js` | `true` when the theme's layout is `workspace` |
| Theme picker | `myapp-frontend/src/ui2/ThemePicker.jsx` | used by the account menu and Profile → Appearance |
| **UI kit** | `myapp-frontend/src/ui/Kit.jsx`, `ui/kit.css` | the shared building blocks (below) + the `--k-*` tokens for both layouts |
| Kit usage guide | `myapp-frontend/src/ui/KIT_GUIDE.md` | which component to use for what, and the rules |
| Searchable dropdown engine | `myapp-frontend/src/Components/ComboBox.jsx` | one popover / keyboard model for every picker |
| Pickers | `SearchableSelect.jsx`, `SearchableClientSelect.jsx` (clients **and** suppliers), `AccountSelect.jsx` (GL accounts) | thin wrappers over ComboBox; public props unchanged |
| Dialog / form tokens | `myapp-frontend/src/theme.js` (`formStyles`, `cardStyles`, `dropdownStyles`) + `ui2/ui2.css` (`--ui-*` block) | values read `var(--ui-x, <original>)`; only Workspace sets `--ui-*` |
| Shared-component tokens | `myapp-frontend/src/ui/shared-components.css` | `--sc-*` (Workspace only) for DataTable, autocompletes, LineItemsEditor, badges… |
| Workspace shell | `ui2/ui2.css` (`.dl-shell--v2`), `ui2/ShellParts.jsx` (CompanySwitcher, QuickJump) | sidebar/topbar look, applied only in the workspace layout |
| Delivery Challans (workspace) | `ui2/ChallansV2.jsx`, `ui2/DataGrid.jsx`, `ui2/Pager.jsx`, `ui2/ChallanDetailV2.jsx`, `ui2/primitives.jsx` | the one screen with a separate workspace structure (presentation only — `ChallanPage` owns all state) |

### Token layers (why Classic stays Classic)

1. `--k-*` in `ui/kit.css`: defined for **both** layouts. Classic values reproduce
   the original look; Workspace values are compact. Kit components read only these.
2. `--ui-*` (dialogs, `cardStyles`) and `--sc-*` (shared components): defined
   **only** under `[data-ui-layout="workspace"]`. Every use is
   `var(--ui-x, <original value>)`, so Classic falls back to the exact old value.

### Kit components (import from `ui/Kit`)

`PageHeader` (icon tile + title + count + subtitle + actions; `className="k-header--hero"`
keeps the dashboard gradient banner in Classic) · `CompanyPicker` (renders nothing in
Workspace — the topbar switcher drives the same CompanyContext) · `Button`,
`IconButton` · `Toolbar`, `ToolbarSpacer`, `SearchBox` · `Field` + `k-input` /
`k-select` / `k-textarea`, `k-form-grid` · `Card` · `TableWrap` + `<table className="k-table">`
(`k-num`, `k-actions`, `k-muted`) · `Tabs` · `StatGrid` / `StatCard` · `Facts` ·
`EmptyState`, `Loading`, `Alert`. Dialogs keep `formStyles` from `theme.js`.

## Adding a new theme

Use the project skill **`.claude/skills/create-ui-theme/SKILL.md`** — it is the
step-by-step. In short:

1. Append an entry to `THEMES` in `ui2/themes.js` (reuse `layout: "workspace"` or
   `"classic"`; a brand-new layout means a new structure branch in every screen —
   avoid unless the maintainer asks).
2. Add ONE CSS block `[data-ui-theme="<id>"] { --k-…; --ui-…; --sc-…; }` that
   overrides tokens only. Don't restyle components per theme; if a component
   hard-codes a value, tokenise it for everyone.
3. Build, run locally, switch themes in the account menu, walk the checklist below.

## Changing a screen

- Build it from the kit (see `ui/KIT_GUIDE.md`). No new inline sizes/colours for
  roles the kit already covers.
- Client / supplier pickers → `SearchableClientSelect` (`noun="suppliers"`), GL
  accounts → `AccountSelect`, other long id/name lists → `SearchableSelect`. Small
  fixed enums stay `k-select`.
- Never drop information or an action to make a layout fit.
- Never `whiteSpace: nowrap` + `textOverflow: ellipsis` on user-supplied names —
  2-line clamp.
- Print / PDF output, print templates, `exportUtils.js`, `printDocument.js` are
  out of scope for themes.

## Verification checklist (both themes)

1. `cd myapp-frontend && npm run build` → 0 errors.
2. Run the backend locally (CLAUDE.md "Running locally"), sign in, switch to each
   theme from the account menu.
3. Every route renders with no error and no horizontal page scroll at 375px.
   A quick way used on 2026-10-03: in the browser console, load each route in a
   hidden 375px-wide same-origin iframe per theme (set `localStorage["ui.theme:<id>"]`)
   and assert `scrollWidth <= clientWidth` and no error-boundary text — all 45
   routes × 2 themes passed.
4. Look at, in both themes: dashboard, a list (filters, table, cards, pager, row
   menu), a form dialog, a confirm dialog, each picker (client, supplier, GL
   account), the user menu, a phone width.
5. `node scripts/test_line_amount.mjs`, `node scripts/test_group_quantity_split.mjs`,
   `python scripts/test_pdf_pagination.py`,
   `cd myapp-frontend && npx vitest run src/pages/POFormatsPage.test.jsx`,
   `python scripts/verify_no_production_identifiers.py`.

## Known follow-ups (not done)

- Midnight still shows a few small light status chips (Pending, Cancelled, Costing
  not added) whose colours are inline values without a token; they stay readable.
- The Classic sidebar gradient in `layouts/DashboardLayout.css` keeps fixed shades;
  the colour themes use the Workspace shell, which reads `--u2-nav-bg`.
- Theme choice is per browser. If it should follow the user across devices, it
  needs a small user-preference API — that is a backend change, deliberately not
  part of this UI-only work.
- `POFormatForm`'s client picker stays a native `<select>` because
  `POFormatsPage.test.jsx` drives it by role; switching needs the test updated by
  the maintainer.
- `WithholdingTaxReceiptForm` customer picker goes through `SelectDropdown`
  (searchable now) instead of `SearchableClientSelect` because swapping it changes
  how clients are fetched.
- A shared "entity card" component (name clamp + facts + action row) would remove
  the per-list duplication in ClientList / CompanyList / SupplierList /
  ItemTypes / Folders.
