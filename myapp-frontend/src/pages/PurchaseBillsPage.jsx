import DocumentLinesNavigation from "../Components/DocumentLinesNavigation";
import { useState, useEffect, useCallback } from "react";
import { MdShoppingCart, MdAdd, MdBusiness, MdEdit, MdDelete, MdVisibility, MdReceipt, MdClose, MdPrint, MdPictureAsPdf } from "react-icons/md";
import { getPurchaseBillsByCompanyPaged, deletePurchaseBill, getPurchaseBillPrintData } from "../api/purchaseBillApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { getAwaitingPurchase } from "../api/invoiceApi";
import { formStyles, modalSizes } from "../theme";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import Pagination from "../Components/Pagination";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import PurchaseBillForm from "../Components/PurchaseBillForm";
import PurchaseBillTable from "../Components/PurchaseBillTable";
import ViewModeToggle from "../Components/ViewModeToggle";
import { useListViewMode } from "../hooks/useListViewMode";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import PaymentStatusBadge from "../Components/PaymentStatusBadge";
import AttachmentBadge from "../Components/AttachmentBadge";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { DEFAULT_TEMPLATES } from "../utils/templateSampleData";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { PageHeader, CompanyPicker, Button, Toolbar, ToolbarSpacer, SearchBox, Card, Facts, EmptyState, Loading } from "../ui/Kit";

export default function PurchaseBillsPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const tplPicker = usePrintTemplates("PurchaseBill");
  const canCreate = has("purchasebills.manage.create");
  const canUpdate = has("purchasebills.manage.update");
  const canDelete = has("purchasebills.manage.delete");
  const canPrint = has("purchasebills.print.view");
  // Gates the payment-status badge (AP payments). No key → no badge.
  const canViewPaymentStatus = has("accounting.paymentstatus.view");
  const [viewMode, setViewMode, isBigScreen] = useListViewMode("purchaseBills");

  const [bills, setBills] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("purchaseBills");
  const [observedSize, setObservedSize] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewOnly, setViewOnly] = useState(false);
  // "Purchase Against Sale Bill" picker
  const [showSalePicker, setShowSalePicker] = useState(false);
  const [awaitingBills, setAwaitingBills] = useState([]);
  const [loadingAwaiting, setLoadingAwaiting] = useState(false);
  const [prefillFromInvoiceId, setPrefillFromInvoiceId] = useState(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [attachTarget, setAttachTarget] = useState(null);
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(selectedCompany?.id, "PurchaseBill", bills.map((b) => b.id));

  const fetchBills = useCallback(async (pg) => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (pageSize) params.pageSize = pageSize;
      if (search) params.search = search;
      if (supplierFilter) params.supplierId = supplierFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await getPurchaseBillsByCompanyPaged(selectedCompany.id, params);
      setBills(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(Math.ceil((data.totalCount || 0) / (data.pageSize || 10)));
      setObservedSize(data.pageSize ?? null);
    } catch {
      setBills([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, page, pageSize, search, supplierFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedCompany) {
      getSuppliersByCompany(selectedCompany.id).then(r => setSuppliers(r.data || [])).catch(() => setSuppliers([]));
      setPage(1);
      fetchBills(1);
    } else {
      setBills([]);
    }
  }, [selectedCompany]);

  useEffect(() => { if (selectedCompany) fetchBills(page); }, [page, pageSize, search, supplierFilter, dateFrom, dateTo]);

  const onFilterChange = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const hasFilters = search || supplierFilter || dateFrom || dateTo;
  const resetFilters = () => { setSearch(""); setSupplierFilter(""); setDateFrom(""); setDateTo(""); setPage(1); };

  const handleDelete = async (b) => {
    const ok = await confirm({
      title: "Delete Purchase Bill?",
      message: `Delete purchase bill #${b.purchaseBillNumber}? Any Stock IN movement it produced will be reversed.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deletePurchaseBill(b.id);
      notify("Purchase bill deleted; stock reversed.", "success");
      fetchBills(page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete bill.", "error");
    }
  };

  const handlePrint = async (b) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading purchase bill...</p>");
    try {
      const { data } = await getPurchaseBillPrintData(b.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(b)?.htmlContent || DEFAULT_TEMPLATES.PurchaseBill, data);
      writeAndPrint(w, html);
    } catch { w.close(); notify("Failed to load print data.", "error"); }
  };

  const handleExportPdf = async (b) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (exportingId) return;
    setExportingId(b.id);
    try {
      const { data } = await getPurchaseBillPrintData(b.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(b)?.htmlContent || DEFAULT_TEMPLATES.PurchaseBill, data);
      await exportToPdf(html, `PB # ${data.purchaseBillNumber} ${data.supplierName}`);
    } catch { notify("Failed to export PDF.", "error"); }
    finally { setExportingId(null); }
  };

  const openSalePicker = async () => {
    setShowSalePicker(true);
    setLoadingAwaiting(true);
    setPickerSearch("");
    try {
      const { data } = await getAwaitingPurchase(selectedCompany.id);
      setAwaitingBills(data || []);
    } catch {
      setAwaitingBills([]);
      notify("Failed to load sale bills awaiting procurement.", "error");
    } finally {
      setLoadingAwaiting(false);
    }
  };

  return (
    <DocumentLinesNavigation type="purchase">
    <div>
      <PageHeader
        icon={MdShoppingCart}
        tone="purple"
        title="Purchase Bills"
        subtitle={selectedCompany
          ? `${totalCount} purchase bill${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
          : "Select a company"}
        actions={companies.length > 0 && canCreate ? (
          <>
            <Button variant="secondary" icon={MdReceipt} onClick={openSalePicker}>Purchase Against Sale Bill</Button>
            <Button variant="primary" icon={MdAdd} onClick={() => { setEditingId(null); setPrefillFromInvoiceId(null); setViewOnly(false); setShowForm(true); }}>
              New Purchase Bill
            </Button>
          </>
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
                placeholder="Search bill#, IRN, supplier, item..."
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
              <div style={dateGroup}>
                <input type="date" className="k-input" style={dateInput} value={dateFrom} onChange={onFilterChange(setDateFrom)} title="From" aria-label="From date" />
                <span style={dateSep}>–</span>
                <input type="date" className="k-input" style={dateInput} value={dateTo} onChange={onFilterChange(setDateTo)} title="To" aria-label="To date" />
              </div>
              {hasFilters && <Button variant="ghost" size="sm" onClick={resetFilters}>Clear</Button>}
              <ToolbarSpacer />
              {canPrint && <PrintTemplateSelect picker={tplPicker} />}
              {isBigScreen && (
                <ViewModeToggle mode={viewMode} onChange={setViewMode} ariaLabel="Purchase bills view mode" />
              )}
            </Toolbar>
          )}

          {loading ? (
            <Loading>Loading purchase bills…</Loading>
          ) : bills.length === 0 ? (
            <EmptyState icon={MdShoppingCart}>
              {hasFilters ? "No purchase bills match the current filters." : "No purchase bills yet."}
            </EmptyState>
          ) : (
            <>
              {viewMode === "table" ? (
                <PurchaseBillTable
                  bills={bills}
                  attachCounts={attachCounts}
                  onAttach={(b) => setAttachTarget(b)}
                  perms={{ canUpdate, canDelete }}
                  showPaymentStatus={canViewPaymentStatus}
                  onView={(b) => { setEditingId(b.id); setViewOnly(true); setShowForm(true); }}
                  onEdit={(b) => { setEditingId(b.id); setViewOnly(false); setShowForm(true); }}
                  onDelete={handleDelete}
                  onPrint={canPrint ? handlePrint : null}
                  onExportPdf={canPrint ? handleExportPdf : null}
                  exportingId={exportingId}
                  printDisabled={tplPicker.noTemplate}
                  printDisabledReason={tplPicker.noTemplateReason}
                />
              ) : (
              <div className="k-grid-cards">
                {bills.map(b => (
                  <Card
                    key={b.id}
                    tone="purple"
                    icon={MdShoppingCart}
                    title={`PB #${b.purchaseBillNumber}`}
                    actions={<AttachmentBadge count={attachCounts[b.id]} onClick={() => setAttachTarget(b)} />}
                    style={docCard}
                  >
                    <Facts facts={[
                      ["Supplier", b.supplierName],
                      b.sourceDeliveryChallanId && ["Source", "Delivery challan"],
                      ["Date", new Date(b.date).toLocaleDateString()],
                      ["Grand Total", `Rs. ${b.grandTotal?.toLocaleString()}`],
                      ["Items", b.items?.length || 0],
                      ["Status", b.reconciliationStatus],
                      b.supplierIRN && ["IRN", <span style={irnText}>{b.supplierIRN}</span>],
                    ]} />
                    {canViewPaymentStatus && b.paymentStatus && (
                      <div style={{ marginTop: "0.6rem" }}>
                        <PaymentStatusBadge status={b.paymentStatus} balanceDue={b.balanceDue} daysOverdue={b.daysOverdue} />
                      </div>
                    )}
                    <div style={cardActions}>
                      <Button size="sm" icon={MdVisibility} onClick={() => { setEditingId(b.id); setViewOnly(true); setShowForm(true); }}>View</Button>
                      {canUpdate && (
                        <Button size="sm" icon={MdEdit} onClick={() => { setEditingId(b.id); setViewOnly(false); setShowForm(true); }}>Edit</Button>
                      )}
                      {canPrint && (
                        <Button
                          size="sm"
                          icon={MdPrint}
                          disabled={tplPicker.noTemplate}
                          title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"}
                          onClick={() => handlePrint(b)}
                        >
                          Print
                        </Button>
                      )}
                      {canPrint && (
                        <Button
                          size="sm"
                          icon={MdPictureAsPdf}
                          onClick={() => handleExportPdf(b)}
                          disabled={tplPicker.noTemplate || !!exportingId}
                          title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Export PDF"}
                        >
                          PDF
                        </Button>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="danger" icon={MdDelete} onClick={() => handleDelete(b)}>Delete</Button>
                      )}
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
        <PurchaseBillForm
          companyId={selectedCompany.id}
          billId={editingId}
          readOnly={viewOnly}
          prefillFromInvoiceId={prefillFromInvoiceId}
          onClose={() => { setShowForm(false); setEditingId(null); setPrefillFromInvoiceId(null); setViewOnly(false); refreshAttachCounts(); }}
          onSaved={() => { setShowForm(false); setEditingId(null); setPrefillFromInvoiceId(null); setViewOnly(false); fetchBills(page); }}
        />
      )}

      {attachTarget && selectedCompany && (
        <AttachmentQuickModal
          companyId={selectedCompany.id}
          entityType="PurchaseBill"
          entityId={attachTarget.id}
          title={`Bill #${attachTarget.purchaseBillNumber} — Attachments`}
          onClose={() => { setAttachTarget(null); refreshAttachCounts(); }}
        />
      )}

      {showSalePicker && (
        <div data-admin-backdrop="" style={formStyles.backdrop} onClick={() => setShowSalePicker(false)}>
          <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }} onClick={(e) => e.stopPropagation()}>
            <div data-admin-header="" style={formStyles.header}>
              <h3 style={formStyles.title}>Pick a sale bill awaiting procurement</h3>
              <button type="button" style={formStyles.closeButton} onClick={() => setShowSalePicker(false)} aria-label="Close">
                <MdClose size={20} />
              </button>
            </div>
            <div style={pickerSearchBar}>
              <SearchBox
                value={pickerSearch}
                onChange={setPickerSearch}
                placeholder="Search bill # / client..."
                autoFocus
              />
              <div style={pickerHint}>
                Only bills where every line has an Item Type AND at least one line is missing HS Code appear here.
              </div>
            </div>
            <div style={pickerTableWrap}>
              {loadingAwaiting ? (
                <Loading>Loading...</Loading>
              ) : awaitingBills.length === 0 ? (
                <EmptyState boxed={false}>
                  No sale bills awaiting procurement. Either every bill is FBR-ready, or some lines are missing Item Type — fix those on the Bills page first.
                </EmptyState>
              ) : (
                <table className="k-table">
                  <thead>
                    <tr>
                      <th>Bill #</th>
                      <th>Date</th>
                      <th>Client</th>
                      <th className="k-num">Lines awaiting</th>
                      <th className="k-num">Qty remaining</th>
                      <th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {awaitingBills
                      .filter(b => {
                        if (!pickerSearch.trim()) return true;
                        const q = pickerSearch.toLowerCase();
                        return String(b.invoiceNumber).includes(q)
                            || (b.clientName || "").toLowerCase().includes(q);
                      })
                      .map(b => (
                        <tr key={b.invoiceId}>
                          <td><strong>#{b.invoiceNumber}</strong></td>
                          <td>{new Date(b.date).toLocaleDateString()}</td>
                          <td>{b.clientName}</td>
                          <td className="k-num">{b.linesAwaiting}</td>
                          <td className="k-num" style={{ fontWeight: 600 }}>{b.totalQtyRemaining}</td>
                          <td className="k-actions">
                            <Button variant="primary" size="sm" onClick={() => {
                              setShowSalePicker(false);
                              setEditingId(null);
                              setPrefillFromInvoiceId(b.invoiceId);
                              setViewOnly(false);
                              setShowForm(true);
                            }}>
                              Pick
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </DocumentLinesNavigation>
  );
}

// Page-specific layout only — every themed role (header, buttons, inputs, cards, table) comes from the kit.
const filterBox = { flex: "1 1 200px", minWidth: 0, maxWidth: 260 };
const dateGroup = { display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0, flexWrap: "wrap" };
const dateInput = { width: "auto", minWidth: 0, maxWidth: 165 };
const dateSep = { color: "var(--k-faint)" };
const docCard = { margin: 0 };
const cardActions = { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.9rem", paddingTop: "0.75rem", borderTop: "1px solid var(--k-line)" };
const irnText = { fontFamily: "monospace", fontSize: "0.74rem", fontWeight: 400, color: "var(--k-muted)", wordBreak: "break-all" };
const pickerSearchBar = { padding: "0.75rem clamp(0.9rem, 2vw, 1.25rem)", borderBottom: "1px solid var(--k-line)", flexShrink: 0 };
const pickerHint = { fontSize: "var(--k-font-sm)", color: "var(--k-muted)", marginTop: "0.5rem" };
const pickerTableWrap = { overflow: "auto", flex: "1 1 auto", minHeight: 0 };
