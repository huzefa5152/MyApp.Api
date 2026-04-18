import httpClient from "./httpClient";

export const searchItemDescriptions = (query) =>
  httpClient.get("/lookup/items", { params: { query } });

// Exact-name lookup — returns the ItemDescription row with FBR defaults
// (HSCode, SaleType, FbrUOMId, UOM) or 404 if not found.
export const getItemByName = (name) =>
  httpClient.get("/lookup/items/by-name", { params: { name } });

export const searchUnits = (query) =>
  httpClient.get("/lookup/units", { params: { query } });

// Upsert remembered FBR defaults for an item description. Called after a bill is
// created to remember what HS Code / Sale Type / UOM the user picked, so next
// time they invoice the same item those values are pre-filled.
export const saveItemFbrDefaults = (payload) =>
  httpClient.post("/lookup/items/fbr-defaults", payload);

// Top items — favorites + most-used — with FBR defaults. Used to populate the
// SmartItemAutocomplete dropdown when there's no search term (so users see a
// short curated list instead of having to search 15k+ FBR catalog entries).
export const getTopItems = (take = 15) =>
  httpClient.get("/lookup/items/top", { params: { take } });

// Mark/unmark an item description as a favorite.
export const toggleItemFavorite = (id, isFavorite) =>
  httpClient.put(`/lookup/items/${id}/favorite`, { isFavorite });
