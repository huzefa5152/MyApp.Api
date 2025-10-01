import { useState, useEffect, useRef } from "react";
import httpClient from "../api/httpClient";

export default function SelectDropdown({
  label,
  endpoint,
  value,
  onChange,
  placeholder = "Select an option",
  optionLabelKey = "name",
  optionValueKey = "id",
  className = "form-select"
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fetchedRef = useRef(false);

  useEffect(() => {
    const fetchOptions = async () => {
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

    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchOptions();
    }
  }, [endpoint]);

  return (
    <div>
      {label && <label className="form-label">{label}</label>}
      <select
        className={className}
        value={value?.[optionValueKey] || ""}
        onChange={(e) => {
          const selected = options.find(
            (opt) => String(opt[optionValueKey]) === e.target.value
          );
          onChange(selected || null);
        }}
        disabled={loading || error}
      >
        <option value="">
          {loading ? "Loading..." : placeholder}
        </option>
        {options.map((opt) => (
          <option key={opt[optionValueKey]} value={opt[optionValueKey]}>
            {opt[optionLabelKey]}
          </option>
        ))}
      </select>
      {error && <div className="text-danger small mt-1">{error}</div>}
    </div>
  );
}
