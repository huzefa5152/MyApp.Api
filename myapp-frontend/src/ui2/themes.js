/**
 * Registry of selectable interface themes. A theme is a LOOK for the same screens and the same
 * behaviour: it never changes what a screen does or who may use it.
 *
 *   id      stored per user, and written to <html data-ui-theme="…"> so CSS can target it
 *   layout  which screen structure the theme uses: "classic" (the original screens) or
 *           "workspace" (compact list/filter/dialog structure). A new theme can reuse a layout
 *           and only change colours and density through CSS scoped to [data-ui-theme="<id>"].
 *   swatch  three colours for the picker preview: [navigation, accent, surface]
 *
 * To add a theme: append an entry here, then add its CSS under [data-ui-theme="<id>"]. Nothing else.
 */
export const THEMES = [
  {
    id: "classic",
    label: "Classic",
    description: "The original look, tidied for consistency.",
    layout: "classic",
    swatch: ["#0d47a1", "#00897b", "#ffffff"],
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Compact, information-dense layout on the same colours.",
    layout: "workspace",
    swatch: ["#0a1628", "#1565c0", "#f0f4f8"],
  },
];

export const DEFAULT_THEME = "classic";
export const getTheme = (id) => THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);
