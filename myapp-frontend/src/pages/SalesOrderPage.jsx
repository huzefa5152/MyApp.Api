import DocumentLinesNavigation from "../Components/DocumentLinesNavigation";
import { useState, useEffect, useCallback } from "react";
import { richTextToPlain } from "../utils/richText";
import { useNavigate } from "react-router-dom";
import { MdAssignment, MdAdd, MdPrint, MdPictureAsPdf, MdEdit, MdDelete, MdLocalShipping, MdVisibility, MdUploadFile, MdGridOn, MdReceiptLong, MdLink } from "react-icons/md";
import { saveAs } from "file-saver";
import { hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import SalesOrderForm from "../Components/SalesOrderForm";
import CreateChallanFromOrderModal from "../Components/CreateChallanFromOrderModal";
import AttachChallanToOrderModal from "../Components/AttachChallanToOrderModal";
import InvoiceForm from "../Components/InvoiceForm";
import SalesOrderDetailModal from "../Components/SalesOrderDetailModal";
import Pagination from "../Components/Pagination";
import POImportForm from "../Components/POImportForm";
import AttachmentBadge from "../Components/AttachmentBadge";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import {
  getSalesOrderById, getPagedSalesOrdersByCompany, createSalesOrder, updateSalesOrder,
  deleteSalesOrder, setSalesOrderStatus, getSalesOrderPrintData,
} from "../api/salesOrderApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { defaultOrderTemplate } from "../utils/salesDocTemplates";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import { PageHeader, CompanyPicker, Button, IconButton, Toolbar, ToolbarSpacer, SearchBox, Card, EmptyState, Loading } from "../ui/Kit";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";

const FULFIL_COLORS = {
  "Not Delivered": "#5f6d7e", "Partially Delivered": "#f57c00", "Fully Delivered": "#28a745", "Over Delivered": "#7b1fa2",
};
const INVOICE_COLORS = {
  "Uninvoiced": "#5f6d7e", "Partially Invoiced": "#f57c00", "Invoiced": "#28a745",
};

export default function SalesOrderPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
  const tplPicker = usePrintTemplates("SalesOrder");
  const { has } = usePermissions();
  const canView = has("salesorders.list.view");
  const canCreate = has("salesorders.manage.create");
  const canUpdate = has("salesorders.manage.update");
  const canDelete = has("salesorders.manage.delete");
  const canPrint = has("salesorders.print.view");
  const canMakeChallan = has("challans.manage.create");
  // Attach an unlinked challan = mutating the challan's linkage/PO/status.
  const canAttach = has("challans.manage.update");
  // Generate Bill uses the same permissions as the bill-creation forms.
  const canBill = has("bills.manage.create") || has("bills.manage.create.standalone");
  const canImportPo = canCreate && has("poformats.import.create");

  const [orders, setOrders] = useState([]);
  const [exportingId, setExportingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editOrder, setEditOrder] = useState(null);
  const [deliverOrder, setDeliverOrder] = useState(null);
  const [billOrder, setBillOrder] = useState(null);
  const [attachOrder, setAttachOrder] = useState(null);
  const [viewOrder, setViewOrder] = useState(null);
  useEffect(() => { const id = Number(new URLSearchParams(window.location.search).get("viewOrder")); if (id > 0) getSalesOrderById(id).then(({data}) => setViewOrder(data)).catch(() => notify("Could not open sales order.", "error")); }, []);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("salesOrders");
  const [observedSize, setObservedSize] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [hasExcelTpl, setHasExcelTpl] = useState(false);
  const [attachTarget, setAttachTarget] = useState(null);
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(selectedCompany?.id, "SalesOrder", orders.map((o) => o.id));

  const fetchOrders = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (pageSize) params.pageSize = pageSize;
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const { data } = await getPagedSalesOrdersByCompany(companyId, params);
      setOrders(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
      setObservedSize(data.pageSize ?? null);
    } catch { setOrders([]); setTotalCount(0); setTotalPages(0); }
    finally { setLoading(false); }
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => {
    setPage(1); setSearch(""); setStatusFilter("");
    if (selectedCompany) {
      hasExcelTemplate(selectedCompany.id, "SalesOrder").then((r) => setHasExcelTpl(!!r.data.hasExcelTemplate)).catch(() => setHasExcelTpl(false));
    } else { setOrders([]); setHasExcelTpl(false); }
  }, [selectedCompany]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedCompany) fetchOrders(selectedCompany.id, page);
    else setOrders([]);
  }, [selectedCompany, page, pageSize, search, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading order...</p>");
    try {
      const { data } = await getSalesOrderPrintData(o.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(o)?.htmlContent || defaultOrderTemplate, data);
      writeAndPrint(w, html);
    } catch { w.close(); notify("Failed to load print data.", "error"); }
  };

  const handleExportExcel = async (o) => {
    if (exportingId) return;
    setExportingId(o.id + "-excel");
    try {
      const { data } = await getSalesOrderPrintData(o.id);
      const res = await exportExcel(selectedCompany.id, "SalesOrder", data);
      saveAs(res.data, `SO # ${o.salesOrderNumber} ${o.clientName}.xlsx`);
    } catch { notify("Failed to export Excel.", "error"); }
    finally { setExportingId(null); }
  };

  const handleExportPdf = async (o) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (exportingId) return;
    setExportingId(o.id);
    try {
      const { data } = await getSalesOrderPrintData(o.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(o)?.htmlContent || defaultOrderTemplate, data);
      await exportToPdf(html, `SO # ${o.salesOrderNumber} ${o.clientName}`);
    } catch { notify("Failed to export PDF.", "error"); }
    finally { setExportingId(null); }
  };

  const onChallanCreated = (challan) => {
    setDeliverOrder(null);
    reload();
    notify(`Delivery Challan #${challan.challanNumber} created from this order.`, "success");
  };

  const onAttached = (updatedOrder) => {
    setAttachOrder(null);
    reload();
    notify(`Challan attached to SO #${updatedOrder?.salesOrderNumber ?? ""}.`, "success");
  };

  const viewChallans = (o) => navigate(`/challans?salesOrderId=${o.id}`);

  return (
    <DocumentLinesNavigation type="order">
    <div>
      <PageHeader
        icon={MdAssignment}
        tone="teal"
        title="Sales Orders"
        subtitle={selectedCompany ? `${totalCount} order${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` : "Select a company to view orders"}
        actions={companies.length > 0 && (canCreate || canImportPo) ? (
          <>
            {canCreate && <Button variant="primary" icon={MdAdd} onClick={() => selectedCompany && (setEditOrder(null), setShowForm(true))}>New Order</Button>}
            {canImportPo && <Button variant="secondary" icon={MdUploadFile} onClick={() => selectedCompany && setShowImport(true)}>Import Customer PO</Button>}
          </>
        ) : null}
      />

      {loadingCompanies ? <Loading>Loading companies...</Loading> : companies.length > 0 ? (
        <>
          <CompanyPicker />
          {selectedCompany && (
            <Toolbar>
              <SearchBox placeholder="Search Order#, Client, PO..." value={search} onChange={(text) => { setSearch(text); setPage(1); }} />
              <select className="k-select" aria-label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">All Status</option>
                {["Open", "Closed", "Cancelled"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <ToolbarSpacer />
              <PrintTemplateSelect picker={tplPicker} />
            </Toolbar>
          )}
        </>
      ) : <EmptyState icon={MdAssignment}>No companies available. Add a company first.</EmptyState>}

      {loading ? <Loading>Loading orders...</Loading> : orders.length === 0 && selectedCompany ? (
        <EmptyState icon={MdAssignment}>No sales orders found.</EmptyState>
      ) : (
        <>
          <div style={st.grid}>
            {orders.map((o) => {
              const canDeliver = canMakeChallan && o.status === "Open" && o.fulfillmentStatus !== "Fully Delivered" && o.fulfillmentStatus !== "Over Delivered";
              const canBillThis = canBill && (o.billableChallanCount || 0) > 0;
              const canAttachThis = canAttach && o.status !== "Cancelled";
              const totalOrdered = (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
              const totalDelivered = (o.items || []).reduce((s, i) => s + (Number(i.deliveredQuantity) || 0), 0);
              return (
                <Card key={o.id} style={st.card}>
                  <div style={st.cardTop}>
                    <span style={st.oNum}>SO #{o.salesOrderNumber}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <AttachmentBadge count={attachCounts[o.id]} onClick={() => setAttachTarget(o)} />
                      <span style={{ ...st.badge, background: `${FULFIL_COLORS[o.fulfillmentStatus] || "#5f6d7e"}18`, color: FULFIL_COLORS[o.fulfillmentStatus] || "#5f6d7e" }}>{o.fulfillmentStatus}</span>
                    </div>
                  </div>
                  <div style={st.client}>{o.clientName}</div>
                  <div style={st.metaRow}><span>{fmtDate(o.orderDate)}</span><span>{o.items?.length || 0} item{(o.items?.length || 0) !== 1 ? "s" : ""}</span></div>
                  {o.customerPoNumber && <div style={st.meta}>Customer PO: {o.customerPoNumber}</div>}
                  {o.salesQuoteNumber && <div style={st.meta}>From Quote #{o.salesQuoteNumber}</div>}
                  <div style={st.fulfilBar}>
                    {(o.items || []).slice(0, 4).map((i) => (
                      <div key={i.id} style={st.fulfilRow}>
                        <span style={st.fItem} title={richTextToPlain(i.description)}>{richTextToPlain(i.description)}</span>
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
                      <span style={{ ...st.statusPill, color: o.status === "Cancelled" ? "#dc3545" : o.status === "Closed" ? "#5f6d7e" : "var(--k-teal)" }}>{o.status}</span>
                      <span style={{ ...st.invPill, color: INVOICE_COLORS[o.invoiceStatus] || "#5f6d7e", background: `${INVOICE_COLORS[o.invoiceStatus] || "#5f6d7e"}18` }}>{({ Invoiced: "Billed", "Partially Invoiced": "Partially billed", Uninvoiced: "Unbilled" })[o.invoiceStatus] || o.invoiceStatus}</span>
                    </span>
                    {o.challanCount > 0 && (
                      <button style={st.challanCountBtn} onClick={() => viewChallans(o)} title="View this order's challans">
                        <MdLocalShipping size={13} /> {o.challanCount} challan{o.challanCount !== 1 ? "s" : ""}
                      </button>
                    )}
                  </div>
                  <div style={st.actions}>
                    {canView && <IconButton style={st.actBtn} icon={MdVisibility} size={16} label="View details" onClick={() => setViewOrder(o)} />}
                    {canDeliver && <Button variant="teal" size="sm" icon={MdLocalShipping} onClick={() => setDeliverOrder(o)}>Deliver</Button>}
                    {canBillThis && <Button variant="primary" size="sm" icon={MdReceiptLong} onClick={() => setBillOrder(o)} title="Generate a bill from this order's delivered challans">Bill</Button>}
                    {canAttachThis && <IconButton style={st.actBtn} icon={MdLink} size={16} label="Attach an existing (No-PO) challan to this order" onClick={() => setAttachOrder(o)} />}
                    {canUpdate && o.isEditable && <IconButton style={st.actBtn} icon={MdEdit} size={16} label="Edit" onClick={() => { setEditOrder(o); setShowForm(true); }} />}
                    {canPrint && <IconButton style={st.actBtn} icon={MdPrint} size={16} label={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"} onClick={() => handlePrint(o)} disabled={tplPicker.noTemplate} />}
                    {canPrint && <IconButton style={{ ...st.actBtn, opacity: exportingId === o.id ? 0.5 : undefined }} icon={MdPictureAsPdf} size={16} label={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Download PDF"} onClick={() => handleExportPdf(o)} disabled={tplPicker.noTemplate || !!exportingId} />}
                    {canPrint && hasExcelTpl && <IconButton style={{ ...st.actBtn, color: "#2e7d32", opacity: exportingId === o.id + "-excel" ? 0.5 : undefined }} icon={MdGridOn} size={16} label="Download Excel" onClick={() => handleExportExcel(o)} disabled={!!exportingId} />}
                    {canUpdate && o.status !== "Cancelled" && (
                      <select className="k-select" style={st.statusSelect} value={o.status} onChange={(e) => handleStatus(o, e.target.value)} title="Set status" aria-label="Set status">
                        {["Open", "Closed", "Cancelled"].map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    )}
                    {canDelete && o.isLatest && o.challanCount === 0 && <IconButton danger style={{ ...st.actBtn, color: "var(--k-danger)" }} icon={MdDelete} size={16} label="Delete" onClick={() => handleDelete(o)} />}
                  </div>
                </Card>
              );
            })}
          </div>
          {totalCount > PAGE_SIZE_OPTIONS[0] && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={totalCount}
              onPage={setPage}
              pageSize={pageSize ?? observedSize}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
          )}
        </>
      )}

      {attachTarget && selectedCompany && (
        <AttachmentQuickModal
          companyId={selectedCompany.id}
          entityType="SalesOrder"
          entityId={attachTarget.id}
          title={`SO #${attachTarget.salesOrderNumber} — Attachments`}
          onClose={() => { setAttachTarget(null); refreshAttachCounts(); }}
        />
      )}

      {showForm && selectedCompany && (
        <SalesOrderForm companyId={selectedCompany.id} order={editOrder} onClose={() => { setShowForm(false); setEditOrder(null); refreshAttachCounts(); }} onSaved={handleSave} />
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
        <CreateChallanFromOrderModal order={deliverOrder} companyId={selectedCompany?.id} onClose={() => setDeliverOrder(null)} onCreated={onChallanCreated} />
      )}
      {attachOrder && (
        <AttachChallanToOrderModal order={attachOrder} companyId={selectedCompany?.id} onClose={() => setAttachOrder(null)} onAttached={onAttached} />
      )}
      {billOrder && selectedCompany && (
        <InvoiceForm
          companyId={selectedCompany.id}
          company={selectedCompany}
          prefillSalesOrderId={billOrder.id}
          billsMode={true}
          onClose={() => setBillOrder(null)}
          onSaved={() => { setBillOrder(null); notify("Bill created.", "success"); reload(); }}
        />
      )}
      {viewOrder && (
        <SalesOrderDetailModal onChanged={updated => { setViewOrder(updated); reload(); }}
          order={viewOrder}
          companyId={selectedCompany?.id}
          canDeliver={canMakeChallan && viewOrder.status === "Open" && viewOrder.fulfillmentStatus !== "Fully Delivered" && viewOrder.fulfillmentStatus !== "Over Delivered"}
          canBill={canBill && (viewOrder.billableChallanCount || 0) > 0}
          canAttach={canAttach && viewOrder.status !== "Cancelled"}
          onClose={() => setViewOrder(null)}
          onPrint={canPrint ? handlePrint : undefined}
          onEdit={canUpdate ? (o) => { setEditOrder(o); setShowForm(true); } : undefined}
          onDeliver={canMakeChallan ? (o) => setDeliverOrder(o) : undefined}
          onGenerateBill={() => { setViewOrder(null); setBillOrder(viewOrder); }}
          onAttach={() => { setViewOrder(null); setAttachOrder(viewOrder); }}
          onViewChallans={() => { setViewOrder(null); viewChallans(viewOrder); }}
        />
      )}
    </div>
    </DocumentLinesNavigation>
  );
}

const fmtDate = (d) => { if (!d) return ""; const dt = new Date(d); const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${String(dt.getDate()).padStart(2,"0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; };
const fmtQty = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(4)).toString(); };
const st = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: "var(--k-gap)" },
  card: { marginTop: 0 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  oNum: { fontWeight: 800, fontSize: "calc(var(--k-font) + 0.1rem)", color: "var(--k-teal)" },
  badge: { fontSize: "0.72rem", fontWeight: 700, padding: "0.15rem 0.6rem", borderRadius: 20 },
  client: { marginTop: "0.5rem", fontWeight: 600, color: "var(--k-ink)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  metaRow: { display: "flex", justifyContent: "space-between", marginTop: "0.35rem", fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  meta: { marginTop: "0.2rem", fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  fulfilBar: { marginTop: "0.6rem", borderTop: "1px dashed var(--k-line)", paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.2rem" },
  fulfilRow: { display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "var(--k-font-sm)" },
  fItem: { color: "var(--k-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 },
  fQty: { fontWeight: 700, color: "var(--k-ink)", flexShrink: 0 },
  fMore: { fontSize: "0.72rem", color: "var(--k-muted)", fontStyle: "italic" },
  totalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid var(--k-line)" },
  totalLabel: { fontSize: "var(--k-font-sm)", fontWeight: 700, color: "var(--k-ink)" },
  totalVal: { fontSize: "var(--k-font)", fontWeight: 800, color: "var(--k-teal)" },
  statusLine: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: "0.5rem" },
  statusPill: { fontSize: "var(--k-font-sm)", fontWeight: 700 },
  invPill: { fontSize: "0.7rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 20 },
  challanCountBtn: { display: "inline-flex", alignItems: "center", gap: "0.2rem", fontSize: "0.75rem", color: "var(--k-blue)", background: "none", border: "none", padding: 0, minHeight: 0, cursor: "pointer", fontWeight: 600, textDecoration: "underline", boxShadow: "none" },
  actions: { display: "flex", gap: "0.4rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "center" },
  actBtn: { borderColor: "var(--k-line)", background: "var(--k-surface)", color: "var(--k-blue)" },
  statusSelect: { width: "auto", minHeight: "calc(var(--k-btn-h) - 8px)", fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
};
