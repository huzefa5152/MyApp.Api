import { useUiPreference } from "./useUiPreference";

// Card view is the default on every screen and every viewport. The Card/Table
// toggle is offered at ALL widths — including phones and tablets.
//
// Why this is safe on a phone now: the dense table view renders inside a
// horizontal-scroll container (DataTable's `overflowX:auto` wrapper), and the
// layout content column carries `min-width:0` (see DashboardLayout.css), so the
// table scrolls *within its own box* instead of stretching the page sideways.
// An operator who wants the dense table on a small screen can opt in and can
// always flip back — the toggle is always present, so there's no "stuck on a
// squashed table" state that the old desktop-only gate was guarding against.
//
// The persisted preference is per-screen (keyed by screenKey) and shared across
// viewports; default is "card".

/**
 * Per-screen view mode hook.
 *
 * @param {string} screenKey  localStorage namespace, e.g. "challans".
 * @returns {[mode, setMode, showToggle]}
 *   mode        — "card" | "table" (persisted; defaults to "card").
 *   setMode     — persist a new mode.
 *   showToggle  — always true; pages render <ViewModeToggle> when this is truthy.
 */
export function useListViewMode(screenKey) {
  const [persisted, setPersisted] = useUiPreference(`viewMode:${screenKey}`, "card");
  const mode = persisted === "table" ? "table" : "card";
  return [mode, setPersisted, true];
}
