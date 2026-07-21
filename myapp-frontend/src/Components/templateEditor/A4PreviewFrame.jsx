import { useRef, useState, useMemo, useLayoutEffect } from "react";

// A4 at 96dpi.
const A4_W = 794;
const A4_H = 1123;

/**
 * Full-page template preview that scales a whole A4 sheet to fit the available
 * space so the operator sees the complete page without scrolling. The zoom is
 * applied INSIDE the iframe (on <html>) — scaling the iframe element itself is
 * a Chromium compositor scale that can paint blank, whereas an in-document
 * zoom renders like a normal page. The stage is measured on mount / resize and
 * the zoom is recomputed to fit both width and height.
 */
export default function A4PreviewFrame({ html, title = "Preview" }) {
  const stageRef = useRef(null);
  const [zoom, setZoom] = useState(0.6);

  useLayoutEffect(() => {
    const measure = () => {
      const el = stageRef.current;
      if (!el) return;
      const w = el.clientWidth - 24;   // minus stage padding
      const h = el.clientHeight - 24;
      if (w <= 0 || h <= 0) return;
      setZoom(Math.max(0.15, Math.min(w / A4_W, h / A4_H, 1)));
    };
    measure();
    const t = setTimeout(measure, 80); // re-measure after the modal has laid out
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, []);

  const doc = useMemo(() => {
    const tag = `<style>html{zoom:${zoom};}body{margin:0;}</style>`;
    return (html || "").includes("</head>") ? html.replace("</head>", tag + "</head>") : tag + (html || "");
  }, [html, zoom]);

  return (
    <div
      ref={stageRef}
      style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", background: "#e8e8e8", padding: 12 }}
    >
      <iframe
        srcDoc={doc}
        title={title}
        sandbox="allow-same-origin"
        style={{ width: Math.round(A4_W * zoom), height: Math.round(A4_H * zoom), border: "none", background: "#fff", boxShadow: "0 2px 24px rgba(0,0,0,0.25)", display: "block" }}
      />
    </div>
  );
}
