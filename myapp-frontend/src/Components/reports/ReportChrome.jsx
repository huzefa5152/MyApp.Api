import { MdPictureAsPdf, MdPrint } from "react-icons/md";
import "./ReportWorkspace.css";

/**
 * The identity bar every report screen opens with: icon, section, title and a
 * one-line provenance on the left; the report's own actions on the right.
 * Purely presentational — each screen keeps its own handlers.
 */
export function ReportBar({ icon, crumb, title, meta, actions }) {
  return (
    <header className="rw-head">
      <div className="rw-head__id">
        {icon && <span className="rw-icon">{icon}</span>}
        <div className="rw-head__text">
          {crumb && <span className="rw-crumb">{crumb}</span>}
          <h1 className="rw-title">{title}</h1>
          {meta && <div className="rw-meta">{meta}</div>}
        </div>
      </div>
      {actions && <div className="rw-head__actions">{actions}</div>}
    </header>
  );
}

/** items: [{ label, value, tone?: "lead" | "good" | "bad", sub? }] */
export function ReportKpis({ items }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="rw-kpis">
      {shown.map((k) => (
        <div key={k.label} className={`rw-kpi${k.tone ? ` rw-kpi--${k.tone}` : ""}`}>
          <span className="rw-kpi__label">{k.label}</span>
          <span className="rw-kpi__value">{k.value}</span>
          {k.sub && <span className="rw-kpi__sub">{k.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** The company picker, sized for the report bar. */
export function CompanyPicker({ icon, companies, selectedCompany, onChange }) {
  if (!companies || companies.length < 2) return null;
  return (
    <label className="rw-company">
      {icon}
      <select
        aria-label="Company"
        value={selectedCompany?.id || ""}
        onChange={(e) => onChange(companies.find((c) => String(c.id) === e.target.value))}
      >
        {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
      </select>
    </label>
  );
}

/** Print + PDF of the report itself, on the company letterhead. */
export function PrintPdfButtons({ onPrint, onPdf, busy, disabled }) {
  return (
    <>
      <button type="button" className="rw-btn" onClick={onPrint} disabled={disabled || !!busy} title="Print this report on the company letterhead">
        <MdPrint size={17} /><span>Print</span>
      </button>
      <button type="button" className="rw-btn rw-btn--primary" onClick={onPdf} disabled={disabled || !!busy} title="Save this report as a PDF on the company letterhead">
        <MdPictureAsPdf size={17} /><span>{busy === "pdf" ? "Building…" : "PDF"}</span>
      </button>
    </>
  );
}

export const Dot = ({ children }) => (
  <>
    <span className="rw-meta__dot" aria-hidden="true">·</span>
    <span>{children}</span>
  </>
);
