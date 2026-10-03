import DocumentLinesNavigation from "../Components/DocumentLinesNavigation";
import { useState, useEffect, useCallback } from "react";
import { MdInventory2, MdAdd, MdBusiness, MdEdit, MdDelete, MdVisibility, MdPrint, MdPictureAsPdf } from "react-icons/md";
import { getGoodsReceiptsByCompanyPaged, deleteGoodsReceipt, getGoodsReceiptPrintData } from "../api/goodsReceiptApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import Pagination from "../Components/Pagination";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import GoodsReceiptForm from "../Components/GoodsReceiptForm";
import GoodsReceiptTable from "../Components/GoodsReceiptTable";
import AttachmentBadge from "../Components/AttachmentBadge";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import ViewModeToggle from "../Components/ViewModeToggle";
import { useListViewMode } from "../hooks/useListViewMode";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { DEFAULT_TEMPLATES } from "../utils/templateSampleData";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { PageHeader, CompanyPicker, Button, Toolbar, ToolbarSpacer, SearchBox, Card, Facts, EmptyState, Loading } from "../ui/Kit";

export default function GoodsReceiptsPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const tplPicker = usePrintTemplates("GoodsReceipt");
  const canCreate = has("goodsreceipts.manage.create");
  const canUpdate = has("goodsreceipts.manage.update");
  const canDelete = has("goodsreceipts.manage.delete");
  const canPrint = has("goodsreceipts.print.view");
  const [viewMode, setViewMode, isBigScreen] = useListViewMode("goodsReceipts");

  const [receipts, setReceipts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("goodsReceipts");
  const [observedSize, setObservedSize] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [attachTarget, setAttachTarget] = useState(null);
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(selectedCompany?.id, "GoodsReceipt", receipts.map((r) => r.id));

  const fetchReceipts = useCallback(async (pg) => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (pageSize) params.pageSize = pageSize;
      if (search) params.search = search;
      if (supplierFilter) params.supplierId = supplierFilter;
      const { data } = await getGoodsReceiptsByCompanyPaged(selectedCompany.id, params);
      setReceipts(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(Math.ceil((data.totalCount || 0) / (data.pageSize || 10)));
      setObservedSize(data.pageSize ?? null);
    } catch {
      setReceipts([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, page, pageSize, search, supplierFilter]);

  useEffect(() => {
    if (selectedCompany) {
      getSuppliersByCompany(selectedCompany.id).then(r => setSuppliers(r.data || [])).catch(() => setSuppliers([]));
      setPage(1);
      fetchReceipts(1);
    }
  }, [selectedCompany]);

  useEffect(() => { if (selectedCompany) fetchReceipts(page); }, [page, pageSize, search, supplierFilter]);

  const onFilterChange = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const handleDelete = async (gr) => {
    const ok = await confirm({ title: "Delete Goods Receipt?", message: `Delete GR #${gr.goodsReceiptNumber}?`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try {
      await deleteGoodsReceipt(gr.id);
      notify("Goods Receipt deleted.", "success");
      fetchReceipts(page);
    } catch {
      notify("Failed to delete receipt.", "error");
    }
  };

  const handlePrint = async (gr) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading goods receipt...</p>");
    try {
      const { data } = await getGoodsReceiptPrintData(gr.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(gr)?.htmlContent || DEFAULT_TEMPLATES.GoodsReceipt, data);
      writeAndPrint(w, html);
    } catch { w.close(); notify("Failed to load print data.", "error"); }
  };

  const handleExportPdf = async (gr) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (exportingId) return;
    setExportingId(gr.id);
    try {
      const { data } = await getGoodsReceiptPrintData(gr.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(gr)?.htmlContent || DEFAULT_TEMPLATES.GoodsReceipt, data);
      await exportToPdf(html, `GRN # ${data.goodsReceiptNumber} ${data.supplierName}`);
    } catch { notify("Failed to export PDF.", "error"); }
    finally { setExportingId(null); }
  };

  return (
    <DocumentLinesNavigation type="receipt">
    <div>
      <PageHeader
        icon={MdInventory2}
        tone="teal"
        title="Goods Receipts"
        subtitle={selectedCompany ? `${totalCount} receipt${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` : "Select a company"}
        actions={companies.length > 0 && canCreate ? (
          <Button variant="primary" icon={MdAdd} onClick={() => { setEditingId(null); setShowForm(true); }}>New Receipt</Button>
        ) : null}
      />

      {loadingCompanies ? (
        <Loading>Loading companies…</Loading>
      ) : companies.length === 0 ? (
        <EmptyState icon={MdBusiness}>No companies available.</EmptyState>
      ) : (
        <>
          <CompanyPicker />

          {selectedCompany && (
            <Toolbar>
              <SearchBox
                value={search}
                onChange={(text) => onFilterChange(setSearch)({ target: { value: text } })}
                placeholder="Search GR#, supplier, item..."
              />
              <div style={filterBox}>
                <SearchableClientSelect
                  clients={suppliers}
                  value={supplierFilter}
                  onChange={(id) => onFilterChange(setSupplierFilter)({ target: { value: String(id) } })}
                  placeholder="All Suppliers"
                  noun="suppliers"
                />
              </div>
              <ToolbarSpacer />
              {canPrint && <PrintTemplateSelect picker={tplPicker} />}
              {isBigScreen && (
                <ViewModeToggle mode={viewMode} onChange={setViewMode} ariaLabel="Goods receipts view mode" />
              )}
            </Toolbar>
          )}

          {loading ? (
            <Loading>Loading goods receipts…</Loading>
          ) : receipts.length === 0 ? (
            <EmptyState icon={MdInventory2}>No goods receipts yet.</EmptyState>
          ) : (
            <>
              {viewMode === "table" ? (
                <GoodsReceiptTable
                  receipts={receipts}
                  perms={{ canUpdate, canDelete }}
                  onView={(g) => { setEditingId(g.id); setShowForm(true); }}
                  onEdit={(g) => { setEditingId(g.id); setShowForm(true); }}
                  onDelete={handleDelete}
                  onPrint={canPrint ? handlePrint : null}
                  onExportPdf={canPrint ? handleExportPdf : null}
                  exportingId={exportingId}
                  printDisabled={tplPicker.noTemplate}
                  printDisabledReason={tplPicker.noTemplateReason}
                  attachCounts={attachCounts}
                  onAttach={(g) => setAttachTarget(g)}
                />
              ) : (
              <div className="k-grid-cards">
                {receipts.map(gr => (
                  <Card
                    key={gr.id}
                    tone="teal"
                    icon={MdInventory2}
                    title={`GR #${gr.goodsReceiptNumber}`}
                    actions={<AttachmentBadge count={attachCounts[gr.id]} onClick={() => setAttachTarget(gr)} />}
                    style={docCard}
                  >
                    <Facts facts={[
                      ["Supplier", gr.supplierName],
                      ["Date", new Date(gr.receiptDate).toLocaleDateString()],
                      gr.purchaseBillNumber && ["Linked PB", `#${gr.purchaseBillNumber}`],
                      gr.supplierChallanNumber && ["Supplier DC", gr.supplierChallanNumber],
                      ["Items", gr.items?.length || 0],
                      ["Status", gr.status],
                    ]} />
                    <div style={cardActions}>
                      <Button size="sm" icon={MdVisibility} onClick={() => { setEditingId(gr.id); setShowForm(true); }}>View</Button>
                      {canUpdate && <Button size="sm" icon={MdEdit} onClick={() => { setEditingId(gr.id); setShowForm(true); }}>Edit</Button>}
                      {canPrint && <Button size="sm" icon={MdPrint} disabled={tplPicker.noTemplate} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"} onClick={() => handlePrint(gr)}>Print</Button>}
                      {canPrint && <Button size="sm" icon={MdPictureAsPdf} onClick={() => handleExportPdf(gr)} disabled={tplPicker.noTemplate || !!exportingId} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Export PDF"}>PDF</Button>}
                      {canDelete && <Button size="sm" variant="danger" icon={MdDelete} onClick={() => handleDelete(gr)}>Delete</Button>}
                    </div>
                  </Card>
                ))}
              </div>
              )}
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
        </>
      )}

      {showForm && selectedCompany && (
        <GoodsReceiptForm
          companyId={selectedCompany.id}
          receiptId={editingId}
          onClose={() => { setShowForm(false); setEditingId(null); refreshAttachCounts(); }}
          onSaved={() => { setShowForm(false); setEditingId(null); fetchReceipts(page); refreshAttachCounts(); }}
        />
      )}

      {attachTarget && selectedCompany && (
        <AttachmentQuickModal
          companyId={selectedCompany.id}
          entityType="GoodsReceipt"
          entityId={attachTarget.id}
          title={`GRN #${attachTarget.goodsReceiptNumber} — Attachments`}
          onClose={() => { setAttachTarget(null); refreshAttachCounts(); }}
        />
      )}
    </div>
    </DocumentLinesNavigation>
  );
}

// Page-specific layout only — every themed role comes from the kit.
const filterBox = { flex: "1 1 200px", minWidth: 0, maxWidth: 260 };
const docCard = { margin: 0 };
const cardActions = { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.9rem", paddingTop: "0.75rem", borderTop: "1px solid var(--k-line)" };
