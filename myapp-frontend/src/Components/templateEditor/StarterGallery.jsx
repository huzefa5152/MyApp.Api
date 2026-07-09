import { useMemo, useState, useEffect } from "react";
import { MdSearch, MdClose, MdVisibility, MdCheckCircle } from "react-icons/md";
import { STARTER_TEMPLATES } from "../../utils/starterTemplates";
import { TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, buildTemplatePreviewHtml } from "../../utils/templateSampleData";
import { useCompany } from "../../contexts/CompanyContext";

const PREVIEW_H = 200;
const PREVIEW_SCALE = 0.34;

// A scaled, non-interactive live render of a starter (merged with sample data).
// Wrapped so the A4 page shrinks into a thumbnail box without clipping oddly.
function LivePreview({ starter, company }) {
  const html = useMemo(
    () => buildTemplatePreviewHtml(starter.type, starter.html, { company }),
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
        style={{
          width: `${100 / PREVIEW_SCALE}%`,
          height: `${PREVIEW_H / PREVIEW_SCALE}px`,
          border: "none",
          transform: `scale(${PREVIEW_SCALE})`,
          transformOrigin: "top left",
        }}
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
export default function StarterGallery({ lockType = null, selectLabel = "Use this", embedded = false, onSelect, onClose }) {
  const { selectedCompany } = useCompany();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(lockType || "");
  const [sort, setSort] = useState("catalog"); // catalog | name
  const [previewStarter, setPreviewStarter] = useState(null);

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
          <div>
            <h3 style={s.title}>Starter Templates</h3>
            <p style={s.subtitle}>
              {lockType ? `${TEMPLATE_TYPE_LABEL[lockType] || lockType} designs` : "Professionally designed layouts to start from"}
              {` · ${list.length} shown`}
            </p>
          </div>
          {!embedded && <button style={s.closeBtn} onClick={onClose} aria-label="Close"><MdClose size={22} /></button>}
        </div>

        <div style={s.toolbar}>
          <div style={s.searchWrap}>
            <MdSearch size={16} style={{ color: "#9aa5b4", flexShrink: 0 }} />
            <input
              style={s.searchInput}
              placeholder="Search designs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!lockType && (
            <select style={s.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by document type">
              <option value="">All document types</option>
              {TEMPLATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          )}
          <select style={s.select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="catalog">Sort: Catalog order</option>
            <option value="name">Sort: Name (A–Z)</option>
          </select>
        </div>

        <div style={s.grid}>
          {list.length === 0 && <div style={s.empty}>No starter templates match your search.</div>}
          {list.map((t, i) => (
            <div key={t.id} style={s.card}>
              <div style={s.thumb}>
                {i < renderCount ? <LivePreview starter={t} company={selectedCompany} /> : <PreviewSkeleton />}
                <button style={s.previewBtn} title="Preview larger" onClick={() => setPreviewStarter(t)}>
                  <MdVisibility size={15} /> Preview
                </button>
              </div>
              <div style={s.cardBody}>
                <div style={s.cardName} title={t.name}>{t.name}</div>
                {!lockType && <span style={s.typeBadge}>{TEMPLATE_TYPE_LABEL[t.type] || t.type}</span>}
                <div style={s.cardDesc} title={t.description}>{t.description}</div>
              </div>
              <button style={s.useBtn} onClick={() => onSelect(t)}>
                <MdCheckCircle size={16} /> {selectLabel}
              </button>
            </div>
          ))}
        </div>
    </>
  );

  const largePreview = previewStarter && (
    <div style={s.previewOverlay} onClick={() => setPreviewStarter(null)}>
      <div style={s.previewModal} onClick={(e) => e.stopPropagation()}>
        <div style={s.previewHead}>
          <div>
            <strong style={{ fontSize: "1rem" }}>{previewStarter.name}</strong>
            <span style={s.typeBadge}>{TEMPLATE_TYPE_LABEL[previewStarter.type] || previewStarter.type}</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button style={s.useBtnSm} onClick={() => { const t = previewStarter; setPreviewStarter(null); onSelect(t); }}>
              <MdCheckCircle size={15} /> {selectLabel}
            </button>
            <button style={s.closeBtn} onClick={() => setPreviewStarter(null)} aria-label="Close preview"><MdClose size={20} /></button>
          </div>
        </div>
        <iframe
          srcDoc={buildTemplatePreviewHtml(previewStarter.type, previewStarter.html, { company: selectedCompany })}
          title="Starter preview"
          sandbox="allow-same-origin"
          style={s.previewFrame}
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

const s = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200, padding: "1rem",
  },
  modal: {
    background: "#fff", borderRadius: 16, width: "min(1100px, 96vw)", maxHeight: "92vh",
    display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  embedded: {
    background: "#fff", borderRadius: 14, border: "1px solid #e6eaf0",
    display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: "calc(100vh - 220px)",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1.1rem 1.25rem 0.75rem", borderBottom: "1px solid #eef1f6" },
  title: { margin: 0, fontSize: "1.2rem", fontWeight: 800, color: "#1a2332" },
  subtitle: { margin: "0.2rem 0 0", fontSize: "0.82rem", color: "#5f6d7e" },
  closeBtn: { border: "none", background: "transparent", cursor: "pointer", color: "#8a94a6", padding: 4, borderRadius: 8, display: "inline-flex" },
  toolbar: { display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.75rem 1.25rem", borderBottom: "1px solid #eef1f6" },
  searchWrap: { display: "flex", alignItems: "center", gap: "0.4rem", flex: "1 1 220px", minWidth: 0, border: "1px solid #d0d7e2", borderRadius: 9, padding: "0.35rem 0.6rem", background: "#fff" },
  searchInput: { flex: 1, minWidth: 0, border: "none", outline: "none", fontSize: "0.86rem", background: "transparent" },
  select: { border: "1px solid #d0d7e2", borderRadius: 9, padding: "0.4rem 0.6rem", fontSize: "0.82rem", background: "#fff", color: "#1a2332" },
  grid: {
    display: "grid", gap: "0.9rem", padding: "1rem 1.25rem", overflow: "auto",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))",
  },
  empty: { gridColumn: "1 / -1", textAlign: "center", padding: "2.5rem", color: "#5f6d7e", fontSize: "0.9rem" },
  card: { border: "1px solid #e6eaf0", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", background: "#fff", transition: "box-shadow .15s, transform .15s" },
  thumb: { position: "relative", borderBottom: "1px solid #eef1f6", background: "#f4f6fa" },
  previewBtn: {
    position: "absolute", right: 8, bottom: 8, display: "inline-flex", alignItems: "center", gap: "0.25rem",
    fontSize: "0.72rem", fontWeight: 700, color: "#0d47a1", background: "rgba(255,255,255,0.94)",
    border: "1px solid #cfe0ff", borderRadius: 7, padding: "0.25rem 0.5rem", cursor: "pointer",
  },
  cardBody: { padding: "0.6rem 0.75rem", flex: 1, minWidth: 0 },
  cardName: { fontSize: "0.9rem", fontWeight: 700, color: "#1a2332", marginBottom: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  typeBadge: { display: "inline-block", marginLeft: 6, fontSize: "0.64rem", fontWeight: 700, color: "#3949ab", background: "#e8eaf6", padding: "1px 7px", borderRadius: 5, verticalAlign: "middle" },
  cardDesc: { marginTop: "0.35rem", fontSize: "0.76rem", color: "#5f6d7e", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  useBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem",
    border: "none", borderTop: "1px solid #eef1f6", background: "#0d47a1", color: "#fff",
    padding: "0.55rem", fontSize: "0.84rem", fontWeight: 700, cursor: "pointer",
  },
  useBtnSm: { display: "inline-flex", alignItems: "center", gap: "0.3rem", border: "none", background: "#0d47a1", color: "#fff", borderRadius: 8, padding: "0.4rem 0.75rem", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" },
  previewOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1300, padding: "1rem" },
  previewModal: { background: "#e8e8e8", borderRadius: 14, width: "min(860px, 96vw)", maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  previewHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", background: "#fff", borderBottom: "1px solid #eef1f6" },
  previewFrame: { flex: 1, width: "100%", border: "none", background: "#fff" },
};
