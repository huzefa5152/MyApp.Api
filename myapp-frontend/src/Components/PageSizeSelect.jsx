import { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import { colors } from "../theme";

const wrap = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  fontSize: "0.82rem",
  color: colors.textSecondary,
  fontWeight: 500,
};

const select = {
  minHeight: 44, // tap target (CLAUDE.md §3)
  padding: "0.3rem 0.6rem",
  borderRadius: 8,
  border: `1px solid ${colors.inputBorder}`,
  backgroundColor: "#fff",
  color: colors.blue,
  fontSize: "0.82rem",
  fontWeight: 600,
  cursor: "pointer",
  outline: "none",
};

// Row-count selector for paginated screens. Controlled: `value` is the
// effective size to display (a stored choice, else the server-echoed default),
// `onChange` receives the newly picked size as a number.
export default function PageSizeSelect({ value, onChange, options = PAGE_SIZE_OPTIONS }) {
  return (
    <label style={wrap}>
      Rows:
      <select
        style={select}
        value={value ?? options[0]}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        aria-label="Rows per page"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
