import { useState, useRef, useEffect } from "react";
import SmartItemAutocomplete from "./SmartItemAutocomplete";
import SearchableSelect from "./SearchableSelect";
import LineItemsEditor from "./LineItemsEditor";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { getAllUnits } from "../api/unitsApi";
import { getClientsByCompany } from "../api/clientApi";
import { getOpenSalesOrdersByCompany } from "../api/salesOrderApi";
import { MdPersonAdd } from "react-icons/md";
import ClientForm from "./ClientForm";
import PermissionLackedHint from "./PermissionLackedHint";
import { usePermissions } from "../contexts/PermissionsContext";
import AttachmentManager from "./AttachmentManager";
import { formStyles, modalSizes } from "../theme";
import useScrollToError from "../hooks/useScrollToError";
import DocumentNotesEditor from "./DocumentNotesEditor";
import ChallanPrivateCosts, { useChallanSuppliers } from "./ChallanPrivateCosts";
import { createPurchaseBillsFromChallan } from "../api/purchaseBillApi";
import { useConfirm } from "./ConfirmDialog";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  danger: "#dc3545",
  dangerLight: "#fff0f1",
  success: "#28a745",
};

export default function ChallanForm({ onClose, onSaved, companyId }) {
  const { has } = usePermissions();
  const canUseOrders = has("salesorders.list.view");
  const canCreateClient = has("clients.manage.create");
  const [showAddClient, setShowAddClient] = useState(false);
  const [client, setClient] = useState(null);
  const [site, setSite] = useState("");
  const [notes, setNotes] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [indentNo, setIndentNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  // Optional Sales Order this challan fulfils. When set, the header + lines
  // are autofilled from the order and the challan is created via the order's
  // fulfilment flow (linkage + auto-close).
  const [openOrders, setOpenOrders] = useState([]);
  const [salesOrderId, setSalesOrderId] = useState("");
  const [items, setItems] = useState([
    { description: "", quantity: 1, unit: "" },
  ]);
  // Units list with the AllowsDecimalQuantity flag — drives whether each
  // row's quantity input accepts decimals or only whole numbers. Loaded
  // once on mount; cheap (≤50 rows) and the operator can flip flags via
  // the Units admin page (changes only need a re-open of this form).
  const [units, setUnits] = useState([]);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);
  const suppliers = useChallanSuppliers(companyId);
  const confirm = useConfirm();
  // Set when the challan saved but its purchase bills failed — the form then
  // offers a retry instead of saving the challan a second time.
  const [savedChallanId, setSavedChallanId] = useState(null);
  const [purchaseError, setPurchaseError] = useState("");

  // Every line carries a supplier + actual cost → offer the purchase bills
  // (one per supplier). Returns false when the form must stay open.
  const offerPurchaseBills = async (saved, lines) => {
    if (!saved?.id || !has("purchasebills.manage.create") || !lines.length ||
      !lines.every((line) => line.supplierId && line.actualUnitCost !== null && line.actualUnitCost !== undefined && line.actualUnitCost !== "")) return true;
    const supplierCount = new Set(lines.map((line) => Number(line.supplierId))).size;
    const yes = await confirm({ title: "Create purchase bills?", message: `Every line has a supplier and actual cost. Create ${supplierCount} unpaid purchase bill${supplierCount === 1 ? "" : "s"} now, one per supplier?`, variant: "info", confirmText: "Create purchase bills", cancelText: "Not now" });
    if (!yes) return true;
    try { await createPurchaseBillsFromChallan(saved.id); return true; }
    catch (err) {
      setSavedChallanId(saved.id);
      setPurchaseError(err.response?.data?.error || "The challan was saved, but purchase bills could not be created.");
      setSaving(false);
      return false;
    }
  };

  useEffect(() => {
    getAllUnits(companyId).then(({ data }) => setUnits(data)).catch(() => setUnits([]));
  }, []);

  // Client list for the searchable picker (replaces the old fetch-inside-
  // SelectDropdown). The picked option is the full client row, so client.site
  // still drives the Site dropdown below.
  useEffect(() => {
    if (!companyId) { setClients([]); return; }
    getClientsByCompany(companyId).then(({ data }) => setClients(data || [])).catch(() => setClients([]));
  }, [companyId]);

  // Open sales orders (partial + undelivered) — powers the optional
  // "From Sales Order" picker. Only fetched when the user can see orders.
  useEffect(() => {
    if (!canUseOrders || !companyId) { setOpenOrders([]); return; }
    getOpenSalesOrdersByCompany(companyId).then(({ data }) => setOpenOrders(data || [])).catch(() => setOpenOrders([]));
  }, [companyId, canUseOrders]);

  // Picking a Sales Order autofills the challan from it: client, PO, site, and
  // the order's still-undelivered lines (remaining qty, each linked back to its
  // ordered line). Clearing it resets to a blank, ad-hoc challan.
  const selectOrder = (id) => {
    setSalesOrderId(id || "");
    if (!id) {
      setClient(null); setSite(""); setPoNumber(""); setPoDate("");
      setItems([{ description: "", quantity: 1, unit: "" }]);
      return;
    }
    const o = openOrders.find((x) => String(x.id) === String(id));
    if (!o) return;
    setClient({ id: o.clientId, label: o.clientName, site: null });
    setSite(o.site || "");
    setPoNumber(o.customerPoNumber || "");
    setPoDate(o.customerPoDate ? o.customerPoDate.slice(0, 10) : "");
    const lines = (o.items || [])
      .filter((i) => (i.remainingQuantity ?? 0) > 0)
      .map((i) => ({ salesOrderItemId: i.id, description: i.description, quantity: i.remainingQuantity, unit: i.unit }));
    setItems(lines.length ? lines : [{ description: "", quantity: 1, unit: "" }]);
  };

  // Fires when user picks from the SmartItemAutocomplete dropdown
  // (either a SAVED local item or an FBR catalog entry).
  // Fills description + unit in one shot, and also remembers the HS code /
  // sale type per description so the bill can auto-fill them later.
  const handleItemPick = (index, picked) => {
    const newItems = [...items];
    if (picked.name) newItems[index].description = picked.name;
    if (picked.uom) newItems[index].unit = picked.uom;
    setItems(newItems);

    // Remember FBR defaults for this description so future bills auto-fill
    if (picked.name && (picked.hsCode || picked.saleType || picked.fbrUOMId)) {
      saveItemFbrDefaults({
        companyId: companyId,
        name: picked.name,
        hsCode: picked.hsCode || null,
        saleType: picked.saleType || null,
        fbrUOMId: picked.fbrUOMId || null,
        uom: picked.uom || null,
      }).catch(() => {});
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || savedChallanId) return;
    setError("");

    const validItems = items.filter((item) => item.description.trim());
    if (validItems.length === 0) {
      setError("Please add at least one item with a description.");
      return;
    }
    if (!client) {
      setError("Please select a client.");
      return;
    }

    setSaving(true);
    try {
      const payloadItems = validItems.map((i) => ({
          description: i.description,
          unit: i.unit,
          // Ties the delivered line back to its ordered line (SO fulfilment).
          salesOrderItemId: i.salesOrderItemId ?? null,
          // Item Type isn't captured on the challan side anymore — that
          // happens on the Invoices tab during FBR classification. Send
          // null so the backend stores DeliveryItem.ItemTypeId=null.
          itemTypeId: null,
          // parseFloat preserves decimals (12.5 KG, 0.0004 Carat). The
          // QuantityInput already coerces correctly per UOM, this is just
          // defensive in case a string slips through.
          quantity: typeof i.quantity === "number" ? i.quantity : (parseFloat(i.quantity) || 1),
          // Private procurement — never printed.
          supplierId: i.supplierId || null,
          actualUnitCost: i.actualUnitCost === "" ? null : i.actualUnitCost ?? null,
        }));
      const saved = await onSaved({
        // When set, the parent creates the challan through the sales-order
        // fulfilment flow (which links each line + auto-closes the order).
        salesOrderId: salesOrderId ? parseInt(salesOrderId) : null,
        clientId: client.id,
        clientName: client.label,
        site: site || null,
        notes: notes.trim() || null,
        poNumber: poNumber.trim(),
        poDate: poDate ? new Date(poDate).toISOString() : null,
        indentNo: indentNo.trim() || null,
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
        items: payloadItems,
      });
      // Upload any files staged before the challan had an id. Best-effort —
      // the challan is already saved.
      const savedId = saved?.id;
      if (savedId) { try { await attachmentRef.current?.flush(savedId); } catch { /* attachments best-effort */ } }
      if (await offerPurchaseBills(saved, payloadItems)) onClose();
    } catch (err) {
      // Server-supplied user-friendly message wins; otherwise show a
      // friendly stable string. Bare err.message from axios is
      // "Network Error" / "Request failed with status code 500" —
      // not user-facing, so we don't surface it.
      const serverMsg = err.response?.data?.error || err.response?.data?.message;
      if (serverMsg) setError(serverMsg);
      else if (!err.response) setError("Could not reach the server. Please check your connection and try again.");
      else setError("Could not save the challan. Please try again or contact an administrator.");
      setSaving(false);
    }
  };

  const isDisabled = items.some((i) => !i.description.trim()) || !client || saving || !!savedChallanId;

  // Backdrop click is intentionally a no-op — the user can lose minutes
  // of typed data with one stray click otherwise. Use the X in the
  // header or the Cancel button to dismiss.
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Create Delivery Challan</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={styles.errorAlert}>{error}</div>}

            {/* Optional: fulfil a Sales Order. Picking one autofills the client,
                PO, site and the order's undelivered lines below, and links the
                challan to the order (fulfilment tracking + auto-close). */}
            {canUseOrders && (
              <div style={styles.row}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <label style={styles.label}>
                    From Sales Order <span style={{ color: colors.textSecondary, fontWeight: 400 }}>(optional — autofills the challan)</span>
                  </label>
                  <SearchableSelect
                    items={openOrders.map((o) => ({ id: o.id, label: `SO #${o.salesOrderNumber} — ${o.clientName}${o.customerPoNumber ? ` · PO ${o.customerPoNumber}` : ""}` }))}
                    value={salesOrderId}
                    onChange={(id) => selectOrder(id ? String(id) : "")}
                    labelKey="label"
                    placeholder={openOrders.length ? "— not from an order —" : "No open sales orders for this company"}
                  />
                </div>
              </div>
            )}

            {/* Header row: Client / Site / Delivery Date — same layout as
                Edit Challan so operators see identical shape on both flows.
                Site is dropdown when the picked client has presets, free-text
                otherwise so one-offs still work. */}
            <div style={styles.row}>
              <div style={{ flex: 2, minWidth: 220 }}>
                <label style={styles.label}>Client</label>
                <SearchableSelect
                  items={clients}
                  value={client?.id || ""}
                  onChange={(id, item) => { setClient(item); setSite(""); }}
                  placeholder="— Select Client —"
                />
                {canCreateClient ? (
                  <button
                    type="button"
                    style={{ ...styles.inlineAddBtn, marginTop: "0.4rem", minHeight: 44 }}
                    onClick={() => setShowAddClient(true)}
                    title="Create a new client without leaving this form"
                  >
                    <MdPersonAdd size={14} /> New Client
                  </button>
                ) : (
                  <PermissionLackedHint perm="clients.manage.create" what="add a new client" />
                )}
              </div>
              <div style={{ flex: 1.5, minWidth: 180 }}>
                <label style={styles.label}>Site / Department</label>
                {(() => {
                  const clientSites = client?.site
                    ? client.site.split(";").map((s) => s.trim()).filter(Boolean)
                    : [];
                  return clientSites.length > 0 ? (
                    <select
                      style={styles.input}
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                    >
                      <option value="">(none)</option>
                      {clientSites.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      style={styles.input}
                      placeholder={client ? "Optional" : "Pick a client first"}
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                      disabled={!client}
                    />
                  );
                })()}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label style={styles.label}>Delivery Date</label>
                <input type="date" style={styles.input} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </div>
            </div>

            {/* PO row: Number + Date + Indent No — flex weights match
                ChallanEditForm's PO row so Add and Edit look identical. */}
            <div style={styles.row}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={styles.label}>PO Number{salesOrderId && <span style={{ color: colors.textSecondary, fontWeight: 400 }}> (from the order)</span>}</label>
                <input type="text" style={{ ...styles.input, ...(salesOrderId ? { backgroundColor: "#eef1f5", cursor: "not-allowed" } : {}) }} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Enter PO number" disabled={!!salesOrderId} />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={styles.label}>PO Date</label>
                <input type="date" style={{ ...styles.input, ...(salesOrderId ? { backgroundColor: "#eef1f5", cursor: "not-allowed" } : {}) }} value={poDate} onChange={(e) => setPoDate(e.target.value)} disabled={!!salesOrderId} />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={styles.label}>
                  Indent No <span style={{ color: "#5f6d7e", fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  style={styles.input}
                  value={indentNo}
                  onChange={(e) => setIndentNo(e.target.value)}
                  placeholder="Enter indent number"
                />
              </div>
            </div>

            <div style={{ marginTop: "0.25rem" }}>
              <LineItemsEditor companyId={companyId}
                items={items}
                onItemsChange={setItems}
                makeBlankItem={() => ({ description: "", quantity: 1, unit: "" })}
                units={units}
                itemsLabel="Items"
              />
              <ChallanPrivateCosts items={items} onItemsChange={setItems} suppliers={suppliers} />
            </div>

            {savedChallanId && <div role="alert" style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#fff3e0", color: "#92400e" }}>
              Challan saved. {purchaseError}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                <button type="button" style={{ minHeight: 44 }} disabled={saving} onClick={async () => { setSaving(true); try { await createPurchaseBillsFromChallan(savedChallanId); onClose(); } catch (err) { setPurchaseError(err.response?.data?.error || "Could not create purchase bills."); } finally { setSaving(false); } }}>Retry purchase bills</button>
                <button type="button" style={{ minHeight: 44 }} onClick={onClose}>Close without purchase bills</button>
              </div>
            </div>}

            <DocumentNotesEditor value={notes} onChange={setNotes} />

            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager ref={attachmentRef} companyId={companyId} entityType="DeliveryChallan" entityId={null} mode="edit" />
            </div>
          </div>

          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: isDisabled ? 0.6 : 1 }} disabled={isDisabled}>{saving ? "Saving..." : "Save Challan"}</button>
          </div>
        </form>
      </div>

      {/* Inline Add Client — the same ClientForm the Clients page uses,
          pinned to this company (companies=[] collapses the multi-company
          picker). On save the list reloads and the new client is selected,
          so the operator carries on without losing what they have typed. */}
      {showAddClient && (
        <ClientForm
          client={null}
          companyId={companyId}
          companies={[]}
          onClose={() => setShowAddClient(false)}
          onSaved={async (created) => {
            setShowAddClient(false);
            const { data } = await getClientsByCompany(companyId).catch(() => ({ data: [] }));
            setClients(data || []);
            if (created?.id) setClient((data || []).find((c) => String(c.id) === String(created.id))
              || { id: created.id, label: created.name });
          }}
        />
      )}
    </div>
  );
}

const styles = {
  inlineAddBtn: { minHeight: 44, display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.4rem 0.7rem", borderRadius: 6, border: `1px solid ${colors.teal}`, backgroundColor: "#fff", color: colors.teal, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  row: { display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600, fontSize: "0.85rem", color: colors.textSecondary },
  input: { width: "100%", padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.9rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none", transition: "border-color 0.25s", boxSizing: "border-box" },
  errorAlert: { backgroundColor: colors.dangerLight, color: colors.danger, padding: "0.65rem 1rem", borderRadius: 8, marginBottom: "1rem", fontWeight: 500, border: `1px solid ${colors.danger}30`, fontSize: "0.85rem" },
  itemsContainer: { display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: 220, overflowY: "auto", overflowX: "hidden", paddingRight: 4 },
  itemRow: { display: "flex", gap: "0.4rem", alignItems: "flex-start", padding: "0.5rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`, backgroundColor: "#fafbfc", minWidth: 0 },
  itemIndex: { width: 22, paddingTop: "0.55rem", fontWeight: 700, fontSize: "0.82rem", color: colors.textSecondary, textAlign: "center", flexShrink: 0 },
  removeBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "0.4rem", marginTop: "0.3rem", borderRadius: 8, border: `1px solid ${colors.danger}25`, backgroundColor: colors.dangerLight, color: colors.danger, cursor: "pointer", transition: "background-color 0.2s", flexShrink: 0 },
  addItemBtn: { minHeight: 44, display: "inline-flex", alignItems: "center", gap: "0.3rem", marginTop: "0.6rem", padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", backgroundColor: `${colors.teal}14`, color: colors.teal, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", transition: "background-color 0.2s" },
};
