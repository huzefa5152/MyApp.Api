import { useState, useEffect } from "react";
import { getPendingChallansByCompany } from "../api/challanApi";
import { createInvoice } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { formStyles } from "../theme";

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
};

export default function InvoiceForm({ companyId, company, onClose, onSaved }) {
  const [clients, setClients] = useState([]);
  const [allChallans, setAllChallans] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [itemPrices, setItemPrices] = useState({});
  const [gstRate, setGstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [challanRes, clientRes] = await Promise.all([
          getPendingChallansByCompany(companyId),
          getClientsByCompany(companyId),
        ]);
        setAllChallans(challanRes.data);
        setClients(clientRes.data);
      } catch {
        setError("Failed to load data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [companyId]);

  // Filter challans for selected client, sorted by DC# descending
  const clientChallans = selectedClientId
    ? allChallans
        .filter((c) => c.clientId === parseInt(selectedClientId))
        .sort((a, b) => b.challanNumber - a.challanNumber)
    : [];

  // Reset selections when client changes
  const handleClientChange = (e) => {
    setSelectedClientId(e.target.value);
    setSelectedIds([]);
    setItemPrices({});
    setError("");
  };


  const toggleChallan = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === clientChallans.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(clientChallans.map((c) => c.id));
    }
  };

  const selectedChallans = clientChallans.filter((c) => selectedIds.includes(c.id));
  const allItems = selectedChallans.flatMap((c) =>
    c.items.map((item) => ({ ...item, challanNumber: c.challanNumber }))
  );

  const subtotal = allItems.reduce((sum, item) => {
    const price = parseFloat(itemPrices[item.id]) || 0;
    return sum + item.quantity * price;
  }, 0);
  const gstAmount = Math.round(subtotal * gstRate / 100 * 100) / 100;
  const grandTotal = subtotal + gstAmount;

  const handlePriceChange = (itemId, value) => {
    setItemPrices((prev) => ({ ...prev, [itemId]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!selectedClientId) return setError("Select a client first.");
    if (selectedIds.length === 0) return setError("Select at least one challan.");
    if (!company || company.startingInvoiceNumber === 0)
      return setError("Starting invoice number has not been set for this company. Please set it in the Companies page first.");

    const missingPrices = allItems.filter((i) => !itemPrices[i.id] || parseFloat(itemPrices[i.id]) <= 0);
    if (missingPrices.length > 0) return setError("Enter unit price for all items.");

    setSaving(true);
    try {
      await createInvoice({
        date: new Date(invoiceDate).toISOString(),
        companyId,
        clientId: parseInt(selectedClientId),
        gstRate: parseFloat(gstRate),
        paymentTerms: paymentTerms || null,
        challanIds: selectedIds,
        items: allItems.map((item) => ({
          deliveryItemId: item.id,
          unitPrice: parseFloat(itemPrices[item.id]),
        })),
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create invoice.");
    } finally {
      setSaving(false);
    }
  };

  // Clients that have at least one pending challan
  const clientsWithChallans = clients.filter((cl) =>
    allChallans.some((ch) => ch.clientId === cl.id)
  );

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: 850, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Create Invoice</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ ...formStyles.body, maxHeight: "70vh", overflowY: "auto" }}>
            {error && <div style={styles.errorAlert}>{error}</div>}

            {loading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: colors.textSecondary }}>Loading...</div>
            ) : (
              <>
                {/* Step 1: Client Selection */}
                <div style={{ marginBottom: "1.25rem" }}>
                  <label style={styles.label}>Select Client</label>
                  {clientsWithChallans.length === 0 ? (
                    <p style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>No clients have pending challans.</p>
                  ) : (
                    <select
                      style={styles.select}
                      value={selectedClientId}
                      onChange={handleClientChange}
                    >
                      <option value="">— Choose a client —</option>
                      {clientsWithChallans.map((cl) => {
                        const count = allChallans.filter((ch) => ch.clientId === cl.id).length;
                        return (
                          <option key={cl.id} value={cl.id}>
                            {cl.name} ({count} pending DC{count !== 1 ? "s" : ""})
                          </option>
                        );
                      })}
                    </select>
                  )}
                  {company && company.startingInvoiceNumber === 0 && (
                    <div style={{ ...styles.errorAlert, marginTop: "0.5rem", marginBottom: 0 }}>
                      Starting invoice number not set for this company. Please configure it in the Companies page.
                    </div>
                  )}
                  {company && company.startingInvoiceNumber > 0 && (
                    <span style={{ fontSize: "0.78rem", color: colors.textSecondary, marginTop: "0.3rem", display: "block" }}>
                      Next invoice #: {company.currentInvoiceNumber > 0 ? company.currentInvoiceNumber + 1 : company.startingInvoiceNumber}
                    </span>
                  )}
                </div>

                {/* Step 2: Show rest only after client is selected AND has starting invoice number */}
                {selectedClientId && company?.startingInvoiceNumber > 0 && (
                  <>
                    {/* Date & GST */}
                    <div style={styles.row}>
                      <div style={{ flex: 1 }}>
                        <label style={styles.label}>Invoice Date</label>
                        <input type="date" style={styles.input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={styles.label}>GST Rate (%)</label>
                        <input type="number" style={styles.input} value={gstRate} onChange={(e) => setGstRate(e.target.value)} min={0} max={100} step={0.5} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={styles.label}>Payment Terms</label>
                        <input type="text" style={styles.input} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Optional" />
                      </div>
                    </div>

                    {/* Challan selection */}
                    <div style={{ marginBottom: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                        <label style={{ ...styles.label, marginBottom: 0 }}>
                          Pending Challans ({clientChallans.length})
                        </label>
                        {clientChallans.length > 1 && (
                          <button
                            type="button"
                            style={styles.selectAllBtn}
                            onClick={selectAll}
                          >
                            {selectedIds.length === clientChallans.length ? "Deselect All" : "Select All"}
                          </button>
                        )}
                      </div>
                      {clientChallans.length === 0 ? (
                        <p style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>No pending challans for this client.</p>
                      ) : (
                        <div style={styles.challanGrid}>
                          {clientChallans.map((c) => (
                            <label key={c.id} style={{
                              ...styles.challanCard,
                              borderColor: selectedIds.includes(c.id) ? colors.blue : colors.cardBorder,
                              backgroundColor: selectedIds.includes(c.id) ? "#e3f2fd" : "#fff",
                            }}>
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(c.id)}
                                onChange={() => toggleChallan(c.id)}
                                style={{ marginRight: "0.5rem", flexShrink: 0 }}
                              />
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                <strong>DC #{c.challanNumber}</strong>
                                <span style={{ fontSize: "0.78rem", color: colors.textSecondary }}>
                                  {new Date(c.deliveryDate).toLocaleDateString()} | {c.items?.length} items
                                  {c.poNumber ? ` | PO: ${c.poNumber}` : ""}
                                </span>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Items with price input */}
                    {allItems.length > 0 && (
                      <div>
                        <label style={styles.label}>Items - Enter Unit Price</label>
                        <div style={styles.itemsTable}>
                          <div style={styles.itemsHeader}>
                            <span style={{ flex: 0.5 }}>DC#</span>
                            <span style={{ flex: 0.8 }}>Type</span>
                            <span style={{ flex: 2 }}>Description</span>
                            <span style={{ flex: 0.5, textAlign: "center" }}>Qty</span>
                            <span style={{ flex: 0.5, textAlign: "center" }}>Unit</span>
                            <span style={{ flex: 1 }}>Unit Price</span>
                            <span style={{ flex: 1, textAlign: "right" }}>Total</span>
                          </div>
                          {allItems.map((item) => {
                            const price = parseFloat(itemPrices[item.id]) || 0;
                            return (
                              <div key={item.id} style={styles.itemRow}>
                                <span style={{ flex: 0.5, fontSize: "0.8rem", color: colors.textSecondary }}>{item.challanNumber}</span>
                                <span style={{ flex: 0.8, fontSize: "0.8rem", color: colors.teal, fontWeight: 600 }}>{item.itemTypeName || "—"}</span>
                                <span style={{ flex: 2, fontSize: "0.85rem" }}>{item.description}</span>
                                <span style={{ flex: 0.5, textAlign: "center", fontSize: "0.85rem" }}>{item.quantity}</span>
                                <span style={{ flex: 0.5, textAlign: "center", fontSize: "0.85rem" }}>{item.unit}</span>
                                <div style={{ flex: 1 }}>
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    style={{ ...styles.input, padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                                    value={itemPrices[item.id] || ""}
                                    onChange={(e) => handlePriceChange(item.id, e.target.value)}
                                    placeholder="0.00"
                                  />
                                </div>
                                <span style={{ flex: 1, textAlign: "right", fontWeight: 600, fontSize: "0.85rem" }}>
                                  {(item.quantity * price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Totals */}
                        <div style={styles.totalsBox}>
                          <div style={styles.totalRow}><span>Subtotal:</span><span>Rs. {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          <div style={styles.totalRow}><span>GST ({gstRate}%):</span><span>Rs. {gstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          <div style={{ ...styles.totalRow, fontWeight: 700, fontSize: "1rem", borderTop: "2px solid #333", paddingTop: "0.5rem" }}>
                            <span>Grand Total:</span><span>Rs. {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: saving || !selectedClientId || selectedIds.length === 0 ? 0.6 : 1 }}
              disabled={saving || !selectedClientId || selectedIds.length === 0}
            >
              {saving ? "Creating..." : "Create Invoice"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", padding: "0.6rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", cursor: "pointer" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  challanGrid: { display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: 200, overflowY: "auto" },
  challanCard: { display: "flex", alignItems: "center", padding: "0.5rem 0.75rem", borderRadius: 8, border: "2px solid", cursor: "pointer", transition: "all 0.2s", fontSize: "0.88rem" },
  selectAllBtn: { padding: "0.25rem 0.6rem", borderRadius: 6, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", fontSize: "0.75rem", fontWeight: 600, color: colors.blue, cursor: "pointer" },
  itemsTable: { display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "1rem" },
  itemsHeader: { display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.4rem 0.5rem", backgroundColor: "#f0f4f8", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase" },
  itemRow: { display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.4rem 0.5rem", borderRadius: 6, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fafbfc" },
  totalsBox: { display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-end", padding: "1rem", backgroundColor: "#f8f9fb", borderRadius: 8, border: `1px solid ${colors.cardBorder}` },
  totalRow: { display: "flex", gap: "2rem", justifyContent: "flex-end", fontSize: "0.9rem", minWidth: 280 },
};
