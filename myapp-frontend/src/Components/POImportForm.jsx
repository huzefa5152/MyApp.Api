import { useState, useEffect, useRef } from "react";
import { MdUploadFile, MdTextSnippet, MdAdd, MdDelete, MdCheckCircle, MdArrowBack, MdArrowForward, MdVerified, MdErrorOutline } from "react-icons/md";
import { parsePdf, parseText, ensureLookups } from "../api/poImportApi";
import { getClientsByCompany, getClientById } from "../api/clientApi";
import { createSalesOrder } from "../api/salesOrderApi";
import { createSalesQuote, getSalesQuotesForPicker } from "../api/salesQuoteApi";
import { createDeliveryChallan } from "../api/challanApi";
import { getAllUnits } from "../api/unitsApi";
import { submitParserFeedback } from "../api/parserFeedbackApi";
import { formStyles, modalSizes } from "../theme";
import { todayYmd } from "../utils/dateInput";
import LookupAutocomplete from "./LookupAutocomplete";
import QuantityInput from "./QuantityInput";
import ParserFeedback from "./ParserFeedback";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
  successLight: "#e8f5e9",
  warning: "#f57c00",
  warningLight: "#fff3e0",
};

// Per-target wiring — one PO-import wizard drives three destinations.
// `showQuoteLink` only makes sense for orders (an order links to a quote);
// `showPrice` adds a unit-price column for quotes (a priced document);
// `showIndent` keeps the challan's optional Indent No field.
const TARGET_CONFIG = {
  salesorder: { doc: "Sales Order", verb: "Create Sales Order", dateLabel: "Order Date *", showQuoteLink: true, showPrice: false, showIndent: false },
  salesquote: { doc: "Sales Quote", verb: "Create Sales Quote", dateLabel: "Quote Date *", showQuoteLink: false, showPrice: true, showIndent: false },
  challan: { doc: "Delivery Challan", verb: "Create Challan", dateLabel: "Delivery Date *", showQuoteLink: false, showPrice: false, showIndent: true },
};

export default function POImportForm({ companyId, target = "challan", onClose, onSaved }) {
  const cfg = TARGET_CONFIG[target] || TARGET_CONFIG.challan;
  const [step, setStep] = useState(1); // 1=import, 2=preview
  const [importMode, setImportMode] = useState("pdf"); // "pdf" or "text"
  const [pastedText, setPastedText] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");

  // Parsed data (editable in step 2)
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [indentNo, setIndentNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(todayYmd());
  const [selectedClientId, setSelectedClientId] = useState("");
  const [site, setSite] = useState("");
  const [salesQuoteId, setSalesQuoteId] = useState("");
  const [quotes, setQuotes] = useState([]);
  const [items, setItems] = useState([]);
  const [rawText, setRawText] = useState("");

  // Format match metadata (populated when a saved POFormat handled this PDF)
  const [matchedFormatId, setMatchedFormatId] = useState(null);
  const [matchedFormatName, setMatchedFormatName] = useState("");
  const [matchedFormatVersion, setMatchedFormatVersion] = useState(null);

  // When the server returns 422 (no format saved for this client's layout),
  // we flip into manual-entry mode: the form fields start empty and a clear
  // error banner tells the operator what to do.
  const [noFormatMessage, setNoFormatMessage] = useState("");

  // Parser-feedback verdict for THIS import ("Correct" | "Incorrect" | null).
  // Optional — never blocks creating the document.
  const [parserFeedback, setParserFeedback] = useState(null);

  // Lookups
  const [clients, setClients] = useState([]);
  const [units, setUnits] = useState([]);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [clientRes, unitsRes, quoteItems] = await Promise.all([
          getClientsByCompany(companyId),
          getAllUnits().catch(() => ({ data: [] })),
          // Quote-link picker is order-only — skip the (paged) fetch otherwise.
          cfg.showQuoteLink
            ? getSalesQuotesForPicker(companyId).catch(() => [])
            : Promise.resolve([]),
        ]);
        setClients(clientRes.data);
        setUnits(unitsRes.data || []);
        setQuotes(quoteItems || []);
      } catch { /* ignore */ }
    };
    load();
  }, [companyId, cfg.showQuoteLink]);

  // If the parse response carries a matchedClientId but it's not in the
  // current company's client list, fetch that one client and merge it in.
  const ensureClientInList = async (clientId) => {
    if (!clientId) return;
    try {
      const { data } = await getClientById(clientId);
      setClients((prev) => (prev.some((c) => c.id === data.id) ? prev : [data, ...prev]));
    } catch {
      /* client deleted or no permission — fall through; select will show blank */
    }
  };

  const handleParse = async () => {
    setError("");
    setNoFormatMessage("");
    setParsing(true);

    try {
      let res;
      if (importMode === "pdf") {
        if (!selectedFile) { setError("Please select a PDF file."); setParsing(false); return; }
        res = await parsePdf(selectedFile, companyId);
      } else {
        if (!pastedText.trim()) { setError("Please paste some text."); setParsing(false); return; }
        res = await parseText(pastedText, companyId);
      }

      const data = res.data;
      // A fresh parse is a fresh PO — drop any quote link chosen for a
      // previous preview.
      setSalesQuoteId("");
      setPoNumber(data.poNumber || "");
      setPoDate(data.poDate ? data.poDate.split("T")[0] : "");
      setItems(data.items?.map((item, idx) => ({
        id: idx,
        description: item.description || "",
        quantity: item.quantity || 1,
        unit: item.unit || "Pcs",
        unitPrice: 0,  // priced later (only surfaced for the quote target)
      })) || []);
      setRawText(data.rawText || "");
      setMatchedFormatId(data.matchedFormatId ?? null);
      setMatchedFormatName(data.matchedFormatName || "");
      setMatchedFormatVersion(data.matchedFormatVersion ?? null);
      // Pre-select the client from the matched POFormat so the operator
      // doesn't have to re-pick it on every import.
      if (data.matchedClientId) {
        await ensureClientInList(data.matchedClientId);
        setSelectedClientId(String(data.matchedClientId));
      }
      setStep(2);
    } catch (err) {
      // 422 = no format saved for this client's layout (or rules empty).
      // Flip into manual-entry mode with an explicit error message.
      if (err.response?.status === 422) {
        const miss = err.response.data || {};
        setPoNumber("");
        setPoDate("");
        setIndentNo("");
        setItems([]);
        setMatchedFormatId(null);
        setMatchedFormatName("");
        setMatchedFormatVersion(null);
        setRawText(miss.rawText || "");
        setNoFormatMessage(miss.message || "No PO format saved for this client — please fill the fields manually.");
        setStep(2);
      } else {
        setError(err.response?.data?.error || "Failed to parse. Please try again.");
      }
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError("");
    }
  };

  const handleItemChange = (idx, field, value) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { id: Date.now(), description: "", quantity: 1, unit: "Pcs", unitPrice: 0 }]);
  };

  const removeItem = (idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const selectedClient = clients.find((c) => c.id === parseInt(selectedClientId));
  const clientSites = selectedClient?.site ? selectedClient.site.split(";").map((s) => s.trim()).filter(Boolean) : [];
  // Quote status on the paged list is DERIVED server-side — Active / Accepted
  // / Expired. Only OPEN (Active) quotes are candidates for linking an
  // imported PO — never Expired, never Accepted (already linked). Before a
  // client is picked the list spans the whole company; once a client is set
  // it narrows to that client's quotes.
  const linkableQuotes = quotes.filter((q) =>
    (q.status === "Active" || q.status === "Draft" || q.status === "Sent")
    && (!selectedClientId || String(q.clientId) === String(selectedClientId)));

  // Picking a quote first auto-fills the client from it.
  const handleQuotePick = async (quoteId) => {
    setSalesQuoteId(quoteId);
    if (!quoteId) return;
    const q = quotes.find((x) => String(x.id) === String(quoteId));
    if (!q?.clientId || String(q.clientId) === String(selectedClientId)) return;
    if (!clients.some((c) => c.id === q.clientId)) await ensureClientInList(q.clientId);
    setSelectedClientId(String(q.clientId));
    setSite(""); // site belongs to the previous client
  };

  const canSubmit = selectedClientId && deliveryDate && items.length > 0 &&
    items.every((i) => i.description.trim() && i.quantity > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError("");
    setSaving(true);

    try {
      // Auto-create missing lookup entries
      const descriptions = items.map((i) => i.description.trim()).filter(Boolean);
      const unitNames = items.map((i) => i.unit.trim()).filter(Boolean);
      await ensureLookups(descriptions, unitNames);

      // Preserve fractional quantities (KG, Litre).
      const qty = (i) => (typeof i.quantity === "number" ? i.quantity : (parseFloat(i.quantity) || 1));
      const clientId = parseInt(selectedClientId);
      const iso = (d) => (d ? new Date(d).toISOString() : null);

      let created = null;
      if (target === "salesquote") {
        // Quote: description + qty + unit + price (operator prices in preview).
        // PO number/date map to the customer-enquiry reference fields — a
        // quote has no "customer PO" field of its own (PO lives on the order).
        created = await createSalesQuote(companyId, {
          clientId,
          date: iso(deliveryDate),
          validUntil: null,
          customerEnquiryRef: poNumber.trim() || null,
          enquiryDate: iso(poDate),
          gstRate: 0,
          notes: null,
          items: items.map((i) => ({
            id: 0,
            itemTypeId: null,
            description: i.description.trim(),
            quantity: qty(i),
            unit: i.unit.trim() || "Pcs",
            unitPrice: Number(i.unitPrice) || 0,
          })),
        });
      } else if (target === "challan") {
        // Direct delivery challan (no sales order). Qty-only; item types
        // classified later at bill time.
        created = await createDeliveryChallan(companyId, {
          clientId,
          clientName: selectedClient?.name || null,
          site: site || null,
          poNumber: poNumber.trim(),
          poDate: iso(poDate),
          indentNo: indentNo.trim() || null,
          deliveryDate: iso(deliveryDate),
          items: items.map((i) => ({
            description: i.description.trim(),
            quantity: qty(i),
            unit: i.unit.trim() || "Pcs",
            itemTypeId: null,
          })),
        });
      } else {
        // Sales Order (default target for the sales-order page). The customer's
        // PO number/date carry onto the order; delivery challans are raised
        // against it afterwards to track fulfilment.
        created = await createSalesOrder(companyId, {
          clientId,
          salesQuoteId: salesQuoteId ? parseInt(salesQuoteId) : null,
          customerPoNumber: poNumber.trim() || null,
          customerPoDate: iso(poDate),
          orderDate: iso(deliveryDate),
          site: site || null,
          isImported: true,
          items: items.map((i) => ({
            description: i.description.trim(),
            quantity: qty(i),
            unit: i.unit.trim() || "Pcs",
            itemTypeId: null,
          })),
        });
      }

      // Parser feedback — best-effort, never blocks. Only meaningful when a
      // saved format actually parsed this import.
      if (parserFeedback && matchedFormatId) {
        try {
          await submitParserFeedback({
            status: parserFeedback,
            file: importMode === "pdf" ? selectedFile : null,
            purchaseOrderId: created?.data?.id ?? null,
            companyId,
            parserVersion: matchedFormatName
              ? `${matchedFormatName}${matchedFormatVersion ? ` (v${matchedFormatVersion})` : ""}`
              : (matchedFormatVersion != null ? `v${matchedFormatVersion}` : null),
            originalFileName: importMode === "pdf" ? (selectedFile?.name || null) : null,
          });
        } catch { /* feedback is best-effort — the document is already created */ }
      }

      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || `Failed to create ${cfg.doc.toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  };

  // Backdrop click is a no-op — PO imports involve picking + reviewing
  // many lines, a stray click shouldn't drop the work. Use X / Cancel.
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            {step === 1 ? "Import Purchase Order" : `Review & ${cfg.verb}`}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div style={{ ...formStyles.body, maxHeight: "72vh", overflowY: "auto" }}>
          {error && <div style={styles.errorAlert}>{error}</div>}

          {step === 1 && (
            <>
              {/* Mode Tabs */}
              <div style={styles.modeTabs}>
                <button
                  type="button"
                  style={{ ...styles.modeTab, ...(importMode === "pdf" ? styles.modeTabActive : {}) }}
                  onClick={() => setImportMode("pdf")}
                >
                  <MdUploadFile size={18} /> Upload PDF
                </button>
                <button
                  type="button"
                  style={{ ...styles.modeTab, ...(importMode === "text" ? styles.modeTabActive : {}) }}
                  onClick={() => setImportMode("text")}
                >
                  <MdTextSnippet size={18} /> Paste Text
                </button>
              </div>

              {importMode === "pdf" ? (
                <div style={styles.uploadArea}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
                  <div
                    style={styles.dropZone}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <MdUploadFile size={48} color={colors.textSecondary} />
                    <p style={{ margin: "0.5rem 0 0", color: colors.textSecondary, fontSize: "0.9rem" }}>
                      {selectedFile ? selectedFile.name : "Click to select a PDF file"}
                    </p>
                    <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>Max 10 MB</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label style={styles.label}>Paste PO content below</label>
                  <textarea
                    style={styles.textarea}
                    rows={12}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={"Paste your Purchase Order text here...\n\nExample:\nPO No: PO-2026-001\nDate: 13/04/2026\n\n1. Pneumatic Fitting 1/4\"  -  10 Pcs\n2. Air Cylinder 50mm      -   5 Nos\n3. FRL Unit 1/4\"           -   2 Set"}
                  />
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {/* When a saved POFormat handled the PDF — quiet confirmation */}
              {matchedFormatId && (
                <div style={styles.matchedBanner}>
                  <MdVerified size={18} color={colors.success} />
                  <span style={{ fontSize: "0.85rem" }}>
                    Parsed using saved format <strong>{matchedFormatName}</strong>
                    {matchedFormatVersion ? ` (v${matchedFormatVersion})` : ""}. Review and edit below if needed.
                  </span>
                </div>
              )}

              {/* No format saved for this client's layout — explicit error */}
              {noFormatMessage && (
                <div style={styles.noFormatAlert}>
                  <MdErrorOutline size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>
                      No PO format saved for this client's layout
                    </div>
                    <div style={{ fontSize: "0.82rem", opacity: 0.9 }}>
                      {noFormatMessage}
                    </div>
                  </div>
                </div>
              )}

              {/* Quote link is asked FIRST — picking one auto-fills the client
                  below. Order-only; optional; narrows once a client is set. */}
              {cfg.showQuoteLink && (
                <div style={styles.row}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label style={styles.label}>Sales Quote (optional)</label>
                    <select style={styles.select} value={salesQuoteId} onChange={(e) => handleQuotePick(e.target.value)}>
                      <option value="">— not linked —</option>
                      {linkableQuotes.map((q) => (
                        <option key={q.id} value={q.id}>
                          Quote #{q.quoteNumber} · {q.clientName}{q.status ? ` · ${q.status}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Header row: Client / Site / Date */}
              <div style={styles.row}>
                <div style={{ flex: 2, minWidth: 220 }}>
                  <label style={styles.label}>Client *</label>
                  <select style={styles.select} value={selectedClientId} onChange={(e) => { setSelectedClientId(e.target.value); setSite(""); setSalesQuoteId(""); }}>
                    <option value="">— Select Client —</option>
                    {clients.map((cl) => (
                      <option key={cl.id} value={cl.id}>{cl.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1.5, minWidth: 180 }}>
                  <label style={styles.label}>Site / Department</label>
                  {clientSites.length > 0 ? (
                    <select style={styles.select} value={site} onChange={(e) => setSite(e.target.value)}>
                      <option value="">— Select Site —</option>
                      {clientSites.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      style={styles.input}
                      placeholder={selectedClientId ? "Optional" : "Pick a client first"}
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                      disabled={!selectedClientId}
                    />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={styles.label}>{cfg.dateLabel}</label>
                  <input type="date" style={styles.input} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                </div>
              </div>

              {/* PO row: Number + Date (+ Indent No for challan target) */}
              <div style={styles.row}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={styles.label}>PO Number</label>
                  <input style={styles.input} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-2026-001" />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label style={styles.label}>PO Date</label>
                  <input type="date" style={styles.input} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
                </div>
                {cfg.showIndent && (
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={styles.label}>Indent No</label>
                    <input style={styles.input} value={indentNo} onChange={(e) => setIndentNo(e.target.value)} placeholder="Leave blank if not used" />
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <label style={{ ...styles.label, marginBottom: 0 }}>
                    Items ({items.length})
                    {items.length > 0 && items.every((i) => i.description.trim() && i.quantity > 0) && (
                      <MdCheckCircle size={14} color={colors.success} style={{ marginLeft: 6, verticalAlign: "middle" }} />
                    )}
                  </label>
                  <button type="button" style={styles.addItemBtn} onClick={addItem}>
                    <MdAdd size={16} /> Add Item
                  </button>
                </div>

                {items.length === 0 ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: colors.textSecondary, fontSize: "0.85rem", border: `2px dashed ${colors.cardBorder}`, borderRadius: 8 }}>
                    No items detected. Click "Add Item" to add manually.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={styles.itemsHeader}>
                      <span style={{ flex: 0.5 }}>#</span>
                      <span style={{ flex: 2.5 }}>Description *</span>
                      <span style={{ flex: 0.6, textAlign: "center" }}>Qty *</span>
                      <span style={{ flex: 1 }}>Unit</span>
                      {cfg.showPrice && <span style={{ flex: 1, textAlign: "right" }}>Unit Price</span>}
                      <span style={{ flex: 0.3 }}></span>
                    </div>
                    {items.map((item, idx) => (
                      <div key={item.id} style={styles.itemRow}>
                        <span style={{ flex: 0.5, fontSize: "0.8rem", color: colors.textSecondary, paddingTop: 6 }}>{idx + 1}</span>
                        <div style={{ flex: 2.5 }}>
                          <LookupAutocomplete
                            label="Description"
                            endpoint="/lookup/items"
                            value={item.description}
                            onChange={(val) => handleItemChange(idx, "description", val)}
                            inputClassName=""
                            inputStyle={{ ...styles.input, padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                            multiline
                          />
                        </div>
                        <div style={{ flex: 1.1 }}>
                          <QuantityInput
                            value={item.quantity}
                            onChange={(val) => handleItemChange(idx, "quantity", val)}
                            unit={item.unit}
                            units={units}
                            style={{ ...styles.input, padding: "0.35rem 0.5rem", fontSize: "0.85rem", textAlign: "right" }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <LookupAutocomplete
                            label="Unit"
                            endpoint="/lookup/units"
                            value={item.unit}
                            onChange={(val) => handleItemChange(idx, "unit", val)}
                            inputClassName=""
                            inputStyle={{ ...styles.input, padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                          />
                        </div>
                        {cfg.showPrice && (
                          <div style={{ flex: 1 }}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => handleItemChange(idx, "unitPrice", e.target.value)}
                              style={{ ...styles.input, padding: "0.35rem 0.5rem", fontSize: "0.85rem", textAlign: "right" }}
                            />
                          </div>
                        )}
                        <div style={{ flex: 0.3, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <button
                            type="button"
                            style={styles.deleteItemBtn}
                            onClick={() => removeItem(idx)}
                            title="Remove item"
                          >
                            <MdDelete size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Raw text toggle */}
              {rawText && (
                <details style={{ marginTop: "1rem" }}>
                  <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: colors.textSecondary }}>
                    View extracted raw text
                  </summary>
                  <pre style={{ marginTop: "0.5rem", padding: "0.75rem", backgroundColor: "#f5f5f5", borderRadius: 6, fontSize: "0.75rem", maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {rawText}
                  </pre>
                </details>
              )}

              {/* Parser feedback — only when a saved format actually parsed
                  this import. Optional and non-blocking. */}
              {matchedFormatId && (
                <ParserFeedback value={parserFeedback} onChange={setParserFeedback} disabled={saving} />
              )}
            </>
          )}
        </div>

        <div style={formStyles.footer}>
          {step === 2 && (
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.cancel, marginRight: "auto" }}
              onClick={() => setStep(1)}
            >
              <MdArrowBack size={16} style={{ verticalAlign: "middle", marginRight: 4 }} />
              Back
            </button>
          )}

          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>

          {step === 1 && (
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: parsing ? 0.6 : 1 }}
              disabled={parsing}
              onClick={handleParse}
            >
              {parsing ? "Parsing..." : <>Parse & Preview <MdArrowForward size={16} style={{ verticalAlign: "middle", marginLeft: 4 }} /></>}
            </button>
          )}

          {step === 2 && (
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: !canSubmit || saving ? 0.6 : 1 }}
              disabled={!canSubmit || saving}
              onClick={handleSubmit}
            >
              {saving ? "Creating..." : cfg.verb}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", padding: "0.6rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", cursor: "pointer" },
  textarea: { width: "100%", padding: "0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.85rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box", fontFamily: "monospace", resize: "vertical" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  modeTabs: { display: "flex", gap: "0.5rem", marginBottom: "1.25rem" },
  modeTab: { display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.25rem", borderRadius: 8, border: `2px solid ${colors.cardBorder}`, backgroundColor: "#fff", fontSize: "0.88rem", fontWeight: 600, color: colors.textSecondary, cursor: "pointer", transition: "all 0.2s" },
  modeTabActive: { borderColor: colors.blue, color: colors.blue, backgroundColor: "#e3f2fd" },
  uploadArea: { marginBottom: "1rem" },
  dropZone: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2.5rem 1rem", border: `2px dashed ${colors.inputBorder}`, borderRadius: 12, cursor: "pointer", backgroundColor: colors.inputBg, transition: "border-color 0.2s" },
  itemsHeader: { display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.4rem 0.5rem", backgroundColor: "#f0f4f8", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase" },
  itemRow: { display: "flex", gap: "0.5rem", alignItems: "flex-start", padding: "0.5rem", borderRadius: 6, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fafbfc" },
  addItemBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.35rem 0.75rem", borderRadius: 6, border: `1px solid ${colors.teal}`, backgroundColor: "#fff", color: colors.teal, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  deleteItemBtn: { border: "none", background: "none", color: colors.danger, cursor: "pointer", padding: "0.25rem", borderRadius: 4 },
  matchedBanner: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    backgroundColor: colors.successLight,
    border: `1px solid ${colors.success}40`,
    borderRadius: 8,
    padding: "0.55rem 0.85rem",
    marginBottom: "1rem",
    color: "#1b5e20",
  },
  noFormatAlert: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.6rem",
    backgroundColor: colors.dangerLight,
    color: colors.danger,
    border: `1px solid ${colors.danger}40`,
    borderRadius: 8,
    padding: "0.75rem 1rem",
    marginBottom: "1rem",
  },
};
