import { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
// Look (44px tap target in Classic, compact in Workspace) lives in Pagination.css
// as .pagination-size / .pagination-size__select, driven by the --pg-* tokens.
import "./Pagination.css";

// Row-count selector for paginated screens. Controlled: `value` is the
// effective size to display (a stored choice, else the server-echoed default),
// `onChange` receives the newly picked size as a number.
export default function PageSizeSelect({ value, onChange, options = PAGE_SIZE_OPTIONS }) {
  return (
    <label className="pagination-size">
      Rows:
      <select
        className="pagination-size__select"
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
