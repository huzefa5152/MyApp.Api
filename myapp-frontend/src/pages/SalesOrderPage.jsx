import { useState, useEffect, useCallback } from "react";
import { MdAssignment, MdAdd, MdBusiness, MdSearch, MdChevronLeft, MdChevronRight, MdPrint, MdPictureAsPdf, MdEdit, MdDelete, MdLocalShipping, MdVisibility, MdUploadFile } from "react-icons/md";
import SalesOrderForm from "../Components/SalesOrderForm";
import CreateChallanFromOrderModal from "../Components/CreateChallanFromOrderModal";
import SalesOrderDetailModal from "../Components/SalesOrderDetailModal";
import POImportForm from "../Components/POImportForm";
import {
  getPagedSalesOrdersByCompany, createSalesOrder, updateSalesOrder,
  deleteSalesOrder, setSalesOrderStatus, getSalesOrderPrintData,
} from "../api/salesOrderApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { defaultOrderTemplate } from "../utils/salesDocTemplates";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBorder: "#d0d7e2" };

const FULFIL_COLORS = {
  "Not Delivered": "#5f6d7e", "Partially Delivered": "#f57c00", "Fully Delivered": "#28a745", "Over Delivered": "#7b1fa2",
};
const INVOICE_COLORS = {
  "Uninvoiced": "#5f6d7e", "Partially Invoiced": "#f57c00", "Invoiced": "#28a745",
};

export default function SalesOrderPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canView = has("salesorders.list.view");
  const canCreate = has("salesorders.manage.create");
  const canUpdate = has("salesorders.manage.update");
  const canDelete = has("salesorders.manage.delete");
  const canPrint = has("salesorders.print.view");
  const canMakeChallan = has("challans.manage.create");
  const canImportPo = canCreate && has("poformats.import.create");

  const [orders, setOrders] = useState([]);
  const [exportingId, setExportingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editOrder, setEditOrder] = useState(null);
  const [deliverOrder, setDeliverOrder] = useState(null);
  const [viewOrder, setViewOrder] = useState(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchOrders = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const { data } = await getPagedSalesOrdersByCompany(companyId, params);
      setOrders(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
    } catch { setOrders([]); setTotalCount(0); setTotalPages(0); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => {
    setPage(1); setSearch(""); setStatusFilter("");
    if (!selectedCompany) setOrders([]);
  }, [selectedCompany]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedCompany) fetchOrders(selectedCompany.id, page);
    else setOrders([]);
  }, [selectedCompany, page, search, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => selectedCompany && fetchOrders(selectedCompany.id, page);

  const handleSave = async (payload) => {
    const res = editOrder
      ? await updateSalesOrder(editOrder.id, payload)
      : await createSalesOrder(selectedCompany.id, payload);
    reload();
    notify(editOrder ? "Order updated." : "Order created.", "success");
    return res.data;
  };

  const handleStatus = async (o, status) => {
    try { await setSalesOrderStatus(o.id, status); reload(); }
    catch (err) { notify(err.response?.data?.error || "Failed to update status.", "error"); }
  };

  const handleDelete = async (o) => {
    const ok = await confirm({ title: "Delete Order?", message: `Delete Sales Order #${o.salesOrderNumber}? This cannot be undone.`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try { await deleteSalesOrder(o.id); reload(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); }
  };

  const handlePrint = async (o) => {
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading order...</p>");
    try {
      const { data } = await getSalesOrderPrintData(o.id);
      const html = mergeTemplate(defaultOrderTemplate, data);
      writeAndPrint(w, html);
    } catch { w.close(); notify("Failed to load print data.", "error"); }
  };

  const handleExportPdf = async (o) => {
    if (exportingId) return;
    setExportingId(o.id);
    try {
      const { data } = await getSalesOrderPrintData(o.id);
      const html = mergeTemplate(defaultOrderTemplate, data);
      await exportToPdf(html, `SO # ${o.salesOrderNumber} ${o.clientName}`);
    } catch { notify("Failed to export PDF.", "error"); }
    finally { setExportingId(null); }
  };

  const onChallanCreated = (challan) => {
    setDeliverOrder(null);
    reload();
    notify(`Delivery Challan #${challan.challanNumber} created from this order.`, "success");
  };

  return (
    <div>
      <div style={st.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={st.icon}><MdAssignment size={28} color="#fff" /></div>
          <div>
            <h2 style={st.title}>Sales Orders</h2>
            <p style={st.subtitle}>{selectedCompany ? `${totalCount} order${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` : "Select a company to view orders"}</p>
          </div>
        </div>
        {companies.length > 0 && (canCreate || canImportPo) && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {canCreate && <button style={st.addBtn} onClick={() => selectedCompany && (setEditOrder(null), setShowForm(true))}><MdAdd size={18} /> New Order</button>}
            {canImportPo && <button style={{ ...st.addBtn, background: colors.blue, boxShadow: "0 4px 14px rgba(13,71,161,0.25)" }} onClick={() => selectedCompany && setShowImport(true)}><MdUploadFile size={18} /> Import PO</button>}
          </div>
        )}
      </div>

      {loadingCompanies ? <Spinner label="Loading companies..." /> : companies.length > 0 ? (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""} onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>
          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap">
                <MdSearch size={15} className="filter-search-icon" />
                <input type="text" placeholder="Search Order#, Client, PO..." className="filter-search-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <select className="filter-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">All Status</option>
                {["Open", "Closed", "Cancelled"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          )}
        </>
      ) : <Empty label="No companies available. Add a company first." />}

      {loading ? <Spinner label="Loading orders..." /> : orders.length === 0 && selectedCompany ? (
        <Empty label="No sales orders found." />
      ) : (
        <>
          <div style={st.grid}>
            {orders.map((o) => {
              const canDeliver = canMakeChallan && o.status === "Open" && o.fulfillmentStatus !== "Fully Delivered" && o.fulfillmentStatus !== "Over Delivered";
              const totalOrdered = (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
              const totalDelivered = (o.items || []).reduce((s, i) => s + (Number(i.deliveredQuantity) || 0), 0);
              return (
                <div key={o.id} style={st.card}>
                  <div style={st.cardTop}>
                    <span style={st.oNum}>SO #{o.salesOrderNumber}</span>
                    <span style={{ ...st.badge, background: `${FULFIL_COLORS[o.fulfillmentStatus] || "#5f6d7e"}18`, color: FULFIL_COLORS[o.fulfillmentStatus] || "#5f6d7e" }}>{o.fulfillmentStatus}</span>
                  </div>
                  <div style={st.client}>{o.clientName}</div>
                  <div style={st.metaRow}><span>{fmtDate(o.orderDate)}</span><span>{o.items?.length || 0} item{(o.items?.length || 0) !== 1 ? "s" : ""}</span></div>
                  {o.customerPoNumber && <div style={st.meta}>Customer PO: {o.customerPoNumber}</div>}
                  {o.salesQuoteNumber && <div style={st.meta}>From Quote #{o.salesQuoteNumber}</div>}
                  <div style={st.fulfilBar}>
                    {(o.items || []).slice(0, 4).map((i) => (
                      <div key={i.id} style={st.fulfilRow}>
                        <span style={st.fItem} title={i.description}>{i.description}</span>
                        <span style={st.fQty}>{i.deliveredQuantity}/{i.quantity} {i.unit}</span>
                      </div>
                    ))}
                    {(o.items?.length || 0) > 4 && <div style={st.fMore}>+{o.items.length - 4} more</div>}
                    <div style={st.totalRow}>
                      <span style={st.totalLabel}>Total Quantity</span>
                      <span style={st.totalVal} title="Delivered / Ordered">{fmtQty(totalDelivered)} / {fmtQty(totalOrdered)}</span>
                    </div>
                  </div>
                  <div style={st.statusLine}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                      <span style={{ ...st.statusPill, color: o.status === "Cancelled" ? "#dc3545" : o.status === "Closed" ? "#5f6d7e" : colors.teal }}>{o.status}</span>
                      <span style={{ ...st.invPill, color: INVOICE_COLORS[o.invoiceStatus] || "#5f6d7e", background: `${INVOICE_COLORS[o.invoiceStatus] || "#5f6d7e"}18` }}>{o.invoiceStatus}</span>
                    </span>
                    {o.challanCount > 0 && <span style={st.challanCount}><MdLocalShipping size={13} /> {o.challanCount} challan{o.challanCount !== 1 ? "s" : ""}</span>}
                  </div>
                  <div style={st.actions}>
                    {canView && <button style={st.actBtn} onClick={() => setViewOrder(o)} title="View details"><MdVisibility size={16} /></button>}
                    {canDeliver && <button style={st.deliverBtn} onClick={() => setDeliverOrder(o)}><MdLocalShipping size={15} /> Deliver</button>}
                    {canUpdate && o.isEditable && <button style={st.actBtn} onClick={() => { setEditOrder(o); setShowForm(true); }} title="Edit"><MdEdit size={16} /></button>}
                    {canPrint && <button style={st.actBtn} onClick={() => handlePrint(o)} title="Print"><MdPrint size={16} /></button>}
                    {canPrint && <button style={{ ...st.actBtn, opacity: exportingId === o.id ? 0.5 : 1 }} onClick={() => handleExportPdf(o)} disabled={!!exportingId} title="Download PDF"><MdPictureAsPdf size={16} /></button>}
                    {canUpdate && o.status !== "Cancelled" && (
                      <select style={st.statusSelect} value={o.status} onChange={(e) => handleStatus(o, e.target.value)} title="Set status">
                        {["Open", "Closed", "Cancelled"].map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    )}
                    {canDelete && o.isLatest && o.challanCount === 0 && <button style={{ ...st.actBtn, color: "#dc3545" }} onClick={() => handleDelete(o)} title="Delete"><MdDelete size={16} /></button>}
                  </div>
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div style={st.pagination}>
              <button style={{ ...st.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => setPage(page - 1)}><MdChevronLeft size={20} /> Prev</button>
              <span style={st.pageInfo}>Page {page} of {totalPages} ({totalCount} total)</span>
              <button style={{ ...st.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next <MdChevronRight size={20} /></button>
            </div>
          )}
        </>
      )}

      {showForm && selectedCompany && (
        <SalesOrderForm companyId={selectedCompany.id} order={editOrder} onClose={() => { setShowForm(false); setEditOrder(null); }} onSaved={handleSave} />
      )}
      {showImport && selectedCompany && (
        <POImportForm
          companyId={selectedCompany.id}
          target="salesorder"
          onClose={() => setShowImport(false)}
          onSaved={() => { setShowImport(false); reload(); notify("Sales Order created from PO.", "success"); }}
        />
      )}
      {deliverOrder && (
        <CreateChallanFromOrderModal order={deliverOrder} onClose={() => setDeliverOrder(null)} onCreated={onChallanCreated} />
      )}
      {viewOrder && (
        <SalesOrderDetailModal
          order={viewOrder}
          canDeliver={canMakeChallan && viewOrder.status === "Open" && viewOrder.fulfillmentStatus !== "Fully Delivered" && viewOrder.fulfillmentStatus !== "Over Delivered"}
          onClose={() => setViewOrder(null)}
          onPrint={canPrint ? handlePrint : undefined}
          onEdit={canUpdate ? (o) => { setEditOrder(o); setShowForm(true); } : undefined}
          onDeliver={canMakeChallan ? (o) => setDeliverOrder(o) : undefined}
        />
      )}
    </div>
  );
}

const fmtDate = (d) => { if (!d) return ""; const dt = new Date(d); const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${String(dt.getDate()).padStart(2,"0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; };
const fmtQty = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(4)).toString(); };
const Spinner = ({ label }) => <div style={st.loading}><div style={st.spin} /><span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>{label}</span></div>;
const Empty = ({ label }) => <div style={st.empty}><MdAssignment size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>{label}</p></div>;

const st = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  icon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${colors.teal}, ${colors.blue})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${colors.teal}, ${colors.blue})`, color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(0,137,123,0.25)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: "1rem" },
  card: { border: `1px solid ${colors.cardBorder}`, borderRadius: 14, padding: "1rem", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  oNum: { fontWeight: 800, fontSize: "1rem", color: colors.teal },
  badge: { fontSize: "0.72rem", fontWeight: 700, padding: "0.15rem 0.6rem", borderRadius: 20 },
  client: { marginTop: "0.5rem", fontWeight: 600, color: colors.textPrimary, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  metaRow: { display: "flex", justifyContent: "space-between", marginTop: "0.35rem", fontSize: "0.8rem", color: colors.textSecondary },
  meta: { marginTop: "0.2rem", fontSize: "0.78rem", color: colors.textSecondary },
  fulfilBar: { marginTop: "0.6rem", borderTop: `1px dashed ${colors.cardBorder}`, paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.2rem" },
  fulfilRow: { display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.78rem" },
  fItem: { color: colors.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  fQty: { fontWeight: 700, color: colors.textPrimary, flexShrink: 0 },
  fMore: { fontSize: "0.72rem", color: colors.textSecondary, fontStyle: "italic" },
  totalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: `1px solid ${colors.cardBorder}` },
  totalLabel: { fontSize: "0.8rem", fontWeight: 700, color: colors.textPrimary },
  totalVal: { fontSize: "0.85rem", fontWeight: 800, color: colors.teal },
  statusLine: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" },
  statusPill: { fontSize: "0.78rem", fontWeight: 700 },
  invPill: { fontSize: "0.7rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 20 },
  challanCount: { display: "inline-flex", alignItems: "center", gap: "0.2rem", fontSize: "0.75rem", color: colors.textSecondary },
  actions: { display: "flex", gap: "0.4rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "center" },
  deliverBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.4rem 0.7rem", borderRadius: 8, border: "none", background: colors.teal, color: "#fff", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  actBtn: { display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, cursor: "pointer" },
  statusSelect: { padding: "0.3rem 0.4rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.78rem", color: colors.textSecondary, background: "#fff", cursor: "pointer" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 0" },
  spin: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.teal, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
};
