import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from "react";
import grapesjs from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import {
  MdUndo, MdRedo, MdVisibility, MdFullscreen, MdDelete,
  MdBorderAll, MdPhoneAndroid, MdDescription,
} from "react-icons/md";
import {
  getEditorConfig, registerHbsComponent, registerCustomBlocks,
  registerCommands, injectA4Styles,
} from "../../utils/grapesConfig";
import { encodeHandlebars, decodeHandlebars } from "../../utils/handlebarsCodec";
import { MergeFieldList } from "./MergeFieldSidebar";
import { useConfirm } from "../ConfirmDialog";

/* GrapesJS CSS overrides for custom panel layout */
const PANEL_CSS = `
.ve-blocks .gjs-blocks-c {
  display: flex; flex-wrap: wrap; gap: 4px; padding: 6px;
}
.ve-blocks .gjs-block {
  width: calc(50% - 2px); min-height: 50px; margin: 0;
  padding: 8px 4px; font-size: 11px; border-radius: 4px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  color: #ccc; display: flex; flex-direction: column; align-items: center;
  justify-content: center; text-align: center; cursor: grab;
}
.ve-blocks .gjs-block:hover { background: rgba(255,255,255,0.12); }
.ve-blocks .gjs-block svg { fill: #aaa; }
.ve-blocks .gjs-block-category .gjs-title {
  background: transparent; border-bottom: 1px solid rgba(255,255,255,0.1);
  color: #999; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  padding: 8px 10px;
}
.ve-right .gjs-sm-sector .gjs-sm-sector-title {
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  color: #ccc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px;
}
.ve-right .gjs-sm-properties { padding: 6px 8px; }
.ve-right .gjs-field { min-height: 28px; }
.ve-right .gjs-clm-tags { padding: 6px 8px; }
.ve-right .gjs-trt-traits { padding: 6px 8px; }
.ve-right .gjs-trt-trait { margin-bottom: 6px; }
div:fullscreen { background: #1e1e26; }
`;

const VisualEditor = forwardRef(function VisualEditor(
  { htmlContent, templateJson, fields, onReady },
  ref
) {
  const confirmFn = useConfirm();
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const blocksRef = useRef(null);
  const selectorRef = useRef(null);
  const styleRef = useRef(null);
  const traitRef = useRef(null);
  const [device, setDevice] = useState("A4 Portrait");
  const [bordersOn, setBordersOn] = useState(true);
  const [leftTab, setLeftTab] = useState("blocks");

  // Inject panel CSS overrides once
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const insertMergeField = useCallback((fieldExpression) => {
    const editor = editorRef.current;
    if (!editor) return;
    const encoded = encodeHandlebars(fieldExpression);
    const selected = editor.getSelected();
    if (selected) {
      selected.append(encoded);
    } else {
      editor.addComponents(encoded);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    getHtml() {
      if (!editorRef.current) return "";
      const html = editorRef.current.getHtml();
      const css = editorRef.current.getCss();
      return decodeHandlebars(
        `<!DOCTYPE html><html><head><style>${css}</style></head><body>${html}</body></html>`
      );
    },
    getCss() {
      return editorRef.current?.getCss() || "";
    },
    getProjectData() {
      return editorRef.current?.getProjectData() || null;
    },
    insertMergeField,
  }));

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

    const editor = grapesjs.init(getEditorConfig(containerRef.current));
    editorRef.current = editor;

    registerHbsComponent(editor);
    registerCustomBlocks(editor);
    registerCommands(editor, confirmFn);

    editor.on("load", () => {
      injectA4Styles(editor);

      // Render managers into custom containers
      if (blocksRef.current) {
        const el = editor.BlockManager.render();
        blocksRef.current.innerHTML = "";
        blocksRef.current.appendChild(el);
      }
      try {
        if (selectorRef.current) {
          const el = editor.SelectorManager.render();
          selectorRef.current.innerHTML = "";
          selectorRef.current.appendChild(el);
        }
      } catch (e) { console.warn("SelectorManager render:", e); }
      try {
        if (styleRef.current) {
          const el = editor.StyleManager.render();
          styleRef.current.innerHTML = "";
          styleRef.current.appendChild(el);
        }
      } catch (e) { console.warn("StyleManager render:", e); }
      try {
        if (traitRef.current) {
          const el = editor.TraitManager.render();
          traitRef.current.innerHTML = "";
          traitRef.current.appendChild(el);
        }
      } catch (e) { console.warn("TraitManager render:", e); }

      // Load content
      if (templateJson) {
        try {
          const data =
            typeof templateJson === "string"
              ? JSON.parse(templateJson)
              : templateJson;
          editor.loadProjectData(data);
        } catch {
          loadFromHtml(editor, htmlContent);
        }
      } else {
        loadFromHtml(editor, htmlContent);
      }

      editor.setDevice("A4 Portrait");
      editor.runCommand("sw-visibility");
      onReady?.();
    });

    return () => {
      editorRef.current = null;
      editor.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCmd = (cmd) => editorRef.current?.runCommand(cmd);

  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  };

  const toggleBorders = () => {
    const ed = editorRef.current;
    if (!ed) return;
    if (bordersOn) ed.stopCommand("sw-visibility");
    else ed.runCommand("sw-visibility");
    setBordersOn(!bordersOn);
  };

  const switchDevice = (d) => {
    editorRef.current?.setDevice(d);
    setDevice(d);
  };

  return (
    <div ref={wrapperRef} style={vs.wrapper}>
      {/* Toolbar */}
      <div style={vs.toolbar}>
        <div style={vs.toolbarGroup}>
          <ToolBtn icon={<MdUndo size={18} />} label="Undo" onClick={() => runCmd("core:undo")} />
          <ToolBtn icon={<MdRedo size={18} />} label="Redo" onClick={() => runCmd("core:redo")} />
          <div style={vs.sep} />
          <ToolBtn icon={<MdBorderAll size={18} />} label="Borders" onClick={toggleBorders} active={bordersOn} />
          <ToolBtn icon={<MdVisibility size={18} />} label="Preview" onClick={() => runCmd("preview")} />
          <ToolBtn icon={<MdFullscreen size={18} />} label="Fullscreen" onClick={toggleFullscreen} />
          <div style={vs.sep} />
          <ToolBtn icon={<MdDescription size={16} />} label="A4" onClick={() => switchDevice("A4 Portrait")} active={device === "A4 Portrait"} />
          <ToolBtn icon={<MdPhoneAndroid size={16} />} label="Mobile" onClick={() => switchDevice("Mobile")} active={device === "Mobile"} />
          <div style={vs.sep} />
          <ToolBtn icon={<MdDelete size={18} />} label="Clear" onClick={() => runCmd("canvas-clear")} danger />
        </div>
      </div>

      {/* Three-panel body */}
      <div style={vs.body}>
        {/* Left Panel — Blocks + Merge Fields */}
        <div style={vs.leftPanel}>
          <div style={vs.panelTabs}>
            <button
              style={{ ...vs.panelTab, ...(leftTab === "blocks" ? vs.panelTabActive : {}) }}
              onClick={() => setLeftTab("blocks")}
            >
              Blocks
            </button>
            <button
              style={{ ...vs.panelTab, ...(leftTab === "fields" ? vs.panelTabActive : {}) }}
              onClick={() => setLeftTab("fields")}
            >
              Fields
            </button>
          </div>
          <div style={vs.panelScroll}>
            <div
              ref={blocksRef}
              className="ve-blocks"
              style={{ display: leftTab === "blocks" ? "block" : "none" }}
            />
            {leftTab === "fields" && (
              <MergeFieldList
                fields={fields || []}
                onInsert={insertMergeField}
                dark
              />
            )}
          </div>
        </div>

        {/* Canvas */}
        <div ref={containerRef} style={vs.canvas} />

        {/* Right Panel — Selector, Styles, Traits */}
        <div style={vs.rightPanel} className="ve-right">
          <div style={vs.rightHeader}>Selector</div>
          <div ref={selectorRef} />
          <div style={vs.rightHeader}>Styles</div>
          <div ref={styleRef} />
          <div style={vs.rightHeader}>Properties</div>
          <div ref={traitRef} />
        </div>
      </div>
    </div>
  );
});

export default VisualEditor;

function ToolBtn({ icon, label, onClick, active, danger }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        ...tbStyles.btn,
        ...(active ? tbStyles.btnActive : {}),
        ...(danger ? tbStyles.btnDanger : {}),
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = danger ? "#fee" : "rgba(255,255,255,0.1)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      <span style={tbStyles.label}>{label}</span>
    </button>
  );
}

function loadFromHtml(editor, htmlContent) {
  if (!htmlContent) return;
  const styleMatch = htmlContent.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  let css = "";
  if (styleMatch) {
    css = styleMatch
      .map((s) => s.replace(/<\/?style[^>]*>/gi, ""))
      .join("\n");
  }
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
  const encoded = encodeHandlebars(bodyHtml);
  editor.setComponents(encoded);
  editor.setStyle(css);
}

/* Styles */
const vs = {
  wrapper: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    padding: "4px 10px",
    background: "#2b2b33",
    borderBottom: "1px solid #1a1a22",
    flexShrink: 0,
  },
  toolbarGroup: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
  },
  sep: {
    width: 1,
    height: 24,
    background: "#444",
    margin: "0 6px",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  /* Left panel */
  leftPanel: {
    width: 240,
    display: "flex",
    flexDirection: "column",
    background: "#2b2b33",
    borderRight: "1px solid #1a1a22",
    flexShrink: 0,
  },
  panelTabs: {
    display: "flex",
    borderBottom: "1px solid #1a1a22",
    flexShrink: 0,
  },
  panelTab: {
    flex: 1,
    padding: "8px 0",
    border: "none",
    background: "transparent",
    color: "#888",
    fontSize: "0.75rem",
    fontWeight: 600,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    borderBottom: "2px solid transparent",
    transition: "all 0.15s",
  },
  panelTabActive: {
    color: "#fff",
    borderBottomColor: "#0d47a1",
  },
  panelScroll: {
    flex: 1,
    overflowY: "auto",
  },
  /* Canvas */
  canvas: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  /* Right panel */
  rightPanel: {
    width: 260,
    display: "flex",
    flexDirection: "column",
    background: "#363640",
    borderLeft: "1px solid #1a1a22",
    flexShrink: 0,
    overflowY: "auto",
  },
  rightHeader: {
    padding: "7px 10px",
    fontSize: "0.68rem",
    fontWeight: 700,
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
  },
};

const tbStyles = {
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "5px 8px",
    border: "none",
    borderRadius: 5,
    background: "transparent",
    color: "#b3b3c0",
    fontSize: "0.75rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    whiteSpace: "nowrap",
  },
  btnActive: {
    background: "#0d47a1",
    color: "#fff",
  },
  btnDanger: {
    color: "#e57373",
  },
  label: {
    fontSize: "0.72rem",
  },
};
