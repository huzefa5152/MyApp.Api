import { useState, useEffect } from "react";
import { MdInfo } from "react-icons/md";
import { getInvoiceById, updateInvoice } from "../api/invoiceApi";
import { getItemTypes } from "../api/itemTypeApi";
import { formStyles } from "../theme";
import LookupAutocomplete from "./LookupAutocomplete";
import SearchableItemTypeSelect from "./SearchableItemTypeSelect";

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
  warn: "#f57c00",
  warnBg: "#fff8e1",
  warnBorder: "#ffcc80",
  infoBg: "#e3f2fd",
  infoBorder: "#90caf9",
};

/**
 * Edit an existing bill.
 *
 * Items cannot be added or removed here — add/remove items on the linked
 * delivery challan instead (the bill auto-syncs). Here the user can only
 * update per-item fields: description, quantity, UOM, unit price, HS Code, sale type.
 *
 * Description and UOM use LookupAutocomplete with /api/lookup/items and /api/lookup/units,
 * matching the delivery challan form — picks existing values, creates new ones if needed.
 */
export default function EditBillForm({ invoiceId, onClose, onSaved, readOnly = false }) {
  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [gstRate, setGstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [documentType, setDocumentType] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [{ data }, typesRes] = await Promise.all([
          getInvoiceById(invoiceId),
          getItemTypes().catch(() => ({ data: [] })),
        ]);
        setInvoice(data);
        setItems(data.items.map((it) => ({ ...it })));
        setItemTypes(typesRes.data || []);
        setGstRate(data.gstRate ?? 18);
        setPaymentTerms(data.paymentTerms ?? "");
        setPaymentMode(data.paymentMode ?? "");
        setDocumentType(data.documentType ?? 4);
      } catch {
        setError("Failed to load bill.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [invoiceId]);

  const updateItem = (index, field, value) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // Recalculate lineTotal
      const qty = parseFloat(next[index].quantity) || 0;
      const price = parseFloat(next[index].unitPrice) || 0;
      next[index].lineTotal = Math.round(qty * price * 100) / 100;
      return next;
    });
  };

  // When the user picks a different Item Type for a line, copy the catalog's
  // FBR fields onto the row — UOM, HS Code, Sale Type, FBR UOM ID. These fields
  // are read-only in the grid; the only way to change them is to pick a
  // different Item Type (or edit the Item Type row in the catalog).
  const updateItemType = (index, newId, pickedType) => {
    setItems((prev) => {
      const next = [...prev];
      const current = { ...next[index] };
      current.itemTypeId = newId || null;
      if (pickedType) {
        current.itemTypeName = pickedType.name || "";
        current.uom = pickedType.uom || "";
        current.fbrUOMId = pickedType.fbrUOMId || null;
        current.hsCode = pickedType.hsCode || "";
        current.saleType = pickedType.saleType || "";
        // Default description to the item type name if empty
        if (!current.description?.trim()) current.description = pickedType.name || "";
      } else {
        // Cleared — blank out the FBR metadata
        current.itemTypeName = "";
      }
      next[index] = current;
      return next;
    });
  };

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.lineTotal) || 0), 0);
  const gstAmount = Math.round(subtotal * (parseFloat(gstRate) || 0) / 100 * 100) / 100;
  const grandTotal = subtotal + gstAmount;

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    if (items.length === 0) return setError("No items to save.");
    if (items.some((i) => !i.description?.trim())) return setError("All items must have a description.");
    if (items.some((i) => (parseFloat(i.quantity) || 0) <= 0)) return setError("Quantity must be greater than 0.");
    if (items.some((i) => (parseFloat(i.unitPrice) || 0) < 0)) return setError("Unit price cannot be negative.");

    setSaving(true);
    try {
      await updateInvoice(invoiceId, {
        gstRate: parseFloat(gstRate),
        paymentTerms: paymentTerms || null,
        documentType: documentType || null,
        paymentMode: paymentMode || null,
        items: items.map((i) => ({
          id: i.id || 0,
          deliveryItemId: i.deliveryItemId || null,
          // When ItemTypeId is set, backend re-derives HS/UOM/Sale Type from it.
          // We still send the current values for safety (backend uses the ItemType
          // values when ItemTypeId is present).
          itemTypeId: i.itemTypeId || null,
          description: i.description,
          quantity: parseInt(i.quantity),
          uom: i.uom || "",
          unitPrice: parseFloat(i.unitPrice),
          hsCode: i.hsCode || null,
          fbrUOMId: i.fbrUOMId || null,
          saleType: i.saleType || null,
          rateId: i.rateId || null,
        })),
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save bill.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: 1300, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            {readOnly ? "View Bill" : "Edit Bill"} {invoice?.fbrInvoiceNumber || `#${invoice?.invoiceNumber || ""}`}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSave}>
          <div style={{ ...formStyles.body, maxHeight: "75vh", overflowY: "auto" }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: colors.textSecondary }}>Loading...</div>
            ) : !invoice ? (
              <div style={styles.errorAlert}>Bill not found.</div>
            ) : !invoice.isEditable && !readOnly ? (
              <div style={styles.errorAlert}>
                This bill has been submitted to FBR and cannot be edited.
              </div>
            ) : (
              <>
                {error && <div style={styles.errorAlert}>{error}</div>}

                {!readOnly && (
                  <div style={styles.infoBox}>
                    <MdInfo size={16} style={{ color: colors.blue, flexShrink: 0, marginTop: 2 }} />
                    <div>
                      To <b>add or remove items</b>, edit the linked delivery challan
                      {invoice.challanNumbers?.length > 0 && (
                        <> (<b>DC#{invoice.challanNumbers.join(", DC#")}</b>)</>
                      )}.
                      The bill will sync automatically.
                    </div>
                  </div>
                )}

                {readOnly && (
                  <div style={styles.infoBox}>
                    <MdInfo size={16} style={{ color: colors.blue, flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <b>Client:</b> {invoice.clientName} · <b>Date:</b> {invoice.date ? new Date(invoice.date).toLocaleDateString() : "—"}
                      {invoice.challanNumbers?.length > 0 && <> · <b>DC#{invoice.challanNumbers.join(", #")}</b></>}
                      {invoice.fbrStatus && <> · <b>FBR:</b> {invoice.fbrStatus}</>}
                      {invoice.fbrIRN && <> · <b>IRN:</b> {invoice.fbrIRN}</>}
                    </div>
                  </div>
                )}

                {/* Bill-level fields */}
                <div style={styles.row}>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <label style={styles.label}>GST Rate (%)</label>
                    <input
                      type="number"
                      style={{ ...styles.input, ...(readOnly ? styles.readOnlyInput : {}) }}
                      value={gstRate}
                      onChange={(e) => setGstRate(e.target.value)}
                      min={0}
                      max={100}
                      step={0.5}
                      readOnly={readOnly}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={styles.label}>Payment Terms</label>
                    <input
                      type="text"
                      style={{ ...styles.input, ...(readOnly ? styles.readOnlyInput : {}) }}
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                      placeholder="Optional"
                      readOnly={readOnly}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={styles.label}>Payment Mode</label>
                    <select
                      style={{ ...styles.input, ...(readOnly ? styles.readOnlyInput : {}) }}
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value)}
                      disabled={readOnly}
                    >
                      <option value="">— none —</option>
                      <option>Cash</option>
                      <option>Credit</option>
                      <option>Bank Transfer</option>
                      <option>Cheque</option>
                      <option>Online</option>
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={styles.label}>Document Type</label>
                    <select
                      style={{ ...styles.input, ...(readOnly ? styles.readOnlyInput : {}) }}
                      value={documentType}
                      onChange={(e) => setDocumentType(parseInt(e.target.value))}
                      disabled={readOnly}
                    >
                      <option value={4}>Sale Invoice</option>
                      <option value={9}>Debit Note</option>
                      <option value={10}>Credit Note</option>
                    </select>
                  </div>
                </div>

                {/* Items table — no add/remove; only field edits */}
                <h6 style={styles.sectionHeading}>Items ({items.length})</h6>

                {!readOnly && (
                  <p style={styles.gridHint}>
                    Pick an <b>Item Type</b> — UOM, HS Code &amp; Sale Type auto-fill from the catalog and
                    <b> cannot be edited inline</b>. To change them, pick a different Item Type or edit the Item Type row on the catalog page.
                  </p>
                )}

                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.thead}>
                        <th style={{ ...styles.th, width: 180, minWidth: 180 }}>Item Type (FBR)</th>
                        <th style={{ ...styles.th, minWidth: 140 }}>Description</th>
                        <th style={{ ...styles.th, width: 70, minWidth: 70 }}>Qty</th>
                        <th style={{ ...styles.th, width: 110, minWidth: 110 }}>UOM</th>
                        <th style={{ ...styles.th, width: 100, minWidth: 100 }}>Unit Price</th>
                        <th style={{ ...styles.th, width: 100, minWidth: 100 }}>Line Total</th>
                        <th style={{ ...styles.th, width: 90, minWidth: 90 }}>HS Code</th>
                        <th style={{ ...styles.th, minWidth: 140 }}>Sale Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => {
                        const hasItemType = !!item.itemTypeId;
                        return (
                          <tr key={item.id || `new-${idx}`}>
                            <td style={styles.td}>
                              {readOnly ? (
                                <div style={styles.readOnlyText}>{item.itemTypeName || <span style={styles.muted}>—</span>}</div>
                              ) : (
                                <SearchableItemTypeSelect
                                  items={itemTypes}
                                  value={item.itemTypeId || ""}
                                  onChange={(newId, picked) => updateItemType(idx, newId ? parseInt(newId) : null, picked)}
                                  placeholder="Pick item…"
                                  style={styles.tableInput}
                                />
                              )}
                            </td>
                            <td style={styles.td}>
                              {readOnly ? (
                                <div style={styles.readOnlyText}>{item.description || <span style={styles.muted}>—</span>}</div>
                              ) : (
                                <LookupAutocomplete
                                  label="Description"
                                  endpoint="/lookup/items"
                                  value={item.description || ""}
                                  onChange={(v) => updateItem(idx, "description", v)}
                                  inputClassName=""
                                  inputStyle={styles.tableInput}
                                />
                              )}
                            </td>
                            <td style={styles.td}>
                              <input
                                type="number"
                                style={{ ...styles.tableInput, ...(readOnly ? styles.readOnlyInput : {}), textAlign: "right" }}
                                value={item.quantity ?? 0}
                                onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                                min={1}
                                readOnly={readOnly}
                              />
                            </td>
                            <td style={{ ...styles.td, ...styles.readOnlyCell }} title="Comes from Item Type">
                              {item.uom || <span style={styles.muted}>—</span>}
                            </td>
                            <td style={styles.td}>
                              <input
                                type="number"
                                style={{ ...styles.tableInput, ...(readOnly ? styles.readOnlyInput : {}), textAlign: "right" }}
                                value={item.unitPrice ?? 0}
                                onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                                min={0}
                                step={0.01}
                                readOnly={readOnly}
                              />
                            </td>
                            <td style={{ ...styles.td, fontWeight: 600, color: colors.textPrimary, textAlign: "right" }}>
                              {(parseFloat(item.lineTotal) || 0).toLocaleString()}
                            </td>
                            <td style={{ ...styles.td, ...styles.readOnlyCell, fontFamily: "monospace" }} title="Comes from Item Type">
                              {item.hsCode || <span style={styles.muted}>—</span>}
                            </td>
                            <td style={{ ...styles.td, ...styles.readOnlyCell, fontSize: "0.72rem" }} title="Comes from Item Type">
                              {item.saleType || <span style={styles.muted}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div style={styles.totalsBox}>
                  <div style={styles.totalsRow}>
                    <span>Subtotal:</span>
                    <strong>Rs. {subtotal.toLocaleString()}</strong>
                  </div>
                  <div style={styles.totalsRow}>
                    <span>GST ({gstRate}%):</span>
                    <strong>Rs. {gstAmount.toLocaleString()}</strong>
                  </div>
                  <div style={{ ...styles.totalsRow, borderTop: `1px solid ${colors.cardBorder}`, paddingTop: "0.5rem", marginTop: "0.5rem" }}>
                    <span style={{ fontWeight: 700 }}>Grand Total:</span>
                    <strong style={{ fontSize: "1.1rem", color: colors.blue }}>Rs. {grandTotal.toLocaleString()}</strong>
                  </div>
                </div>

                {invoice?.fbrStatus === "Validated" && (
                  <div style={styles.warnNote}>
                    ⓘ Editing this bill will clear its FBR validation status. You'll need to re-validate before submitting to FBR.
                  </div>
                )}
              </>
            )}
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && invoice?.isEditable && (
              <button
                type="submit"
                style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  errorAlert: { padding: "0.7rem 1rem", backgroundColor: colors.dangerLight, color: colors.danger, borderRadius: 6, marginBottom: "1rem", fontSize: "0.85rem" },
  warnNote: { padding: "0.7rem 1rem", backgroundColor: colors.warnBg, color: colors.warn, borderRadius: 6, marginTop: "1rem", fontSize: "0.82rem", border: `1px solid ${colors.warnBorder}` },
  infoBox: {
    display: "flex", alignItems: "flex-start", gap: "0.5rem",
    padding: "0.65rem 0.85rem", backgroundColor: colors.infoBg,
    color: colors.textPrimary, borderRadius: 6, marginBottom: "1rem",
    fontSize: "0.82rem", border: `1px solid ${colors.infoBorder}`,
  },
  row: { display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", fontSize: "0.82rem", fontWeight: 600, color: colors.textPrimary, marginBottom: "0.3rem" },
  input: { width: "100%", padding: "0.55rem 0.75rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 6, fontSize: "0.85rem", backgroundColor: colors.inputBg },
  sectionHeading: { margin: "1rem 0 0.5rem", fontSize: "0.95rem", fontWeight: 700, color: colors.textPrimary },
  tableWrap: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 1100, tableLayout: "fixed" },
  thead: { backgroundColor: "#f5f7fa" },
  th: { padding: "0.6rem 0.5rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${colors.cardBorder}` },
  td: { padding: "0.4rem 0.5rem", fontSize: "0.82rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "middle" },
  tableInput: { width: "100%", padding: "0.35rem 0.5rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 4, fontSize: "0.8rem", backgroundColor: "#fff" },
  readOnlyCell: { backgroundColor: "#f5f7fa", color: colors.textPrimary, fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  readOnlyInput: { backgroundColor: "#f5f7fa", cursor: "not-allowed", pointerEvents: "none" },
  readOnlyText: { padding: "0.35rem 0.5rem", fontSize: "0.8rem", color: colors.textPrimary, fontWeight: 600 },
  muted: { color: "#9ca3af", fontStyle: "italic" },
  gridHint: { margin: "0.5rem 0 0.6rem", fontSize: "0.75rem", color: colors.textSecondary, lineHeight: 1.4 },
  totalsBox: { marginTop: "1rem", padding: "0.75rem 1rem", backgroundColor: "#f5f7fa", borderRadius: 8, maxWidth: 360, marginLeft: "auto" },
  totalsRow: { display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: colors.textPrimary, padding: "0.2rem 0" },
};
