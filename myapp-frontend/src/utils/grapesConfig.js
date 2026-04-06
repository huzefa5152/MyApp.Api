/**
 * GrapesJS configuration for the template visual editor.
 * Sets up A4 canvas, custom blocks for invoice sections,
 * and the hbs-placeholder component type for Handlebars expressions.
 */

export function getEditorConfig(container) {
  return {
    container,
    fromElement: false,
    height: "100%",
    width: "auto",
    storageManager: false,
    canvas: {
      styles: [],
      scripts: [],
    },
    panels: { defaults: [] },
    deviceManager: {
      devices: [
        { name: "A4 Portrait", width: "" },
        { name: "Mobile", width: "375px" },
      ],
    },
    // Don't render side panels — our merge fields sidebar handles field insertion
    blockManager: { appendTo: null },
    styleManager: {
      appendTo: null,
      sectors: [
        {
          name: "Typography",
          open: false,
          properties: [
            "font-family", "font-size", "font-weight", "letter-spacing",
            "color", "line-height", "text-align", "text-decoration", "text-shadow",
          ],
        },
        {
          name: "Dimensions",
          open: false,
          properties: [
            "width", "height", "max-width", "min-height", "padding", "margin",
          ],
        },
        {
          name: "Layout",
          open: false,
          properties: [
            "display", "flex-direction", "justify-content", "align-items",
            "gap", "position", "top", "right", "bottom", "left",
          ],
        },
        {
          name: "Decorations",
          open: false,
          properties: [
            "background-color", "background-image", "border",
            "border-radius", "box-shadow", "opacity",
          ],
        },
      ],
    },
    layerManager: { appendTo: null },
    selectorManager: { appendTo: null },
    traitManager: { appendTo: null },
  };
}

export function registerCommands(editor, confirmFn) {
  editor.Commands.add("canvas-clear", {
    async run(ed) {
      const ok = confirmFn
        ? await confirmFn({ title: "Clear Canvas?", message: "Clear the entire canvas? This cannot be undone.", variant: "danger", confirmText: "Clear" })
        : confirm("Clear the entire canvas? This cannot be undone.");
      if (ok) {
        ed.DomComponents.clear();
        ed.CssComposer.clear();
      }
    },
  });
}

export function registerHbsComponent(editor) {
  editor.DomComponents.addType("hbs-placeholder", {
    isComponent: (el) => el?.classList?.contains("hbs-placeholder"),
    model: {
      defaults: {
        tagName: "span",
        draggable: true,
        droppable: false,
        editable: false,
        removable: true,
        copyable: true,
        layerable: true,
        selectable: true,
        hoverable: true,
        attributes: { contenteditable: "false" },
        traits: [],
      },
    },
    view: {
      onRender() {
        this.el.style.cssText =
          "background:#e3f2fd;border:1px dashed #1565c0;border-radius:3px;" +
          "padding:1px 6px;font-family:monospace;font-size:0.8em;color:#0d47a1;" +
          "cursor:move;display:inline-block;white-space:nowrap;user-select:none;";
      },
    },
  });
}

// Helper: create an hbs-placeholder span for Handlebars expressions in block content
function hbs(expr) {
  return `<span class="hbs-placeholder" data-hbs="${btoa(expr)}" contenteditable="false">${expr}</span>`;
}

export function registerCustomBlocks(editor) {
  const bm = editor.BlockManager;

  /* ═══════════════════ BASIC ═══════════════════ */

  bm.add("text-block", {
    label: "Text",
    category: "Basic",
    content: "<p>Type your text here</p>",
  });

  bm.add("heading", {
    label: "Heading",
    category: "Basic",
    content: "<h2>Heading</h2>",
  });

  bm.add("image", {
    label: "Image",
    category: "Basic",
    content: { type: "image" },
  });

  bm.add("divider", {
    label: "Divider",
    category: "Basic",
    content: '<hr style="border:none;border-top:1px solid #000;margin:10px 0">',
  });

  bm.add("link", {
    label: "Link",
    category: "Basic",
    content: '<a href="#" style="color:#0d47a1;text-decoration:underline">Link text</a>',
  });

  bm.add("list", {
    label: "List",
    category: "Basic",
    content: `<ul style="padding-left:20px;margin:8px 0">
      <li>Item one</li><li>Item two</li><li>Item three</li>
    </ul>`,
  });

  bm.add("quote", {
    label: "Quote",
    category: "Basic",
    content: '<blockquote style="border-left:3px solid #1f4e79;padding:8px 14px;margin:10px 0;font-style:italic;color:#333">Quote text here</blockquote>',
  });

  bm.add("spacer", {
    label: "Spacer",
    category: "Basic",
    content: '<div style="height:30px" data-gjs-type="default"></div>',
  });

  /* ═══════════════════ LAYOUT ═══════════════════ */

  bm.add("two-columns", {
    label: "2 Columns",
    category: "Layout",
    content: `<div style="display:flex;gap:20px">
      <div style="flex:1;padding:10px;border:1px dashed #ccc;min-height:50px">Column 1</div>
      <div style="flex:1;padding:10px;border:1px dashed #ccc;min-height:50px">Column 2</div>
    </div>`,
  });

  bm.add("three-columns", {
    label: "3 Columns",
    category: "Layout",
    content: `<div style="display:flex;gap:15px">
      <div style="flex:1;padding:10px;border:1px dashed #ccc;min-height:50px">Column 1</div>
      <div style="flex:1;padding:10px;border:1px dashed #ccc;min-height:50px">Column 2</div>
      <div style="flex:1;padding:10px;border:1px dashed #ccc;min-height:50px">Column 3</div>
    </div>`,
  });

  bm.add("sidebar-layout", {
    label: "Sidebar 30/70",
    category: "Layout",
    content: `<div style="display:flex;gap:15px">
      <div style="flex:0 0 30%;padding:10px;border:1px dashed #ccc;min-height:60px">Sidebar</div>
      <div style="flex:1;padding:10px;border:1px dashed #ccc;min-height:60px">Main content</div>
    </div>`,
  });

  bm.add("grid-2x2", {
    label: "Grid 2×2",
    category: "Layout",
    content: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="padding:10px;border:1px dashed #ccc;min-height:40px">Cell 1</div>
      <div style="padding:10px;border:1px dashed #ccc;min-height:40px">Cell 2</div>
      <div style="padding:10px;border:1px dashed #ccc;min-height:40px">Cell 3</div>
      <div style="padding:10px;border:1px dashed #ccc;min-height:40px">Cell 4</div>
    </div>`,
  });

  bm.add("section", {
    label: "Section",
    category: "Layout",
    content: '<div style="width:100%;padding:15px;border:1px dashed #ccc;min-height:60px;box-sizing:border-box">Section content</div>',
  });

  bm.add("table", {
    label: "Table",
    category: "Layout",
    content: `<table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="border:1px solid #000;padding:5px">Header 1</th><th style="border:1px solid #000;padding:5px">Header 2</th><th style="border:1px solid #000;padding:5px">Header 3</th></tr></thead>
      <tbody><tr><td style="border:1px solid #000;padding:5px">Cell</td><td style="border:1px solid #000;padding:5px">Cell</td><td style="border:1px solid #000;padding:5px">Cell</td></tr></tbody>
    </table>`,
  });

  /* ═══════════════════ INVOICE ═══════════════════ */

  bm.add("invoice-header", {
    label: "Invoice Header",
    category: "Invoice",
    content: `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:15px">
      <div>
        <div style="font-size:28px;font-weight:bold">Company Name</div>
        <div style="font-size:11px;margin-top:4px">Address Line</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:24px;font-weight:bold;color:#1f4e79">Document Title</div>
      </div>
    </div>`,
  });

  bm.add("logo-header", {
    label: "Logo + Name",
    category: "Invoice",
    content: `<div style="display:flex;align-items:center;gap:15px;margin-bottom:15px">
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect width='60' height='60' fill='%23e0e0e0'/%3E%3Ctext x='50%25' y='55%25' font-size='10' text-anchor='middle' fill='%23999'%3ELogo%3C/text%3E%3C/svg%3E" alt="Logo" style="width:60px;height:60px;object-fit:contain" />
      <div>
        <div style="font-size:22px;font-weight:bold;color:#1f4e79">Company Name</div>
        <div style="font-size:10px;color:#555;margin-top:2px">Tagline or address here</div>
      </div>
    </div>`,
  });

  bm.add("info-row", {
    label: "Info Row",
    category: "Invoice",
    content: `<div style="display:flex;gap:20px;margin-bottom:8px;font-size:11px">
      <div><strong>Invoice No:</strong> 001</div>
      <div><strong>Date:</strong> 01/01/2026</div>
      <div><strong>PO No:</strong> PO-001</div>
    </div>`,
  });

  bm.add("party-info", {
    label: "Party Info",
    category: "Invoice",
    content: `<div style="border:1px solid #000;padding:10px;margin-bottom:15px">
      <div style="font-weight:bold;margin-bottom:5px">Party Name</div>
      <div style="font-size:10px">Address</div>
      <div style="font-size:10px">NTN: / STRN:</div>
    </div>`,
  });

  bm.add("items-table", {
    label: "Items Table",
    category: "Invoice",
    content: `<table style="width:100%;border-collapse:collapse;border:2px solid #000">
      <thead><tr>
        <th style="border:1px solid #000;padding:5px;background:#1f4e79;color:#fff">Item #</th>
        <th style="border:1px solid #000;padding:5px;background:#1f4e79;color:#fff">Description</th>
        <th style="border:1px solid #000;padding:5px;background:#1f4e79;color:#fff">Qty</th>
        <th style="border:1px solid #000;padding:5px;background:#1f4e79;color:#fff">Amount</th>
      </tr></thead>
      <tbody><tr>
        <td style="border:1px solid #000;padding:4px">1</td>
        <td style="border:1px solid #000;padding:4px">Item description</td>
        <td style="border:1px solid #000;padding:4px;text-align:center">0</td>
        <td style="border:1px solid #000;padding:4px;text-align:right">0</td>
      </tr></tbody>
    </table>`,
  });

  bm.add("totals-section", {
    label: "Totals",
    category: "Invoice",
    content: `<table style="border-collapse:collapse;margin-left:auto;margin-top:10px">
      <tr><td style="padding:5px;font-weight:bold">Subtotal</td><td style="padding:5px;border:1px solid #999">0</td></tr>
      <tr><td style="padding:5px;font-weight:bold">GST</td><td style="padding:5px;border:1px solid #999">0</td></tr>
      <tr><td style="padding:5px;font-weight:bold;border-top:2px solid #000">Total</td><td style="padding:5px;border:1px solid #000;font-weight:bold">0</td></tr>
    </table>`,
  });

  bm.add("gst-summary", {
    label: "GST Summary",
    category: "Invoice",
    content: `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:11px">
      <thead><tr>
        <th style="border:1px solid #000;padding:4px;background:#f0f0f0">Description</th>
        <th style="border:1px solid #000;padding:4px;background:#f0f0f0;text-align:right">Value (excl. tax)</th>
        <th style="border:1px solid #000;padding:4px;background:#f0f0f0;text-align:right">CGST</th>
        <th style="border:1px solid #000;padding:4px;background:#f0f0f0;text-align:right">SGST</th>
        <th style="border:1px solid #000;padding:4px;background:#f0f0f0;text-align:right">Total</th>
      </tr></thead>
      <tbody><tr>
        <td style="border:1px solid #000;padding:4px">Goods / Services</td>
        <td style="border:1px solid #000;padding:4px;text-align:right">0</td>
        <td style="border:1px solid #000;padding:4px;text-align:right">0</td>
        <td style="border:1px solid #000;padding:4px;text-align:right">0</td>
        <td style="border:1px solid #000;padding:4px;text-align:right;font-weight:bold">0</td>
      </tr></tbody>
    </table>`,
  });

  bm.add("amount-words", {
    label: "Amount in Words",
    category: "Invoice",
    content: `<div style="border:1px solid #000;margin-top:10px">
      <div style="font-weight:bold;padding:5px;background:#1f4e79;color:#fff">Amount In Words:</div>
      <div style="padding:15px;text-align:center;font-style:italic">Amount in words here</div>
    </div>`,
  });

  bm.add("bank-details", {
    label: "Bank Details",
    category: "Invoice",
    content: `<div style="border:1px solid #000;padding:10px;margin-top:10px;font-size:11px">
      <div style="font-weight:bold;margin-bottom:6px;font-size:12px">Bank Details</div>
      <table style="border-collapse:collapse">
        <tr><td style="padding:2px 10px 2px 0;font-weight:bold">Bank Name:</td><td style="padding:2px 0">Your Bank</td></tr>
        <tr><td style="padding:2px 10px 2px 0;font-weight:bold">Account Title:</td><td style="padding:2px 0">Account Name</td></tr>
        <tr><td style="padding:2px 10px 2px 0;font-weight:bold">Account No:</td><td style="padding:2px 0">0000-0000000-000</td></tr>
        <tr><td style="padding:2px 10px 2px 0;font-weight:bold">IBAN:</td><td style="padding:2px 0">PK00XXXX0000000000000</td></tr>
      </table>
    </div>`,
  });

  bm.add("terms", {
    label: "Terms & Conditions",
    category: "Invoice",
    content: `<div style="margin-top:15px;font-size:10px;color:#333">
      <div style="font-weight:bold;margin-bottom:4px;font-size:11px">Terms &amp; Conditions:</div>
      <ol style="padding-left:18px;margin:0">
        <li>Payment is due within 30 days of invoice date.</li>
        <li>Goods once sold will not be taken back.</li>
        <li>All disputes are subject to local jurisdiction.</li>
      </ol>
    </div>`,
  });

  bm.add("signature-row", {
    label: "Signatures",
    category: "Invoice",
    content: `<div style="display:flex;justify-content:space-between;margin-top:50px;padding:0 40px">
      <div style="text-align:center">
        <div style="width:200px;border-top:1px solid #000;margin-bottom:4px"></div>
        <div style="font-size:9px;font-weight:bold">Signature and Stamp</div>
      </div>
      <div style="text-align:center">
        <div style="width:200px;border-top:1px solid #000;margin-bottom:4px"></div>
        <div style="font-size:9px;font-weight:bold">Receiver Signature</div>
      </div>
    </div>`,
  });

  bm.add("stamp-box", {
    label: "Stamp & Sign Box",
    category: "Invoice",
    content: `<div style="width:200px;height:100px;border:2px dashed #999;display:flex;align-items:center;justify-content:center;margin-top:20px">
      <span style="font-size:10px;color:#999;font-style:italic">Stamp &amp; Signature</span>
    </div>`,
  });

  bm.add("watermark", {
    label: "Watermark",
    category: "Invoice",
    content: `<div style="position:relative;text-align:center;margin:20px 0;pointer-events:none">
      <span style="font-size:60px;font-weight:bold;color:rgba(0,0,0,0.06);text-transform:uppercase;letter-spacing:10px">ORIGINAL</span>
    </div>`,
  });

  bm.add("page-break", {
    label: "Page Break",
    category: "Invoice",
    content: '<div style="page-break-after:always;border-bottom:2px dashed #ccc;margin:20px 0;padding:4px;text-align:center;font-size:9px;color:#999">— Page Break —</div>',
  });

  bm.add("bordered-container", {
    label: "Bordered Box",
    category: "Invoice",
    content: '<div style="border:1px solid #000;padding:12px;margin:10px 0;min-height:50px">Content here</div>',
  });

  bm.add("note-box", {
    label: "Note / Remark",
    category: "Invoice",
    content: `<div style="background:#fffde7;border:1px solid #f9a825;border-radius:4px;padding:10px;margin:10px 0;font-size:11px">
      <strong>Note:</strong> Your remark or special instructions here.
    </div>`,
  });

  /* ═══════════════════ DYNAMIC DATA ═══════════════════ */

  bm.add("each-loop", {
    label: "Each Loop",
    category: "Dynamic",
    content: `<div style="border:1px dashed #1565c0;padding:8px;margin:8px 0;border-radius:4px">
      ${hbs("{{#each items}}")}
      <div style="padding:4px 0;border-bottom:1px dotted #ddd">Row content — use merge fields here</div>
      ${hbs("{{/each}}")}
    </div>`,
  });

  bm.add("if-block", {
    label: "If / Condition",
    category: "Dynamic",
    content: `<div style="border:1px dashed #2e7d32;padding:8px;margin:8px 0;border-radius:4px">
      ${hbs("{{#if condition}}")}
      <div style="padding:4px 0">Content shown when condition is true</div>
      ${hbs("{{/if}}")}
    </div>`,
  });

  bm.add("merge-chip", {
    label: "Merge Field",
    category: "Dynamic",
    content: hbs("{{fieldName}}"),
  });

  bm.add("currency-field", {
    label: "Currency Amount",
    category: "Dynamic",
    content: `<span style="font-weight:bold">Rs. </span>${hbs("{{amount}}")}`,
  });
}

export function injectA4Styles(editor) {
  const frame = editor.Canvas.getFrameEl();
  if (!frame) return;
  const doc = frame.contentDocument;
  if (!doc) return;
  const style = doc.createElement("style");
  style.textContent = `
    body {
      max-width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 10mm 12mm;
      background: #fff;
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #000;
      line-height: 1.3;
      box-sizing: border-box;
    }
    .hbs-placeholder {
      background: #e3f2fd !important;
      border: 1px dashed #1565c0 !important;
      border-radius: 3px !important;
      padding: 1px 6px !important;
      font-family: monospace !important;
      font-size: 0.8em !important;
      color: #0d47a1 !important;
      cursor: move !important;
      display: inline-block !important;
      white-space: nowrap !important;
      user-select: none !important;
    }
  `;
  doc.head.appendChild(style);
}
