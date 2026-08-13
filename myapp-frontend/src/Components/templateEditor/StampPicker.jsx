import { useMemo } from "react";
import { MdBlock, MdAddPhotoAlternate } from "react-icons/md";
import { STAMP_STATE } from "../../utils/stampSlot";

/**
 * Choose which company stamp a template renders.
 *
 * SHARED FILE: keep byte-identical on `master` and
 * `customize-solution-for-other`. It takes everything through props precisely
 * so it can drop into either branch's very different page layouts — do not
 * reach into contexts or page state from here.
 *
 * Two shapes:
 *   variant="cards"   thumbnails — the apply-starter / import step, where the
 *                     operator is choosing deliberately and wants to see them
 *   variant="inline"  a compact <select> — list cards and the editor header,
 *                     where it sits alongside other controls
 *
 * `state` drives whether choosing is even possible:
 *   slotted — live
 *   pinned  — the template names its stamp inline; offer onConvert
 *   none    — no slot in the markup; offer onAddBlock
 */
export default function StampPicker({
  stamps = [],
  value = null,
  onChange,
  state = STAMP_STATE.SLOTTED,
  variant = "inline",
  disabled = false,
  onAddBlock,
  onConvert,
  pinnedSlug = null,
  busy = false,
}) {
  const hasStamps = stamps.length > 0;
  const selected = useMemo(
    () => stamps.find((s) => s.id === value) || null,
    [stamps, value]
  );

  if (state === STAMP_STATE.NONE) {
    return (
      <div style={st.row}>
        <span style={st.muted}>No signature block</span>
        {onAddBlock && (
          <button type="button" style={st.linkBtn} disabled={disabled || busy} onClick={onAddBlock}>
            <MdAddPhotoAlternate size={15} /> Add signature block
          </button>
        )}
      </div>
    );
  }

  if (state === STAMP_STATE.PINNED) {
    return (
      <div style={st.row}>
        <span style={st.muted}>
          Fixed stamp{pinnedSlug ? ` (${pinnedSlug})` : ""}
        </span>
        {onConvert && (
          <button type="button" style={st.linkBtn} disabled={disabled || busy} onClick={onConvert}>
            Make changeable
          </button>
        )}
      </div>
    );
  }

  if (!hasStamps) {
    return <span style={st.muted}>No stamps uploaded yet</span>;
  }

  if (variant === "cards") {
    return (
      <div style={st.cards}>
        <button
          type="button"
          style={{ ...st.card, ...(value == null ? st.cardOn : {}) }}
          onClick={() => onChange?.(null)}
          disabled={disabled || busy}
        >
          <span style={st.cardArt}><MdBlock size={18} color="#9aa7b8" /></span>
          <span style={st.cardLabel}>None</span>
        </button>
        {stamps.map((s) => (
          <button
            key={s.id}
            type="button"
            style={{ ...st.card, ...(value === s.id ? st.cardOn : {}) }}
            onClick={() => onChange?.(s.id)}
            disabled={disabled || busy}
            title={`{{stamps.${s.slug}}}`}
          >
            <span style={st.cardArt}><img src={s.url} alt="" style={st.cardImg} /></span>
            <span style={st.cardLabel}>{s.name}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={st.row}>
      {selected && <img src={selected.url} alt="" style={st.inlineThumb} />}
      <select
        value={value == null ? "" : String(value)}
        disabled={disabled || busy}
        onChange={(e) => onChange?.(e.target.value === "" ? null : Number(e.target.value))}
        style={st.select}
        aria-label="Signature stamp"
      >
        <option value="">No signature</option>
        {stamps.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}

const st = {
  row: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", minWidth: 0 },
  muted: { fontSize: "0.78rem", color: "#5f6d7e" },
  select: { flex: 1, minWidth: 120, maxWidth: 220, padding: "0.3rem 0.4rem", fontSize: "0.8rem", borderRadius: 7, border: "1px solid #d0d7e2", background: "#fff" },
  inlineThumb: { width: 30, height: 24, objectFit: "contain", border: "1px solid #e8edf3", borderRadius: 4, background: "#fff", flexShrink: 0 },
  linkBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.25rem 0.5rem", fontSize: "0.76rem", borderRadius: 7, border: "1px solid #d0d7e2", background: "#fff", color: "#0d47a1", cursor: "pointer" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: "0.5rem" },
  card: { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem", padding: "0.5rem", borderRadius: 8, border: "1px solid #d0d7e2", background: "#fff", cursor: "pointer", boxShadow: "none" },
  cardOn: { border: "2px solid #0d47a1", background: "#f4f8ff" },
  cardArt: { display: "grid", placeItems: "center", height: 38, width: "100%" },
  cardImg: { maxHeight: 38, maxWidth: "100%", objectFit: "contain" },
  cardLabel: { fontSize: "0.72rem", color: "#1a2332", textAlign: "center", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
};
