import { useState, useEffect, useMemo } from "react";
import { MdSearch } from "react-icons/md";
import { getPendingChallansByCompany } from "../api/challanApi";
import { createInvoice, getLastRatesForChallan } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getFbrApplicableScenarios } from "../api/fbrApi";
import { getItemByName, saveItemFbrDefaults } from "../api/lookupApi";
import { formStyles, modalSizes } from "../theme";
import SmartItemAutocomplete from "./SmartItemAutocomplete";
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
};

export default function InvoiceForm({ companyId, company, onClose, onSaved, prefillChallanId }) {
  const [clients, setClients] = useState([]);
  const [allChallans, setAllChallans] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [itemPrices, setItemPrices] = useState({});
  const [itemDescriptions, setItemDescriptions] = useState({});
  const [commonPoDate, setCommonPoDate] = useState("");
  const [dcSearch, setDcSearch] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── FBR optional fields (per item + invoice-level) ──
  const [documentType, setDocumentType] = useState(4); // 4=Sale Invoice
  const [paymentMode, setPaymentMode] = useState("");
  const [itemHsCodes, setItemHsCodes] = useState({});
  const [itemSaleTypes, setItemSaleTypes] = useState({});
  // Overridable UOM per item (starts from challan's unit but can change when
  // user picks an FBR catalog item that has its own UOM)
  const [itemUoms, setItemUoms] = useState({});
  const [itemFbrUomIds, setItemFbrUomIds] = useState({});
  // ── Per-item ItemType (FBR catalog entry) ──
  // When the operator picks an ItemType, HS Code / UOM / Sale Type auto-fill
  // from the catalog entry — same UX as the Edit Bill form. ItemTypeId flows
  // to the backend so the bill line is permanently linked to the catalog.
  const [itemTypes, setItemTypes] = useState([]);
  const [itemTypeIds, setItemTypeIds] = useState({});

  // ── Scenario lock ─────────────────────────────────────────────
  // FBR allows only one sale type per invoice. Operator picks the
  // scenario at bill-creation time → item-type dropdown filters to
  // catalog rows with a compatible sale type → bill is structurally
  // submittable (no mixed-bucket 0052 errors). Empty selection ("auto")
  // means "infer from items" — which is allowed but only works when
  // every item happens to share the same sale type.
  const [scenarios, setScenarios] = useState([]);
  const [scenarioCode, setScenarioCode] = useState("");

  // Bulk-apply mode — drives the "Apply same Item Type to: [All / Only empty]"
  // selector above the items grid. Saves 20+ catalog picks when every line on
  // the bill is the same FBR category.
  const [bulkApplyMode, setBulkApplyMode] = useState("all");

  // Apply one catalog ItemType to many lines in one shot. mode = "all"
  // overwrites every row; "empty" only fills rows without an Item Type.
  // Re-uses the per-row state setters so the same auto-fill logic
  // (description default, HSCode/UOM/SaleType inheritance) runs uniformly.
  const applyItemTypeToAll = (newId, picked, mode = "all") => {
    if (!newId || !picked) return;
    setItemTypeIds((prev) => {
      const next = { ...prev };
      const newHs = {}, newSt = {}, newUom = {}, newFbrUom = {}, newDesc = {};
      for (const item of allItems) {
        const id = item.id;
        if (mode === "empty" && next[id]) continue;
        next[id] = parseInt(newId);
        if (picked.hsCode) newHs[id] = picked.hsCode;
        if (picked.saleType) newSt[id] = picked.saleType;
        if (picked.uom) newUom[id] = picked.uom;
        if (picked.fbrUOMId) newFbrUom[id] = picked.fbrUOMId;
        // Don't overwrite a description the operator already typed.
        if (picked.name && !itemDescriptions[id]?.trim() && !item.description?.trim())
          newDesc[id] = picked.name;
      }
      // Apply the keyed updates outside this updater so each set runs.
      setTimeout(() => {
        if (Object.keys(newHs).length) setItemHsCodes(p => ({ ...p, ...newHs }));
        if (Object.keys(newSt).length) setItemSaleTypes(p => ({ ...p, ...newSt }));
        if (Object.keys(newUom).length) setItemUoms(p => ({ ...p, ...newUom }));
        if (Object.keys(newFbrUom).length) setItemFbrUomIds(p => ({ ...p, ...newFbrUom }));
        if (Object.keys(newDesc).length) setItemDescriptions(p => ({ ...p, ...newDesc }));
      }, 0);
      return next;
    });
  };

  // Last-billed rate per delivery item, keyed by deliveryItemId.
  // Populated whenever a challan gets ticked (whether via the Generate-Bill
  // shortcut on the Challans page OR by the operator selecting a challan in
  // the Bills > New Bill flow). Operator can still override any row — the
  // per-row hint shows the source bill so they can spot stale rates (e.g.
  // material price has gone up since last bill).
  const [lastRates, setLastRates] = useState({});
  const [autoFilledFromHistory, setAutoFilledFromHistory] = useState(false);
  // Memo of challan ids we've already queried last-rates for, so toggling
  // the same challan on/off doesn't re-hit the API every time.
  const [fetchedRateChallanIds, setFetchedRateChallanIds] = useState(() => new Set());

  useEffect(() => {
    const load = async () => {
      try {
        const [challanRes, clientRes, typesRes, scenarioRes] = await Promise.all([
          getPendingChallansByCompany(companyId),
          getClientsByCompany(companyId),
          getItemTypes().catch(() => ({ data: [] })),
          getFbrApplicableScenarios(companyId).catch(() => ({ data: { scenarios: [] } })),
        ]);
        setAllChallans(challanRes.data);
        setClients(clientRes.data);
        setItemTypes(typesRes.data || []);
        setScenarios(scenarioRes.data?.scenarios || []);

        // Generate-Bill shortcut from the Challans page: when a challanId is
        // passed in, derive its client and pre-tick the challan. The user
        // lands directly on the items/prices step. The actual rate fetch +
        // price prefill is handled by the selectedIds-change effect below,
        // so the same code path serves both this shortcut and the regular
        // Bills > New Bill flow when the operator ticks a challan manually.
        // If the challan is no longer in the pending list (someone else
        // billed it in between) we fall back to the empty state silently.
        if (prefillChallanId) {
          const dc = challanRes.data.find((c) => c.id === prefillChallanId);
          if (dc) {
            setSelectedClientId(String(dc.clientId));
            setSelectedIds([dc.id]);
          }
        }
      } catch {
        setError("Failed to load data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [companyId, prefillChallanId]);

  // Whenever a challan gets newly ticked (either via the Generate-Bill
  // prefill or a manual click in the Bills > New Bill flow), fetch the
  // last-billed rate for each of its items and merge them into lastRates.
  // Pre-fill itemPrices ONLY for items the operator has not already typed
  // a price into — never overwrite manual entries. fetchedRateChallanIds
  // prevents re-fetching when the user toggles the same challan on/off.
  useEffect(() => {
    const newIds = selectedIds.filter((id) => !fetchedRateChallanIds.has(id));
    if (newIds.length === 0) return;

    let cancelled = false;
    (async () => {
      const updates = {};
      const priceUpdates = {};
      let filledAny = false;
      for (const cid of newIds) {
        try {
          const r = await getLastRatesForChallan(companyId, cid);
          (r.data || []).forEach((row) => {
            updates[row.deliveryItemId] = row;
            if (row.lastUnitPrice != null) {
              priceUpdates[row.deliveryItemId] = String(row.lastUnitPrice);
              filledAny = true;
            }
          });
        } catch {
          // Non-fatal — operator can still type prices manually.
        }
      }
      if (cancelled) return;
      setFetchedRateChallanIds((prev) => {
        const next = new Set(prev);
        newIds.forEach((id) => next.add(id));
        return next;
      });
      if (Object.keys(updates).length > 0) {
        setLastRates((prev) => ({ ...prev, ...updates }));
      }
      if (Object.keys(priceUpdates).length > 0) {
        // Only fill prices for items the operator hasn't typed into yet.
        setItemPrices((prev) => {
          const next = { ...prev };
          Object.entries(priceUpdates).forEach(([k, v]) => {
            if (!next[k]) next[k] = v;
          });
          return next;
        });
        if (filledAny) setAutoFilledFromHistory(true);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedIds, companyId, fetchedRateChallanIds]);

  // The chosen scenario's full record (sale type + rate + scope) — drives
  // both the item-type filter and the GST rate auto-fill below.
  const chosenScenario = useMemo(
    () => scenarios.find((s) => s.code === scenarioCode) || null,
    [scenarios, scenarioCode],
  );

  // Item types compatible with the chosen scenario. When no scenario is
  // chosen, ALL item types are visible (pre-existing behaviour). When a
  // scenario is locked in, only items whose stored saleType matches the
  // scenario's saleType are surfaced — preventing the operator from
  // building a mixed-sale-type bill that FBR will reject with 0052.
  const filteredItemTypes = useMemo(() => {
    if (!chosenScenario) return itemTypes;
    const target = (chosenScenario.saleType || "").trim().toLowerCase();
    return itemTypes.filter(
      (it) => (it.saleType || "").trim().toLowerCase() === target,
    );
  }, [itemTypes, chosenScenario]);

  // When operator picks a scenario, snap the GST Rate to that scenario's
  // canonical rate. Operator can still type over it but the default is
  // always FBR-correct (e.g. 5% for SN005, 1% for SN020/SN025).
  useEffect(() => {
    if (chosenScenario) setGstRate(chosenScenario.defaultRate);
  }, [chosenScenario]);

  // Filter challans for selected client, sorted by DC# descending
  const clientChallans = selectedClientId
    ? allChallans
        .filter((c) => c.clientId === parseInt(selectedClientId))
        .sort((a, b) => b.challanNumber - a.challanNumber)
    : [];

  // Further filter by DC search (challan number, PO, or item descriptions)
  const filteredChallans = useMemo(() => {
    if (!dcSearch.trim()) return clientChallans;
    const term = dcSearch.toLowerCase();
    return clientChallans.filter((c) =>
      c.challanNumber.toString().includes(term) ||
      (c.poNumber && c.poNumber.toLowerCase().includes(term)) ||
      c.items?.some((item) => item.description?.toLowerCase().includes(term))
    );
  }, [clientChallans, dcSearch]);

  // Reset selections when client changes
  const handleClientChange = (e) => {
    setSelectedClientId(e.target.value);
    setSelectedIds([]);
    setItemPrices({});
    setItemDescriptions({});
    setCommonPoDate("");
    setDcSearch("");
    setError("");
    // Also clear any leftover rate-history state so the warning banner and
    // per-row hints don't persist across an unrelated client.
    setLastRates({});
    setAutoFilledFromHistory(false);
    setFetchedRateChallanIds(new Set());
  };


  const toggleChallan = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    const visible = filteredChallans.map((c) => c.id);
    const allSelected = visible.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visible.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...visible])]);
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

  const allPricesValid = allItems.length > 0 && allItems.every((i) => itemPrices[i.id] && parseFloat(itemPrices[i.id]) > 0);

  const handlePriceChange = (itemId, value) => {
    setItemPrices((prev) => ({ ...prev, [itemId]: value }));
  };

  const handleDescriptionChange = (itemId, value) => {
    setItemDescriptions((prev) => ({ ...prev, [itemId]: value }));
  };

  // Fires when user picks an item from SmartItemAutocomplete dropdown.
  // `picked` has { name, hsCode, uom, fbrUOMId, saleType, source }.
  // Auto-fills HS Code / UOM / Sale Type in one shot.
  const handleItemPick = (itemId, picked) => {
    setItemDescriptions((p) => ({ ...p, [itemId]: picked.name || p[itemId] }));
    if (picked.hsCode) setItemHsCodes((p) => ({ ...p, [itemId]: picked.hsCode }));
    if (picked.uom) setItemUoms((p) => ({ ...p, [itemId]: picked.uom }));
    if (picked.fbrUOMId) setItemFbrUomIds((p) => ({ ...p, [itemId]: picked.fbrUOMId }));
    if (picked.saleType) setItemSaleTypes((p) => ({ ...p, [itemId]: picked.saleType }));
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
      // Build PO date updates for selected challans that don't have a PO date
      const poDateUpdates = {};
      if (commonPoDate) {
        const isoDate = new Date(commonPoDate).toISOString();
        for (const dc of selectedChallans) {
          if (!dc.poDate) {
            poDateUpdates[dc.id] = isoDate;
          }
        }
      }

      // Prepend the chosen scenario tag to paymentTerms so FbrService's
      // auto-detector routes the submission to the right scenarioId. The
      // tag pattern is "[SNxxx]" — see FbrService.PostInvoiceAsync.
      const paymentTermsToSave = scenarioCode
        ? `[${scenarioCode}] ${paymentTerms || chosenScenario?.description || ""}`.trim()
        : (paymentTerms || null);

      await createInvoice({
        date: new Date(invoiceDate).toISOString(),
        companyId,
        clientId: parseInt(selectedClientId),
        gstRate: parseFloat(gstRate),
        paymentTerms: paymentTermsToSave,
        documentType: documentType || null,
        paymentMode: paymentMode || null,
        challanIds: selectedIds,
        items: allItems.map((item) => ({
          deliveryItemId: item.id,
          unitPrice: parseFloat(itemPrices[item.id]),
          description: itemDescriptions[item.id] || item.description,
          // ItemType link (new) — when set, backend re-derives HS/UOM/SaleType from catalog
          itemTypeId: itemTypeIds[item.id] || null,
          // Optional FBR fields — sent only if user filled them in (or auto-filled from picked ItemType)
          uom: itemUoms[item.id]?.trim() || null,
          fbrUOMId: itemFbrUomIds[item.id] || null,
          hsCode: itemHsCodes[item.id]?.trim() || null,
          saleType: itemSaleTypes[item.id]?.trim() || null,
        })),
        poDateUpdates,
      });

      // ── Remember FBR defaults per item description ──
      // Next time the user invoices the same item, HS Code / Sale Type / UOM
      // will auto-fill from these saved defaults. Best-effort — don't fail the
      // overall bill creation if a save fails.
      const rememberPromises = allItems
        .filter((item) => {
          const hs = itemHsCodes[item.id]?.trim();
          const st = itemSaleTypes[item.id]?.trim();
          const uom = itemUoms[item.id]?.trim();
          const fbrUom = itemFbrUomIds[item.id];
          return hs || st || uom || fbrUom;
        })
        .map((item) => {
          const name = (itemDescriptions[item.id] || item.description)?.trim();
          if (!name) return Promise.resolve();
          return saveItemFbrDefaults({
            name,
            hsCode: itemHsCodes[item.id]?.trim() || null,
            saleType: itemSaleTypes[item.id]?.trim() || null,
            uom: itemUoms[item.id]?.trim() || item.unit || null,
            fbrUOMId: itemFbrUomIds[item.id] || null,
          }).catch(() => {});
        });
      await Promise.all(rememberPromises);

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

  // Backdrop click is a no-op — bills can hold a lot of typed data and
  // a stray click shouldn't wipe it. Dismiss via X or Cancel.
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.xxl}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Create Bill</h5>
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
                      Starting bill number not set for this company. Please configure it in the Companies page.
                    </div>
                  )}
                  {company && company.startingInvoiceNumber > 0 && (
                    <span style={{ fontSize: "0.78rem", color: colors.textSecondary, marginTop: "0.3rem", display: "block" }}>
                      Next bill #: {company.currentInvoiceNumber > 0 ? company.currentInvoiceNumber + 1 : company.startingInvoiceNumber}
                    </span>
                  )}
                </div>

                {/* Step 2: Show rest only after client is selected AND has starting invoice number */}
                {selectedClientId && company?.startingInvoiceNumber > 0 && (
                  <>
                    {/* Bill header fields — Date / GST / Terms / FBR Doc Type / FBR Payment Mode */}
                    <div style={styles.row}>
                      <div style={{ flex: 2, minWidth: 240 }}>
                        <label style={styles.label}>
                          FBR Scenario <span style={styles.optionalTag}>filters items</span>
                        </label>
                        <select
                          style={styles.input}
                          value={scenarioCode}
                          onChange={(e) => setScenarioCode(e.target.value)}
                        >
                          <option value="">— auto-detect from items —</option>
                          {scenarios.map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.code} · {s.saleType} · {s.defaultRate}%
                            </option>
                          ))}
                        </select>
                        {chosenScenario && (
                          <div style={{ fontSize: "0.7rem", color: colors.textSecondary, marginTop: "0.25rem" }}>
                            Showing only item types with sale type "{chosenScenario.saleType}".
                            Pick a different scenario to switch the filter.
                          </div>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>Bill Date</label>
                        <input type="date" style={styles.input} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 100 }}>
                        <label style={styles.label}>GST Rate (%)</label>
                        <input type="number" style={styles.input} value={gstRate} onChange={(e) => setGstRate(e.target.value)} min={0} max={100} step={0.5} />
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>Payment Terms</label>
                        <input type="text" style={styles.input} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Optional" />
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>
                          Document Type <span style={styles.optionalTag}>FBR</span>
                        </label>
                        <select
                          style={styles.input}
                          value={documentType}
                          onChange={(e) => setDocumentType(parseInt(e.target.value))}
                        >
                          <option value={4}>Sale Invoice</option>
                          <option value={9}>Debit Note</option>
                          <option value={10}>Credit Note</option>
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={styles.label}>
                          Payment Mode <span style={styles.optionalTag}>FBR</span>
                        </label>
                        <select
                          style={styles.input}
                          value={paymentMode}
                          onChange={(e) => setPaymentMode(e.target.value)}
                        >
                          <option value="">— optional —</option>
                          <option>Cash</option>
                          <option>Credit</option>
                          <option>Bank Transfer</option>
                          <option>Cheque</option>
                          <option>Online</option>
                        </select>
                      </div>
                    </div>

                    {/* Challan selection */}
                    <div style={{ marginBottom: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap", gap: "0.35rem" }}>
                        <label style={{ ...styles.label, marginBottom: 0 }}>
                          Pending Challans ({dcSearch ? `${filteredChallans.length} / ${clientChallans.length}` : clientChallans.length})
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          {clientChallans.length > 0 && (
                            <div style={{ position: "relative" }}>
                              <MdSearch size={14} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary }} />
                              <input
                                type="text"
                                placeholder="Search DC#, PO, items..."
                                style={{ ...styles.input, padding: "0.25rem 0.5rem 0.25rem 1.5rem", fontSize: "0.78rem", width: 180 }}
                                value={dcSearch}
                                onChange={(e) => setDcSearch(e.target.value)}
                              />
                            </div>
                          )}
                          {filteredChallans.length > 1 && (
                            <button
                              type="button"
                              style={styles.selectAllBtn}
                              onClick={selectAll}
                            >
                              {filteredChallans.every((c) => selectedIds.includes(c.id)) ? "Deselect All" : "Select All"}
                            </button>
                          )}
                        </div>
                      </div>
                      {clientChallans.length === 0 ? (
                        <p style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>No pending challans for this client.</p>
                      ) : filteredChallans.length === 0 ? (
                        <p style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>No challans match "{dcSearch}".</p>
                      ) : (
                        <>
                          <div style={styles.challanGrid}>
                            {filteredChallans.map((c) => (
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
                                    {c.poDate ? ` | PO Date: ${new Date(c.poDate).toLocaleDateString()}` : ""}
                                  </span>
                                </div>
                              </label>
                            ))}
                          </div>
                          {selectedIds.length > 0 && selectedChallans.find((c) => c.poDate) && (
                            <div style={styles.poDateInfo}>
                              <span style={{ fontSize: "0.82rem", fontWeight: 600, color: colors.textSecondary }}>PO Date:</span>
                              <span style={{ fontSize: "0.82rem", color: colors.textPrimary }}>{new Date(selectedChallans.find((c) => c.poDate).poDate).toLocaleDateString()}</span>
                            </div>
                          )}
                          {selectedIds.length > 0 && !selectedChallans.find((c) => c.poDate) && (
                            <div style={styles.poDateInfo}>
                              <span style={{ fontSize: "0.82rem", fontWeight: 600, color: colors.textSecondary }}>PO Date (for all selected DCs):</span>
                              <input
                                type="date"
                                style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.82rem", width: "auto" }}
                                value={commonPoDate}
                                onChange={(e) => setCommonPoDate(e.target.value)}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Items - unified single-row table (same layout as Edit Bill) */}
                    {allItems.length > 0 && (
                      <div>
                        <div style={styles.itemsHeaderBar}>
                          <label style={{ ...styles.label, margin: 0 }}>
                            Items ({allItems.length})
                          </label>
                          <div style={styles.hintRow}>
                            <span style={styles.hintPill}>Tip</span>
                            Pick from <b>SAVED</b> (remembered defaults) or <b>FBR catalog</b> to auto-fill HS Code & UOM.
                          </div>
                        </div>

                        {autoFilledFromHistory && (
                          <div style={{
                            display: "flex", alignItems: "flex-start", gap: "0.5rem",
                            padding: "0.55rem 0.85rem", marginBottom: "0.5rem",
                            backgroundColor: "#fff8e1", border: "1px solid #ffcc80",
                            borderRadius: 8, fontSize: "0.82rem", color: "#bf360c"
                          }}>
                            <span style={{ fontSize: "1rem", lineHeight: 1 }}>⚠</span>
                            <div>
                              <b>Rates pre-filled from last bill.</b>
                              {" "}Verify each unit price below — material prices may have changed since the previous order. Override any row that needs a new rate.
                            </div>
                          </div>
                        )}

                        {/* Bulk Item Type apply — single dropdown sets the
                            same catalog row across all lines. Saves 20+
                            picks when every item on the bill is the same
                            FBR category. */}
                        {allItems.length > 1 && (
                          <div style={{
                            display: "flex", alignItems: "center", gap: "0.65rem",
                            flexWrap: "wrap", padding: "0.55rem 0.85rem",
                            marginBottom: "0.5rem", borderRadius: 8,
                            border: `1px solid ${colors.cardBorder}`,
                            backgroundColor: "#f8faff",
                          }}>
                            <span style={{ fontSize: "0.82rem", color: colors.textPrimary, fontWeight: 500 }}>
                              Apply same Item Type to:
                            </span>
                            <select
                              value={bulkApplyMode}
                              onChange={(e) => setBulkApplyMode(e.target.value)}
                              style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem", maxWidth: 180 }}
                            >
                              <option value="all">All {allItems.length} rows</option>
                              <option value="empty">Only empty rows</option>
                            </select>
                            <div style={{ flex: "1 1 220px", maxWidth: 280 }}>
                              <SearchableItemTypeSelect
                                items={filteredItemTypes}
                                value=""
                                onChange={(newId, picked) => {
                                  if (!newId || !picked) return;
                                  applyItemTypeToAll(parseInt(newId), picked, bulkApplyMode);
                                }}
                                placeholder={bulkApplyMode === "all"
                                  ? "— pick to apply to all —"
                                  : "— pick to fill empty rows —"}
                                style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                              />
                            </div>
                          </div>
                        )}

                        <div style={styles.unifiedTableWrap}>
                          <table style={styles.unifiedTable}>
                            <thead>
                              <tr style={styles.unifiedThead}>
                                <th style={{ ...styles.unifiedTh, width: "4%" }}>DC#</th>
                                <th style={{ ...styles.unifiedTh, width: "14%" }}>Item Type (FBR)</th>
                                <th style={{ ...styles.unifiedTh, width: "16%" }}>Description</th>
                                <th style={{ ...styles.unifiedTh, width: "9%" }}>Qty</th>
                                <th style={{ ...styles.unifiedTh, width: "8%" }}>UOM</th>
                                <th style={{ ...styles.unifiedTh, width: "8%" }}>Unit Price *</th>
                                <th style={{ ...styles.unifiedTh, width: "9%" }}>Line Total</th>
                                <th style={{ ...styles.unifiedTh, width: "10%" }}>HS Code</th>
                                <th style={{ ...styles.unifiedTh, width: "22%" }}>Sale Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {allItems.map((item) => {
                                const price = parseFloat(itemPrices[item.id]) || 0;
                                const displayUom = itemUoms[item.id] ?? item.unit;
                                return (
                                  <tr key={item.id} style={styles.unifiedRow}>
                                    <td style={{ ...styles.unifiedTd, fontSize: "0.76rem", color: colors.textSecondary }}>
                                      {item.challanNumber}
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      {/* Picking an ItemType auto-fills HS Code, UOM, SaleType,
                                          FbrUOMId on this row — identical behaviour to EditBillForm. */}
                                      <SearchableItemTypeSelect
                                        items={filteredItemTypes}
                                        value={itemTypeIds[item.id] || ""}
                                        onChange={(newId, picked) => {
                                          setItemTypeIds((p) => ({ ...p, [item.id]: newId ? parseInt(newId) : null }));
                                          if (picked) {
                                            // Picking an ItemType binds these fields to the catalog row.
                                            if (picked.hsCode) setItemHsCodes((p) => ({ ...p, [item.id]: picked.hsCode }));
                                            if (picked.saleType) setItemSaleTypes((p) => ({ ...p, [item.id]: picked.saleType }));
                                            if (picked.uom) setItemUoms((p) => ({ ...p, [item.id]: picked.uom }));
                                            if (picked.fbrUOMId) setItemFbrUomIds((p) => ({ ...p, [item.id]: picked.fbrUOMId }));
                                          } else {
                                            // Clearing the ItemType also clears the bound HS Code,
                                            // Sale Type and UOM — they were inherited from the
                                            // catalog row, so removing the link should remove the
                                            // values too. Otherwise stale FBR fields stay on the
                                            // line and the operator silently ships wrong data.
                                            setItemHsCodes((p) => ({ ...p, [item.id]: "" }));
                                            setItemSaleTypes((p) => ({ ...p, [item.id]: "" }));
                                            setItemUoms((p) => ({ ...p, [item.id]: "" }));
                                            setItemFbrUomIds((p) => ({ ...p, [item.id]: null }));
                                          }
                                        }}
                                        placeholder="— optional —"
                                        style={{ padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                                      />
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      <SmartItemAutocomplete
                                        companyId={companyId}
                                        value={itemDescriptions[item.id] ?? item.description}
                                        onChange={(v) => handleDescriptionChange(item.id, v)}
                                        onPick={(picked) => handleItemPick(item.id, picked)}
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                        placeholder="Search or type item…"
                                      />
                                    </td>
                                    <td style={{ ...styles.unifiedTd, textAlign: "right", fontSize: "0.82rem", paddingRight: "0.5rem" }}>
                                      {/* Strip trailing zeros so 1.0000 → "1",
                                          12.5000 → "12.5", 0.0004 → "0.0004". */}
                                      {parseFloat(Number(item.quantity || 0).toFixed(4)).toString()}
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      <input
                                        type="text"
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                        value={displayUom}
                                        onChange={(e) => setItemUoms((p) => ({ ...p, [item.id]: e.target.value }))}
                                      />
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.01}
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.8rem" }}
                                        value={itemPrices[item.id] || ""}
                                        onChange={(e) => handlePriceChange(item.id, e.target.value)}
                                        placeholder="0.00"
                                      />
                                      {lastRates[item.id]?.lastUnitPrice != null && (
                                        <div style={{
                                          fontSize: "0.68rem", marginTop: 2, lineHeight: 1.2,
                                          whiteSpace: "nowrap",
                                          color: parseFloat(itemPrices[item.id]) === parseFloat(lastRates[item.id].lastUnitPrice)
                                            ? "#5f6d7e" : "#2e7d32",
                                        }}
                                        title={`Last billed Rs. ${Number(lastRates[item.id].lastUnitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                                          + ` on bill #${lastRates[item.id].lastInvoiceNumber}`
                                          + (lastRates[item.id].lastInvoiceDate ? ` (${new Date(lastRates[item.id].lastInvoiceDate).toLocaleDateString()})` : "")
                                          + ` — matched by ${lastRates[item.id].matchedBy}`
                                        }>
                                          Last Rs.{Number(lastRates[item.id].lastUnitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                          {lastRates[item.id].lastInvoiceDate && (
                                            <> · #{lastRates[item.id].lastInvoiceNumber}</>
                                          )}
                                          {parseFloat(itemPrices[item.id]) !== parseFloat(lastRates[item.id].lastUnitPrice) && (
                                            <> · <b>edited</b></>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ ...styles.unifiedTd, textAlign: "right", fontWeight: 600, fontSize: "0.82rem" }}>
                                      {(item.quantity * price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      <input
                                        type="text"
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.78rem", fontFamily: "monospace" }}
                                        value={itemHsCodes[item.id] || ""}
                                        onChange={(e) => setItemHsCodes((p) => ({ ...p, [item.id]: e.target.value }))}
                                        placeholder="auto"
                                      />
                                    </td>
                                    <td style={styles.unifiedTd}>
                                      <select
                                        style={{ ...styles.input, padding: "0.3rem 0.5rem", fontSize: "0.78rem" }}
                                        value={itemSaleTypes[item.id] || ""}
                                        onChange={(e) => setItemSaleTypes((p) => ({ ...p, [item.id]: e.target.value }))}
                                      >
                                        <option value="">— select —</option>
                                        <option>Goods at standard rate (default)</option>
                                        <option>Goods at Reduced Rate</option>
                                        <option>Goods at zero-rate</option>
                                        <option>Exempt goods</option>
                                        <option>3rd Schedule Goods</option>
                                        <option>Services</option>
                                        <option>Services (FED in ST Mode)</option>
                                        <option>Goods (FED in ST Mode)</option>
                                        <option>Steel Melting and re-rolling</option>
                                        <option>Toll Manufacturing</option>
                                        <option>Mobile Phones</option>
                                        <option>Petroleum Products</option>
                                        <option>Electric Vehicle</option>
                                        <option>Cement /Concrete Block</option>
                                        <option>Processing/Conversion of Goods</option>
                                        <option>Cotton Ginners</option>
                                        <option>Non-Adjustable Supplies</option>
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p style={styles.fbrToggleHint}>
                          <b>*</b> Unit Price is required. HS Code &amp; Sale Type are optional —
                          needed only when submitting to FBR. They auto-fill when you pick an item.
                        </p>

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
            {allItems.length > 0 && !allPricesValid && (
              <span style={{ fontSize: "0.8rem", color: colors.danger, marginRight: "auto" }}>
                All items must have a unit price greater than 0.
              </span>
            )}
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: saving || !selectedClientId || selectedIds.length === 0 || !allPricesValid ? 0.6 : 1 }}
              disabled={saving || !selectedClientId || selectedIds.length === 0 || !allPricesValid}
            >
              {saving ? "Creating..." : "Create Bill"}
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
  poDateInfo: { display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", padding: "0.5rem 0.75rem", borderRadius: 8, backgroundColor: "#e3f2fd", border: "1px solid #0d47a130", flexWrap: "wrap" },
  fbrToggleHint: { margin: "0.3rem 0 0", fontSize: "0.75rem", color: colors.textSecondary },
  optionalTag: { marginLeft: "0.3rem", padding: "0.05rem 0.35rem", borderRadius: 4, backgroundColor: "#fff3e0", color: "#e65100", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase" },
  itemsHeaderBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" },
  hintRow: { display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", color: colors.textSecondary },
  hintPill: { padding: "0.05rem 0.4rem", borderRadius: 4, backgroundColor: "#e3f2fd", color: colors.blue, fontSize: "0.65rem", fontWeight: 800, letterSpacing: "0.03em" },
  unifiedTableWrap: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  unifiedTable: { width: "100%", borderCollapse: "collapse", minWidth: 1000 },
  unifiedThead: { backgroundColor: "#eff3f8" },
  unifiedTh: { padding: "0.5rem 0.45rem", textAlign: "left", fontSize: "0.7rem", fontWeight: 800, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${colors.cardBorder}` },
  unifiedRow: { backgroundColor: "#fff" },
  unifiedTd: { padding: "0.3rem 0.4rem", fontSize: "0.8rem", borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: "middle" },
};
