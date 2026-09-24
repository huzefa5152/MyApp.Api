import { useEffect, useState } from "react";
import { getSuppliersByCompany } from "../api/supplierApi";

const field = { width: "100%", minHeight: 44, boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", background: "#fff" };

export function useChallanSuppliers(companyId) {
  const [suppliers, setSuppliers] = useState([]);
  useEffect(() => {
    if (!companyId) { setSuppliers([]); return; }
    getSuppliersByCompany(companyId).then(({ data }) => setSuppliers(data || [])).catch(() => setSuppliers([]));
  }, [companyId]);
  return suppliers;
}

export function PrivateCostFields({ item, suppliers, onChange }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10 }}>
    <label style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>Supplier (private)
      <select style={field} value={item.supplierId ?? ""} onChange={(e) => onChange({ supplierId: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Choose supplier</option>
        {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
      </select>
    </label>
    <label style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>Actual cost per unit (private)
      <input style={field} type="number" inputMode="decimal" min="0" step="any" placeholder="Optional" value={item.actualUnitCost ?? ""} onChange={(e) => onChange({ actualUnitCost: e.target.value === "" ? null : e.target.value })} />
    </label>
  </div>;
}

export default function ChallanPrivateCosts({ items, onItemsChange, suppliers }) {
  return <section style={{ marginTop: 14, padding: 14, border: "1px solid #dce7e4", borderRadius: 12, background: "#f7fbfa" }}>
    <strong style={{ color: "#00695c" }}>Private supplier and cost details</strong>
    <p style={{ margin: "4px 0 12px", color: "#64748b", fontSize: 12 }}>Used for purchase bills and profit reporting. These details do not print on customer documents.</p>
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((item, index) => <div key={item.id || index} style={{ display: "grid", gridTemplateColumns: "minmax(100px, 1fr) minmax(0, 3fr)", alignItems: "center", gap: 10, padding: 10, background: "white", borderRadius: 9, border: "1px solid #e2e8f0" }}>
        <div style={{ minWidth: 0 }}><b>Line {index + 1}</b><div style={{ overflowWrap: "anywhere", fontSize: 12, color: "#64748b" }}>{item.description || "New line"}</div></div>
        <PrivateCostFields item={item} suppliers={suppliers} onChange={(patch) => onItemsChange(items.map((row, i) => i === index ? { ...row, ...patch } : row))} />
      </div>)}
    </div>
  </section>;
}
