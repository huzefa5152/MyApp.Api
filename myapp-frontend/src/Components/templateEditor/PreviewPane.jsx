import { useState, useEffect } from "react";

export default function PreviewPane({ html, isMobile }) {
  // The iframe paints blank until the browser finishes rendering the doc — for a
  // template with a large embedded (base64) image that gap is seconds. Show a
  // spinner over it until its load event fires, so it never looks broken/blank.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [html]);

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        overflow: "auto",
        background: "#e8e8e8",
        display: "flex",
        justifyContent: "center",
        padding: isMobile ? "0.5rem" : "1rem",
      }}
    >
      {!loaded && (
        <div style={overlay}>
          <span style={spin} />
          <span style={{ color: "#5f6d7e", fontSize: "0.9rem", fontWeight: 600 }}>Rendering preview…</span>
        </div>
      )}
      <iframe
        srcDoc={html}
        onLoad={() => setLoaded(true)}
        style={{
          width: isMobile ? "100%" : "210mm",
          minHeight: "297mm",
          border: "none",
          background: "#fff",
          boxShadow: "0 2px 20px rgba(0,0,0,0.15)",
        }}
        title="Template Preview"
        sandbox="allow-same-origin"
      />
    </div>
  );
}

const overlay = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.6rem",
  background: "#e8e8e8",
  zIndex: 2,
};
const spin = {
  width: 22, height: 22,
  border: "3px solid #d0d7e2",
  borderTopColor: "#0d47a1",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
  display: "inline-block",
};
