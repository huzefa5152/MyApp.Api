// ItemTypeForm — single shared modal for creating / editing an ItemType.
//
// Used in four places:
//   1. Configuration → Item Types (create + edit + isFavorite + rich FBR hints)
//   2. New Bill (InvoiceForm) — inline create, scenario-locked sale type
//   3. New Bill (No Challan, StandaloneInvoiceForm) — same as #2
//   4. Invoice Edit (EditBillForm) — same as #2
//
// Replaces the inline form on ItemTypesPage and the standalone
// QuickItemTypeForm component. Future field / UX changes happen once
// here and propagate to every call site.
//
// Props:
//   editItem          — when present, switches to edit mode (PUT)
//   companyId         — used for FBR hint lookup + back-fill query param
//   scenarioCode      — optional; when set, sale type is locked + HS code
//                       typeahead filters to scenario-valid codes
//   scenarioSaleType  — optional; the sale type the scenario locks to
//   showFavoriteToggle — render the "favorite" checkbox (ItemTypesPage)
//   showRichHints     — render the FBR rate options / notes panel
//                       (ItemTypesPage; bill-form usage keeps the modal
//                       small)
//   existingHsCodes   — already-used HS codes to hide from the catalog
//                       autocomplete (prevents creating two items for
//                       the same code)
//   onClose           — called on Cancel / X
//   onSaved           — called with the saved item type after a 2xx

import { useEffect, useRef, useState } from "react";
import { MdLock, MdInfo, MdInventory2 } from "react-icons/md";
import { createItemType, updateItemType, getItemTypeFbrHints } from "../api/itemTypeApi";
import { getFbrHsUom } from "../api/fbrApi";
import { formStyles, modalSizes } from "../theme";
import HsCodeAutocomplete from "./HsCodeAutocomplete";
import LookupAutocomplete from "./LookupAutocomplete";

// 2026-05-14 perf: module-level cache for FBR-hint responses keyed by
// `${companyId}:${hsCode}`. PRAL latency dominates the lookup time
// (typically 1-2 s per call even with parallelisation), so caching in
// the browser session means picking the same HS code twice — or
// flipping between HS codes the operator has already inspected — is
// effectively instant. Cleared on full page reload, NOT scoped to the
// modal lifetime, so subsequent opens of the ItemTypeForm reuse
// previous lookups.
//
// Keyed by both companyId AND hsCode because the FBR call is
// authenticated with the company's PRAL token and the master list,
// while in practice global, can technically differ per tenant.
const hsHintCache = new Map();
const hsHintCacheKey = (companyId, hsCode) =>
  `${companyId}:${String(hsCode).trim().toLowerCase()}`;

const SALE_TYPES = [
  "Goods at standard rate (default)",
  "Goods at Reduced Rate",
  "Goods at zero-rate",
  "Exempt goods",
  "3rd Schedule Goods",
  "Services",
  "Services (FED in ST Mode)",
  "Goods (FED in ST Mode)",
  "Steel Melting and re-rolling",
  "Toll Manufacturing",
  "Mobile Phones",
  "Petroleum Products",
  "Electric Vehicle",
  "Cement /Concrete Block",
  "Processing/Conversion of Goods",
  "Cotton Ginners",
  "Non-Adjustable Supplies",
];

export default function ItemTypeForm({
  editItem = null,
  companyId,
  scenarioCode,
  scenarioSaleType,
  showFavoriteToggle = false,
  showRichHints = false,
  existingHsCodes = [],
  onClose,
  onSaved,
}) {
  const mode = editItem ? "edit" : "create";
  const lockedSaleType = !!scenarioSaleType;

  const [name, setName] = useState(editItem?.name || "");
  const [hsCode, setHsCode] = useState(editItem?.hsCode || "");
  const [uom, setUom] = useState(editItem?.uom || "");
  const [fbrUOMId, setFbrUOMId] = useState(editItem?.fbrUOMId || null);
  const [saleType, setSaleType] = useState(
    scenarioSaleType || editItem?.saleType || "Goods at standard rate (default)"
  );
  const [fbrDescription, setFbrDescription] = useState(editItem?.fbrDescription || "");
  const [isFavorite, setIsFavorite] = useState(editItem?.isFavorite ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // FBR hint bundle for the currently-typed HS code: valid UOMs,
  // suggested sale type, suggested rate %, live SaleTypeToRate options.
  // Used as INFORMATION when showRichHints is true; always used to
  // pre-fill the UOM field when it's blank.
  const [hsHints, setHsHints] = useState(null);
  const [hintLoading, setHintLoading] = useState(false);

  // 2026-05-14: refs that protect the FBR-hint lookup from three
  // failure modes:
  //   • Race condition — picking HS code A then B before A's response
  //     arrives. The version counter (lookupSeq) tags each lookup; we
  //     only apply the result when the version is still current.
  //   • Keystroke flicker — HsCodeAutocomplete fires `onChange` on
  //     every keystroke. Debouncing the fetch by 250 ms means a normal
  //     paste / pick costs one request, not eight.
  //   • Unmount mid-lookup — `aliveRef` is flipped false on cleanup
  //     so setState calls on a stale promise become no-ops instead of
  //     "setState on unmounted component" warnings.
  const lookupSeqRef = useRef(0);
  const debounceRef = useRef(null);
  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // On open in edit mode WITH an existing HS code, fetch hints
  // **silently** so the operator sees the FBR recommendation alongside
  // the saved value WITHOUT a "looking up UOM…" badge flicker. Saved
  // values are sacred in edit mode; we don't apply the override here.
  // The silent flag suppresses the hintLoading toggle so the UOM
  // label keeps showing the persistent "🔒 HS-locked" state.
  useEffect(() => {
    if (editItem?.hsCode && companyId) {
      void fetchHsHints(editItem.hsCode, { silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Race-safe + alive-safe FBR-hint fetcher. Returns the data when the
  // caller's version is still current; returns null when the call was
  // superseded by a newer pick OR when the modal unmounted mid-flight.
  //
  // 2026-05-14 perf: hits the module-level hsHintCache first. Cache
  // hits skip the network round-trip entirely — re-picking the same
  // HS code (or flipping back to a previously-inspected one in the
  // same session) is instantaneous instead of paying the 1-2 s PRAL
  // latency again.
  // `silent: true` skips the hintLoading toggle so the UOM label
  // doesn't flicker. Used by the edit-mode mount fetch (the field
  // already shows a saved value; no need for a "looking up" badge).
  const fetchHsHints = async (code, { silent = false } = {}) => {
    if (!code || code.replace(/\D/g, "").length < 4 || !companyId) {
      if (aliveRef.current) setHsHints(null);
      return null;
    }
    const cacheKey = hsHintCacheKey(companyId, code);
    if (hsHintCache.has(cacheKey)) {
      const cached = hsHintCache.get(cacheKey);
      if (aliveRef.current) {
        setHsHints(cached);
        if (!silent) setHintLoading(false);
      }
      return cached;
    }
    const myVersion = ++lookupSeqRef.current;
    if (aliveRef.current && !silent) setHintLoading(true);
    try {
      const { data } = await getItemTypeFbrHints(companyId, code);
      if (!aliveRef.current || myVersion !== lookupSeqRef.current) return null;
      if (data) hsHintCache.set(cacheKey, data);
      setHsHints(data);
      return data;
    } catch {
      try {
        const { data } = await getFbrHsUom(companyId, code, 3);
        if (!aliveRef.current || myVersion !== lookupSeqRef.current) return null;
        if (Array.isArray(data) && data.length > 0) {
          const synthetic = { uoms: data, defaultUom: data[0], defaultSaleType: null, saleTypeOptions: [] };
          // Cache the synthetic fallback too — better than re-paying
          // for an endpoint that's already failed once.
          hsHintCache.set(cacheKey, synthetic);
          setHsHints(synthetic);
          return synthetic;
        }
      } catch { /* nothing */ }
      return null;
    } finally {
      if (aliveRef.current && !silent && myVersion === lookupSeqRef.current) {
        setHintLoading(false);
      }
    }
  };

  // Operator picks / changes HS code. Debounced — HsCodeAutocomplete
  // fires `onChange` per keystroke, but the FBR-hint fetch only runs
  // 250 ms after the operator stops typing (or picks from the dropdown,
  // which is also a single onChange call).
  //
  // When an HS code is set the FBR-recommended UOM **overrides**
  // whatever the user typed previously. The UOM field then becomes
  // read-only until the HS code is cleared again.
  //
  // Sale type still only pre-fills when blank / seed-default — the
  // operator may legitimately want a non-default sale type even when
  // the HS code suggests one (e.g. SN028 reduced-rate variants).
  const onHsChange = (code) => {
    setHsCode(code);
    // Bump the version so any in-flight lookup from the previous code
    // becomes a no-op when it returns.
    lookupSeqRef.current += 1;
    setHsHints(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!code || !code.trim()) {
      // HS cleared → release the UOM lock; keep the current UOM value
      // so the operator can fine-tune via the autocomplete rather than
      // starting from scratch. BUT drop the FBR-mapped marker (its
      // badge would otherwise linger on the now-editable field).
      setFbrUOMId(null);
      setHintLoading(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const data = await fetchHsHints(code);
      if (!data || !aliveRef.current) return;
      if (data?.defaultUom?.description) {
        setUom(data.defaultUom.description);
        setFbrUOMId(data.defaultUom.uoM_ID || null);
      }
      if (!lockedSaleType && data?.defaultSaleType) {
        if (!saleType || saleType === "Goods at standard rate (default)") {
          setSaleType(data.defaultSaleType);
        }
      }
    }, 250);
  };

  const saleTypeMismatch = lockedSaleType
    && hsHints?.defaultSaleType
    && hsHints.defaultSaleType !== scenarioSaleType;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        hsCode: hsCode?.trim() || null,
        uom: uom?.trim() || null,
        fbrUOMId: fbrUOMId || null,
        saleType: saleType || null,
        fbrDescription: fbrDescription?.trim() || null,
        isFavorite: !!isFavorite,
      };
      let saved;
      if (mode === "edit") {
        const { data } = await updateItemType(editItem.id, { ...payload, id: editItem.id }, companyId);
        saved = data;
      } else {
        const { data } = await createItemType(payload, companyId);
        saved = data;
      }
      onSaved?.(saved);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const uomMissing = !uom.trim();
  // 2026-05-14: once an HS code is picked, the FBR-recommended UOM is
  // authoritative — lock the input so the operator can't drift the row
  // away from what FBR will accept. Clearing the HS code releases the
  // lock. See onHsChange above for how the override is applied.
  const uomLocked = !!hsCode.trim();
  const blockReason = hintLoading
    ? "Waiting for FBR's recommended UOM…"
    : uomMissing
      ? "Pick or type a UOM before saving."
      : null;
  const blocked = saving || hintLoading || uomMissing;
  const submitLabel = saving
    ? (mode === "edit" ? "Saving…" : "Creating…")
    : hintLoading
      ? "Looking up UOM…"
      : mode === "edit" ? "Update" : "Create";

  return (
    <div style={{ ...formStyles.backdrop, zIndex: 1100 }}>
      <div
        style={{
          ...formStyles.modal,
          maxWidth: `${showRichHints ? modalSizes.md : modalSizes.sm}px`,
          cursor: "default",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdInventory2 style={{ verticalAlign: "-3px", marginRight: 4 }} size={16} />
            {mode === "edit" ? "Edit Item Type" : "New Item Type"}
            {scenarioCode && <span style={styles.scenarioPill}>{scenarioCode}</span>}
          </h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={submit}>
          <div style={formStyles.body}>
            {error && <div style={styles.errorAlert}>{error}</div>}

            <p style={styles.intro}>
              Adds an entry to your product catalog.{" "}
              {scenarioCode
                ? `Sale Type is locked to ${scenarioCode}'s rule; UOM auto-fills from FBR's HS-UOM mapping.`
                : "Pick an HS code to auto-fill UOM, sale type, and rate."}
            </p>

            <div style={formStyles.formGroup}>
              <label style={styles.label}>Name *</label>
              <input
                style={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder="e.g. Ball Valve 2 inch"
              />
            </div>

            <div style={formStyles.formGroup}>
              <label style={styles.label}>
                HS Code{" "}
                {hintLoading && <span style={styles.lockedTag}>looking up UOM…</span>}
                {!hintLoading && mode === "create" && <span style={styles.optTag}>Optional</span>}
              </label>
              <HsCodeAutocomplete
                companyId={companyId}
                value={hsCode}
                onChange={onHsChange}
                saleType={scenarioSaleType || null}
                style={{ ...styles.input, fontFamily: "monospace" }}
                placeholder={
                  scenarioSaleType
                    ? `Click to browse — filtered to ${scenarioSaleType}`
                    : "Click to browse FBR catalog, or type e.g. 'valve', 'mobile'"
                }
                excludeHsCodes={existingHsCodes}
              />
              <p style={styles.hint}>
                Must be picked from FBR's official catalog. A free-typed code that
                isn't in PRAL's master list will be rejected at save time.
              </p>

              {showRichHints && hsHints && (
                <div style={styles.hintBox}>
                  <div style={styles.hintBoxTitle}>FBR suggestions for this HS code</div>
                  {hsHints.defaultRate != null && (
                    <div style={styles.hintRow}>
                      <span style={styles.hintLabel}>Recommended rate:</span>
                      <strong>{hsHints.defaultRate}%</strong>
                      <span style={styles.hintLabel} title="Pre-fills the GST Rate when this item is added to a bill">
                        (applied to bills automatically)
                      </span>
                    </div>
                  )}
                  {hsHints.defaultSaleType && (
                    <div style={styles.hintRow}>
                      <span style={styles.hintLabel}>Suggested sale type:</span>
                      <em>{hsHints.defaultSaleType}</em>
                    </div>
                  )}
                  {hsHints.uoms?.length > 0 && (
                    <div style={styles.hintRow}>
                      <span style={styles.hintLabel}>Valid UOM(s):</span>
                      <span>{hsHints.uoms.map((u) => u.description).join(", ")}</span>
                    </div>
                  )}
                  {hsHints.rateOptions?.length > 0 && (
                    <div style={styles.hintRow}>
                      <span style={styles.hintLabel}>All FBR rate options today:</span>
                      <span>{hsHints.rateOptions.map((r) => `${r.rateValue}%`).join(" · ")}</span>
                    </div>
                  )}
                  {hsHints.notes?.length > 0 && (
                    <ul style={styles.hintNotes}>
                      {hsHints.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {!showRichHints && hsHints?.notes?.length > 0 && (
                <span style={styles.compactNote}>{hsHints.notes[0]}</span>
              )}
            </div>

            <div style={styles.row}>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>
                  UOM *
                  {/* 2026-05-14: badge progression —
                      ① during FBR lookup AND UOM not yet filled → "looking up UOM…"
                      ② post-override OR edit mode with saved UOM → "🔒 HS-locked"
                      ③ HS cleared / no override / no lock → no badge
                      The lookup badge is suppressed when the field is
                      already populated (edit-mode re-fetch shouldn't
                      flicker the label). */}
                  {/* 2026-05-14: badge state machine
                       ① `hintLoading` true → "looking up UOM…"
                         (set only by user-triggered HS changes; edit-
                          mode mount fetch is silent so this doesn't
                          flicker on initial open).
                       ② HS locked AND UOM populated AND no lookup
                          in flight → "🔒 HS-locked"
                       ③ otherwise → no badge.
                       Mutually exclusive — `hintLoading` always wins
                       so re-picking an HS code flips the badge from
                       HS-locked → looking up → HS-locked cleanly,
                       even though the old UOM value is still on
                       screen mid-fetch. */}
                  {hintLoading && (
                    <span style={styles.lockedTag}>looking up UOM…</span>
                  )}
                  {!hintLoading && uomLocked && uom.trim() && (
                    <span style={styles.lockedTag}>
                      <MdLock size={10} /> HS-locked
                    </span>
                  )}
                </label>
                {/* 2026-05-14: when an HS code is set, render a read-only
                    input showing the FBR-recommended UOM. The autocomplete
                    only renders when no HS code is picked, since the HS
                    code is the source of truth for UOM at submission time
                    — letting the operator pick a different one would
                    silently fail FBR validation with [0052]. */}
                {uomLocked ? (
                  <input
                    type="text"
                    value={uom}
                    readOnly
                    style={{ ...styles.input, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                    placeholder={hintLoading ? "Looking up UOM…" : "(no UOM mapped — clear HS code to edit)"}
                    title="UOM is driven by the HS code. Clear the HS code to edit it manually."
                  />
                ) : (
                  <LookupAutocomplete
                    endpoint="/lookup/units"
                    label="type to pick from your units"
                    value={uom}
                    onChange={(val) => { setUom(val); setFbrUOMId(null); }}
                    inputClassName=""
                    inputStyle={styles.input}
                  />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>
                  Sale Type
                  {lockedSaleType && (
                    <span style={styles.lockedTag}>
                      <MdLock size={10} /> {scenarioCode}
                    </span>
                  )}
                </label>
                {lockedSaleType ? (
                  <input
                    style={{ ...styles.input, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                    value={saleType}
                    readOnly
                    title={`Locked to ${scenarioCode}'s sale type. Cancel to use a different scenario.`}
                  />
                ) : (
                  <select
                    style={styles.input}
                    value={saleType}
                    onChange={(e) => setSaleType(e.target.value)}
                  >
                    {SALE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            </div>

            {saleTypeMismatch && (
              <div style={styles.warnAlert}>
                <MdInfo size={14} /> Heads-up: FBR usually treats this HS code as
                <b style={{ margin: "0 0.25rem" }}>{hsHints.defaultSaleType}</b>,
                but you're saving it as <b>{saleType}</b> to match {scenarioCode}.
                That's fine — the bill will validate as long as your scenario allows this HS code.
              </div>
            )}

            {showFavoriteToggle && (
              <div style={styles.field}>
                <label style={styles.favoriteLabel}>
                  <input
                    type="checkbox"
                    checked={isFavorite}
                    onChange={(e) => setIsFavorite(e.target.checked)}
                  />
                  Show in challan &amp; bill dropdowns (favorite)
                </label>
              </div>
            )}
          </div>

          <div style={formStyles.footer}>
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.cancel }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...formStyles.button,
                ...formStyles.submit,
                opacity: blocked ? 0.55 : 1,
                cursor: blocked ? "not-allowed" : "pointer",
              }}
              disabled={blocked}
              title={blockReason || ""}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const colors = {
  blue: "#0d47a1",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  warn: "#e65100",
  warnLight: "#fff8e1",
  hintBg: "#f3f7ff",
  hintBorder: "#cfd9ff",
};
const styles = {
  intro: { margin: "0 0 0.6rem", fontSize: "0.78rem", color: colors.textSecondary },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  hint: { fontSize: "0.72rem", color: colors.textSecondary, margin: "0.35rem 0 0" },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" },
  field: { marginTop: "0.75rem" },
  favoriteLabel: { display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.85rem", color: colors.textPrimary, fontWeight: 600 },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  warnAlert: { display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.65rem 0.85rem", borderRadius: 8, backgroundColor: colors.warnLight, border: `1px solid ${colors.warn}30`, color: colors.warn, fontSize: "0.85rem", marginTop: "0.75rem" },
  lockedTag: { marginLeft: "0.3rem", padding: "0.05rem 0.3rem", borderRadius: 4, backgroundColor: "#e0f2f1", color: "#00695c", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 2 },
  optTag: { marginLeft: "0.3rem", padding: "0.05rem 0.3rem", borderRadius: 4, backgroundColor: "#f1f5f9", color: "#475569", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase" },
  scenarioPill: { marginLeft: "0.5rem", padding: "0.1rem 0.4rem", borderRadius: 4, backgroundColor: "#e3f2fd", color: colors.blue, fontSize: "0.7rem", fontWeight: 800, fontFamily: "monospace" },
  hintBox: { marginTop: "0.5rem", padding: "0.6rem 0.75rem", borderRadius: 8, backgroundColor: colors.hintBg, border: `1px solid ${colors.hintBorder}`, fontSize: "0.78rem" },
  hintBoxTitle: { fontWeight: 700, color: colors.blue, marginBottom: "0.25rem" },
  hintRow: { display: "flex", flexWrap: "wrap", gap: "0.35rem", lineHeight: 1.4, marginBottom: "0.2rem" },
  hintLabel: { color: colors.textSecondary },
  hintNotes: { margin: "0.35rem 0 0 1.1rem", padding: 0, fontSize: "0.75rem", color: colors.textPrimary },
  compactNote: { display: "block", fontSize: "0.72rem", color: colors.textSecondary, marginTop: "0.2rem" },
};
