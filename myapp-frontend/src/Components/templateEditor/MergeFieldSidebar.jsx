const colors = {
  blue: "#0d47a1",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
};

// Reusable field list — used in code-mode sidebar and visual-editor left panel
export function MergeFieldList({ fields, onInsert, dark }) {
  const grouped = {};
  fields.forEach((f) => {
    const cat = f.category || "General";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(f);
  });
  const categories = Object.keys(grouped);

  const catColor = dark ? "#999" : colors.textSecondary;
  const codeColor = dark ? "#82b1ff" : colors.blue;
  const labelColor = dark ? "#b3b3c0" : colors.textSecondary;
  const hoverBg = dark ? "rgba(255,255,255,0.08)" : "#e3f2fd";

  const renderField = (f, i) => (
    <button
      key={i}
      style={fieldStyles.btn}
      onClick={() => onInsert(f.field)}
      title={`Insert ${f.field}`}
      onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ ...fieldStyles.code, color: codeColor }}>
        {f.field.length > 30 ? f.field.substring(0, 30) + "..." : f.field}
      </span>
      <span style={{ ...fieldStyles.label, color: labelColor }}>{f.label}</span>
    </button>
  );

  return (
    <div style={{ padding: "0.25rem" }}>
      {categories.length > 0
        ? categories.map((cat) => (
            <div key={cat}>
              <div style={{ ...fieldStyles.cat, color: catColor }}>{cat}</div>
              {grouped[cat].map(renderField)}
            </div>
          ))
        : fields.map(renderField)}
    </div>
  );
}

export default function MergeFieldSidebar({ fields, onInsert, hint, stamps = [] }) {
  // Insert a ready-to-use <img> that references the stamp merge field — no base64,
  // resizable via the style. Name is attribute-escaped for the alt text.
  const insertStamp = (s) => {
    const alt = String(s.name || "").replace(/"/g, "");
    onInsert(`<img src="{{stamps.${s.slug}}}" alt="${alt}" style="height:90px" />`);
  };

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>Merge Fields</div>
      {hint && <div style={styles.hint}>{hint}</div>}
      <div style={styles.scroll}>
        {stamps.length > 0 && (
          <div>
            <div style={{ ...fieldStyles.cat, color: colors.textSecondary }}>Stamps</div>
            {stamps.map((s) => (
              <button
                key={s.id}
                style={fieldStyles.stampBtn}
                onClick={() => insertStamp(s)}
                title={`Insert {{stamps.${s.slug}}} as an image`}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#e3f2fd")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <img src={s.url} alt="" style={fieldStyles.stampThumb} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: "0.74rem", fontWeight: 600, color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ ...fieldStyles.code, color: colors.blue }}>{`{{stamps.${s.slug}}}`}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <MergeFieldList fields={fields} onInsert={onInsert} />
      </div>
    </div>
  );
}

const fieldStyles = {
  cat: {
    padding: "0.4rem 0.6rem 0.15rem",
    fontSize: "0.68rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginTop: "0.3rem",
  },
  btn: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    width: "100%",
    padding: "0.4rem 0.6rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    borderRadius: 6,
    transition: "background 0.15s",
  },
  code: {
    fontSize: "0.7rem",
    fontFamily: "monospace",
    fontWeight: 600,
  },
  label: {
    fontSize: "0.72rem",
  },
  stampBtn: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "0.4rem 0.6rem",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    borderRadius: 6,
    transition: "background 0.15s",
  },
  stampThumb: {
    width: 34,
    height: 34,
    objectFit: "contain",
    flexShrink: 0,
    border: "1px solid #e8edf3",
    borderRadius: 4,
    background: "#fff",
  },
};

const styles = {
  sidebar: {
    width: 240,
    borderRight: `1px solid ${colors.cardBorder}`,
    display: "flex",
    flexDirection: "column",
    background: "#fafbfc",
    flexShrink: 0,
  },
  header: {
    padding: "0.65rem 0.85rem",
    fontWeight: 700,
    fontSize: "0.82rem",
    color: colors.textPrimary,
    borderBottom: `1px solid ${colors.cardBorder}`,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    background: "#f0f2f5",
  },
  hint: {
    padding: "0.5rem 0.7rem",
    fontSize: "0.72rem",
    color: "#5f6d7e",
    background: "#e8f4fd",
    borderBottom: `1px solid ${colors.cardBorder}`,
    lineHeight: 1.4,
  },
  scroll: {
    flex: 1,
    overflowY: "auto",
  },
};
