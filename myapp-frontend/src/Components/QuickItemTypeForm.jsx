import { useState } from "react";
import { MdLock, MdInfo, MdInventory2 } from "react-icons/md";
import { createItemType, getItemTypeFbrHints } from "../api/itemTypeApi";
import { formStyles, modalSizes } from "../theme";
import HsCodeAutocomplete from "./HsCodeAutocomplete";

// Inline mini-form for "+ New Item Type". Scenario-aware:
//
//   • Sale Type is LOCKED to the parent bill's scenario.saleType when
//     opened from a scenario context — saving a mismatched sale type
//     would just block the bill at FBR validation. Outside a scenario,
//     it falls back to a freeform select.
//
//   • HS Code is a live typeahead against `/api/fbr/hscodes/{companyId}`,
//     filtered by the locked sale type when one is provided. Picking a
//     code calls /api/itemtypes/fbr-hints which fills UOM (and the FBR
//     uoM_ID) automatically. If the FBR hint suggests a different sale
//     type than the scenario lock, surface that as a heads-up.
//
// Used by both bill creation forms (with and without challan).
export default function QuickItemTypeForm({ companyId, onClose, onSaved, scenarioCode, scenarioSaleType }) {
  const lockedSaleType = !!scenarioSaleType;

  const [name, setName] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [uom, setUom] = useState("");
  const [fbrUOMId, setFbrUOMId] = useState(null);
  const [saleType, setSaleType] = useState(scenarioSaleType || "Goods at standard rate (default)");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // FBR hint state — fetched after the operator picks an HS code via
  // HsCodeAutocomplete. Drives UOM auto-fill and the sale-type-mismatch
  // heads-up below.
  const [fbrHint, setFbrHint] = useState(null);
  const [hintLoading, setHintLoading] = useState(false);

  // HsCodeAutocomplete fires onChange with the FULL HS code only when the
  // operator clicks a suggestion (manual typing fires onChange with whatever
  // they typed). We treat any change with a 4+ char numeric-ish value as a
  // "pick" and trigger the FBR-hints lookup. The hint endpoint is cheap and
  // the UOM auto-fill is the whole point of this form.
  const onHsChange = async (code) => {
    setHsCode(code);
    if (!code || code.replace(/\D/g, "").length < 4) {
      setFbrHint(null);
      return;
    }
    setHintLoading(true);
    setFbrHint(null);
    try {
      const { data } = await getItemTypeFbrHints(companyId, code);
      setFbrHint(data);
      if (data?.defaultUom) {
        setUom(data.defaultUom.description || "");
        setFbrUOMId(data.defaultUom.uoM_ID || null);
      }
      if (!lockedSaleType && data?.defaultSaleType) {
        setSaleType(data.defaultSaleType);
      }
    } catch { /* hints unavailable; UOM stays editable */ }
    finally { setHintLoading(false); }
  };

  const saleTypeMismatch = lockedSaleType
    && fbrHint?.defaultSaleType
    && fbrHint.defaultSaleType !== scenarioSaleType;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    try {
      const { data } = await createItemType({
        name: name.trim(),
        hsCode: hsCode.trim() || null,
        uom: uom.trim() || null,
        fbrUOMId: fbrUOMId || null,
        saleType: saleType || null,
      }, companyId);
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create item type.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...formStyles.backdrop, zIndex: 1100 }}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.sm}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdInventory2 style={{ verticalAlign: "-3px", marginRight: 4 }} size={16} />
            New Item Type
            {scenarioCode && <span style={styles.scenarioPillSmall}>{scenarioCode}</span>}
          </h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={submit}>
          <div style={formStyles.body}>
            {error && <div style={styles.errorAlert}>{error}</div>}
            <p style={{ margin: "0 0 0.6rem", fontSize: "0.78rem", color: colors.textSecondary }}>
              Adds a new entry to your product catalog.
              {scenarioCode
                ? ` Sale Type is locked to ${scenarioCode}'s rule; UOM auto-fills from FBR's HS-UOM mapping.`
                : " Pick an HS code to auto-fill UOM."}
              {" "}You can fine-tune later from <b>Configuration → Item Types</b>.
            </p>

            <div style={formStyles.formGroup}>
              <label style={styles.label}>Name *</label>
              <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>

            <div style={formStyles.formGroup}>
              <label style={styles.label}>
                HS Code
                {hintLoading && <span style={styles.lockedTag}>looking up UOM…</span>}
              </label>
              {/* Reuse the same HsCodeAutocomplete the Item Types page uses —
                  click/focus opens the catalog browser without typing, type
                  to search. saleType prop narrows the catalog server-side
                  to codes whose HS-prefix heuristic maps to the scenario's
                  sale type, so SN001 only sees standard-rate codes, SN015
                  only sees mobile-phone codes, etc. */}
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
              />
              {fbrHint?.notes?.length > 0 && (
                <span style={{ fontSize: "0.72rem", color: colors.textSecondary, marginTop: "0.2rem", display: "block" }}>
                  {fbrHint.notes[0]}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={styles.label}>
                  UOM
                  {fbrUOMId && <span style={styles.lockedTag}>FBR-mapped</span>}
                </label>
                <input
                  style={styles.input}
                  value={uom}
                  onChange={(e) => { setUom(e.target.value); setFbrUOMId(null); }}
                  placeholder="auto-fills from HS code"
                />
              </div>
              <div style={formStyles.formGroup}>
                <label style={styles.label}>
                  Sale Type
                  {lockedSaleType && <span style={styles.lockedTag}><MdLock size={10} /> {scenarioCode}</span>}
                </label>
                {lockedSaleType ? (
                  <input
                    style={{ ...styles.input, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                    value={saleType}
                    readOnly
                    title={`Locked to ${scenarioCode}'s sale type. Cancel to use a different scenario.`}
                  />
                ) : (
                  <select style={styles.input} value={saleType} onChange={(e) => setSaleType(e.target.value)}>
                    <option>Goods at standard rate (default)</option>
                    <option>Goods at Reduced Rate</option>
                    <option>Goods at zero-rate</option>
                    <option>Exempt goods</option>
                    <option>3rd Schedule Goods</option>
                    <option>Services</option>
                    <option>Services (FED in ST Mode)</option>
                    <option>Goods (FED in ST Mode)</option>
                  </select>
                )}
              </div>
            </div>

            {saleTypeMismatch && (
              <div style={styles.warnAlert}>
                <MdInfo size={14} /> Heads-up: FBR usually treats this HS code as
                <b style={{ margin: "0 0.25rem" }}>{fbrHint.defaultSaleType}</b>,
                but you're saving it as <b>{saleType}</b> to match {scenarioCode}.
                That's fine — the bill will validate as long as your scenario allows this HS code.
              </div>
            )}
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }} disabled={saving}>
              {saving ? "Creating…" : "Create"}
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
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  warn: "#e65100",
  warnLight: "#fff8e1",
};
const styles = {
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  warnAlert: { display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.65rem 0.85rem", borderRadius: 8, backgroundColor: colors.warnLight, border: `1px solid ${colors.warn}30`, color: colors.warn, fontSize: "0.85rem" },
  lockedTag: { marginLeft: "0.3rem", padding: "0.05rem 0.3rem", borderRadius: 4, backgroundColor: "#e0f2f1", color: "#00695c", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 2 },
  scenarioPillSmall: { marginLeft: "0.5rem", padding: "0.1rem 0.4rem", borderRadius: 4, backgroundColor: "#e3f2fd", color: "#0d47a1", fontSize: "0.7rem", fontWeight: 800, fontFamily: "monospace" },
};
