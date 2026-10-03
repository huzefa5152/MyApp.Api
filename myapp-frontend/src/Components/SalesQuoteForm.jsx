import { useState, useRef, useEffect, useMemo } from "react";
import SearchableClientSelect from "./SearchableClientSelect";
import ItemTypeForm from "./ItemTypeForm";
import LineItemsEditor from "./LineItemsEditor";
import { MdPersonAdd } from "react-icons/md";
import ClientForm from "./ClientForm";
import PermissionLackedHint from "./PermissionLackedHint";
import { usePermissions } from "../contexts/PermissionsContext";
import { getAllUnits } from "../api/unitsApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getClientsByCompany } from "../api/clientApi";
import { getQuoteItemRate, uploadQuoteLineImage } from "../api/salesQuoteApi";
import AttachmentManager from "./AttachmentManager";
import { formStyles, modalSizes } from "../theme";
import useScrollToError from "../hooks/useScrollToError";
import DocumentNotesEditor from "./DocumentNotesEditor";
import BillNumberField, { billNumberPayload } from "./BillNumberField";

import { todayYmd } from "../utils/dateInput";
import { Button, Field } from "../ui/Kit";

const blankItem = () => ({ id: 0, _imageKey: crypto.randomUUID(), imagePath: null, itemTypeId: null, description: "", quantity: 1, unit: "", unitPrice: 0, rateHint: "" });

// Create + edit a Sales Quote. Pass `quote` to edit; omit to create.
export default function SalesQuoteForm({ onClose, onSaved, companyId, quote }) {
  const { has } = usePermissions();
  const canCreateItemType = has("itemtypes.manage.create");
  const canCreateClient = has("clients.manage.create");
  const [showAddClient, setShowAddClient] = useState(false);
  const isEdit = !!quote;
  const [client, setClient] = useState(quote ? { id: quote.clientId, label: quote.clientName } : null);
  const [date, setDate] = useState(quote?.date ? quote.date.slice(0, 10) : todayYmd());
  // "Valid for N days" drives expiry: ValidUntil = issue date + N days. Blank =
  // no expiry (quote stays Active until accepted). On edit, derive the day count
  // back from the stored dates.
  const [validForDays, setValidForDays] = useState(() => {
    if (quote?.validUntil && quote?.date) {
      const d = Math.round((new Date(quote.validUntil) - new Date(quote.date)) / 86400000);
      return d > 0 ? String(d) : "";
    }
    return "";
  });
  const [enquiryRef, setEnquiryRef] = useState(quote?.customerEnquiryRef || "");
  const [enquiryDate, setEnquiryDate] = useState(quote?.enquiryDate ? quote.enquiryDate.slice(0, 10) : "");
  const [gstRate, setGstRate] = useState(quote?.gstRate ?? 18);
  const [notes, setNotes] = useState(quote?.notes || "");
  const [contactPerson, setContactPerson] = useState(quote?.contactPerson || "");
  const [items, setItems] = useState(
    quote?.items?.length
      ? quote.items.map((i) => ({ id: i.id, _imageKey: crypto.randomUUID(), imagePath: i.imagePath || null, itemTypeId: i.itemTypeId, description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, rateHint: "" }))
      : [blankItem()]
  );
  const [units, setUnits] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [clients, setClients] = useState([]);
  const [showAddItemType, setShowAddItemType] = useState(false);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
  const [saving, setSaving] = useState(false);
  const [numberMode, setNumberMode] = useState("auto");
  const [customNumber, setCustomNumber] = useState(quote ? String(quote.quoteNumber) : "");
  const [numberValid, setNumberValid] = useState(true);
  const [imageUploads, setImageUploads] = useState(0);
  const attachmentRef = useRef(null);

  useEffect(() => { getAllUnits(companyId).then(({ data }) => setUnits(data)).catch(() => setUnits([])); }, [companyId]);
  useEffect(() => { getItemTypes(companyId).then(({ data }) => setItemTypes(data || [])).catch(() => setItemTypes([])); }, [companyId]);
  useEffect(() => { getClientsByCompany(companyId).then(({ data }) => setClients(data || [])).catch(() => setClients([])); }, [companyId]);
  // A quote is a pre-sale document (never sent to FBR), so — like Bill mode —
  // it only offers item types WITHOUT an HS code (HS-coded types are the
  // FBR-classification set used on the Invoices tab).
  const nonHsItemTypes = useMemo(
    () => itemTypes.filter((it) => !(it.hsCode && String(it.hsCode).trim())),
    [itemTypes]
  );

  // Last-billed-rate lookup for the shared editor's price auto-fill. Returns
  // { lastUnitPrice, hint } or null. The editor only fills when the row's price
  // is still 0, so a typed price is never clobbered.
  const getRate = async (description) => {
    if (!companyId || !description?.trim()) return null;
    const { data } = await getQuoteItemRate(companyId, { description });
    if (data?.lastUnitPrice == null) return null;
    return {
      lastUnitPrice: data.lastUnitPrice,
      hint: `Last billed: Rs ${Number(data.lastUnitPrice).toLocaleString()}${data.lastInvoiceNumber ? ` (Bill #${data.lastInvoiceNumber})` : ""}`,
    };
  };

  const lineTotal = (it) => Math.round((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) * 100) / 100;
  const subtotal = items.reduce((s, it) => s + lineTotal(it), 0);
  const gstAmount = Math.round(subtotal * (Number(gstRate) || 0)) / 100;
  const grandTotal = subtotal + gstAmount;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || imageUploads > 0 || !numberValid) return;
    setError("");
    const valid = items.filter((i) => i.description.trim());
    if (!client) { setError("Please select a client."); return; }
    if (valid.length === 0) { setError("Add at least one item."); return; }

    setSaving(true);
    try {
      const saved = await onSaved({
        clientId: client.id,
        customNumber: quote ? billNumberPayload("custom", customNumber) : billNumberPayload(numberMode, customNumber),
        date: date ? new Date(date).toISOString() : null,
        validUntil: validForDays && date ? new Date(new Date(date).getTime() + Number(validForDays) * 86400000).toISOString() : null,
        customerEnquiryRef: enquiryRef.trim() || null,
        enquiryDate: enquiryDate ? new Date(enquiryDate).toISOString() : null,
        gstRate: Number(gstRate) || 0,
        notes: notes.trim() || null,
        contactPerson: contactPerson || null,
        items: valid.map((i) => ({
          id: i.id || 0,
          itemTypeId: i.itemTypeId || null,
          description: i.description.trim(),
          quantity: typeof i.quantity === "number" ? i.quantity : (parseFloat(i.quantity) || 1),
          unit: i.unit,
          unitPrice: Number(i.unitPrice) || 0,
          imagePath: i.imagePath || null,
        })),
      });
      // Upload any files staged before the record had an id (no-op in edit
      // mode / when nothing was staged). Best-effort — the quote is saved.
      const savedId = saved?.id ?? quote?.id;
      if (savedId) { try { await attachmentRef.current?.flush(savedId); } catch { /* attachments best-effort */ } }
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message;
      setError(msg || (!err.response ? "Could not reach the server." : "Could not save the quote."));
      setSaving(false);
    }
  };

  const disabled = !client || items.every((i) => !i.description.trim()) || saving || imageUploads > 0 || !numberValid;

  // Contact-person dropdown options come from the selected client's
  // semicolon-separated ContactPerson list (mirrors the challan Site dropdown).
  const contactOptions = useMemo(() => {
    const sel = clients.find((c) => String(c.id) === String(client?.id));
    return sel?.contactPerson ? sel.contactPerson.split(";").map((x) => x.trim()).filter(Boolean) : [];
  }, [clients, client]);

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit Quote #${quote.quoteNumber}` : "Create Sales Quote"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}
            {<div style={{ maxWidth: 360, marginBottom: "0.75rem" }}><BillNumberField companyId={companyId} documentType="quote" variant={quote ? "edit" : "create"} currentNumber={quote?.quoteNumber} editRecordId={quote?.id} mode={numberMode} onModeChange={setNumberMode} number={customNumber} onNumberChange={setCustomNumber} onValidityChange={setNumberValid} disabled={saving} /></div>}
            <div className="k-form-grid" style={s.grid}>
              <Field label="Client">
                <SearchableClientSelect
                  clients={clients}
                  value={client?.id || ""}
                  onChange={(id, item) => setClient(item)}
                  placeholder="— Select Client —"
                />
                {canCreateClient ? (
                  <Button
                    variant="secondary"
                    icon={MdPersonAdd}
                    style={s.inlineAddBtn}
                    onClick={() => setShowAddClient(true)}
                    title="Create a new client without leaving this form"
                  >
                    New Client
                  </Button>
                ) : (
                  <PermissionLackedHint perm="clients.manage.create" what="add a new client" />
                )}
              </Field>
              <Field label="Issue Date">
                <input type="date" className="k-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={<>Valid for (days) <span style={s.opt}>(optional)</span></>}>
                <input type="number" min={1} step={1} className="k-input" value={validForDays} onChange={(e) => setValidForDays(e.target.value)} placeholder="blank = no expiry" />
              </Field>
            </div>
            <div className="k-form-grid" style={s.grid}>
              <Field label={<>Customer Enquiry Ref <span style={s.opt}>(optional)</span></>}>
                <input type="text" className="k-input" value={enquiryRef} onChange={(e) => setEnquiryRef(e.target.value)} placeholder="Their RFQ / enquiry number" />
              </Field>
              <Field label={<>Enquiry Date <span style={s.opt}>(optional)</span></>}>
                <input type="date" className="k-input" value={enquiryDate} onChange={(e) => setEnquiryDate(e.target.value)} />
              </Field>
              <Field label="GST Rate (%)">
                <input type="number" min="0" max="100" step="0.01" className="k-input" style={{ textAlign: "right" }} value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
              </Field>
              <Field label={<>Contact Person <span style={s.opt}>(optional)</span></>}>
                {contactOptions.length > 0 ? (
                  <select className="k-select" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)}>
                    <option value="">(none)</option>
                    {contactPerson && !contactOptions.includes(contactPerson) && <option value={contactPerson}>{contactPerson}</option>}
                    {contactOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input type="text" className="k-input" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder={client ? "Optional (client has no saved contacts)" : "Pick a client first"} disabled={!client} />
                )}
              </Field>
            </div>

            <LineItemsEditor companyId={companyId}
              showImage
              onUploadImage={async file => (await uploadQuoteLineImage(companyId, file)).data.url}
              onImageBusyChange={delta => setImageUploads(count => Math.max(0, count + delta))}
              items={items}
              onItemsChange={setItems}
              makeBlankItem={blankItem}
              units={units}
              showItemType
              itemTypes={nonHsItemTypes}
              canCreateItemType={canCreateItemType}
              onAddItemType={() => setShowAddItemType(true)}
              showUnitPrice
              getRate={getRate}
              itemsLabel="Items"
              itemsHint="unit price is required per line and remembered for later billing"
            />

            <div style={s.totals}>
              <div style={s.tRow}><span>Subtotal</span><span>Rs {subtotal.toLocaleString()}</span></div>
              <div style={s.tRow}><span>GST @ {gstRate || 0}%</span><span>Rs {gstAmount.toLocaleString()}</span></div>
              <div style={{ ...s.tRow, ...s.grand }}><span>Grand Total</span><span>Rs {grandTotal.toLocaleString()}</span></div>
            </div>

            <DocumentNotesEditor value={notes} onChange={setNotes} label="Notes / Terms (optional)" />

            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager ref={attachmentRef} companyId={companyId} entityType="SalesQuote" entityId={quote?.id ?? null} mode="edit" />
            </div>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: disabled ? 0.6 : 1 }} disabled={disabled}>{saving ? "Saving..." : isEdit ? "Update Quote" : "Save Quote"}</button>
          </div>
        </form>
      </div>

      {/* Inline Add Client — the same ClientForm the Clients page uses, pinned
          to this company (companies=[] collapses the multi-company picker).
          On save the list reloads and the new client is selected, so the
          operator carries on without losing what they have typed here. */}
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

      {showAddItemType && (
        <ItemTypeForm
          companyId={companyId}
          onClose={() => setShowAddItemType(false)}
          onSaved={() => { setShowAddItemType(false); getItemTypes(companyId).then(({ data }) => setItemTypes(data || [])).catch(() => {}); }}
        />
      )}
    </div>
  );
}

const s = {
  grid: { gap: "var(--k-gap)", marginBottom: "1rem" },
  inlineAddBtn: { marginTop: "0.4rem", alignSelf: "flex-start", color: "var(--k-teal)", borderColor: "var(--k-teal)" },
  opt: { color: "var(--k-muted)", fontWeight: 400 },
  totals: { marginTop: "1rem", marginLeft: "auto", width: 280, maxWidth: "100%" },
  tRow: { display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "var(--k-font)", color: "var(--k-muted)" },
  grand: { borderTop: "2px solid var(--k-blue)", marginTop: 4, paddingTop: 8, fontWeight: 800, fontSize: "calc(var(--k-font) + 0.1rem)", color: "var(--k-blue)" },
};
