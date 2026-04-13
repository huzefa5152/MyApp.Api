// src/components/LookupAutocomplete.jsx
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import httpClient from "../api/httpClient";

export default function LookupAutocomplete({ label, endpoint, value, onChange, inputClassName, inputStyle }) {
    const [suggestions, setSuggestions] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [inputValue, setInputValue] = useState(value || "");
    const [loading, setLoading] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const wrapperRef = useRef(null);
    const debounceRef = useRef(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            clearTimeout(debounceRef.current);
        };
    }, []);

    // Update inputValue if parent value changes
    useEffect(() => {
        setInputValue(value || "");
    }, [value]);

    const fetchSuggestions = (query) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        debounceRef.current = setTimeout(async () => {
            const trimmedQuery = query.trim();
            if (!trimmedQuery) {
                setSuggestions([]);
                return;
            }

            setLoading(true);
            try {
                const response = await httpClient.get(endpoint, { params: { query: trimmedQuery } });
                setSuggestions(response.data || []);
            } catch (err) {
                console.error("Lookup fetch error:", err);
                setSuggestions([]);
            } finally {
                setLoading(false);
            }
        }, 400);
    };

    const createEntry = async (val) => {
        try {
            const response = await httpClient.post(endpoint, { name: val });
            // Refresh suggestions with the newly created entry
            fetchSuggestions(val);
            return response.data.name || val;
        } catch (err) {
            console.error("Lookup create error:", err);
            return val;
        }
    };

    const handleSelect = async (val) => {
        let finalValue = val;
        if (!suggestions.some((s) => s.name === val)) {
            finalValue = await createEntry(val);
        }
        setInputValue(finalValue);
        onChange(finalValue);
        setShowDropdown(false);
    };


    const handleInputChange = (e) => {
        const val = e.target.value;
        setInputValue(val);
        onChange(val);
        fetchSuggestions(val);
        setShowDropdown(true);
    };

    const handleBlur = async () => {
        if (inputValue && !suggestions.some((s) => s.name === inputValue)) {
            const finalValue = await createEntry(inputValue);
            setInputValue(finalValue);
            onChange(finalValue);
        }
        setShowDropdown(false);
    };

    const handleKeyDown = (e) => {
        if (!showDropdown || suggestions.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightIndex((prev) => (prev + 1) % suggestions.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightIndex((prev) =>
                prev <= 0 ? suggestions.length - 1 : prev - 1
            );
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (highlightIndex >= 0) {
                handleSelect(suggestions[highlightIndex].name);
            } else if (valueExists) {
                handleSelect(inputValue);
            }
        }
    };

    const valueExists = !suggestions.some((s) => s.name === inputValue) && inputValue.trim() !== "";

    return (
        <div className="position-relative" ref={wrapperRef}>
            <input
                type="text"
                className={inputClassName !== undefined ? inputClassName : "form-control"}
                style={inputStyle}
                placeholder={label}
                value={inputValue}
                onChange={handleInputChange}
                onFocus={() => { if (inputValue) { setShowDropdown(true); fetchSuggestions(inputValue); } }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}   // 👈 added
                autoComplete="off"
            />

            {showDropdown && (
                createPortal(
                    <ul
                        className="list-group shadow-sm"
                        style={{
                            position: "absolute",
                            zIndex: 9999,
                            maxHeight: "300px",
                            overflowY: "auto",
                            borderRadius: "0.375rem",
                            background: "#fff",
                            top: wrapperRef.current?.getBoundingClientRect().bottom + window.scrollY,
                            left: wrapperRef.current?.getBoundingClientRect().left + window.scrollX,
                            width: wrapperRef.current?.offsetWidth
                        }}
                    >

                        {loading && <li className="list-group-item text-muted">Loading...</li>}

                        {suggestions.map((s, idx) => (
                            <li
                                key={s.id}
                                className={`list-group-item list-group-item-action ${idx === highlightIndex ? "active" : ""
                                    }`}
                                style={{ cursor: "pointer" }}
                                onMouseDown={() => handleSelect(s.name)}
                            >
                                {s.name}
                            </li>
                        ))}

                        {valueExists && (
                            <li
                                className="list-group-item list-group-item-action text-success"
                                style={{ cursor: "pointer", fontWeight: "bold" }}
                                onMouseDown={() => handleSelect(inputValue)}
                            >
                                + Create new "{inputValue}"
                            </li>
                        )}
                    </ul>,
                    document.body)
            )}
        </div>
    );
}
