import { useState, useEffect, useCallback } from "react";
import { MdInventory2, MdAdd, MdBusiness, MdSearch, MdEdit, MdDelete, MdVisibility, MdChevronLeft, MdChevronRight, MdPrint, MdPictureAsPdf } from "react-icons/md";
import { getGoodsReceiptsByCompanyPaged, deleteGoodsReceipt, getGoodsReceiptPrintData } from "../api/goodsReceiptApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { dropdownStyles, cardStyles, cardHover } from "../theme";
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

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
};

export default function GoodsReceiptsPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
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
      if (search) params.search = search;
      if (supplierFilter) params.supplierId = supplierFilter;
      const { data } = await getGoodsReceiptsByCompanyPaged(selectedCompany.id, params);
      setReceipts(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(Math.ceil((data.totalCount || 0) / (data.pageSize || 10)));
    } catch {
      setReceipts([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, page, search, supplierFilter]);

  useEffect(() => {
    if (selectedCompany) {
      getSuppliersByCompany(selectedCompany.id).then(r => setSuppliers(r.data || [])).catch(() => setSuppliers([]));
      setPage(1);
      fetchReceipts(1);
    }
  }, [selectedCompany]);

  useEffect(() => { if (selectedCompany) fetchReceipts(page); }, [page, search, supplierFilter]);

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
    <div>
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdInventory2 size={28} color="#fff" /></div>
          <div>
            <h2 style={styles.pageTitle}>Goods Receipts</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany ? `${totalCount} receipt${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` : "Select a company"}
            </p>
          </div>
        </div>
        {companies.length > 0 && canCreate && (
          <button style={styles.addBtn} onClick={() => { setEditingId(null); setShowForm(true); }}>
            <MdAdd size={18} /> New Receipt
          </button>
        )}
      </div>

      {loadingCompanies ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : companies.length === 0 ? (
        <div style={styles.empty}>No companies available.</div>
      ) : (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""} onChange={e => setSelectedCompany(companies.find(c => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>

          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap">
                <MdSearch size={15} className="filter-search-icon" />
                <input type="text" placeholder="Search GR#, supplier, item..." className="filter-search-input" value={search} onChange={onFilterChange(setSearch)} />
              </div>
              <select className="filter-select" value={supplierFilter} onChange={onFilterChange(setSupplierFilter)}>
                <option value="">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {canPrint && <PrintTemplateSelect picker={tplPicker} />}
                {isBigScreen && (
                  <ViewModeToggle mode={viewMode} onChange={setViewMode} ariaLabel="Goods receipts view mode" />
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div style={styles.loading}><div style={styles.spinner} /></div>
          ) : receipts.length === 0 ? (
            <div style={styles.empty}>
              <MdInventory2 size={40} color={colors.cardBorder} />
              <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>No goods receipts yet.</p>
            </div>
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
              <div className="card-grid">
                {receipts.map(gr => (
                  <div key={gr.id} style={cardStyles.card}
                       onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
                       onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" })}>
                    <div style={cardStyles.cardContent}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "0.5rem" }}>
                          <h5 style={{ ...cardStyles.title, marginBottom: 0 }}>
                            <MdInventory2 style={{ color: colors.teal, marginRight: 6 }} />
                            GR #{gr.goodsReceiptNumber}
                          </h5>
                          <AttachmentBadge count={attachCounts[gr.id]} onClick={() => setAttachTarget(gr)} />
                        </div>
                        <p style={cardStyles.text}><strong>Supplier:</strong> {gr.supplierName}</p>
                        <p style={cardStyles.text}><strong>Date:</strong> {new Date(gr.receiptDate).toLocaleDateString()}</p>
                        {gr.purchaseBillNumber && <p style={cardStyles.text}><strong>Linked PB:</strong> #{gr.purchaseBillNumber}</p>}
                        {gr.supplierChallanNumber && <p style={cardStyles.text}><strong>Supplier DC:</strong> {gr.supplierChallanNumber}</p>}
                        <p style={{ ...cardStyles.text, fontSize: "0.74rem" }}>{gr.items?.length || 0} items · {gr.status}</p>
                      </div>
                      <div style={{ ...cardStyles.buttonGroup, flexWrap: "wrap" }}>
                        <button style={btnView} onClick={() => { setEditingId(gr.id); setShowForm(true); }}><MdVisibility size={14} /> View</button>
                        {canUpdate && <button style={btnEdit} onClick={() => { setEditingId(gr.id); setShowForm(true); }}><MdEdit size={14} /> Edit</button>}
                        {canPrint && <button style={{ ...btnPrint, opacity: tplPicker.noTemplate ? 0.5 : 1, cursor: tplPicker.noTemplate ? "not-allowed" : "pointer" }} disabled={tplPicker.noTemplate} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"} onClick={() => handlePrint(gr)}><MdPrint size={14} /> Print</button>}
                        {canPrint && <button style={{ ...btnPdf, opacity: tplPicker.noTemplate || exportingId === gr.id ? 0.5 : 1, cursor: tplPicker.noTemplate ? "not-allowed" : "pointer" }} onClick={() => handleExportPdf(gr)} disabled={tplPicker.noTemplate || !!exportingId} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Export PDF"}><MdPictureAsPdf size={14} /> PDF</button>}
                        {canDelete && <button style={btnDelete} onClick={() => handleDelete(gr)}><MdDelete size={14} /> Delete</button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              )}
              {totalPages > 1 && (
                <div style={styles.pagination}>
                  <button style={{ ...styles.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => setPage(page - 1)}><MdChevronLeft size={20} /> Prev</button>
                  <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
                  <button style={{ ...styles.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next <MdChevronRight size={20} /></button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {showForm && selectedCompany && (
        <GoodsReceiptForm
          companyId={selectedCompany.id}
          receiptId={editingId}
          onClose={() => { setShowForm(false); setEditingId(null); }}
          onSaved={() => { setShowForm(false); setEditingId(null); fetchReceipts(page); }}
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
  );
}

const styles = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, #00695c, #00897b)`, display: "flex", alignItems: "center", justifyContent: "center" },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center", color: colors.textSecondary },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
};
const baseBtn = { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" };
const btnView = { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" };
const btnEdit = { ...baseBtn, backgroundColor: "#fff3e0", color: "#e65100" };
const btnPrint = { ...baseBtn, backgroundColor: "#e8f5e9", color: "#1b5e20" };
const btnPdf = { ...baseBtn, backgroundColor: "#f3e5f5", color: "#6a1b9a" };
const btnDelete = { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" };
