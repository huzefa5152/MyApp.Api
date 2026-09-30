import { useEffect, useState } from "react";
import { getSuppliersByCompany } from "../api/supplierApi";
import SearchableSelect from "./SearchableSelect";
import RichText from "./RichText";
import "./ChallanPrivateCosts.css";

const field = { width: "100%", minHeight: 44, boxSizing: "border-box", border: "1px solid #d0d7e2", borderRadius: 7, padding: "6px 9px", fontSize: 12, background: "#fff" };

export function useChallanSuppliers(companyId) {
  const [suppliers, setSuppliers] = useState([]);
  useEffect(() => {
    if (!companyId) { setSuppliers([]); return; }
    getSuppliersByCompany(companyId).then(({ data }) => setSuppliers(data || [])).catch(() => setSuppliers([]));
  }, [companyId]);
  return suppliers;
}

export default function ChallanPrivateCosts({ items = [], onItemsChange, suppliers = [], readOnly = false }) {
  const supplierId = items.length && items.every((item) => item.supplierId && item.supplierId === items[0].supplierId)
    ? items[0].supplierId : "";
  if (!items.length || (readOnly && !items.some((item) => item.supplierId || item.actualUnitCost != null))) return null;
  const applySupplier = (id) => onItemsChange(items.map((row) => ({ ...row, supplierId: id ? Number(id) : null })));
  const updateLine = (index, patch) => onItemsChange(items.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section className="challan-private-costs" aria-label="Private supplier and cost details">
    <div className="challan-private-heading">
      <div><strong>Private supplier and cost details</strong><p>Internal use only · Excluded from customer prints</p></div>
      {!readOnly && items.length > 1 && <div className="challan-private-bulk">
        <span>Supplier for all lines</span>
        <div><SearchableSelect items={suppliers} value={supplierId} onChange={applySupplier} placeholder="Apply supplier to all" style={field} /></div>
        <button type="button" disabled={!items.some((item) => item.supplierId)} onClick={() => applySupplier("")}>Clear all</button>
      </div>}
    </div>
    <div className="challan-private-columns" aria-hidden="true"><span>Item</span><span>Supplier</span><span>Actual cost / unit</span></div>
    {items.map((item, index) => <div key={item.id || index} className="challan-private-row">
      <div className="challan-private-item"><span>{index + 1}</span><div><RichText text={item.description || "New line"} /></div></div>
      <div className="challan-private-supplier">
        <span className="challan-private-mobile-label">Supplier</span>
        {readOnly ? <span>{item.supplierName || suppliers.find((s) => s.id === item.supplierId)?.name || "—"}</span> : <SearchableSelect items={suppliers} value={item.supplierId ?? ""} onChange={(id) => updateLine(index, { supplierId: id ? Number(id) : null })} placeholder="Optional supplier" style={field} />}
      </div>
      <label className="challan-private-cost">
        <span className="challan-private-mobile-label">Actual cost / unit</span>
        {readOnly ? <span>{item.actualUnitCost == null ? "—" : Number(item.actualUnitCost).toLocaleString(undefined, { maximumFractionDigits: 12 })}</span> : <input aria-label={`Actual cost per unit for line ${index + 1}`} style={field} type="number" inputMode="decimal" min="0" step="any" placeholder="Optional" value={item.actualUnitCost ?? ""} onChange={(e) => updateLine(index, { actualUnitCost: e.target.value === "" ? null : e.target.value })} />}
      </label>
    </div>)}
  </section>;
}
