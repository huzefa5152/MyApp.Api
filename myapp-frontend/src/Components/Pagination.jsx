import { MdChevronLeft, MdChevronRight } from "react-icons/md";
import PageSizeSelect from "./PageSizeSelect";
import "./Pagination.css";

/**
 * Shared, mobile-friendly pagination bar. Replaces the per-page inline
 * copies (styles.pagination / pageBtn / pageInfo) that cramped and
 * overflowed on a phone.
 *
 * Responsive behaviour (see Pagination.css):
 *   - Desktop/tablet: one centered row — [Rows ▾] [Prev] [Page x of y (n total)] [Next].
 *   - Phone (≤599.98px): the nav row spans full width with Prev / info / Next
 *     spaced apart (≥44px tap targets); the rows-per-page selector wraps to
 *     its own centered line. No horizontal page scroll.
 *
 * Props:
 *   page        current 1-based page
 *   totalPages  total page count
 *   total       total row count (shown as "(n unit)"; omit to hide the count)
 *   onPage(n)   page change handler
 *   pageSize    current rows-per-page (omit with onPageSize to hide the selector)
 *   onPageSize(n)  rows-per-page change handler
 *   unit        noun after the count — "total" (default) / "rows"
 */
export default function Pagination({
  page,
  totalPages,
  total,
  onPage,
  pageSize,
  onPageSize,
  unit = "total",
}) {
  const showSize = typeof onPageSize === "function";
  const showNav = totalPages > 1;
  if (!showSize && !showNav) return null;

  return (
    <div className="pagination-bar">
      {showSize && <PageSizeSelect value={pageSize} onChange={onPageSize} />}
      {showNav && (
        <div className="pagination-nav">
          <button
            type="button"
            className="pagination-btn"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <MdChevronLeft size={20} />
            <span className="pagination-btn__label">Prev</span>
          </button>
          <span className="pagination-info">
            Page {page} of {totalPages}
            {total != null && (
              <span className="pagination-info__count"> ({total.toLocaleString()} {unit})</span>
            )}
          </span>
          <button
            type="button"
            className="pagination-btn"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <span className="pagination-btn__label">Next</span>
            <MdChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
