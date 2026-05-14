import { useEffect, useState } from "react";
import { useUiPreference } from "./useUiPreference";

// Card view is the universal default on every screen, every viewport.
// Operators wanted card-first everywhere. The table layout is opt-in and
// ONLY available on big-screen desktops — phones and tablets don't see the
// toggle at all, so they can never accidentally land on a squashed table.
// The threshold matches Tailwind's `xl` (1280px): phones, portrait
// tablets, and even iPad Pro 12.9" landscape (1024px) all stay on cards
// without a toggle. A real desktop (1366px+, 1440px+, 1920px+) gets the
// toggle and can flip to table.
//
// Behaviour summary:
//   - Default for any new operator on any device: card.
//   - Phone / tablet (<1280px): no toggle rendered; mode is forced to
//     "card" regardless of any persisted localStorage preference.
//   - Desktop (≥1280px): toggle rendered; operator's persisted preference
//     is honoured (e.g. someone who picks "table" on Challans keeps
//     seeing table on Challans across sessions).
//   - Window resize crosses 1280px → mode and toggle visibility flip
//     reactively so an operator dragging a window narrower gets cards on
//     the fly (no need to refresh).

const BIG_SCREEN_QUERY = "(min-width: 1280px)";

function isBigScreenNow() {
  try {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(BIG_SCREEN_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Per-screen view mode hook.
 *
 * @param {string} screenKey  Namespace for localStorage, e.g. "challans".
 * @returns {[mode, setMode, isBigScreen]}
 *   mode         — "card" | "table" (effective; forced to "card" off-desktop).
 *   setMode      — only takes effect if isBigScreen is true (callers should
 *                  hide the toggle anyway so this isn't even reachable
 *                  off-desktop).
 *   isBigScreen  — boolean. Pages should render <ViewModeToggle> only when
 *                  this is true; otherwise the operator is on phone/tablet
 *                  and the toggle isn't offered.
 */
export function useListViewMode(screenKey) {
  // Persisted preference — default "card" everywhere.
  const [persisted, setPersisted] = useUiPreference(`viewMode:${screenKey}`, "card");

  // Reactive big-screen flag — true on desktops ≥1280px. Reacts to resize
  // (e.g. dragging a window narrower than xl threshold flips back to card).
  const [isBigScreen, setIsBigScreen] = useState(isBigScreenNow);
  useEffect(() => {
    try {
      const mq = window.matchMedia(BIG_SCREEN_QUERY);
      const handler = (e) => setIsBigScreen(e.matches);
      // Modern browsers expose addEventListener on MediaQueryList; Safari
      // <14 used the legacy addListener. Try both.
      if (mq.addEventListener) mq.addEventListener("change", handler);
      else mq.addListener(handler);
      return () => {
        if (mq.removeEventListener) mq.removeEventListener("change", handler);
        else mq.removeListener(handler);
      };
    } catch {
      return undefined;
    }
  }, []);

  // Off-desktop: ignore any persisted preference and force card. Operator
  // can never "get stuck" on a table view they can't toggle out of.
  const effectiveMode = isBigScreen ? persisted : "card";
  return [effectiveMode, setPersisted, isBigScreen];
}
