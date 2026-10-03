---
name: create-ui-theme
description: >-
  Add a new selectable interface theme to the admin app (the per-user theme list
  in Profile > Appearance and the account menu), or change an existing one. Use
  whenever the user asks for a new theme, a more modern / professional / dark /
  compact look, a colour variation, or to adjust "Workspace" or "Classic" — even
  if they only say "make a new design" and never say "theme". A theme is a LOOK
  for the same screens; it never changes features, permissions, validation,
  actions, APIs or business flows.
---

# Create a UI theme

## How themes work (read before touching anything)

Full architecture, token layers and the verification checklist: `docs/UI_THEMES.md`.
Kit component usage: `myapp-frontend/src/ui/KIT_GUIDE.md`.

Token layers a theme can override (one CSS block, `[data-ui-theme="<id>"] { … }`):
- `--k-*` (`ui/kit.css`) — every kit component: header, buttons, inputs, cards,
  tables, tabs, stats, pickers. Defined for both layouts.
- `--ui-*` (`ui2/ui2.css`) — dialogs/forms/cards from `theme.js`; read as
  `var(--ui-x, <classic value>)`.
- `--sc-*` (`ui/shared-components.css`) — DataTable, autocompletes, LineItemsEditor, badges.
- `--u2-*` (`ui2/ui2.css`) — the workspace shell (sidebar/topbar) and Delivery Challans.

- **Registry:** `myapp-frontend/src/ui2/themes.js` lists every theme:
  `{ id, label, description, layout, swatch }`.
- **Per user:** `ui2/UiThemeContext.jsx` stores the choice in `localStorage`
  under `ui.theme:<userId>` and writes `data-ui-theme="<id>"` and
  `data-ui-layout="<layout>"` on `<html>`. Another user on the same browser keeps
  their own choice. Default is `DEFAULT_THEME` in `themes.js`.
- **Picker:** `ui2/ThemePicker.jsx` renders the registry. It is used in the
  account menu (`layouts/DashboardLayout.jsx`) and in Profile > Appearance
  (`pages/ProfilePage.jsx`). A new registry entry shows up in both with no other
  code.
- **Layout vs. colours:** `layout` picks the screen *structure*.
  - `classic` = the original screens, untouched.
  - `workspace` = the redesigned structure (`useUi2()` is true; the shell gets
    `.dl-shell--v2`, pages get `.u2`; screens such as `ui2/ChallansV2.jsx` render).
  A new theme should normally **reuse `layout: "workspace"`** and change only
  tokens and density in CSS scoped to its id. Add a new layout only when the
  screen structure itself must differ, and then every screen needs that branch.

## Adding a theme (the normal case: new colours/density, same structure)

1. Append an entry to `THEMES` in `ui2/themes.js` with a unique lowercase `id`,
   `layout: "workspace"`, and `swatch: [navigation, accent, surface]` hex colours.
2. Add a block to `ui2/ui2.css` (or a new `ui2/theme-<id>.css` imported from
   `ui2.css`) that **only overrides the `--u2-*` tokens and a few shell values**
   under `[data-ui-theme="<id>"]`:
   ```css
   [data-ui-theme="midnight"] {
     --u2-blue: #4f8cff; --u2-blue-600: #3b78f0; --u2-ink: #e6edf7;
     --u2-surface: #111a2b; --u2-surface-2: #0e1625; --u2-line: #223049;
     --u2-nav-bg: #070d18; /* …every token listed at the top of ui2.css */
   }
   ```
   Components read tokens (`var(--u2-…)`), so one block restyles the sidebar,
   topbar, lists, filters, cards, dialogs, selects and pager together.
3. Do not edit `[data-ui-theme="classic"]` — Classic has no CSS by design.
4. Do not copy component CSS into the theme block. If a component hard-codes a
   colour, replace that colour with a token in `ui2.css`; do not special-case the
   theme.

## Rules a theme must follow

- **No feature change.** Same fields, columns, actions, permissions, states.
  Never hide or remove a detail to make a look work.
- **Palette discipline.** Keep brand blue/teal recognisable unless the user asks
  otherwise. Contrast: body text >= 4.5:1, large text/icons >= 3:1, visible
  focus ring (`--u2-focus`) on every control.
- **One control height** (`--u2-h`), one radius scale, one type scale. Do not
  invent a per-screen size.
- **Dark themes:** also set `color-scheme: dark` under the theme selector, and
  check native inputs, date pickers, scrollbars and the print/PDF previews
  (print documents must stay white — never theme anything under print CSS).
- **Responsive:** verify 375 / 768 / 1280. No horizontal page scroll on a phone.
- **Shared pieces only.** Lists use `ui2/DataGrid`, `ui2/Pager`, dialogs use the
  `.u2-dialog*` classes, selects use the one searchable select, and status
  colours come from `statusTones`. A theme restyles them; it does not fork them.

## Verify

1. `cd myapp-frontend && npm run build` (0 errors).
2. Run locally (see the project CLAUDE.md "Running locally"), sign in, open the
   account menu > Theme and Profile > Appearance, switch to the new theme and to
   Classic and back. Confirm Classic is pixel-for-pixel the original.
3. Walk: Dashboard, a list screen (filters, table, cards, pager, row menu,
   column chooser), a form dialog, a confirm dialog, a searchable select
   (client / supplier / GL account), the user menu, a phone width.
4. Run `node scripts/test_line_amount.mjs`, `node scripts/test_group_quantity_split.mjs`
   and `python scripts/test_pdf_pagination.py` — a theme must not move them.
5. Never commit or push without the maintainer asking; stage explicit paths.

## Do not

- Do not store the theme server-side or add an API for it (UI-only change).
- Do not gate a theme by permission or role unless the user asks.
- Do not delete or rename an existing theme id: users have it saved. Retire a
  theme by removing it from `THEMES`; `getTheme()` falls back to the default.
