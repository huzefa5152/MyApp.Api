export default function PreviewPane({ html, isMobile }) {
  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        background: "#e8e8e8",
        display: "flex",
        justifyContent: "center",
        padding: isMobile ? "0.5rem" : "1rem",
      }}
    >
      <iframe
        srcDoc={html}
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
