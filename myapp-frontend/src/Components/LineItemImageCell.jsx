import { useRef, useState } from "react";
import { MdAddAPhoto, MdClose } from "react-icons/md";

export default function LineItemImageCell({ value, onChange, onUpload, onBusyChange, label, disabled }) {
  const input = useRef(null);
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (file) => {
    if (!file || disabled || uploading.current) return;
    uploading.current = true;
    setBusy(true); setError(""); onBusyChange?.(1);
    try {
      const url = await onUpload(file);
      if (!url) throw new Error("Upload failed");
      onChange(url);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || "Could not upload photo.");
    } finally {
      uploading.current = false; setBusy(false); onBusyChange?.(-1);
    }
  };
  return <div style={{ display: "grid", gap: 4, maxWidth: 110 }}>
    <button type="button" disabled={disabled || busy}
      aria-label={`${value ? "Replace" : "Add"} ${label}`}
      onClick={() => input.current?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); send(e.dataTransfer.files?.[0]); }}
      onPaste={e => {
        const image = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
        if (image) { e.preventDefault(); send(image.getAsFile()); }
      }}
      style={{ width: 48, height: 48, padding: 0, border: "1px dashed #d0d7e2", borderRadius: 7, background: "#f8f9fb", display: "grid", placeItems: "center", boxShadow: "none" }}>
      {busy ? "…" : value ? <img src={value} alt={label} style={{ maxWidth: 44, maxHeight: 44, objectFit: "contain" }} /> : <MdAddAPhoto size={21} />}
    </button>
    {value && <button type="button" aria-label={`Remove ${label}`} disabled={disabled || busy}
      onClick={() => onChange(null)} style={{ minHeight: "var(--ui-btn-h, 44px)", padding: "4px", boxShadow: "none", background: "white", border: "1px solid #e8edf3", borderRadius: 6, fontSize: 11 }}><MdClose /> Remove</button>}
    {error && <span role="alert" style={{ color: "#dc3545", fontSize: 11 }}>{error}</span>}
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={`Upload ${label}`}
      style={{ display: "none" }} onChange={e => { const file=e.target.files?.[0]; e.target.value=""; send(file); }} />
  </div>;
}
