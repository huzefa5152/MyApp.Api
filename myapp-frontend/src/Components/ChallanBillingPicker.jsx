import { useMemo, useState } from "react";
import { hasChallanPo, groupChallansByPo } from "../utils/challanBilling";

const button = { minHeight: 44, padding: "0.5rem 0.75rem", border: "1px solid #d0d7e2", borderRadius: 8, background: "#fff", color: "#0d47a1" };

export default function ChallanBillingPicker({ challans, selectedIds, onChange }) {
  const [tab, setTab] = useState(() => {
    const first = challans.find((c) => selectedIds.includes(c.id));
    return first ? (hasChallanPo(first) ? "withPo" : "withoutPo") : (challans.some(hasChallanPo) ? "withPo" : "withoutPo");
  });
  const [search, setSearch] = useState("");
  const withPo = challans.filter(hasChallanPo);
  const withoutPo = challans.filter((c) => !hasChallanPo(c));
  const visible = (tab === "withPo" ? withPo : withoutPo).filter((c) => {
    const term = search.trim().toLowerCase();
    return !term || String(c.challanNumber).includes(term) || c.poNumber?.toLowerCase().includes(term) || c.items?.some((i) => i.description?.toLowerCase().includes(term));
  });
  const groups = useMemo(() => groupChallansByPo(visible), [visible]);
  const selected = challans.filter((c) => selectedIds.includes(c.id));
  const selectedGroups = groupChallansByPo(selected.filter(hasChallanPo));
  const toggle = (ids) => {
    const all = ids.every((id) => selectedIds.includes(id));
    onChange(all ? selectedIds.filter((id) => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])]);
  };

  return <section aria-label="Billable challans" style={{ marginBottom: "1rem", minWidth: 0 }}>
    <h6 style={{ marginBottom: 8 }}>Select delivery challans</h6>
    <div role="tablist" aria-label="Challan PO details" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
      {[["withPo", "With PO", withPo.length], ["withoutPo", "Without PO", withoutPo.length]].map(([id, label, count]) =>
        <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls="billable-challan-panel" onClick={() => setTab(id)} style={{ ...button, flex: 1, background: tab === id ? "#e3f2fd" : "#fff", fontWeight: tab === id ? 700 : 400 }}>{label} ({count})</button>)}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
      <input aria-label="Search billable challans" placeholder="Search DC#, PO, items" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 160px", minWidth: 0, minHeight: 44, border: "1px solid #d0d7e2", borderRadius: 8, padding: "0.5rem" }} />
      {visible.length > 1 && <button type="button" style={button} onClick={() => toggle(visible.map((c) => c.id))}>{visible.every((c) => selectedIds.includes(c.id)) ? "Deselect shown" : "Select shown"}</button>}
    </div>
    <div id="billable-challan-panel" role="tabpanel">
      {tab === "withoutPo" && <p style={{ fontSize: "0.85rem", color: "#5f6d7e" }}>Bill one or more challans without a PO, or enter one PO number and date above to apply to every selected challan.</p>}
      {!visible.length && <p>No billable challans in this tab{search.trim() ? " match your search" : ""}.</p>}
      {groups.map((group) => <div key={group.key} style={{ marginBottom: 10, border: "1px solid #e8edf3", padding: 10, borderRadius: 10 }}>
        {tab === "withPo" && <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <strong style={{ overflowWrap: "anywhere" }}>PO {group.poNumber} · {group.poDate || "Date not set"}</strong>
          <button type="button" style={button} onClick={() => onChange(group.challans.map((c) => c.id))}>Select this PO</button>
        </div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))", gap: 8 }}>
          {group.challans.map((c) => <label key={c.id} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: 8, border: "1px solid #d0d7e2", borderRadius: 8, background: selectedIds.includes(c.id) ? "#e3f2fd" : "#fff", cursor: "pointer" }}>
            <input type="checkbox" aria-label={`Select challan ${c.challanNumber}`} checked={selectedIds.includes(c.id)} onChange={() => toggle([c.id])} />
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>DC #{c.challanNumber}</b><br /><small>{c.deliveryDate?.slice(0, 10)} · {c.items?.length || 0} items{c.salesOrderId ? ` · SO #${c.salesOrderNumber || c.salesOrderId}` : ""}</small></span>
          </label>)}
        </div>
      </div>)}
    </div>
    <p role="status" style={{ marginTop: 8 }}>{selected.length} challan{selected.length === 1 ? "" : "s"} selected across both tabs{selected.length ? `: ${selected.map((c) => `#${c.challanNumber}`).join(", ")}` : ""}.</p>
    {selectedGroups.length > 1 && <p style={{ color: "#8a5300", fontSize: "0.85rem" }}>Selected challans have different PO details. For a bill against one PO, use “Select this PO” or enter the common PO number and date above.</p>}
  </section>;
}
