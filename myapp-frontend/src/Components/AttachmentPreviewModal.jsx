import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdDownload } from "react-icons/md";
import { formStyles, modalSizes } from "../theme";
import { fileIconFor, isImageExt, isPdfExt } from "../utils/fileIcons";
import { Loading } from "../ui/Kit";

// Previews an attachment inline. `loadBlob` is an async () => Blob, so the same
// modal previews both saved attachments (fetched with auth) and staged local
// Files. Images render in an <img>, PDFs in an <iframe>; anything else shows an
// icon + a download prompt. The object URL is revoked on close.
export default function AttachmentPreviewModal({ title, ext, loadBlob, onDownload, onClose }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const previewable = isImageExt(ext) || isPdfExt(ext);

  useEffect(() => {
    let cancelled = false;
    let created = null;
    (async () => {
      if (!previewable) { setLoading(false); return; }
      try {
        const blob = await loadBlob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      } catch {
        if (!cancelled) setErr("Could not load the preview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
  }, [previewable, loadBlob]);

  const { Icon, color } = fileIconFor(ext || title);

  // Portaled to <body> (same reason as FolderFormModal) so it sits outside any
  // parent <form> / modal subtree it may be embedded in.
  return createPortal(
    <div data-admin-backdrop="" style={{ ...formStyles.backdrop, zIndex: 1103 }} onClick={onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, height: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          {/* File names are user-supplied: 2-line clamp rather than nowrap + ellipsis. */}
          <h5 title={title} style={{ ...formStyles.title, minWidth: 0, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{title}</h5>
          <div style={{ display: "flex", gap: 8 }}>
            {onDownload && <button style={formStyles.closeButton} title="Download" onClick={onDownload}><MdDownload size={18} /></button>}
            <button data-admin-close="" style={formStyles.closeButton} title="Close" onClick={onClose}><MdClose size={18} /></button>
          </div>
        </div>
        <div style={{ ...formStyles.body, maxHeight: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f3f6" }}>
          {loading ? (
            <Loading>Loading preview…</Loading>
          ) : err ? (
            <span style={{ color: "#dc3545" }}>{err}</span>
          ) : !previewable ? (
            <div style={{ textAlign: "center", color: "#5f6d7e" }}>
              <Icon size={72} color={color} />
              <p style={{ marginTop: 12 }}>No inline preview for this file type.</p>
              {onDownload && (
                <button onClick={onDownload} style={{ ...formStyles.button, ...formStyles.submit, marginTop: 8 }}>
                  Download to view
                </button>
              )}
            </div>
          ) : isImageExt(ext) ? (
            <img src={url} alt={title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          ) : (
            <iframe src={url} title={title} style={{ width: "100%", height: "100%", border: "none", background: "#fff" }} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
