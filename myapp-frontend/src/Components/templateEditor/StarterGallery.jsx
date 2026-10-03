import { useMemo, useState, useEffect } from "react";
import { MdClose, MdVisibility, MdCheckCircle } from "react-icons/md";
import { formStyles } from "../../theme";
import { Button, IconButton, SearchBox, EmptyState } from "../../ui/Kit";
import { STARTER_TEMPLATES } from "../../utils/starterTemplates";
import { TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, buildTemplatePreviewHtml } from "../../utils/templateSampleData";
import { useCompany } from "../../contexts/CompanyContext";
import A4PreviewFrame from "./A4PreviewFrame";

const PREVIEW_H = 200;
const PREVIEW_ZOOM = 0.30; // shrink the A4 page INSIDE the frame to fit the card

// Inject a zoom into the merged document so the whole A4 page fits the card.
// Scaling happens INSIDE the iframe (on <html>), leaving the iframe ELEMENT at
// natural size — so it paints on mount like any normal frame. Scaling the
// iframe element itself (CSS transform/zoom) is a Chromium compositor scale
// that stays blank until a reflow is forced, which is why thumbnails used to
// appear only after a search keystroke.
function injectZoom(html) {
  const tag = `<style>html{zoom:${PREVIEW_ZOOM};}body{margin:0;}</style>`;
  return html.includes("</head>") ? html.replace("</head>", tag + "</head>") : tag + html;
}

// A non-interactive live render of a starter merged with sample data.
function LivePreview({ starter, company }) {
  const html = useMemo(
    () => injectZoom(buildTemplatePreviewHtml(starter.type, starter.html, { company })),
    [starter, company]
  );
  return (
    <div style={{ height: PREVIEW_H, overflow: "hidden", background: "#fff", position: "relative", pointerEvents: "none" }}>
      <iframe
        srcDoc={html}
        title={`Preview of ${starter.name}`}
        sandbox="allow-same-origin"
        aria-hidden="true"
        tabIndex={-1}
        scrolling="no"
        style={{ width: "100%", height: PREVIEW_H, border: "none", display: "block", background: "#fff" }}
      />
    </div>
  );
}

// Placeholder shown for cards not yet mounted by the progressive-render batcher
// (keeps the card height stable so the grid doesn't reflow as previews fill in).
function PreviewSkeleton() {
  return (
    <div style={{ height: PREVIEW_H, display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f6fa", color: "#c2cad6", fontSize: "0.8rem" }}>
      Loading preview…
    </div>
  );
}

/**
 * Visual starter-template gallery. Cards show a live rendered preview, name,
 * document type and description, with search + type filter + sort. Clicking a
 * card fires onSelect(starter) — the parent decides what "select" means
 * (create-new vs apply-to-existing). A larger preview opens on the eye icon.
 *
 * Props:
 *   lockType  — when set (e.g. "PurchaseBill"), only that type is shown and the
 *               type filter is hidden (used when applying to an existing template).
 *   selectLabel — CTA text on the card button (e.g. "Use" / "Apply").
 *   onSelect(starter), onClose()
 */
export default function StarterGallery({
  lockType = null, selectLabel = "Use this", embedded = false, onSelect, onClose,
  // Optional controlled filters. The Print Templates page passes its own state
  // for the document type, the search text and the sort, so what the operator
  // typed survives switching between the Print / Starter / Excel tabs (this
  // component unmounts on every switch) and coming back from the editor.
  typeFilter: typeFilterProp, onTypeFilterChange,
  search: searchProp, onSearchChange,
  sort: sortProp, onSortChange,
  // Id of the starter a create is running for: that card shows "Creating…"
  // and every card's button locks, so a double click cannot make two.
  busyStarterId = null,
}) {
  const { selectedCompany } = useCompany();
  const [searchLocal, setSearchLocal] = useState("");
  const [typeFilterLocal, setTypeFilterLocal] = useState(lockType || "");
  const [sortLocal, setSortLocal] = useState("catalog"); // catalog | name
  const isControlled = typeFilterProp !== undefined;
  const typeFilter = isControlled ? typeFilterProp : typeFilterLocal;
  const setTypeFilter = isControlled ? (onTypeFilterChange || (() => {})) : setTypeFilterLocal;
  const search = searchProp !== undefined ? searchProp : searchLocal;
  const setSearch = searchProp !== undefined ? (onSearchChange || (() => {})) : setSearchLocal;
  const sort = sortProp !== undefined ? sortProp : sortLocal;
  const setSort = sortProp !== undefined ? (onSortChange || (() => {})) : setSortLocal;
  const [previewStarter, setPreviewStarter] = useState(null);
  const busy = busyStarterId != null;

  const list = useMemo(() => {
    let items = STARTER_TEMPLATES.filter((t) => {
      if (lockType && t.type !== lockType) return false;
      if (typeFilter && t.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (t.name || "").toLowerCase().includes(q) ||
               (t.description || "").toLowerCase().includes(q);
      }
      return true;
    });
    if (sort === "name") items = [...items].sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }, [lockType, typeFilter, search, sort]);

  // Progressive render: mounting all ~135 preview iframes at once swamps the
  // browser (they paint blank/late — the "designs only show after search"
  // symptom). Instead mount the first batch immediately, then add batches on a
  // timer so the burst never happens. Reset to the first batch whenever the
  // filtered list changes. (IntersectionObserver-based lazyload proved
  // unreliable in some embedded/automated webviews, so this is timer-driven.)
  const BATCH = 12;
  const [renderCount, setRenderCount] = useState(BATCH);
  useEffect(() => { setRenderCount(BATCH); }, [lockType, typeFilter, search, sort]);
  useEffect(() => {
    if (renderCount >= list.length) return undefined;
    const id = setTimeout(() => setRenderCount((n) => Math.min(n + BATCH, list.length)), 250);
    return () => clearTimeout(id);
  }, [renderCount, list.length]);

  const body = (
    <>
        <div style={s.header}>
          <div style={{ minWidth: 0 }}>
            <h3 style={s.title}>Starter Templates</h3>
            <p style={s.subtitle}>
              {lockType ? `${TEMPLATE_TYPE_LABEL[lockType] || lockType} designs` : "Professionally designed layouts to start from"}
              {` · ${list.length} shown`}
            </p>
          </div>
          {!embedded && <IconButton label="Close" icon={MdClose} size={22} onClick={onClose} />}
        </div>

        <div style={s.toolbar}>
          <SearchBox value={search} onChange={setSearch} placeholder="Search designs…" />
          {!lockType && (
            <select className="k-select" style={s.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by document type">
              <option value="">All document types</option>
              {TEMPLATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          )}
          <select className="k-select" style={s.select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="catalog">Sort: Catalog order</option>
            <option value="name">Sort: Name (A–Z)</option>
          </select>
        </div>

        <div style={s.grid}>
          {list.length === 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <EmptyState boxed={false}>No starter templates match your search.</EmptyState>
            </div>
          )}
          {list.map((t, i) => (
            <div key={t.id} style={s.card}>
              <div style={s.thumb}>
                {i < renderCount ? <LivePreview starter={t} company={selectedCompany} /> : <PreviewSkeleton />}
                <button type="button" style={s.previewBtn} title="Preview larger" onClick={() => setPreviewStarter(t)}>
                  <MdVisibility size={15} /> Preview
                </button>
              </div>
              <div style={s.cardBody}>
                <div style={s.cardName} title={t.name}>{t.name}</div>
                {!lockType && <span style={s.typeBadge}>{TEMPLATE_TYPE_LABEL[t.type] || t.type}</span>}
                <div style={s.cardDesc} title={t.description}>{t.description}</div>
              </div>
              <button type="button" style={{ ...s.useBtn, ...(busy ? s.useBtnBusy : {}) }} disabled={busy} onClick={() => onSelect(t)}>
                {busyStarterId === t.id
                  ? <><span style={s.spinLight} /> Creating…</>
                  : <><MdCheckCircle size={16} /> {selectLabel}</>}
              </button>
            </div>
          ))}
        </div>
    </>
  );

  const largePreview = previewStarter && (
    <div style={s.previewOverlay} onClick={() => setPreviewStarter(null)}>
      <div style={s.previewModal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Preview of ${previewStarter.name}`}>
        <div style={{ ...formStyles.header, gap: "0.5rem", flexWrap: "wrap" }}>
          <h3 style={{ ...formStyles.title, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
            {previewStarter.name}
            <span style={s.typeBadge}>{TEMPLATE_TYPE_LABEL[previewStarter.type] || previewStarter.type}</span>
          </h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Button size="sm" icon={MdCheckCircle} disabled={busy} onClick={() => { const t = previewStarter; setPreviewStarter(null); onSelect(t); }}>
              {selectLabel}
            </Button>
            <button type="button" style={formStyles.closeButton} onClick={() => setPreviewStarter(null)} aria-label="Close preview"><MdClose size={20} /></button>
          </div>
        </div>
        <A4PreviewFrame
          html={buildTemplatePreviewHtml(previewStarter.type, previewStarter.html, { company: selectedCompany })}
          title="Starter preview"
        />
      </div>
    </div>
  );

  // Embedded (inside a tab) drops the modal chrome; standalone wraps in an overlay.
  if (embedded) {
    return <div style={s.embedded}>{body}{largePreview}</div>;
  }
  return (
    <div style={s.overlay}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>{body}</div>
      {largePreview}
    </div>
  );
}

// Gallery chrome reads the kit tokens (--k-*) and the shared formStyles; the
// live previews (LivePreview / A4PreviewFrame) are document content — untouched.
const s = {
  overlay: { ...formStyles.backdrop, zIndex: 1200 },
  modal: { ...formStyles.modal, maxWidth: 1100, maxHeight: "92vh" },
  embedded: {
    background: "var(--k-surface)", borderRadius: "var(--k-card-radius)", border: "1px solid var(--k-line)", boxShadow: "var(--k-card-shadow)",
    display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: "calc(100vh - 220px)",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", padding: "var(--k-card-pad)", borderBottom: "1px solid var(--k-line)", flexShrink: 0 },
  title: { margin: 0, fontSize: "calc(var(--k-title) * 0.8)", fontWeight: 800, color: "var(--k-ink)" },
  subtitle: { margin: "0.2rem 0 0", fontSize: "var(--k-sub)", color: "var(--k-muted)" },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--k-line)", flexShrink: 0 },
  select: { width: "auto", maxWidth: "100%" },
  grid: {
    display: "grid", gap: "calc(var(--k-gap) * 0.75)", padding: "1rem 1.25rem", overflow: "auto",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))",
    // Size each row to its tallest card. Without this, the grid sits inside a
    // height-constrained flex column (the modal / embedded wrapper) and its
    // implicit "auto" rows collapse to min-content — the card's iframe + flex
    // children can all shrink to ~0, clipping the name and the select button.
    gridAutoRows: "max-content",
  },
  card: { border: "1px solid var(--k-line)", borderRadius: "var(--k-card-radius)", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--k-surface)", transition: "box-shadow .15s, transform .15s" },
  thumb: { position: "relative", borderBottom: "1px solid var(--k-line)", background: "#f4f6fa" },
  previewBtn: {
    position: "absolute", right: 8, bottom: 8, display: "inline-flex", alignItems: "center", gap: "0.25rem",
    fontSize: "0.72rem", fontWeight: 700, color: "#0d47a1", background: "rgba(255,255,255,0.94)",
    border: "1px solid #cfe0ff", borderRadius: 7, padding: "0.25rem 0.5rem", cursor: "pointer",
  },
  cardBody: { padding: "0.6rem 0.75rem", flex: 1, minWidth: 0 },
  cardName: { fontSize: "var(--k-font)", fontWeight: 700, color: "var(--k-ink)", marginBottom: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  typeBadge: { display: "inline-block", marginLeft: 6, fontSize: "0.64rem", fontWeight: 700, color: "#3949ab", background: "#e8eaf6", padding: "1px 7px", borderRadius: 5, verticalAlign: "middle" },
  cardDesc: { marginTop: "0.35rem", fontSize: "0.76rem", color: "var(--k-muted)", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  useBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem",
    border: "none", borderTop: "1px solid var(--k-line)", borderRadius: 0, background: "var(--k-blue)", color: "#fff",
    minHeight: "var(--k-h)", padding: "0 0.55rem", fontSize: "var(--k-btn-font)", fontWeight: 700, cursor: "pointer", boxShadow: "none",
  },
  useBtnBusy: { opacity: 0.75, cursor: "default" },
  spinLight: { width: 14, height: 14, borderRadius: "50%", display: "inline-block", border: "2px solid rgba(255,255,255,0.45)", borderTopColor: "#fff", animation: "k-spin 0.7s linear infinite" },
  previewOverlay: { ...formStyles.backdrop, zIndex: 1300 },
  previewModal: { ...formStyles.modal, maxWidth: 920, height: "94vh", background: "#e8e8e8" },
};
