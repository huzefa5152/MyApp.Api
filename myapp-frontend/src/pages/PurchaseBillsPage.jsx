import DocumentLinesNavigation, { DocumentLinesHeaderLink } from "../Components/DocumentLinesNavigation";
import CardActions from "../Components/CardActions";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import useQueryAction from "../hooks/useQueryAction";
import { MdShoppingCart, MdAdd, MdBusiness, MdSearch, MdEdit, MdDelete, MdVisibility, MdPayments, MdPrint, MdPictureAsPdf, MdCopyAll } from "react-icons/md";
import { getPurchaseBillsByCompanyPaged, deletePurchaseBill, getPurchaseBillPrintData } from "../api/purchaseBillApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { defaultPurchaseBillTemplate } from "../utils/purchaseNoteDocTemplates";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { getSuppliersByCompany } from "../api/supplierApi";
import { docTrail } from "../utils/demandTags";
import { dropdownStyles, cardStyles, cardHover } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import SearchableSelect from "../Components/SearchableSelect";
import DivisionSelect from "../Components/DivisionSelect";
import { notify } from "../utils/notify";
import PurchaseBillForm from "../Components/PurchaseBillForm";
import PurchaseBillTable from "../Components/PurchaseBillTable";
import PaymentForm from "../Components/PaymentForm";
import PaymentHistoryDialog from "../Components/PaymentHistoryDialog";
import CopyDocumentModal from "../Components/CopyDocumentModal";
import { DOC_COPY_TYPES } from "../api/documentCopyApi";
import { useDocumentCopy } from "../hooks/useDocumentCopy";
import StatusBadge from "../Components/StatusBadge";
import ViewModeToggle from "../Components/ViewModeToggle";
import { useListViewMode } from "../hooks/useListViewMode";
import AttachmentBadge from "../Components/AttachmentBadge";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import Pagination from "../Components/Pagination";
import usePageSize from "../hooks/usePageSize";
import useIsNarrow from "../hooks/useIsNarrow";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  purple: "#6a1b9a",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
};

// Payment-status pill (mirrors PurchaseBillTable's) for the card view.
function paymentStatusBadge(b) {
  const s = b.paymentStatus;
  if (s === "Paid") return <StatusBadge tone="success">Paid</StatusBadge>;
  if (s === "Overdue") return <StatusBadge tone="danger" title={b.daysOverdue ? `${b.daysOverdue} day(s) overdue` : undefined}>Overdue{b.daysOverdue ? ` ${b.daysOverdue}d` : ""}</StatusBadge>;
  if (s === "PartiallyPaid") return <StatusBadge tone="info">Partial</StatusBadge>;
  return <StatusBadge tone="neutral">Unpaid</StatusBadge>;
}

export default function PurchaseBillsPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("purchasebills.manage.create");
  const canUpdate = has("purchasebills.manage.update");
  const canDelete = has("purchasebills.manage.delete");
  const canPrint = has("purchasebills.print.view");
  // A purchase bill copies to another purchase bill or to a goods receipt.
  const canCopy = canCreate || has("goodsreceipts.manage.create");
  // Shortcut to record a payment (money out) straight from a purchase bill —
  // opens the PaymentForm pre-filled with this supplier + this bill.
  const canRecordPayment = has("accounting.payments.create");
  // View the payments applied to a bill (+ balance) — gates the clickable pill.
  const canViewPayments = has("accounting.payments.view");
  // Gate the "Purchase Against Sales Order" flow on the SO list permission
  // (the picker calls GET /salesorders/.../open).
  const [viewMode, setViewMode, isBigScreen] = useListViewMode("purchaseBills");
  const isNarrow = useIsNarrow();

  const [bills, setBills] = useState([]);
  const [attachTarget, setAttachTarget] = useState(null);
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(selectedCompany?.id, "PurchaseBill", bills.map((r) => r.id));
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize("purchaseBills");
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  // Seed from ?supplierId= so the Suppliers page "N purchase bills" chip
  // deep-links straight to this list filtered to that supplier.
  const [sourceFilter, setSourceFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState(() => searchParams.get("supplierId") || "");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Shared template-picker state, scoped to the selected division: "All
  // Divisions" → company-wide templates; a specific division → that division's.
  // An empty scope hides the picker and blocks Print/PDF.
  const tplPicker = usePrintTemplates("PurchaseBill", { divisionId: divisionFilter });
  const [showForm, setShowForm] = useState(false);
  // Dashboard quick action: ?new=1 opens New Purchase Bill (the New button's own reset).
  useQueryAction("new", !!selectedCompany && canCreate, () => {
    openNew();
  });
  const [editingId, setEditingId] = useState(null);
  const [viewOnly, setViewOnly] = useState(false);
  // { contactId, documentId } for the payment shortcut; null when closed.
  const [paymentPreset, setPaymentPreset] = useState(null);
  // Bill whose payment history is open in the dialog; null when closed.
  const [paymentHistoryDoc, setPaymentHistoryDoc] = useState(null);
  // A new bill opens on the customer-document picker when it was started from a
  // document (?for=order:12 from a sales order, challan or sale bill).
  const [pickerFor, setPickerFor] = useState(null);

  const openNew = (forDoc = null) => {
    setEditingId(null);
    setViewOnly(false);
    setPickerFor(forDoc);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false); setEditingId(null); setViewOnly(false); setPickerFor(null);
  };

  // "Buy" on a sales order, challan or sale bill lands here with ?for=kind:id.
  useEffect(() => {
    const target = searchParams.get("for");
    if (!target || !selectedCompany) return;
    const [kind, id] = target.split(":");
    if (canCreate && ["order", "challan", "bill"].includes(kind) && Number(id) > 0)
      openNew({ kind, id: Number(id) });
    const next = new URLSearchParams(searchParams);
    next.delete("for");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, selectedCompany, canCreate]);

  const fetchBills = useCallback(async (pg) => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (size) params.pageSize = size;
      if (search) params.search = search;
      if (supplierFilter) params.supplierId = supplierFilter;
      if (sourceFilter) params.fromChallan = sourceFilter === "challan";
      if (divisionFilter) params.divisionId = divisionFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await getPurchaseBillsByCompanyPaged(selectedCompany.id, params);
      setBills(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(Math.ceil((data.totalCount || 0) / (data.pageSize || 10)));
    } catch {
      setBills([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, page, size, search, supplierFilter, sourceFilter, divisionFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedCompany) {
      getSuppliersByCompany(selectedCompany.id).then(r => setSuppliers(r.data || [])).catch(() => setSuppliers([]));
      setPage(1);
      // Division ids are per-company — a stale filter would blank the list.
      // Resetting it retriggers the filter effect below, so only fetch
      // directly when there's no reset to piggyback on (avoids a stale-
      // division request racing the corrected one).
      if (divisionFilter) setDivisionFilter("");
      else fetchBills(1);
    } else {
      setBills([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany]);

  useEffect(() => { if (selectedCompany) fetchBills(page); }, [page, size, search, supplierFilter, sourceFilter, divisionFilter, dateFrom, dateTo]);
  const copy = useDocumentCopy({ sourceType: DOC_COPY_TYPES.purchaseBill, onRefresh: () => fetchBills(page) });

  const onFilterChange = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const hasFilters = search || supplierFilter || sourceFilter || divisionFilter || dateFrom || dateTo;
  const resetFilters = () => { setSearch(""); setSupplierFilter(""); setSourceFilter(""); setDivisionFilter(""); setDateFrom(""); setDateTo(""); setPage(1); };

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

  const [exportingId, setExportingId] = useState(null);

  // Explicit dropdown pick wins; else the company default; else the built-in.
  const resolveBillTemplate = (b) =>
    tplPicker.resolveTemplate(b)?.htmlContent || defaultPurchaseBillTemplate;

  const handlePrint = async (b) => {
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading purchase bill...</p>");
    try {
      const { data } = await getPurchaseBillPrintData(b.id);
      const html = mergeTemplate(resolveBillTemplate(b), data);
      writeAndPrint(w, html);
    } catch { w.close(); notify("Failed to load print data.", "error"); }
  };

  const handleExportPdf = async (b) => {
    if (exportingId) return;
    setExportingId(b.id);
    try {
      const { data } = await getPurchaseBillPrintData(b.id);
      const html = mergeTemplate(resolveBillTemplate(b), data);
      await exportToPdf(html, `PB # ${data.purchaseBillNumber} ${data.supplierName}`);
    } catch { notify("Failed to export PDF.", "error"); }
    finally { setExportingId(null); }
  };

  return (
    <DocumentLinesNavigation type="purchase">
    <div>
      <div data-admin-page-header="" style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div data-admin-page-icon="" style={styles.headerIcon}><MdShoppingCart size={28} color="#fff" /></div>
          <div>
            <h2 style={styles.pageTitle}>Purchase Bills</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? `${totalCount} purchase bill${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
                : "Select a company"}
            </p>
          </div>
          <DocumentLinesHeaderLink />
        </div>
        {companies.length > 0 && canCreate && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button style={styles.addBtn} onClick={() => openNew()}>
              <MdAdd size={18} /> New purchase bill
            </button>
          </div>
        )}
      </div>

      {loadingCompanies ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : companies.length === 0 ? (
        <div style={styles.empty}>No companies available.</div>
      ) : (
        <>
          {companies.length > 1 && (<div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""} onChange={e => setSelectedCompany(companies.find(c => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
            {selectedCompany && (
              <DivisionSelect companyId={selectedCompany.id} value={divisionFilter} onChange={(v) => { setDivisionFilter(v); setPage(1); }} style={dropdownStyles.base} />
            )}
          </div>)}

          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap">
                <MdSearch size={15} className="filter-search-icon" />
                <input type="text" placeholder="Search bill#, IRN, supplier, item..." className="filter-search-input" value={search} onChange={onFilterChange(setSearch)} />
              </div>
              <div style={{ minWidth: 220, maxWidth: 340 }}>
                <SearchableSelect
                  items={suppliers}
                  value={supplierFilter}
                  onChange={(id) => onFilterChange(setSupplierFilter)({ target: { value: id ? String(id) : "" } })}
                  placeholder="All Suppliers"
                />
              </div>
              <div className="filter-date-group">
                <input type="date" className="filter-date-input" value={dateFrom} onChange={onFilterChange(setDateFrom)} title="From" />
                <span className="filter-date-sep">–</span>
                <input type="date" className="filter-date-input" value={dateTo} onChange={onFilterChange(setDateTo)} title="To" />
              </div>
              <select className="filter-select" aria-label="Purchase source" value={sourceFilter} onChange={onFilterChange(setSourceFilter)}><option value="">All purchase sources</option><option value="challan">For customer documents</option><option value="other">Stock &amp; other</option></select>
              {hasFilters && <button className="filter-clear-btn" onClick={resetFilters}>Clear</button>}
              <PrintTemplateSelect picker={tplPicker} />
              {isBigScreen && (
                <div style={{ marginLeft: "auto" }}>
                  <ViewModeToggle mode={viewMode} onChange={setViewMode} ariaLabel="Purchase bills view mode" />
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div style={styles.loading}><div style={styles.spinner} /></div>
          ) : bills.length === 0 ? (
            <div style={styles.empty}>
              <MdShoppingCart size={40} color={colors.cardBorder} />
              <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                {hasFilters ? "No purchase bills match the current filters." : "No purchase bills yet."}
              </p>
            </div>
          ) : (
            <>
              {viewMode === "table" ? (
                <PurchaseBillTable
                  bills={bills}
                  perms={{ canUpdate, canDelete, canRecordPayment, canViewPayments, canPrint, canCopy }}
                  onView={(b) => { setEditingId(b.id); setViewOnly(true); setShowForm(true); }}
                  onEdit={(b) => { setEditingId(b.id); setViewOnly(false); setShowForm(true); }}
                  onDelete={handleDelete}
                  onCopy={(b) => copy.openCopy(b.id, `Purchase Bill #${b.purchaseBillNumber}`)}
                  onRecordPayment={(b) => setPaymentPreset({ contactId: b.supplierId, documentId: b.id, divisionId: b.divisionId })}
                  onShowPayments={(b) => setPaymentHistoryDoc(b)}
                  onPrint={handlePrint}
                  onExportPdf={handleExportPdf}
                  exportingId={exportingId}
                  printDisabled={tplPicker.noTemplate}
                  printDisabledReason={tplPicker.noTemplateReason}
                  attachCounts={attachCounts}
                  onAttach={(b) => setAttachTarget(b)}
                />
              ) : (
              <div className="card-grid">
                {bills.map(b => (
                  <div key={b.id} style={cardStyles.card}
                       onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
                       onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" })}>
                    <div style={cardStyles.cardContent}>
                      <div>
                        <h5 style={cardStyles.title}>
                          <MdShoppingCart style={{ color: colors.purple, marginRight: 6 }} />
                          PB #{b.purchaseBillNumber}
                          {" "}<AttachmentBadge count={attachCounts[b.id]} onClick={() => setAttachTarget(b)} />
                        </h5>
                        {b.divisionName && <span style={styles.divisionChip}>{b.divisionName}</span>}
                        <p style={cardStyles.text}><strong>Supplier:</strong> {b.supplierName}</p>
                        {b.forDocuments?.length > 0 && <p style={cardStyles.text}><strong>For:</strong> {docTrail(b.forDocuments)}</p>}
                        <p style={cardStyles.text}><strong>Date:</strong> {new Date(b.date).toLocaleDateString()}</p>
                        <p style={cardStyles.text}><strong>Grand Total:</strong> Rs. {b.grandTotal?.toLocaleString()}</p>
                        {/* Payment status + balance — clickable to see all
                            payments applied to this bill and how much remains. */}
                        <button
                          type="button"
                          onClick={canViewPayments ? () => setPaymentHistoryDoc(b) : undefined}
                          title={canViewPayments ? "View payments & balance" : undefined}
                          style={{ all: "unset", margin: "2px 0", display: "inline-flex", alignItems: "center", gap: 6, cursor: canViewPayments ? "pointer" : "default" }}
                        >
                          {paymentStatusBadge(b)}
                          {b.balanceDue > 0 && (
                            <span style={{ fontSize: "0.74rem", color: colors.textSecondary, fontWeight: 600 }}>
                              Bal: Rs {b.balanceDue?.toLocaleString()}
                            </span>
                          )}
                        </button>
                        {b.supplierIRN && (
                          <p style={{ ...cardStyles.text, fontFamily: "monospace", fontSize: "0.74rem", color: colors.textSecondary, wordBreak: "break-all" }}>
                            IRN: {b.supplierIRN}
                          </p>
                        )}
                        <p style={{ ...cardStyles.text, fontSize: "0.74rem" }}>
                          {b.items?.length || 0} items · Status: {b.reconciliationStatus}
                        </p>
                      </div>
                      <CardActions style={cardStyles.buttonGroup}>
                        <button data-primary style={btnView} onClick={() => { setEditingId(b.id); setViewOnly(true); setShowForm(true); }}>
                          <MdVisibility size={14} /> View
                        </button>
                        {canPrint && (
                          <button style={{ ...btnPrint, ...(tplPicker.noTemplate ? { opacity: 0.5, cursor: "not-allowed" } : {}) }} disabled={tplPicker.noTemplate} onClick={() => handlePrint(b)} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print purchase bill"}>
                            <MdPrint size={14} /> Print
                          </button>
                        )}
                        {canPrint && (
                          <button style={{ ...btnPdf, opacity: (tplPicker.noTemplate || exportingId === b.id) ? 0.5 : 1, ...(tplPicker.noTemplate ? { cursor: "not-allowed" } : {}) }} disabled={tplPicker.noTemplate || !!exportingId} onClick={() => handleExportPdf(b)} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Download PDF"}>
                            <MdPictureAsPdf size={14} /> PDF
                          </button>
                        )}
                        {canRecordPayment && (
                          <button style={btnPayment} onClick={() => setPaymentPreset({ contactId: b.supplierId, documentId: b.id, divisionId: b.divisionId })} title="Record a payment (money paid) against this bill">
                            <MdPayments size={14} /> Payment
                          </button>
                        )}
                        {canUpdate && (
                          <button data-primary style={btnEdit} onClick={() => { setEditingId(b.id); setViewOnly(false); setShowForm(true); }}>
                            <MdEdit size={14} /> Edit
                          </button>
                        )}
                        {canCopy && (
                          <button style={btnCopy} onClick={() => copy.openCopy(b.id, `Purchase Bill #${b.purchaseBillNumber}`)}>
                            <MdCopyAll size={14} /> Copy
                          </button>
                        )}
                        {canDelete && (
                          <button style={btnDelete} onClick={() => handleDelete(b)}>
                            <MdDelete size={14} /> Delete
                          </button>
                        )}
                      </CardActions>
                    </div>
                  </div>
                ))}
              </div>
              )}
              <Pagination
                page={page}
                totalPages={totalPages}
                total={totalCount}
                onPage={setPage}
                pageSize={size}
                onPageSize={(n) => { setSize(n); setPage(1); }}
              />
            </>
          )}
        </>
      )}

      {showForm && selectedCompany && (
        <PurchaseBillForm
          companyId={selectedCompany.id}
          company={selectedCompany}
          billId={editingId}
          readOnly={viewOnly}
          defaultDivisionId={editingId ? null : divisionFilter}
          startWithPicker={!!pickerFor}
          forDoc={pickerFor?.kind ? pickerFor : null}
          onClose={closeForm}
          onSaved={() => { closeForm(); fetchBills(page); }}
        />
      )}

      {paymentPreset && selectedCompany && (
        <PaymentForm
          mode="payments"
          companyId={selectedCompany.id}
          preset={paymentPreset}
          onClose={() => setPaymentPreset(null)}
          onSaved={() => { setPaymentPreset(null); fetchBills(page); }}
        />
      )}

      {attachTarget && selectedCompany?.id && (
        <AttachmentQuickModal
          companyId={selectedCompany?.id}
          entityType="PurchaseBill"
          entityId={attachTarget.id}
          title={`Purchase Bill #${attachTarget.purchaseBillNumber} — Attachments`}
          onClose={() => { setAttachTarget(null); refreshAttachCounts(); }}
        />
      )}
      {copy.source && (
        <CopyDocumentModal
          sourceType={DOC_COPY_TYPES.purchaseBill}
          sourceId={copy.source.id}
          sourceLabel={copy.source.label}
          onClose={copy.close}
          onCopied={copy.onCopied}
        />
      )}

      {paymentHistoryDoc && selectedCompany && (
        <PaymentHistoryDialog
          mode="payments"
          companyId={selectedCompany.id}
          doc={{ ...paymentHistoryDoc, number: paymentHistoryDoc.purchaseBillNumber }}
          onClose={() => setPaymentHistoryDoc(null)}
        />
      )}

    </div>
    </DocumentLinesNavigation>
  );
}

const styles = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${colors.purple}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center" },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center", color: colors.textSecondary },
  divisionChip: { display: "inline-block", marginBottom: "0.35rem", fontSize: "0.72rem", fontWeight: 700, color: colors.blue, background: "#e3f0ff", padding: "0.12rem 0.55rem", borderRadius: 6 },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
};
const baseBtn = { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" };
const btnView = { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" };
const btnPrint = { ...baseBtn, backgroundColor: "#ede7f6", color: "#4527a0", border: "1px solid #b39ddb" };
const btnPdf = { ...baseBtn, backgroundColor: "#fce4ec", color: "#ad1457", border: "1px solid #f48fb1" };
const btnPayment = { ...baseBtn, backgroundColor: "#e8f5e9", color: "#1b5e20", border: "1px solid #a5d6a7" };
const btnEdit = { ...baseBtn, backgroundColor: "#fff3e0", color: "#e65100" };
const btnCopy = { ...baseBtn, backgroundColor: "#e8eaf6", color: "#283593", border: "1px solid #9fa8da" };
const btnDelete = { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" };
