import { useState, useEffect, useRef } from "react";
import httpClient from "../api/httpClient";
import SearchableSelect from "./SearchableSelect";

/*
 * Endpoint-backed picker. Fetches its options from `endpoint` and renders them in the
 * shared searchable dropdown (SearchableSelect), so it looks like every other picker in
 * every theme. `onChange` still receives the full picked option (or null when cleared).
 * `className` is accepted for compatibility; the look now comes from the kit tokens.
 */
export default function SelectDropdown({
  label,
  endpoint,
  value,
  onChange,
  placeholder = "Select an option",
  optionLabelKey = "name",
  optionValueKey = "id",
  // eslint-disable-next-line no-unused-vars
  className,
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const prevEndpointRef = useRef(null);

  useEffect(() => {
    if (prevEndpointRef.current === endpoint) return;
    prevEndpointRef.current = endpoint;

    const fetchOptions = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await httpClient.get(endpoint);
        setOptions(response.data || []);
      } catch (err) {
        console.error("Dropdown fetch error:", err);
        setError("Failed to load options");
      } finally {
        setLoading(false);
      }
    };

    fetchOptions();
  }, [endpoint]);

  return (
    <div className="k-field">
      {label && <label className="k-field__label">{label}</label>}
      <SearchableSelect
        items={options}
        value={value?.[optionValueKey] || ""}
        onChange={(id, picked) => onChange(picked || null)}
        valueKey={optionValueKey}
        labelKey={optionLabelKey}
        placeholder={loading ? "Loading..." : placeholder}
        disabled={loading || !!error}
        loading={loading}
        ariaLabel={label || placeholder}
      />
      {error && <span className="k-field__error" role="alert">{error}</span>}
    </div>
  );
}
