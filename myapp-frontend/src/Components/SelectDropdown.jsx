import { useState, useEffect, useRef } from "react";
import httpClient from "../api/httpClient";
import SearchableSelect from "./SearchableSelect";

/**
 * Thin wrapper over the common SearchableSelect combobox (so every dropdown in
 * the app shares one searchable control). Backwards-compatible with the old
 * native-<select> API:
 *   - endpoint        fetch options from this URL (or pass `options` directly)
 *   - value           the selected OPTION OBJECT (legacy) or its id
 *   - onChange        called with the selected option object (or null)
 *   - returnId        when true, onChange receives the id instead of the object
 *   - optionLabelKey / optionValueKey  field names (default name / id)
 */
export default function SelectDropdown({
  label,
  endpoint,
  options: providedOptions,
  value,
  onChange,
  placeholder = "Select an option",
  optionLabelKey = "name",
  optionValueKey = "id",
  searchKeys,
  returnId = false,
  disabled = false,
}) {
  const [fetched, setFetched] = useState([]);
  const [loading, setLoading] = useState(!!endpoint && !providedOptions);
  const [error, setError] = useState("");
  const prevEndpointRef = useRef(null);

  useEffect(() => {
    if (providedOptions || !endpoint) { setLoading(false); return; }
    if (prevEndpointRef.current === endpoint) return;
    prevEndpointRef.current = endpoint;
    (async () => {
      setLoading(true); setError("");
      try {
        const response = await httpClient.get(endpoint);
        setFetched(response.data || []);
      } catch (err) {
        console.error("Dropdown fetch error:", err);
        setError("Failed to load options");
      } finally {
        setLoading(false);
      }
    })();
  }, [endpoint, providedOptions]);

  const items = providedOptions || fetched;
  // Accept either the legacy selected-object or a raw id as `value`.
  const selectedId = value && typeof value === "object" ? value[optionValueKey] : value;

  return (
    <div>
      {label && (
        <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: "#5f6d7e" }}>
          {label}
        </label>
      )}
      <SearchableSelect
        items={items}
        value={selectedId ?? ""}
        valueKey={optionValueKey}
        labelKey={optionLabelKey}
        searchKeys={searchKeys || [optionLabelKey]}
        placeholder={placeholder}
        loading={loading}
        disabled={disabled || !!error}
        onChange={(id, item) => {
          if (returnId) onChange?.(id === "" ? null : id);
          else onChange?.(item || null);
        }}
      />
      {error && <div style={{ color: "#dc3545", fontSize: "0.78rem", marginTop: "0.25rem" }}>{error}</div>}
    </div>
  );
}
