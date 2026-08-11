import { useRef, useState } from "react";
import { MdAddAPhoto, MdClose } from "react-icons/md";
import downscaleImage from "../utils/downscaleImage";

/**
 * One line item's product photo — the cell used by LineItemsEditor.
 *
 * Empty: a dashed 44x44 tap target ("add photo"). Filled: the thumb, with a
 * small ✕ to clear it. Either way clicking opens the file picker, files can be
 * dropped on it, and Ctrl+V pastes a copied image while the cell has focus.
 *
 * The parent owns the value (a relative URL). `onUpload(file)` does the actual
 * POST and resolves to the stored URL; this component only handles picking,
 * shrinking (canvas, see downscaleImage), progress and error display.
 */
export default function LineItemImageCell({
  value,
  onChange,
  onUpload,
  size = 44,
  disabled = false,
  label = "photo",
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const pick = () => { if (!disabled && !busy) inputRef.current?.click(); };

  const send = async (file) => {
    if (!file || disabled || busy) return;
    setError("");
    setBusy(true);
    try {
      const slim = await downscaleImage(file);
      const url = await onUpload(slim);
      if (url) onChange(url);
      else setError("Upload failed");
    } catch (err) {
      const msg = err?.response?.data?.error;
      setError(msg || (!err?.response ? "No connection" : "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  const onFileInput = (e) => {
    const file = e.target.files?.[0];
    // Reset so re-picking the SAME file still fires a change event.
    e.target.value = "";
    send(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = Array.from(e.dataTransfer?.files || []).find((f) => f.type?.startsWith("image/"));
    if (file) send(file);
  };

  const onPaste = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type?.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    send(item.getAsFile());
  };

  const clear = (e) => {
    e.stopPropagation();
    setError("");
    onChange(null);
  };

  const box = { width: size, height: size };

  return (
    <div style={s.wrap}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={value ? `Replace ${label}` : `Add ${label}`}
        title={
          disabled ? undefined
            : value ? "Click to replace · ✕ to remove"
            : "Add a photo — click, drop an image, or paste with Ctrl+V"
        }
        onClick={pick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }}
        onPaste={onPaste}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          ...s.box,
          ...box,
          ...(value ? s.boxFilled : s.boxEmpty),
          ...(dragOver ? s.boxDrag : null),
          ...(error ? s.boxError : null),
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {busy ? (
          <span style={s.spinner} />
        ) : value ? (
          <img src={value} alt="" style={s.img} />
        ) : (
          <MdAddAPhoto size={Math.round(size * 0.42)} style={{ color: colors.textSecondary, opacity: 0.75 }} />
        )}

        {value && !busy && !disabled && (
          <button type="button" onClick={clear} title="Remove photo" aria-label="Remove photo" style={s.clear}>
            <MdClose size={11} />
          </button>
        )}
      </div>

      {error && <div style={s.err} title={error}>{error}</div>}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={onFileInput}
        style={{ display: "none" }}
        tabIndex={-1}
      />
    </div>
  );
}

const colors = {
  textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2", danger: "#dc3545", teal: "#00897b",
};

const s = {
  wrap: { display: "grid", justifyItems: "center", gap: 2 },
  // FLEX centring (not grid): a portrait photo in a fixed-size grid box resolves
  // its percentage height as auto and blows past the box. overflow stays visible
  // so the remove ✕ isn't clipped.
  box: {
    position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 8, overflow: "visible", boxSizing: "border-box", background: colors.inputBg,
  },
  boxEmpty: { border: `1px dashed ${colors.inputBorder}` },
  boxFilled: { border: `1px solid ${colors.cardBorder}`, background: "#fff" },
  boxDrag: { border: `2px dashed ${colors.teal}`, background: `${colors.teal}0d` },
  boxError: { border: `1px solid ${colors.danger}` },
  // contain, never cover: a product photo must not be cropped by the thumb.
  img: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", borderRadius: 6 },
  clear: {
    position: "absolute", top: -6, right: -6, width: 18, height: 18, padding: 0,
    display: "grid", placeItems: "center", borderRadius: "50%", border: `1px solid ${colors.cardBorder}`,
    background: "#fff", color: colors.danger, cursor: "pointer", lineHeight: 0,
    boxShadow: "0 1px 3px rgba(16,24,40,0.18)",
  },
  err: { fontSize: "0.62rem", color: colors.danger, fontWeight: 600, maxWidth: 90, textAlign: "center", lineHeight: 1.15 },
  spinner: {
    width: 16, height: 16, borderRadius: "50%",
    border: `2px solid ${colors.inputBorder}`, borderTopColor: colors.teal,
    animation: "spin 0.7s linear infinite",
  },
};
