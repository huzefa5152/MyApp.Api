import { useState, useEffect, useRef } from "react";
import httpClient from "../api/httpClient";
import { dropdownStyles } from "../theme";

export default function SelectDropdown({
  label,
  endpoint,
  value,
  onChange,
  placeholder = "Select an option",
  optionLabelKey = "name",
  optionValueKey = "id",
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

  const useThemeStyle = className === "" || className === undefined;

  return (
    <div>
      {label && (
        <label
          style={{
            display: "block",
            marginBottom: "0.35rem",
            fontWeight: 600,
            fontSize: "0.85rem",
            color: "#5f6d7e",
          }}
        >
          {label}
        </label>
      )}
      <select
        className={useThemeStyle ? undefined : className}
        style={useThemeStyle ? { ...dropdownStyles.base, width: "100%" } : undefined}
        value={value?.[optionValueKey] || ""}
        onChange={(e) => {
          const selected = options.find(
            (opt) => String(opt[optionValueKey]) === e.target.value
          );
          onChange(selected || null);
        }}
        disabled={loading || !!error}
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
      {error && (
        <div style={{ color: "#dc3545", fontSize: "0.78rem", marginTop: "0.25rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}
