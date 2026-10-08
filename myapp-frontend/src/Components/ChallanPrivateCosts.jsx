import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SupplierForm from "./SupplierForm";
import { usePermissions } from "../contexts/PermissionsContext";
import { getCompanyById } from "../api/companyApi";
import { notify } from "../utils/notify";
import { getSuppliersByCompany } from "../api/supplierApi";
import SearchableSelect from "./SearchableSelect";
import RichText from "./RichText";
import "./ChallanPrivateCosts.css";

const field = { width: "100%", minHeight: 44, boxSizing: "border-box", border: "1px solid #d0d7e2", borderRadius: 7, padding: "6px 9px", fontSize: 12, background: "#fff" };

export function useChallanSuppliers(companyId) {
  const [suppliers, setSuppliers] = useState([]);
  useEffect(() => {
    let active = true;
    setSuppliers([]);
    if (!companyId) return () => { active = false; };
    getSuppliersByCompany(companyId).then(({ data }) => { if (active) setSuppliers(data || []); }).catch(() => { if (active) setSuppliers([]); });
    return () => { active = false; };
  }, [companyId]);
  return suppliers;
}

export default function ChallanPrivateCosts({ items = [], onItemsChange, suppliers = [], readOnly = false, companyId }) {
  const { has } = usePermissions();
  const [addedSuppliers, setAddedSuppliers] = useState([]);
  const [supplierTarget, setSupplierTarget] = useState(null);
  const [openingSupplier, setOpeningSupplier] = useState(false);
  const current = useRef({ companyId, items, onItemsChange });
  useEffect(() => { current.current = { companyId, items, onItemsChange }; }, [companyId, items, onItemsChange]);
  useEffect(() => { setAddedSuppliers([]); setSupplierTarget(null); }, [companyId]);
  const choices = [...addedSuppliers, ...suppliers.filter(s => !addedSuppliers.some(added => added.id === s.id))];
  const canCreate = !readOnly && companyId && has("suppliers.manage.create");
  const addSupplier = async index => {
    setOpeningSupplier(true);
    try {
      const { data: company } = await getCompanyById(companyId);
      if (Number(current.current.companyId) !== Number(companyId)) return;
      setSupplierTarget({ index, companyId, fbrEnabled: company.fbrEnabled });
    } catch { notify("Could not load this company. Try adding the supplier again.", "error"); }
    finally { setOpeningSupplier(false); }
  };
  const supplierCreated = supplier => {
    const latest = current.current;
    if (!supplier?.id || !supplierTarget || Number(latest.companyId) !== Number(supplierTarget.companyId) || Number(supplier.companyId) !== Number(supplierTarget.companyId)) return;
    setAddedSuppliers(previous => [supplier, ...previous.filter(s => s.id !== supplier.id)]);
    latest.onItemsChange(latest.items.map((row, index) => supplierTarget.index === "all" || index === supplierTarget.index ? { ...row, supplierId: supplier.id } : row));
  };
  const supplierId = items.length && items.every((item) => item.supplierId && item.supplierId === items[0].supplierId)
    ? items[0].supplierId : "";
  if (!items.length || (readOnly && !items.some((item) => item.supplierId || item.actualUnitCost != null))) return null;
  const applySupplier = (id) => onItemsChange(items.map((row) => ({ ...row, supplierId: id ? Number(id) : null })));
  const updateLine = (index, patch) => onItemsChange(items.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section className="challan-private-costs" aria-label="Private supplier and cost details">
    <div className="challan-private-heading">
      <div><strong>Private supplier and cost details</strong><p>Internal use only · Excluded from customer prints. Enter the actual price for one unit; line cost is quantity × unit price.</p></div>
      {!readOnly && items.length > 1 && <div className="challan-private-bulk">
        <span>Supplier for all lines</span>
        <div><SearchableSelect items={choices} value={supplierId} onChange={applySupplier} placeholder="Apply supplier to all" style={field} /></div>
        {canCreate && <button type="button" disabled={openingSupplier} onClick={() => addSupplier("all")}>Add supplier for all</button>}
        <button type="button" disabled={!items.some((item) => item.supplierId)} onClick={() => applySupplier("")}>Clear all</button>
      </div>}
    </div>
    <div className="challan-private-columns" aria-hidden="true"><span>Item</span><span>Supplier</span><span>Actual unit price (PKR)</span><span>Actual line total (PKR)</span></div>
    {items.map((item, index) => <div key={item.id || index} className="challan-private-row">
      <div className="challan-private-item"><span>{index + 1}</span><div><RichText text={item.description || "New line"} /></div></div>
      <div className="challan-private-supplier">
        <span className="challan-private-mobile-label">Supplier</span>
        {readOnly ? <span>{item.supplierName || choices.find((s) => s.id === item.supplierId)?.name || "—"}</span> : <SearchableSelect items={choices} value={item.supplierId ?? ""} onChange={(id) => updateLine(index, { supplierId: id ? Number(id) : null })} placeholder="Optional supplier" style={field} />}
        {canCreate && <button className="challan-private-add-supplier" type="button" disabled={openingSupplier} onClick={() => addSupplier(index)} aria-label={`Add supplier for line ${index + 1}`}>+ Add supplier</button>}
      </div>
      <label className="challan-private-cost">
        <span className="challan-private-mobile-label">Actual unit price (PKR)</span>
        {readOnly ? <span>{item.actualUnitCost == null ? "—" : Number(item.actualUnitCost).toLocaleString(undefined, { maximumFractionDigits: 12 })}</span> : <input aria-label={`Actual cost per unit for line ${index + 1}`} style={field} type="number" inputMode="decimal" min="0" step="any" placeholder="Optional" value={item.actualUnitCost ?? ""} onChange={(e) => updateLine(index, { actualUnitCost: e.target.value === "" ? null : e.target.value })} />}
      </label>
      <div className="challan-private-total">
        <span className="challan-private-mobile-label">Actual line total (PKR)</span>
        <output aria-label={`Actual line total for line ${index + 1}`}>
          {item.actualUnitCost == null || item.actualUnitCost === "" || item.quantity == null || item.quantity === "" ||
            !Number.isFinite(Number(item.quantity) * Number(item.actualUnitCost)) || Number(item.quantity) < 0 || Number(item.actualUnitCost) < 0
            ? "—" : (Number(item.quantity) * Number(item.actualUnitCost)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </output>
      </div>
    </div>)}
    {supplierTarget && Number(supplierTarget.companyId) === Number(companyId) && createPortal(
      <div className="challan-private-supplier-modal" onSubmit={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <SupplierForm companyId={supplierTarget.companyId} fbrEnabled={supplierTarget.fbrEnabled} onSaved={supplierCreated} onClose={() => setSupplierTarget(null)} />
      </div>, document.body)}
  </section>;
}
