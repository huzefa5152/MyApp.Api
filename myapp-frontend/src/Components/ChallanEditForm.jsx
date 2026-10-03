import BillNumberField, { billNumberPayload } from "./BillNumberField";
import { useState, useRef, useEffect, useMemo } from "react";
import { MdInfo, MdContentCopy } from "react-icons/md";
import SearchableClientSelect from "./SearchableClientSelect";
import LineItemsEditor from "./LineItemsEditor";
import { Alert, Button, Field } from "../ui/Kit";
import { updateChallan } from "../api/challanApi";
import { getClientsByCompany } from "../api/clientApi";
import { saveItemFbrDefaults } from "../api/lookupApi";
import { getAllUnits } from "../api/unitsApi";
import AttachmentManager from "./AttachmentManager";
import { formStyles, modalSizes } from "../theme";
import useScrollToError from "../hooks/useScrollToError";
import DocumentNotesEditor from "./DocumentNotesEditor";
import ChallanPrivateCosts, { useChallanSuppliers } from "./ChallanPrivateCosts";
import { createPurchaseBillsFromChallan } from "../api/purchaseBillApi";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";


/**
 * ChallanEditForm — edit ANY editable challan (Pending / No PO / Setup Required /
 * Invoiced-non-submitted). Lets the operator change:
 *    • Client             (from the same company's client list)
 *    • Site               (dropdown from the picked client's sites)
 *    • Delivery date
 *    • PO number          (CLEAR it to transition Pending → No PO)
 *    • PO date
 *    • Items              (add / remove / reorder)
 *
 * Submits via a single `PUT /deliverychallans/{id}` call. The backend
 * re-evaluates status:
 *    empty PO  → No PO
 *    with PO   → Pending (if FBR-ready)
 *    FBR gaps  → Setup Required
 *    Invoiced  → stays Invoiced (status preserved — bill syncs separately)
 */
export default function ChallanEditForm({ challan, onClose, onSaved }) {
  // ── Duplicate mode ─────────────────────────────────────────────────────
  // When this challan is itself a duplicate (cloned from another via the
  // Duplicate action), only PO Number, PO Date, and Items may be edited.
  // Client / Site / Delivery Date / Indent are inherited from the source
  // and locked so the original physical-delivery context stays consistent
  // across all copies of this challan number.
  const [customNumber, setCustomNumber] = useState(String(challan.challanNumber));
  const [numberValid, setNumberValid] = useState(true);
  const isDuplicate = challan.duplicatedFromId != null;

  // ── Header fields ──
  const [clientId, setClientId] = useState(challan.clientId || "");
  const [site, setSite] = useState(challan.site || "");
  const [notes, setNotes] = useState(challan.notes || "");
  const [deliveryDate, setDeliveryDate] = useState(
    challan.deliveryDate ? challan.deliveryDate.substring(0, 10) : ""
  );
  const [poNumber, setPoNumber] = useState(challan.poNumber || "");
  const [poDate, setPoDate] = useState(challan.poDate ? challan.poDate.substring(0, 10) : "");
  const [indentNo, setIndentNo] = useState(challan.indentNo || "");

  // ── Line items ──
  // Item Type isn't captured on challans anymore — that classification
  // happens on the Invoices tab during FBR submission. We still preserve
  // any pre-existing itemTypeId on the row so legacy challans round-trip
  // unchanged through Save (the backend's diff helper sees no qty/desc/unit
  // change and won't touch them).
  const [items, setItems] = useState(
    challan.items.map((i) => ({
      id: i.id,
      itemTypeId: i.itemTypeId || null,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      supplierId: i.supplierId ?? null,
      actualUnitCost: i.actualUnitCost ?? null,
    }))
  );

  // ── Lookups ──
  const [clients, setClients] = useState([]);
  // Units list — gates each row's quantity input on the picked UOM.
  const [units, setUnits] = useState([]);
  const suppliers = useChallanSuppliers(challan.companyId);
  const confirm = useConfirm();
  const { has } = usePermissions();
  // Challan saved but the follow-up purchase bills failed — the form stays
  // open with a retry instead of re-saving the challan.
  const [savedAwaitingPurchase, setSavedAwaitingPurchase] = useState(false);

  // ── UI state ──
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);

  // Load lookups once
  useEffect(() => {
    if (challan.companyId) {
      getClientsByCompany(challan.companyId).then(({ data }) => setClients(data)).catch(() => {});
    }
    getAllUnits(challan.companyId).then(({ data }) => setUnits(data)).catch(() => setUnits([]));
  }, [challan.companyId]);

  // Derive the site options from the selected client's semicolon-separated list.
  // Null-safe: if the client has no sites the dropdown collapses to a free-text
  // input so operator can still type a one-off site.
  const selectedClient = useMemo(
    () => clients.find((c) => String(c.id) === String(clientId)),
    [clients, clientId]
  );
  const clientSites = useMemo(
    () =>
      selectedClient?.site
        ? selectedClient.site.split(";").map((s) => s.trim()).filter(Boolean)
        : [],
    [selectedClient]
  );

  // If user switches client, clear any site that doesn't belong to the new
  // client's list. Keeps the free-text case intact (empty list → always clear).
  useEffect(() => {
    if (clientSites.length > 0 && site && !clientSites.includes(site)) {
      setSite("");
    }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Item handlers ──
  const handleItemPick = (index, picked) => {
    const next = [...items];
    if (picked.name) next[index].description = picked.name;
    if (picked.uom) next[index].unit = picked.uom;
    setItems(next);

    if (picked.name && (picked.hsCode || picked.saleType || picked.fbrUOMId)) {
      saveItemFbrDefaults({
        companyId: challan.companyId,
        name: picked.name,
        hsCode: picked.hsCode || null,
        saleType: picked.saleType || null,
        fbrUOMId: picked.fbrUOMId || null,
        uom: picked.uom || null,
      }).catch(() => {});
    }
  };

  // ── Preview the status the backend WILL set, so the operator sees the
  //    consequence of clearing the PO before they hit Save ──
  const previewStatus = useMemo(() => {
    if (challan.status === "Invoiced") return "Invoiced (unchanged — bill already exists)";
    if (challan.status === "Cancelled") return "Cancelled";
    const hasPo = poNumber.trim().length > 0;
    // Imported challans keep the "Imported" label when they have a PO; native
    // ones use "Pending". Setup Required is possible but the preview just
    // shows the ready state optimistically; the backend corrects if not FBR-ready.
    const readyLabel = challan.isImported ? "Imported" : "Pending";
    if (challan.status === "Setup Required") return hasPo ? `${readyLabel} (if FBR-ready)` : "No PO";
    return hasPo ? readyLabel : "No PO";
  }, [poNumber, challan.status, challan.isImported]);

  const statusWillChange = previewStatus !== challan.status;

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savedAwaitingPurchase || saving || !numberValid) return;
    setError("");

    if (!clientId) { setError("Client is required."); return; }
    if (!deliveryDate) { setError("Delivery date is required."); return; }
    const validItems = items.filter((i) => i.description.trim());
    if (validItems.length === 0) { setError("At least one item is required."); return; }
    if (validItems.some((i) => i.quantity <= 0)) { setError("All items must have a quantity > 0."); return; }

    setSaving(true);
    try {
      await updateChallan(challan.id, {
        companyId: challan.companyId,
        customNumber: isDuplicate ? null : billNumberPayload("custom", customNumber),
        clientId: parseInt(clientId),
        site: site || null,
        notes: notes.trim() || null,
        // Empty string = operator wants to clear PO → "No PO" status.
        // Backend re-evaluates status based on FBR readiness.
        poNumber: poNumber.trim(),
        poDate: poNumber.trim() && poDate ? new Date(poDate).toISOString() : null,
        indentNo: indentNo.trim() || null,
        deliveryDate: new Date(deliveryDate).toISOString(),
        items: validItems.map((i) => ({
          id: i.id || 0,
          // Preserved from the row for legacy challans whose lines were
          // typed pre-split. New rows have itemTypeId=null. Either way the
          // backend stores it as-is; classification happens on Invoices.
          itemTypeId: i.itemTypeId ? parseInt(i.itemTypeId) : null,
          description: i.description.trim(),
          // parseFloat preserves decimals (12.5, 0.0004) — server-side
          // validation rejects fractions for integer-only UOMs.
          quantity: parseFloat(i.quantity) || 1,
          unit: (i.unit || "").trim(),
          supplierId: i.supplierId || null,
          actualUnitCost: i.actualUnitCost === "" ? null : i.actualUnitCost ?? null,
          itemTypeName: "",
        })),
      });
      // Every line carries a supplier + actual cost → offer the purchase
      // bills (one per supplier). Never automatic: the operator confirms.
      if (!challan.hasAutoPurchaseBills && has("purchasebills.manage.create") && validItems.every((line) =>
        line.supplierId && line.actualUnitCost !== null && line.actualUnitCost !== undefined && line.actualUnitCost !== "")) {
        const count = new Set(validItems.map((line) => Number(line.supplierId))).size;
        const yes = await confirm({ title: "Create purchase bills?", message: `Create ${count} unpaid purchase bill${count === 1 ? "" : "s"} from this challan, one per supplier?`, variant: "info", confirmText: "Create purchase bills", cancelText: "Not now" });
        if (yes) {
          try { await createPurchaseBillsFromChallan(challan.id); }
          catch (err) {
            setSavedAwaitingPurchase(true);
            setError(`Challan saved. ${err.response?.data?.error || "Could not create purchase bills."}`);
            return;
          }
        }
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update challan.");
    } finally {
      setSaving(false);
    }
  };

  // Backdrop click is a no-op — protects in-progress edits from a stray
  // click. Dismiss via the X in the header or the Cancel button.
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            {isDuplicate ? "Edit Duplicate Challan" : "Edit Challan"} #{challan.challanNumber}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

            <div style={{ maxWidth: 360, marginBottom: "0.75rem" }}><BillNumberField companyId={challan.companyId} documentType="challan" variant="edit" currentNumber={challan.challanNumber} editRecordId={challan.id} number={customNumber} onNumberChange={setCustomNumber} onValidityChange={setNumberValid} lockedReason={isDuplicate ? "Duplicate challan numbers are inherited and cannot be changed." : undefined} disabled={saving} /></div>

            {/* Duplicate-mode banner — explains why so many fields are
                read-only and what the operator IS allowed to change. */}
            {isDuplicate && (
              <div style={styles.duplicateBanner}>
                <MdContentCopy size={16} />
                <span>
                  This is a <strong>duplicate</strong>
                  {challan.duplicatedFromChallanNumber
                    ? <> of <strong>Challan #{challan.duplicatedFromChallanNumber}</strong></>
                    : null}
                  . Only <strong>PO Number</strong>, <strong>PO Date</strong>, and <strong>Items</strong> can be changed —
                  Client, Site, Delivery Date, and Indent No are inherited from the original.
                </span>
              </div>
            )}

            {/* Status preview banner — shows what the Save click will do to
                the challan's status. Especially useful when clearing the PO. */}
            <Alert tone={statusWillChange ? "warn" : "info"} icon={MdInfo}>
              Status: <strong>{challan.status}</strong>
              {statusWillChange && <> → will become <strong>{previewStatus}</strong> after save</>}
              {!statusWillChange && <> (will stay <strong>{previewStatus}</strong>)</>}
            </Alert>

            {/* ── Header row: Client / Site / Delivery Date ── */}
            <div className="k-form-grid" style={styles.grid}>
              <Field label={<>Client *{isDuplicate && <span style={styles.lockedHint}> (locked — inherited)</span>}</>}>
                <SearchableClientSelect
                  clients={clients}
                  value={clientId}
                  onChange={(id) => setClientId(id ? String(id) : "")}
                  placeholder="— Select Client —"
                  disabled={isDuplicate}
                />
              </Field>
              <Field label={<>Site / Department{isDuplicate && <span style={styles.lockedHint}> (locked)</span>}</>}>
                {clientSites.length > 0 ? (
                  <select
                    className="k-select"
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                    disabled={isDuplicate}
                  >
                    <option value="">(none)</option>
                    {clientSites.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="k-input"
                    placeholder="Optional"
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                    disabled={isDuplicate}
                  />
                )}
              </Field>
              <Field label={<>Delivery Date *{isDuplicate && <span style={styles.lockedHint}> (locked)</span>}</>}>
                <input
                  type="date"
                  className="k-input"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  required
                  disabled={isDuplicate}
                />
              </Field>
            </div>

            {/* ── PO row: Number (clearable) + Date + Indent No ──
                All three on one line so the operator sees the full PO/indent
                context at a glance. Indent No is optional and independent
                of PO — companies that don't use indents leave it blank. */}
            <div className="k-form-grid" style={styles.grid}>
              <Field label={<>PO Number<span style={styles.labelHint}> (clear to move to "No PO")</span></>}>
                <input
                  type="text"
                  className="k-input"
                  placeholder="Leave blank for No PO"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                />
              </Field>
              <Field label="PO Date">
                <input
                  type="date"
                  className="k-input"
                  value={poDate}
                  onChange={(e) => setPoDate(e.target.value)}
                  disabled={!poNumber.trim()}
                  title={!poNumber.trim() ? "Set a PO Number first" : undefined}
                />
              </Field>
              <Field label={<>Indent No{isDuplicate
                ? <span style={styles.lockedHint}> (locked)</span>
                : <span style={styles.labelHint}> (optional)</span>}</>}>
                <input
                  type="text"
                  className="k-input"
                  disabled={isDuplicate}
                  placeholder="Leave blank if not used"
                  value={indentNo}
                  onChange={(e) => setIndentNo(e.target.value)}
                />
              </Field>
            </div>

            {/* ── Items ── */}
            <LineItemsEditor companyId={challan.companyId}
              items={items}
              onItemsChange={setItems}
              makeBlankItem={() => ({ id: 0, itemTypeId: null, description: "", quantity: 1, unit: "" })}
              units={units}
              itemsLabel="Items *"
            />
            <ChallanPrivateCosts items={items} onItemsChange={setItems} suppliers={suppliers} />
            {savedAwaitingPurchase && <div style={{ padding: 12, marginTop: 10, background: "#fff3e0", borderRadius: 8 }}>
              Your challan was saved. Purchase bills still need to be created.
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                <Button variant="primary" disabled={saving} onClick={async () => { setSaving(true); try { await createPurchaseBillsFromChallan(challan.id); onSaved(); } catch (err) { setError(err.response?.data?.error || "Could not create purchase bills."); } finally { setSaving(false); } }}>Retry purchase bills</Button>
                <Button variant="secondary" onClick={onSaved}>Close without purchase bills</Button>
              </div>
            </div>}

            <DocumentNotesEditor value={notes} onChange={setNotes} />

            {/* Attachments — INSIDE the scrollable body (formStyles.body) so it
                scrolls with the rest and never pushes the footer off-screen.
                The challan already exists here (edit), so uploads attach
                immediately to its id; no staging/flush needed. */}
            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager companyId={challan.companyId} entityType="DeliveryChallan" entityId={challan.id} mode="edit" />
            </div>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }}
              disabled={saving || !numberValid}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  grid: { gap: "0.75rem", marginBottom: "0.75rem" },
  duplicateBanner: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.65rem 0.85rem",
    borderRadius: "var(--k-radius)",
    border: "1px solid #b39ddb",
    backgroundColor: "#ede7f6",
    color: "#4527a0",
    fontSize: "var(--k-font-sm)",
    marginBottom: "0.75rem",
    lineHeight: 1.45,
  },
  lockedHint: {
    fontWeight: 400,
    fontSize: "0.72rem",
    color: "#4527a0",
    marginLeft: 4,
  },
  labelHint: {
    fontWeight: 400,
    fontSize: "0.72rem",
    color: "var(--k-muted)",
    marginLeft: 4,
  },
};
