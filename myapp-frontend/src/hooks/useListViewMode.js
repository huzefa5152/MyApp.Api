import { useUiPreference } from "./useUiPreference";

// Adaptive default: cards on phone (<768px), table on tablet/desktop.
// Read once at mount — the persisted user choice overrides on subsequent
// visits. We do NOT keep flipping defaults on resize; once a user picks
// a mode it sticks until they change it.
function detectDefault() {
  try {
    if (typeof window === "undefined" || !window.matchMedia) return "card";
    return window.matchMedia("(min-width: 768px)").matches ? "table" : "card";
  } catch {
    return "card";
  }
}

// Per-screen view mode. `screenKey` namespaces the localStorage entry, e.g.
// "challans", "bills", "invoices", "purchaseBills", "goodsReceipts".
export function useListViewMode(screenKey) {
  return useUiPreference(`viewMode:${screenKey}`, detectDefault());
}
