import { MdBusiness, MdSearch } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import useUi2 from "../ui2/useUi2";
import "./kit.css";

/*
 * UI kit — the shared building blocks every screen uses. Each one renders the same markup in
 * every theme; the theme decides the look through the --k-* tokens in kit.css. Screens pass
 * data and handlers only, so a component here can never drop a field or an action.
 */

const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * Page title row. `icon` is a react-icons component, `tone` one of
 * blue | teal | brand | purple | orange | green | red | slate.
 * `count` renders a small pill after the title; `subtitle` stays visible in every theme.
 */
export function PageHeader({ icon: Icon, tone = "blue", title, count, subtitle, actions, className }) {
  return (
    <header className={cx("k-header", `k-tone-${tone}`, className)}>
      <div className="k-header__lead">
        {Icon && <span className="k-header__icon" aria-hidden="true"><Icon /></span>}
        <div style={{ minWidth: 0 }}>
          <h2 className="k-header__title">
            {title}
            {count != null && <span className="k-count">{typeof count === "number" ? count.toLocaleString() : count}</span>}
          </h2>
          {subtitle && <p className="k-header__sub">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="k-header__actions">{actions}</div>}
    </header>
  );
}

/**
 * The per-page company picker. In themes with a topbar company switcher (workspace layout) the
 * topbar already drives the same CompanyContext, so this renders nothing there; in Classic it
 * is the page's dropdown, exactly as before. `onChange` is optional for screens that must react.
 */
export function CompanyPicker({ onChange, label = "Company" }) {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const topbarSwitcher = useUi2();
  if (topbarSwitcher || !companies || companies.length <= 1) return null;
  return (
    <div className="k-company">
      <MdBusiness size={20} aria-hidden="true" />
      <select
        className="k-select"
        aria-label={label}
        value={selectedCompany?.id || ""}
        onChange={(e) => {
          const next = companies.find((c) => parseInt(c.id) === parseInt(e.target.value));
          setSelectedCompany(next);
          onChange?.(next);
        }}
      >
        {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
      </select>
    </div>
  );
}

/** variant: primary | secondary | teal | ghost | danger. Extra props go to <button>. */
export function Button({ variant = "secondary", size, icon: Icon, children, className, type = "button", ...rest }) {
  return (
    <button type={type} className={cx("k-btn", `k-btn--${variant}`, size === "sm" && "k-btn--sm", className)} {...rest}>
      {Icon && <Icon size={size === "sm" ? 15 : 17} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Icon-only button. `label` is required: it is the accessible name and the tooltip. */
export function IconButton({ label, icon: Icon, danger, className, size = 18, children, ...rest }) {
  return (
    <button type="button" className={cx("k-icon-btn", danger && "k-icon-btn--danger", className)} aria-label={label} title={label} {...rest}>
      {children || (Icon && <Icon size={size} aria-hidden="true" />)}
    </button>
  );
}

/** Filter / action row above a list. Put <SearchBox>, selects (className="k-select") and buttons inside. */
export function Toolbar({ children, className, ...rest }) {
  return <div className={cx("k-toolbar", className)} {...rest}>{children}</div>;
}
export const ToolbarSpacer = () => <span className="k-toolbar__spacer" />;

export function SearchBox({ value, onChange, placeholder = "Search…", label, className, ...rest }) {
  return (
    <div className={cx("k-search", className)} role="search">
      <MdSearch size={17} aria-hidden="true" />
      <input type="search" className="k-input" value={value} placeholder={placeholder} aria-label={label || placeholder}
        onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}

/** A labelled form control. Children is the control (k-input / k-select / SearchableSelect …). */
export function Field({ label, hint, error, children, className, htmlFor }) {
  return (
    <div className={cx("k-field", className)}>
      {label && <label className="k-field__label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="k-field__error" role="alert">{error}</span> : hint ? <span className="k-field__hint">{hint}</span> : null}
    </div>
  );
}

/** Surface with an optional titled head. `flush` removes body padding (for tables). */
export function Card({ title, icon: Icon, tone, actions, children, flush, className, bodyClassName, ...rest }) {
  return (
    <section className={cx("k-card", tone && `k-tone-${tone}`, className)} {...rest}>
      {(title || actions) && (
        <div className="k-card__head">
          {title && <h3 className="k-card__title">{Icon && <Icon size={18} aria-hidden="true" />}{title}</h3>}
          {actions && <div className="k-header__actions">{actions}</div>}
        </div>
      )}
      <div className={cx(flush ? "k-card__body--flush" : "k-card__body", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Scrollable table frame. Use <table className="k-table"> inside. */
export function TableWrap({ children, className, style }) {
  return <div data-admin-table-region="" className={cx("k-table-wrap", className)} style={style}>{children}</div>;
}

/** tabs: [{ key, label, icon?, count? }] */
export function Tabs({ tabs, value, onChange, label = "Sections", idPrefix = "k-tab" }) {
  return (
    <div className="k-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" id={`${idPrefix}-${t.key}`} aria-selected={value === t.key}
          aria-controls={`${idPrefix}-panel-${t.key}`} className="k-tab" onClick={() => onChange(t.key)}>
          {t.icon && <t.icon size={17} aria-hidden="true" />}
          {t.label}
          {t.count != null && <span className="k-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatGrid({ children, className }) {
  return <div className={cx("k-stats", className)}>{children}</div>;
}
export function StatCard({ label, value, hint, icon: Icon, tone = "blue", className, ...rest }) {
  return (
    <div className={cx("k-stat", `k-tone-${tone}`, className)} {...rest}>
      {Icon && <span className="k-stat__icon" aria-hidden="true"><Icon size={18} /></span>}
      <div className="k-stat__body">
        <span className="k-stat__label">{label}</span>
        <span className="k-stat__value">{value}</span>
        {hint && <span className="k-stat__hint">{hint}</span>}
      </div>
    </div>
  );
}

/** facts: [[label, value], …] — falsy entries are skipped. */
export function Facts({ facts, className }) {
  return (
    <dl className={cx("k-facts", className)}>
      {facts.filter(Boolean).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? "—"}</dd></div>)}
    </dl>
  );
}

export function EmptyState({ icon: Icon, title, children, action, boxed = true }) {
  return (
    <div className={cx("k-empty", boxed && "k-empty--boxed")} role="status">
      {Icon && <Icon size={40} className="k-empty__icon" aria-hidden="true" />}
      {title && <p className="k-empty__title">{title}</p>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ children = "Loading…" }) {
  return <div className="k-loading" role="status"><span className="k-spinner" aria-hidden="true" />{children}</div>;
}

/** tone: info | warn | error | success */
export function Alert({ tone = "info", icon: Icon, children, className }) {
  return (
    <div className={cx("k-alert", `k-alert--${tone}`, className)} role={tone === "error" ? "alert" : "status"}>
      {Icon && <Icon size={18} aria-hidden="true" style={{ flex: "none", marginTop: 1 }} />}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}
