import { MdChevronLeft, MdChevronRight } from "react-icons/md";
import { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";

/**
 * "1–10 of 27" with previous / next and a rows selector. Kept deliberately quiet: no numbered
 * buttons. Same inputs as the existing Pagination (page, totalPages, total, pageSize, onPage, onPageSize).
 */
export default function Pager({ page, totalPages, total, pageSize, onPage, onPageSize, noun = "records" }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="u2-pager">
      <span aria-live="polite"><strong>{from.toLocaleString()}–{to.toLocaleString()}</strong> of {total.toLocaleString()} {noun}</span>
      <span className="u2-rows">
        {typeof onPageSize === "function" && (
          <label className="u2-rows">
            Rows
            <select className="u2-select" aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(parseInt(e.target.value, 10))}>
              {[...new Set([...PAGE_SIZE_OPTIONS, pageSize])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {totalPages > 1 && (
          <nav className="u2-pager__nav" aria-label="Pagination">
            <button type="button" className="u2-page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><MdChevronLeft size={18} aria-hidden="true" /></button>
            <span className="u2-pager__of">Page {page} of {totalPages}</span>
            <button type="button" className="u2-page-btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page"><MdChevronRight size={18} aria-hidden="true" /></button>
          </nav>
        )}
      </span>
    </div>
  );
}
