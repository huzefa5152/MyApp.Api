import { useState } from "react";
import { updateChallanPrivateCosts } from "../api/challanApi";
import ChallanPrivateCosts, { useChallanSuppliers } from "./ChallanPrivateCosts";
import { useChallanPurchasePreview } from "./ChallanPurchasePreview";
import { usePermissions } from "../contexts/PermissionsContext";
import { formStyles } from "../theme";

export default function ChallanCostEditForm({ challan, onClose, onSaved }) {
  const [items, setItems] = useState(challan.items);
  const [version, setVersion] = useState(challan.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const suppliers = useChallanSuppliers(challan.companyId);
  const purchase = useChallanPurchasePreview();
  const { has } = usePermissions();
  const complete = items.length > 0 && items.every(i => i.supplierId && i.actualUnitCost != null && i.actualUnitCost !== "" && Number(i.actualUnitCost) >= 0);
  const save = async (preview = false) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (!saved) {
        const { data } = await updateChallanPrivateCosts(challan.id, {
          version, items: items.map(i => ({ id: i.id, supplierId: i.supplierId || null, actualUnitCost: i.actualUnitCost === "" ? null : i.actualUnitCost ?? null }))
        });
        setVersion(data.version); setSaved(true);
      }
      if (preview && !await purchase.create(challan.id)) return;
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Could not complete the save. Retry or reload the challan.");
    } finally { setBusy(false); }
  };
  return <div data-admin-backdrop="" style={formStyles.backdrop}>
    {purchase.dialog}
    <section role="dialog" aria-modal="true" aria-labelledby="challan-cost-title" style={{ ...formStyles.modal, maxWidth: 960 }}>
      <header style={formStyles.header}><h2 id="challan-cost-title" style={formStyles.title}>Supplier & actual cost — Challan #{challan.challanNumber}</h2><button aria-label="Close cost editor" disabled={busy} style={formStyles.closeButton} onClick={onClose}>×</button></header>
      <div style={formStyles.body}>
        <p>The billed delivery details are locked. Update supplier and actual unit cost for internal profit calculations.</p>
        {error && <p role="alert">{error}</p>}
        {saved && <p role="status">Supplier costs saved. You can retry the purchase preview or close.</p>}
        <ChallanPrivateCosts companyId={challan.companyId} items={items} onItemsChange={setItems} suppliers={suppliers} readOnly={busy || saved || challan.hasAutoPurchaseBills} />
        {challan.hasAutoPurchaseBills && <p>Supplier purchase bills already exist. Manage corrections in Purchases.</p>}
      </div>
      <footer style={{ ...formStyles.footer, flexWrap: "wrap" }}>
        <button style={{ ...formStyles.button, ...formStyles.cancel }} disabled={busy} onClick={saved ? onSaved : onClose}>{saved ? "Close" : "Cancel"}</button>
        {!challan.hasAutoPurchaseBills && <>
          {!saved && <button style={{ ...formStyles.button, ...formStyles.submit }} disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save supplier & cost"}</button>}
          {has("purchasebills.manage.create") && has("challans.list.view") && <button style={{ ...formStyles.button, ...formStyles.submit }} disabled={busy || !complete} onClick={() => save(true)}>{saved ? "Preview supplier purchases" : "Save & preview supplier purchases"}</button>}
        </>}
      </footer>
    </section>
  </div>;
}
