import { forwardRef } from "react";

const CodeEditor = forwardRef(function CodeEditor({ value, onChange, isMobile }, ref) {
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...styles.editor,
        fontSize: isMobile ? "11px" : "13px",
        padding: isMobile ? "0.5rem" : "1rem",
      }}
      spellCheck={false}
      placeholder="Paste or edit your HTML template here..."
    />
  );
});

export default CodeEditor;

const styles = {
  editor: {
    flex: 1,
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    lineHeight: "1.5",
    border: "none",
    outline: "none",
    resize: "none",
    background: "#1e1e2e",
    color: "#cdd6f4",
    tabSize: 2,
  },
};
