import DocumentLinesNavigation from "../Components/DocumentLinesNavigation";
import { useState, useEffect, useCallback } from "react";
import { renderRichTextHtml } from "../utils/richText";
import { useSearchParams } from "react-router-dom";
import { MdDescription, MdAdd, MdBusiness, MdUploadFile } from "react-icons/md";
import ChallanList from "../Components/ChallanList";
import ChallanTable from "../Components/ChallanTable";
import ChallanForm from "../Components/ChallanForm";
import ChallanEditForm from "../Components/ChallanEditForm";
import POImportForm from "../Components/POImportForm";
import InvoiceForm from "../Components/InvoiceForm";
import AttachChallanToOrderModal from "../Components/AttachChallanToOrderModal";
import SearchableSelect from "../Components/SearchableSelect";
import ViewModeToggle from "../Components/ViewModeToggle";
import Pagination from "../Components/Pagination";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import { useListViewMode } from "../hooks/useListViewMode";
import {
  getPagedChallansByCompany,
  createDeliveryChallan,
  cancelChallan,
  deleteChallan,
  duplicateChallan,
  getChallanPrintData,
} from "../api/challanApi";
import { getClientsByCompany } from "../api/clientApi";
import { createChallanFromOrder, getSalesOrdersForPicker } from "../api/salesOrderApi";
import { hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultChallanTemplate } from "../utils/defaultTemplates";
import { exportToPdf } from "../utils/exportUtils";
import { saveAs } from "file-saver";
import { PageHeader, CompanyPicker, Button, Toolbar, ToolbarSpacer, SearchBox, EmptyState, Loading } from "../ui/Kit";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import PageSizeSelect from "../Components/PageSizeSelect";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import DuplicateChallanDialog from "../Components/DuplicateChallanDialog";
import useUi2 from "../ui2/useUi2";
import ChallansV2 from "../ui2/ChallansV2";

export default function ChallanPage() {
  const confirm = useConfirm();
  const ui2 = useUi2(); // redesigned structure when the user's theme asks for it
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
  const tplPicker = usePrintTemplates("Challan");
  const { has } = usePermissions();
  const canCreate = has("challans.manage.create");
  const canUpdate = has("challans.manage.update");
  const canDelete = has("challans.manage.delete");
  const canPrint = has("challans.print.view");
  // Client-filter dropdown calls GET /api/clients/company/{id} which is
  // gated by clients.manage.view. View-only roles (e.g. tax consultant
  // with just challans.list.view) would 403 on that call AND see an
  // empty non-functional dropdown — skip both the fetch and the UI.
  const canViewClients = has("clients.manage.view");
  const [viewMode, setViewMode, isBigScreen] = useListViewMode("challans");
  const [clients, setClients] = useState([]);
  const [challans, setChallans] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editChallan, setEditChallan] = useState(null);
  const [loadingChallans, setLoadingChallans] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false); // presentation only: lets the redesigned view offer "Try again"
  // Generate-Bill shortcut: holds the challanId to prefill into InvoiceForm
  // when the user clicks the per-card button.
  const [generateBillChallanId, setGenerateBillChallanId] = useState(null);
  // Quick-attachments: target challan for the modal, plus a shared count map
  // over the currently-displayed rows (both card + table views render the
  // same `challans` array, so one hook covers both).
  const [attachTarget, setAttachTarget] = useState(null);
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(selectedCompany?.id, "DeliveryChallan", challans.map((c) => c.id));

  // Pagination & filters
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [pageSize, setPageSize] = useState(10); // server-echoed size (drives page math)
  const [userPageSize, setUserPageSize] = usePageSize("challans"); // operator-chosen override
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Sales Order filter — driven by the searchable dropdown and by the
  // ?salesOrderId= query param (the "View Challans" shortcut from the SO page).
  const [searchParams, setSearchParams] = useSearchParams();
  const [salesOrderFilter, setSalesOrderFilter] = useState(searchParams.get("salesOrderId") || "");
  const [orders, setOrders] = useState([]);
  // "Link to Sales Order" — attach an unlinked challan to an order.
  const [linkChallan, setLinkChallan] = useState(null);
  const canLinkOrder = canUpdate && has("salesorders.list.view");
  const [hasExcelTpl, setHasExcelTpl] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  // Set to the challan id while a duplicate POST is in flight. Acts as
  // the click-lock — the button on every row disables itself when this
  // is non-null, so the operator can't fire two duplicate requests in
  // parallel (which would otherwise create two clones with the same
  // shared challan number).
  const [duplicatingId, setDuplicatingId] = useState(null);
  // Source challan for the count-input dialog. null = dialog closed.
  // 2026-05-08: replaces the legacy yes/no confirm so the operator can
  // request N copies in a single round-trip.
  const [duplicateSource, setDuplicateSource] = useState(null);

  const fetchClients = async (companyId) => {
    // Skip the call entirely for roles without clients.manage.view —
    // avoids a guaranteed 403 in the network log. Dropdown is hidden.
    if (!canViewClients) { setClients([]); return; }
    try {
      const { data } = await getClientsByCompany(companyId);
      setClients(data);
    } catch { setClients([]); }
  };

  const fetchChallans = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoadingChallans(true);
    setLoadFailed(false);
    try {
      const params = { page: pg || page };
      if (userPageSize) params.pageSize = userPageSize;
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (clientFilter) params.clientId = clientFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (salesOrderFilter) params.salesOrderId = salesOrderFilter;
      const { data } = await getPagedChallansByCompany(companyId, params);
      setChallans(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
      setPageSize(data.pageSize);
    } catch {
      setChallans([]);
      setTotalCount(0);
      setTotalPages(0);
      setLoadFailed(true);
    } finally {
      setLoadingChallans(false);
    }
  }, [page, userPageSize, search, statusFilter, clientFilter, dateFrom, dateTo, salesOrderFilter]);

  useEffect(() => {
    if (selectedCompany) {
      fetchClients(selectedCompany.id);
      setPage(1);
      fetchChallans(selectedCompany.id, 1);
      hasExcelTemplate(selectedCompany.id, "Challan")
        .then(r => setHasExcelTpl(r.data.hasExcelTemplate))
        .catch(() => setHasExcelTpl(false));
      // Sales Orders for the SO filter dropdown (searchable). Skipped for
      // roles without salesorders.list.view.
      if (has("salesorders.list.view")) {
        getSalesOrdersForPicker(selectedCompany.id).then(setOrders).catch(() => setOrders([]));
      } else {
        setOrders([]);
      }
    } else {
      setChallans([]);
      setClients([]);
      setHasExcelTpl(false);
      setOrders([]);
    }
  }, [selectedCompany]);

  // Re-fetch when filters or page change
  useEffect(() => {
    if (selectedCompany) fetchChallans(selectedCompany.id, page);
  }, [page, userPageSize, search, statusFilter, clientFilter, dateFrom, dateTo, salesOrderFilter]);

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("");
    setClientFilter("");
    setDateFrom("");
    setDateTo("");
    setSalesOrderFilter("");
    if (searchParams.get("salesOrderId")) setSearchParams({}, { replace: true });
    setPage(1);
  };

  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  // Sales Order filter: keep the URL query param in sync so the filter
  // survives a refresh / is shareable, and reset to page 1.
  const handleSalesOrderFilter = (id) => {
    setSalesOrderFilter(id || "");
    const next = new URLSearchParams(searchParams);
    if (id) next.set("salesOrderId", id); else next.delete("salesOrderId");
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const handleAddChallan = () => { if (selectedCompany) setShowModal(true); };

  const handleSaveChallan = async (payload) => {
    if (!selectedCompany) return;
    let created;
    if (payload.salesOrderId) {
      // Fulfil a Sales Order — route through its create-challan flow so the
      // challan links back to each ordered line and the order auto-closes
      // when fully delivered. Only ordered lines are delivered this way.
      const lines = (payload.items || [])
        .filter((i) => i.salesOrderItemId && Number(i.quantity) > 0)
        .map((i) => ({ salesOrderItemId: i.salesOrderItemId, quantity: i.quantity,
          supplierId: i.supplierId ?? null, actualUnitCost: i.actualUnitCost ?? null }));
      const { data } = await createChallanFromOrder(payload.salesOrderId, {
        deliveryDate: payload.deliveryDate,
        site: payload.site,
        notes: payload.notes,
        lines,
      });
      created = data;
    } else {
      const { data } = await createDeliveryChallan(selectedCompany.id, payload);
      created = data;
    }
    setPage(1);
    fetchChallans(selectedCompany.id, 1);
    // Return the created challan so the form can flush staged attachments
    // against the new id, then the form closes itself via onClose.
    return created;
  };

  const handleCancel = async (challan) => {
    const ok = await confirm({ title: "Cancel Challan?", message: `Cancel Challan #${challan.challanNumber}? This will mark it as cancelled.`, variant: "warning", confirmText: "Cancel Challan" });
    if (!ok) return;
    try {
      await cancelChallan(challan.id);
      fetchChallans(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to cancel challan.", "error");
    }
  };

  const handleDelete = async (challan) => {
    const ok = await confirm({ title: "Delete Challan?", message: `Delete Challan #${challan.challanNumber}? This cannot be undone.`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try {
      await deleteChallan(challan.id);
      fetchChallans(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete challan.", "error");
    }
  };

  // Print only once every image in the popup has loaded — otherwise
  // w.print() fires before the company logo / product images decode, so the
  // first print comes out with them blank (they appear only on a 2nd/3rd
  // attempt once cached) and on production the network-fetched logo misses
  // consistently. `error` listeners + a 3s safety timeout prevent a broken or
  // slow image from ever blocking the print dialog.
  const printWindowWhenImagesReady = (w) => {
    const imgs = Array.from(w.document.images || []);
    const ready = Promise.all(imgs.map((img) => (
      img.complete && img.naturalHeight !== 0
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          })
    )));
    const safety = new Promise((resolve) => setTimeout(resolve, 3000));
    Promise.race([ready, safety]).then(() => {
      try { w.focus(); w.print(); } catch { /* popup already closed */ }
    });
  };

  const handlePrint = async (challan) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (!selectedCompany) { notify("No company selected.", "error"); return; }
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading challan...</p>");
    try {
      const { data } = await getChallanPrintData(challan.id);
      const template = tplPicker.resolveTemplate(challan)?.htmlContent || defaultChallanTemplate;
      const html = mergeTemplate(template, data);
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.onafterprint = () => w.close();
      printWindowWhenImagesReady(w);
    } catch {
      w.close();
      notify("Failed to load print data.", "error");
    }
  };

  const handleEditItems = (challan) => setEditChallan(challan);
  const handleEditSaved = () => {
    setEditChallan(null);
    fetchChallans(selectedCompany.id, page);
    refreshAttachCounts();
  };

  // Click handler: open the count-input dialog. Defensive bail if a
  // previous duplicate POST is still in flight (the button on every
  // row also locks via the duplicatingId disable, so this is belt-
  // and-braces).
  const handleDuplicate = (challan) => {
    if (duplicatingId) return;
    setDuplicateSource(challan);
  };

  // Confirm-handler from DuplicateChallanDialog. Receives the chosen
  // count (1..20). Server returns a single object when count === 1
  // (back-compat) or an array when count > 1.
  const handleDuplicateConfirm = async (count) => {
    const challan = duplicateSource;
    setDuplicateSource(null);
    if (!challan || !count || count < 1) return;
    setDuplicatingId(challan.id);
    try {
      const { data } = await duplicateChallan(challan.id, count);
      const clones = Array.isArray(data) ? data : [data];
      setPage(1);
      await fetchChallans(selectedCompany.id, 1);
      // For count === 1, jump straight into the edit form so the operator
      // can tweak PO/items — same UX as before. For bulk count, just refresh
      // the list and toast; the operator typically wants to leave the dialog
      // batch-applied as-is and edit them one at a time afterwards.
      if (count === 1) {
        setEditChallan(clones[0]);
        notify(
          `Challan #${clones[0].challanNumber} duplicated. Update the PO and items, then save.`,
          "success"
        );
      } else {
        notify(
          `Created ${clones.length} copies of Challan #${challan.challanNumber}.`,
          "success"
        );
      }
    } catch (err) {
      notify(err.response?.data?.error || "Failed to duplicate challan.", "error");
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleExportPdf = async (challan) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (exportingId) return;
    setExportingId(challan.id + "-pdf");
    try {
      const { data } = await getChallanPrintData(challan.id);
      const template = tplPicker.resolveTemplate(challan)?.htmlContent || defaultChallanTemplate;
      const html = mergeTemplate(template, data);
      const name = `DC # ${data.challanNumber} ${data.clientName}`;
      await exportToPdf(html, name);
    } catch {
      notify("Failed to export PDF.", "error");
    } finally {
      setExportingId(null);
    }
  };

  const handleExportExcel = async (challan) => {
    if (exportingId) return;
    setExportingId(challan.id + "-excel");
    try {
      const { data } = await getChallanPrintData(challan.id);
      const res = await exportExcel(selectedCompany.id, "Challan", data);
      saveAs(res.data, `DC # ${data.challanNumber} ${data.clientName}.xlsx`);
    } catch {
      notify("Failed to export Excel.", "error");
    } finally {
      setExportingId(null);
    }
  };

  const hasFilters = search || statusFilter || clientFilter || dateFrom || dateTo || salesOrderFilter;

  // SO dropdown respects the client filter: all clients → every SO; a client
  // selected → only that client's SOs.
  const orderOptions = orders
    .filter((o) => !clientFilter || String(o.clientId) === String(clientFilter))
    .map((o) => ({
      id: o.id,
      label: `SO #${o.salesOrderNumber} — ${o.clientName}`,
    }));

  // Changing the client filter clears a selected SO that belongs to a different
  // client (so the SO filter never contradicts the client filter).
  const handleClientFilter = (e) => {
    const val = e.target.value;
    setClientFilter(val);
    setPage(1);
    if (val && salesOrderFilter) {
      const so = orders.find((o) => String(o.id) === String(salesOrderFilter));
      if (!so || String(so.clientId) !== String(val)) handleSalesOrderFilter("");
    }
  };

  const v2 = ui2 && {
    companies, selectedCompany, loadingCompanies, totalCount, canCreate,
    canImport: canCreate && has("poformats.import.create"), canViewClients, canViewSalesOrders: has("salesorders.list.view"),
    onNew: handleAddChallan, onImport: () => selectedCompany && setShowImport(true),
    search, statusFilter, clientFilter, dateFrom, dateTo, salesOrderFilter, clients, orderOptions,
    setSearch, setStatusFilter, setDateFrom, setDateTo, handleFilterChange, handleClientFilter, handleSalesOrderFilter,
    hasFilters: Boolean(hasFilters), resetFilters, tplPicker, isBigScreen, viewMode, setViewMode,
    loadingChallans, loadFailed, onRetry: () => selectedCompany && fetchChallans(selectedCompany.id, page), challans,
    page, totalPages, pageSize: userPageSize ?? pageSize, setPage, onPageSize: (n) => { setUserPageSize(n); setPage(1); },
    onCancel: handleCancel, onDelete: handleDelete, onPrint: handlePrint, onEditItems: handleEditItems, onExportPdf: handleExportPdf,
    onExportExcel: hasExcelTpl ? handleExportExcel : null, onGenerateBill: (c) => setGenerateBillChallanId(c.id),
    onDuplicate: handleDuplicate, canLinkOrder, onLinkOrder: (c) => setLinkChallan(c), exportingId, duplicatingId,
    printDisabled: tplPicker.noTemplate, printDisabledReason: tplPicker.noTemplateReason,
    attachCounts, onAttach: (c) => setAttachTarget(c),
  };

  return (
    <DocumentLinesNavigation type="challan" inline={ui2}>
    <div className={ui2 ? "u2" : undefined}>
      {ui2 ? <ChallansV2 {...v2} /> : (<>
      <PageHeader
        icon={MdDescription}
        tone="blue"
        title="Delivery Challans"
        subtitle={selectedCompany
          ? `${totalCount} challan${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
          : "Select a company to view challans"}
        actions={companies.length > 0 && (
          <>
            {canCreate && <Button variant="primary" icon={MdAdd} onClick={handleAddChallan}>New Challan</Button>}
            {canCreate && has("poformats.import.create") && (
              <Button variant="teal" icon={MdUploadFile} onClick={() => selectedCompany && setShowImport(true)}>Import PO</Button>
            )}
          </>
        )}
      />

      {loadingCompanies ? (
        <Loading>Loading companies…</Loading>
      ) : companies.length > 0 ? (
        <>
          <CompanyPicker />

          {/* Filters + view-mode toggle */}
          {selectedCompany && (
            <Toolbar>
              <SearchBox value={search} onChange={(text) => handleFilterChange(setSearch)({ target: { value: text } })} placeholder="Search DC#, Client, PO..." />
              <select className="k-select" aria-label="Status" value={statusFilter} onChange={handleFilterChange(setStatusFilter)}>
                <option value="">All Status</option>
                <option value="Pending">Pending</option>
                <option value="Imported">Imported</option>
                <option value="No PO">No PO</option>
                <option value="Setup Required">Setup Required</option>
                <option value="Invoiced">Billed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              {canViewClients && (
                <div style={{ flex: "1 1 190px", maxWidth: 240 }}>
                  <SearchableClientSelect clients={clients} value={clientFilter} placeholder="All Clients"
                    onChange={(id) => handleClientFilter({ target: { value: String(id) } })} />
                </div>
              )}
              {has("salesorders.list.view") && (
                <div style={{ flex: "1 1 190px", maxWidth: 240 }}>
                  <SearchableSelect
                    items={orderOptions}
                    value={salesOrderFilter}
                    onChange={(id) => handleSalesOrderFilter(id)}
                    labelKey="label"
                    searchKeys={["label"]}
                    placeholder="All Sales Orders"
                  />
                </div>
              )}
              <input type="date" className="k-input" style={{ width: "auto" }} value={dateFrom} onChange={handleFilterChange(setDateFrom)} title="From date" aria-label="From date" />
              <span aria-hidden="true" style={{ color: "var(--k-faint)" }}>–</span>
              <input type="date" className="k-input" style={{ width: "auto" }} value={dateTo} onChange={handleFilterChange(setDateTo)} title="To date" aria-label="To date" />
              {hasFilters && <Button variant="ghost" onClick={resetFilters}>Clear</Button>}
              <ToolbarSpacer />
              <PrintTemplateSelect picker={tplPicker} />
              {isBigScreen && (
                <ViewModeToggle mode={viewMode} onChange={setViewMode} ariaLabel="Delivery challan view mode" />
              )}
            </Toolbar>
          )}
        </>
      ) : (
        <EmptyState icon={MdBusiness}>No companies available. Add a company first.</EmptyState>
      )}

      {loadingChallans ? (
        <Loading>Loading challans…</Loading>
      ) : challans.length === 0 && selectedCompany ? (
        <EmptyState icon={MdDescription}>
          {hasFilters ? "No challans match the current filters." : "No delivery challans found for this company."}
        </EmptyState>
      ) : (
        <>
          {viewMode === "table" ? (
            <ChallanTable
              challans={challans}
              onCancel={handleCancel}
              onDelete={handleDelete}
              onPrint={handlePrint}
              onEditItems={handleEditItems}
              onExportPdf={handleExportPdf}
              onExportExcel={hasExcelTpl ? handleExportExcel : null}
              onGenerateBill={(c) => setGenerateBillChallanId(c.id)}
              onDuplicate={handleDuplicate}
              onLinkOrder={canLinkOrder ? (c) => setLinkChallan(c) : null}
              exportingId={exportingId}
              duplicatingId={duplicatingId}
              printDisabled={tplPicker.noTemplate}
              printDisabledReason={tplPicker.noTemplateReason}
              attachCounts={attachCounts}
              onAttach={(c) => setAttachTarget(c)}
            />
          ) : (
            <ChallanList
              challans={challans}
              onCancel={handleCancel}
              onDelete={handleDelete}
              onPrint={handlePrint}
              onEditItems={handleEditItems}
              onExportPdf={handleExportPdf}
              onExportExcel={hasExcelTpl ? handleExportExcel : null}
              onGenerateBill={(c) => setGenerateBillChallanId(c.id)}
              onDuplicate={handleDuplicate}
              onLinkOrder={canLinkOrder ? (c) => setLinkChallan(c) : null}
              exportingId={exportingId}
              duplicatingId={duplicatingId}
              printDisabled={tplPicker.noTemplate}
              printDisabledReason={tplPicker.noTemplateReason}
              attachCounts={attachCounts}
              onAttach={(c) => setAttachTarget(c)}
            />
          )}
          {/* Pagination */}
          {totalCount > PAGE_SIZE_OPTIONS[0] && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={totalCount}
              onPage={setPage}
              pageSize={userPageSize ?? pageSize}
              onPageSize={(n) => { setUserPageSize(n); setPage(1); }}
            />
          )}
        </>
      )}

      </>)}

      {showModal && selectedCompany && (
        <ChallanForm
          companyId={selectedCompany.id}
          onClose={() => { setShowModal(false); refreshAttachCounts(); }}
          onSaved={handleSaveChallan}
        />
      )}

      {showImport && selectedCompany && (
        <POImportForm
          companyId={selectedCompany.id}
          onClose={() => setShowImport(false)}
          onSaved={() => { setShowImport(false); setPage(1); fetchChallans(selectedCompany.id, 1); }}
        />
      )}

      {editChallan && (
        <ChallanEditForm
          challan={editChallan}
          onClose={() => { setEditChallan(null); refreshAttachCounts(); }}
          onSaved={handleEditSaved}
        />
      )}

      {generateBillChallanId && selectedCompany && (
        <InvoiceForm
          companyId={selectedCompany.id}
          company={selectedCompany}
          prefillChallanId={generateBillChallanId}
          // 2026-05-08: Generate Bill from Challans always lands on the
          // Bills view (no FBR fields). Same shape as the Bills tab's
          // "+ New Bill" entry point. Without this, the form rendered
          // Item Type / HS Code / Sale Type columns + the New Item Type
          // button — visually inconsistent with the other bill-creation
          // flows.
          billsMode={true}
          onClose={() => setGenerateBillChallanId(null)}
          onSaved={() => {
            setGenerateBillChallanId(null);
            notify("Bill created.", "success");
            fetchChallans(selectedCompany.id, page);
          }}
        />
      )}

      {/* Count-input dialog for the Duplicate flow. Replaces the
          legacy yes/no confirm — see handleDuplicate above. */}
      <DuplicateChallanDialog
        open={!!duplicateSource}
        challanNumber={duplicateSource?.challanNumber}
        onConfirm={handleDuplicateConfirm}
        onCancel={() => setDuplicateSource(null)}
      />

      {attachTarget && selectedCompany && (
        <AttachmentQuickModal
          companyId={selectedCompany.id}
          entityType="DeliveryChallan"
          entityId={attachTarget.id}
          title={`Challan #${attachTarget.challanNumber} — Attachments`}
          onClose={() => { setAttachTarget(null); refreshAttachCounts(); }}
        />
      )}

      {linkChallan && selectedCompany && (
        <AttachChallanToOrderModal
          companyId={selectedCompany.id}
          challan={linkChallan}
          onClose={() => setLinkChallan(null)}
          onAttached={(order) => {
            setLinkChallan(null);
            notify(`Challan linked to SO #${order?.salesOrderNumber ?? ""}.`, "success");
            fetchChallans(selectedCompany.id, page);
          }}
        />
      )}

    </div>
    </DocumentLinesNavigation>
  );
}

function buildChallanPrintHtml(data) {
  const MIN_ROWS = 15;
  const nl2br = (s) => (s || "").replace(/\n/g, "<br>");
  const fmtDate = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dd = String(dt.getDate()).padStart(2, "0");
    const mmm = months[dt.getMonth()];
    const yy = String(dt.getFullYear()).slice(-2);
    return `${dd}-${mmm}-${yy}`;
  };

  // Build item rows
  let itemRows = data.items.map((item) =>
    `<tr>
      <td class="cell qty">${item.quantity}</td>
      <td class="cell item">${renderRichTextHtml(item.description)}</td>
    </tr>`
  ).join("");

  // Pad with empty rows to reach minimum
  const emptyCount = Math.max(0, MIN_ROWS - data.items.length);
  for (let i = 0; i < emptyCount; i++) {
    itemRows += `<tr><td class="cell qty">&nbsp;</td><td class="cell item">&nbsp;</td></tr>`;
  }

  const date = fmtDate(data.deliveryDate);

  return `<!DOCTYPE html><html><head><title>DC #${data.challanNumber}</title>
<style>
  @media print {
    @page { size: A4; margin: 10mm 0 0 0; }
    @page:first { margin: 0; }
    html, body { height: 100%; margin: 0; }
    .footer-section { page-break-inside: avoid; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
  }
  html, body { height: 100%; }
  body { font-family: "Times New Roman", Times, serif; font-size: 16px; color: #000;
         display: flex; flex-direction: column; min-height: 100vh;
         padding: 10mm 12mm; }
  .main-content { flex: 1; }
  .footer-section { margin-top: auto; }

  /* ---- Two-column header ---- */
  .header-grid { display: flex; justify-content: space-between; }
  .header-left { flex: 1; }
  .header-right { text-align: right; white-space: nowrap; padding-left: 20px; }

  /* Left: logo + name row */
  .brand-row { display: flex; align-items: center; gap: 14px; }
  .brand-row img { height: 75px; }
  .company-name { font-size: 38px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; white-space: nowrap; }
  .company-address { font-size: 11.5px; color: #333; margin-top: 2px; line-height: 1.35; }
  .company-contact { font-size: 12.5px; margin-top: 6px; line-height: 1.4; }

  /* Right: DC label, date, DC number */
  .dc-label { font-size: 22px; font-weight: 700; color: #1a5276; }
  .dc-date { font-size: 17px; font-weight: 700; margin-top: 6px; }
  .dc-number { font-size: 28px; font-weight: 900; margin-top: 14px; }

  /* ---- Info lines (below header) ---- */
  .info-section { margin-top: 18px; }
  .info-line { font-size: 18px; margin-bottom: 5px; }
  .info-line strong { font-weight: 700; }
  .info-line .value { font-size: 20px; font-weight: 900; margin-left: 14px; }

  /* ---- Table ---- */
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  thead { display: table-row-group; }
  th { background-color: #2c3e50 !important; color: #fff !important; font-weight: 700; font-size: 12px; text-transform: uppercase; padding: 6px 14px; border: 1px solid #2c3e50; }
  th.qty-head { width: 130px; text-align: center; }
  .cell { border: 1px solid #888; padding: 8px 14px; font-size: 15px; height: 34px; }
  .cell.qty { text-align: center; width: 130px; }
  .cell.item { text-align: left; }
  tbody tr:nth-child(odd) td { background-color: #ffffff !important; }
  tbody tr:nth-child(even) td { background-color: #d9d9d9 !important; }

  /* ---- Footer ---- */
  .thank-you { text-align: center; font-size: 22px; font-weight: 700; font-style: italic; margin-top: 20px; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 50px; padding: 0 40px; }
  .sig-block { text-align: center; }
  .sig-block .line { width: 220px; border-top: 1.5px solid #4a90b8; margin-bottom: 1px; }
  .sig-block .label { font-size: 13px; font-weight: normal; color: #000; }
</style></head><body>

<div class="main-content">
<!-- Two-column header -->
<div class="header-grid">
  <div class="header-left">
    <div class="brand-row">
      ${data.companyLogoPath ? `<img src="${data.companyLogoPath}" />` : ""}
      <span class="company-name">${data.companyBrandName}</span>
    </div>
    ${data.companyAddress ? `<div class="company-address">${nl2br(data.companyAddress)}</div>` : ""}
    ${data.companyPhone ? `<div class="company-contact">${nl2br(data.companyPhone)}</div>` : ""}
  </div>
  <div class="header-right">
    <div class="dc-label">Delivery Challan</div>
    <div class="dc-date">${date}</div>
    <div class="dc-number">DC # ${data.challanNumber}</div>
  </div>
</div>

<!-- Info -->
<div class="info-section">
  <div class="info-line"><strong>Messers:</strong> <span class="value">${data.clientName}${data.clientAddress ? `, ${data.clientAddress}` : ""}</span></div>
  <div class="info-line"><strong>Purchase Order:</strong> <span class="value">${data.poNumber || "\u2014"}</span></div>
</div>

<!-- Items Table -->
<table>
  <thead><tr><th class="qty-head">Quantity</th><th>Item</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>
</div>

<!-- Footer -->
<div class="footer-section">
  <div class="thank-you">Thank you for your business!</div>
  <div class="sig-row">
    <div class="sig-block"><div class="line"></div><div class="label">Signature and Stamp</div></div>
    <div class="sig-block"><div class="line"></div><div class="label">Receiver Signature and Stamp</div></div>
  </div>
</div>

</body></html>`;
}
