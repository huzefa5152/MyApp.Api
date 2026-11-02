// src/Components/dashboard/CommandCenter.jsx
//
// Building blocks shared by the two command-centre dashboards (Home and
// Accounting). Presentation only — every figure is handed in by the page,
// which takes it from the server; nothing here calculates a business number.
//
// Drill-downs are real links (<Link>), so they work with the keyboard, open
// in a new tab and read correctly to a screen reader. A tile or row with no
// destination (the caller cannot open it) renders as plain content — never a
// control that 403s on click.
//
// Layout is CSS-only (CommandCenter.css): auto-fit grids collapse to one
// column on a phone, and the party table becomes labelled cards below 640px.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MdTrendingUp, MdTrendingDown, MdChevronRight } from "react-icons/md";
import "./CommandCenter.css";

// ── Formatting ───────────────────────────────────────────────────────────

/** "Rs. 1,234" — negatives in parens, the accounting convention. */
export function fmtMoney(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n).toLocaleString("en-PK", { maximumFractionDigits: 0 });
  return n < 0 ? `(Rs. ${abs})` : `Rs. ${abs}`;
}

export function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? "—" : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const pad2 = (n) => String(n).padStart(2, "0");
/** Local yyyy-MM-dd (avoids the UTC off-by-one of toISOString). */
export function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Whole days between a date and today; null when there is no date. */
export function daysSince(d) {
  if (!d) return null;
  const then = new Date(d); then.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - then) / 86400000);
}

/**
 * Percentage change, only where it means something: a positive base and a
 * non-negative current figure. From zero to something is "new"; a base at or
 * below zero (a loss turning into a profit) has no honest percentage, so none
 * is shown.
 */
export function change(current, previous) {
  if (previous == null || current == null) return null;
  const cur = Number(current), prev = Number(previous);
  if (prev > 0 && cur >= 0) return { pct: ((cur - prev) / prev) * 100 };
  if (prev === 0 && cur > 0) return { isNew: true };
  return null;
}

/** /accounting/reports/catalog/{id}?… — the report screen reads its filters from the URL. */
export function reportHref(id, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") qs.set(k, String(v)); });
  const s = qs.toString();
  return `/accounting/reports/catalog/${id}${s ? `?${s}` : ""}`;
}

// ── Layout ───────────────────────────────────────────────────────────────

/** Brand hero band — the gradient the Home dashboard has always carried. */
export function Hero({ eyebrow, title, subtitle, children }) {
  return (
    <header className="cc-hero">
      <div className="cc-hero__text">
        {eyebrow && <p className="cc-hero__eyebrow">{eyebrow}</p>}
        <h1 className="cc-hero__title">{title}</h1>
        {subtitle && <p className="cc-hero__subtitle">{subtitle}</p>}
      </div>
      {children && <div className="cc-hero__controls">{children}</div>}
    </header>
  );
}

/**
 * A titled block. `kind` names what its figures ARE — "Selected period",
 * "As at 19 Oct 2026" — because a period total and a point-in-time balance
 * look identical on screen and mean different things.
 */
export function Section({ title, kind, action, children, className = "" }) {
  return (
    <section className={`cc-section ${className}`}>
      <div className="cc-section__head">
        <h2 className="cc-section__title">{title}</h2>
        {kind && <span className="cc-kind">{kind}</span>}
        {action && <span className="cc-section__action">{action}</span>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ title, kind, action, children, className = "" }) {
  return (
    <div className={`cc-panel ${className}`}>
      {(title || action) && (
        <div className="cc-panel__head">
          {title && <h3 className="cc-panel__title">{title}</h3>}
          {kind && <span className="cc-kind">{kind}</span>}
          {action && <span className="cc-section__action">{action}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** A small "Open …" link for a section or panel header. Null `to` → nothing. */
export function HeadLink({ to, children }) {
  if (!to) return null;
  return <Link className="cc-headlink" to={to}>{children} <MdChevronRight size={15} aria-hidden /></Link>;
}

// ── Metric tile ──────────────────────────────────────────────────────────

/**
 * One headline figure. `delta` is the change() result; `higherIsBetter`
 * decides its colour. `tone` colours the value itself (danger for a loss).
 */
export function Metric({ label, value, sub, hint, delta, higherIsBetter = true, tone, to, accent = "#0d47a1", icon: Icon }) {
  let deltaEl = null;
  if (delta?.isNew) {
    deltaEl = <span className="cc-delta cc-delta--flat">new vs previous</span>;
  } else if (delta && isFinite(delta.pct)) {
    const up = delta.pct > 0;
    const flat = Math.abs(delta.pct) < 0.05;
    const good = higherIsBetter ? up : !up;
    const cls = flat ? "cc-delta--flat" : good ? "cc-delta--good" : "cc-delta--bad";
    const Arrow = up ? MdTrendingUp : MdTrendingDown;
    deltaEl = (
      <span className={`cc-delta ${cls}`}>
        {!flat && <Arrow size={13} aria-hidden />}
        {`${up ? "+" : ""}${delta.pct.toFixed(1)}%`} <span className="cc-delta__suffix">vs previous</span>
      </span>
    );
  }

  const body = (
    <>
      <span className="cc-metric__accent" style={{ background: accent }} aria-hidden />
      <span className="cc-metric__label">
        {Icon && <span className="cc-metric__icon" style={{ color: accent, background: `${accent}14` }}><Icon size={15} aria-hidden /></span>}
        {label}
      </span>
      <span className={`cc-metric__value ${tone ? `cc-tone--${tone}` : ""}`}>{value}</span>
      {deltaEl}
      {sub && <span className="cc-metric__sub">{sub}</span>}
      {/* The definition is a tooltip (title) for the eye and real text for a
          screen reader — inline it made every tile three lines taller. */}
      {hint && <span className="cc-sr">{hint}</span>}
      {to &&<span className="cc-metric__drill">View records <MdChevronRight size={14} aria-hidden /></span>}
    </>
  );

  return to
    ? <Link to={to} className="cc-metric cc-metric--link" title={hint || undefined}
        aria-label={`${label}: ${typeof value === "string" ? value : ""}${sub && typeof sub === "string" ? `, ${sub}` : ""}. View records`}>{body}</Link>
    : <div className="cc-metric" title={hint || undefined}>{body}</div>;
}

export function MetricGrid({ children, min = 210 }) {
  return <div className="cc-grid" style={{ "--cc-min": `${min}px` }}>{children}</div>;
}

// ── Quick actions ────────────────────────────────────────────────────────

/** actions: [{ label, to, icon }] — the page passes only the ones the caller may use. */
export function QuickActions({ actions }) {
  if (!actions?.length) return null;
  return (
    <nav className="cc-actions" aria-label="Quick actions">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link key={a.label} to={a.to} className="cc-action">
            {Icon && <span className="cc-action__icon"><Icon size={18} aria-hidden /></span>}
            <span className="cc-action__label">{a.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ── Attention list ───────────────────────────────────────────────────────

/**
 * items: [{ tone: "danger"|"warn"|"info", title, why, figure, actionLabel, to }]
 * already in urgency order. An empty list says so plainly — "nothing needs
 * you" is information too.
 */
export function AttentionList({ items, emptyText = "Nothing needs your attention right now." }) {
  if (!items?.length) return <p className="cc-empty">{emptyText}</p>;
  return (
    <ul className="cc-attention">
      {items.map((it) => {
        const inner = (
          <>
            <span className={`cc-attention__dot cc-tone-bg--${it.tone || "info"}`} aria-hidden />
            <span className="cc-attention__body">
              <span className="cc-attention__title">{it.title}</span>
              {it.why && <span className="cc-attention__why">{it.why}</span>}
            </span>
            <span className="cc-attention__side">
              {it.figure && <span className="cc-attention__figure">{it.figure}</span>}
              {it.to && it.actionLabel && <span className="cc-attention__cta">{it.actionLabel} <MdChevronRight size={14} aria-hidden /></span>}
            </span>
          </>
        );
        return (
          <li key={it.title}>
            {it.to ? <Link to={it.to} className="cc-attention__row cc-attention__row--link">{inner}</Link>
                   : <div className="cc-attention__row">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

// ── Trend chart ──────────────────────────────────────────────────────────

/**
 * Grouped monthly bars with an optional line, inline SVG (no chart library in
 * this app). bars: [{ key, label, color }], line: { key, label, color } | null,
 * points: [{ label, [key]: number, to? }]. A point with `to` is clickable.
 * Negative values draw below a zero baseline rather than being clipped.
 */
export function TrendChart({ points, bars, line = null, height = 220, ariaLabel }) {
  const navigate = useNavigate();
  // Drawn at the container's real width so text keeps its true size on a
  // phone instead of shrinking with the whole picture.
  const box = useRef(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [points?.length]);
  if (!points?.length) return <p className="cc-empty">No data for this range yet.</p>;
  const keys = [...bars.map((b) => b.key), ...(line ? [line.key] : [])];
  const values = points.flatMap((p) => keys.map((k) => Number(p[k] || 0)));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;

  const H = height, padL = 8, padR = 8, padT = 12, padB = 26;
  const plotH = H - padT - padB;
  const y = (v) => padT + ((max - v) / span) * plotH;
  const slot = (W - padL - padR) / points.length;
  const groupW = slot * 0.72;
  const barW = groupW / bars.length;
  const zeroY = y(0);
  const showEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(W / 56))));

  const linePath = line
    ? points.map((p, i) => `${i ? "L" : "M"}${(padL + slot * i + slot / 2).toFixed(1)},${y(Number(p[line.key] || 0)).toFixed(1)}`).join(" ")
    : null;

  return (
    <figure className="cc-chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={ariaLabel} className="cc-chart__svg">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={padL} x2={W - padR} y1={padT + t * plotH} y2={padT + t * plotH} className="cc-chart__grid" />
        ))}
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} className="cc-chart__zero" />
        {points.map((p, i) => {
          const x0 = padL + slot * i + (slot - groupW) / 2;
          const tip = `${p.label}\n${[...bars, ...(line ? [line] : [])].map((s) => `${s.label}: ${fmtMoney(p[s.key])}`).join("\n")}`;
          const group = (
            <g>
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH} className="cc-chart__hit" />
              {bars.map((b, j) => {
                const v = Number(p[b.key] || 0);
                const top = Math.min(y(v), zeroY);
                return <rect key={b.key} x={x0 + j * barW + 1} y={top} width={Math.max(barW - 2, 1)}
                  height={Math.max(Math.abs(y(v) - zeroY), v ? 1 : 0)} rx={2} fill={b.color} />;
              })}
              <title>{tip}</title>
            </g>
          );
          if (!p.to) return <g key={p.label}>{group}</g>;
          const go = () => navigate(p.to);
          return (
            <g key={p.label} role="link" tabIndex={0} className="cc-chart__link" aria-label={tip.replace(/\n/g, ", ")}
              onClick={go} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}>
              {group}
            </g>
          );
        })}
        {linePath && <path d={linePath} fill="none" stroke={line.color} strokeWidth={2.2} strokeLinejoin="round" pointerEvents="none" />}
        {points.map((p, i) => (i % showEvery === 0 || i === points.length - 1) && (
          <text key={p.label} x={padL + slot * i + slot / 2} y={H - 8} textAnchor="middle" className="cc-chart__axis">{p.short || p.label}</text>
        ))}
      </svg>
      <figcaption className="cc-legend">
        {bars.map((b) => <span key={b.key}><i style={{ background: b.color }} />{b.label}</span>)}
        {line && <span><i className="cc-legend__line" style={{ background: line.color }} />{line.label}</span>}
        <span className="cc-legend__scale">Scale {fmtMoney(min)} – {fmtMoney(max)}</span>
      </figcaption>
    </figure>
  );
}

// ── Aging bar ────────────────────────────────────────────────────────────

export const AGING = [
  { key: "current", label: "Not yet due", color: "#2e7d32" },
  { key: "days1To30", label: "1–30 days", color: "#9ccc65" },
  { key: "days31To60", label: "31–60 days", color: "#f9a825" },
  { key: "days61To90", label: "61–90 days", color: "#ef6c00" },
  { key: "over90", label: "Over 90 days", color: "#c62828" },
];

/**
 * One stacked bar plus a legend of buckets. `hrefFor(bucketKey)` returns the
 * filtered list behind a bucket, or null when there is nowhere to go.
 */
export function AgingBar({ buckets, hrefFor }) {
  const total = Number(buckets?.total || 0);
  if (total <= 0) return <p className="cc-empty">Nothing outstanding.</p>;
  return (
    <div className="cc-aging">
      <div className="cc-aging__bar" role="img"
        aria-label={AGING.map((b) => `${b.label} ${fmtMoney(buckets[b.key])}`).join(", ")}>
        {AGING.map((b) => {
          const v = Number(buckets[b.key] || 0);
          return v > 0 ? <span key={b.key} style={{ width: `${(v / total) * 100}%`, background: b.color }} title={`${b.label}: ${fmtMoney(v)}`} /> : null;
        })}
      </div>
      <ul className="cc-aging__legend">
        {AGING.map((b) => {
          const v = Number(buckets[b.key] || 0);
          const to = v > 0 ? hrefFor?.(b.key) : null;
          const inner = (
            <>
              <i style={{ background: b.color }} aria-hidden />
              <span className="cc-aging__label">{b.label}</span>
              <span className="cc-aging__value">{fmtMoney(v)}</span>
            </>
          );
          return <li key={b.key}>{to ? <Link to={to}>{inner}</Link> : <span>{inner}</span>}</li>;
        })}
      </ul>
    </div>
  );
}

// ── Party table ──────────────────────────────────────────────────────────

/**
 * columns: [{ key, label, money?, render?, tone?(row) }]; rows: objects with
 * `id`. `hrefFor(row)` is the row's drill-down or null. Below 640px each row
 * becomes a card whose cells carry their column label (data-label).
 */
export function PartyTable({ columns, rows, hrefFor, emptyText = "No records." }) {
  if (!rows?.length) return <p className="cc-empty">{emptyText}</p>;
  return (
    <div className="cc-table" role="table" style={{ "--cc-cols": columns.length - 1 }}>
      <div className="cc-table__row cc-table__row--head" role="row">
        {columns.map((c) => <span key={c.key} role="columnheader" className={c.money ? "cc-num" : ""}>{c.label}</span>)}
      </div>
      {rows.map((r) => {
        const cells = columns.map((c, i) => {
          const raw = r[c.key];
          const content = c.render ? c.render(r) : c.money ? fmtMoney(raw) : raw;
          const tone = c.tone?.(r);
          return (
            <span key={c.key} role="cell" data-label={i === 0 ? undefined : c.label}
              className={`${i === 0 ? "cc-table__name" : ""} ${c.money ? "cc-num" : ""} ${tone ? `cc-tone--${tone}` : ""}`}>
              {content}
            </span>
          );
        });
        const to = hrefFor?.(r);
        return to
          ? <Link key={r.id} to={to} role="row" className="cc-table__row cc-table__row--link">{cells}</Link>
          : <div key={r.id} role="row" className="cc-table__row">{cells}</div>;
      })}
    </div>
  );
}

// ── States ───────────────────────────────────────────────────────────────

export function Skeleton({ rows = 2 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="cc-grid" style={{ "--cc-min": "210px", marginBottom: "0.85rem" }}>
          {[0, 1, 2, 3].map((j) => <div key={j} className="cc-skeleton" />)}
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div className="cc-error" role="alert">
      <span>{message}</span>
      {onRetry && <button type="button" className="cc-error__retry" onClick={onRetry}>Try again</button>}
    </div>
  );
}
