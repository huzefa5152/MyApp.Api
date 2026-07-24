import { useState, useEffect, useCallback } from "react";
import { MdRequestQuote, MdAdd, MdBusiness, MdSearch, MdChevronLeft, MdChevronRight, MdPrint, MdPictureAsPdf, MdEdit, MdDelete, MdSwapHoriz, MdVisibility, MdUploadFile, MdGridOn } from "react-icons/md";
import { saveAs } from "file-saver";
import { hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import SalesQuoteForm from "../Components/SalesQuoteForm";
import SalesQuoteDetailModal from "../Components/SalesQuoteDetailModal";
import POImportForm from "../Components/POImportForm";
import AttachmentBadge from "../Components/AttachmentBadge";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import {
  getPagedSalesQuotesByCompany, createSalesQuote, updateSalesQuote,
  deleteSalesQuote, convertQuoteToOrder, getSalesQuotePrintData,
} from "../api/salesQuoteApi";
import { getClientsByCompany } from "../api/clientApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { defaultQuoteTemplate } from "../utils/salesDocTemplates";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBorder: "#d0d7e2" };

// Status is derived server-side (never operator-set): Active / Expired / Accepted.
const STATUS_COLORS = { Active: "#1565c0", Expired: "#f57c00", Accepted: "#28a745" };

export default function SalesQuotePage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const tplPicker = usePrintTemplates("SalesQuote");
  const { has } = usePermissions();
  const canCreate = has("salesquotes.manage.create");
  const canUpdate = has("salesquotes.manage.update");
  const canDelete = has("salesquotes.manage.delete");
  const canPrint = has("salesquotes.print.view");
  const canConvert = has("salesorders.manage.create");
  const canImportPo = canCreate && has("poformats.import.create");

  const [quotes, setQuotes] = useState([]);
  const [viewQuote, setViewQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editQuote, setEditQuote] = useState(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [clients, setClients] = useState([]);
  const [hasExcelTpl, setHasExcelTpl] = useState(false);
  const [attachTarget, setAttachTarget] = useState(null);
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(selectedCompany?.id, "SalesQuote", quotes.map((q) => q.id));

  const fetchQuotes = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (clientFilter) params.clientId = clientFilter;
      const { data } = await getPagedSalesQuotesByCompany(companyId, params);
      setQuotes(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
    } catch { setQuotes([]); setTotalCount(0); setTotalPages(0); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, clientFilter]);

  // Reset paging + filters and load the client list when the company changes.
  useEffect(() => {
    setPage(1); setSearch(""); setStatusFilter(""); setClientFilter("");
    if (selectedCompany) {
      getClientsByCompany(selectedCompany.id).then(({ data }) => setClients(data || [])).catch(() => setClients([]));
      hasExcelTemplate(selectedCompany.id, "SalesQuote").then((r) => setHasExcelTpl(!!r.data.hasExcelTemplate)).catch(() => setHasExcelTpl(false));
    } else { setClients([]); setQuotes([]); setHasExcelTpl(false); }
  }, [selectedCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch whenever the company, page, or any filter changes.
  useEffect(() => {
    if (selectedCompany) fetchQuotes(selectedCompany.id, page);
    else setQuotes([]);
  }, [selectedCompany, page, search, statusFilter, clientFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => selectedCompany && fetchQuotes(selectedCompany.id, page);

  const handleSave = async (payload) => {
    const res = editQuote
      ? await updateSalesQuote(editQuote.id, payload)
      : await createSalesQuote(selectedCompany.id, payload);
    reload();
    notify(editQuote ? "Quote updated." : "Quote created.", "success");
    return res.data;
  };

  const handleConvert = async (q) => {
    const ok = await confirm({ title: "Convert to Sales Order?", message: `Create a Sales Order from Quote #${q.quoteNumber}? The order tracks delivery; pricing is set later at bill time.`, confirmText: "Convert" });
    if (!ok) return;
    try {
      const { data } = await convertQuoteToOrder(q.id);
      reload();
      notify(`Sales Order #${data.salesOrderNumber} created from this quote.`, "success");
    } catch (err) { notify(err.response?.data?.error || "Failed to convert.", "error"); }
  };

  const handleDelete = async (q) => {
    const linked = q.status === "Accepted" || q.convertedToSalesOrderNumber;
    const ok = await confirm({
      title: "Delete Quote?",
      message: linked
        ? `Delete Quote #${q.quoteNumber}? It's linked to a sales order — that link will be removed (the order keeps its items but no longer shows this quote number). This cannot be undone.`
        : `Delete Quote #${q.quoteNumber}? This cannot be undone.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try { await deleteSalesQuote(q.id); notify(`Quote #${q.quoteNumber} deleted.`, "success"); reload(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); }
  };

  const handlePrint = async (q) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading quote...</p>");
    try {
      const { data } = await getSalesQuotePrintData(q.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(q)?.htmlContent || defaultQuoteTemplate, data);
      writeAndPrint(w, html);
    } catch { w.close(); notify("Failed to load print data.", "error"); }
  };

  const [exportingId, setExportingId] = useState(null);

  const handleExportExcel = async (q) => {
    if (exportingId) return;
    setExportingId(q.id + "-excel");
    try {
      const { data } = await getSalesQuotePrintData(q.id);
      const res = await exportExcel(selectedCompany.id, "SalesQuote", data);
      saveAs(res.data, `Quote # ${q.quoteNumber} ${q.clientName}.xlsx`);
    } catch { notify("Failed to export Excel.", "error"); }
    finally { setExportingId(null); }
  };

  const handleExportPdf = async (q) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (exportingId) return;
    setExportingId(q.id);
    try {
      const { data } = await getSalesQuotePrintData(q.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(q)?.htmlContent || defaultQuoteTemplate, data);
      await exportToPdf(html, `Quote # ${q.quoteNumber} ${q.clientName}`);
    } catch { notify("Failed to export PDF.", "error"); }
    finally { setExportingId(null); }
  };

  return (
    <div>
      <div style={st.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={st.icon}><MdRequestQuote size={28} color="#fff" /></div>
          <div>
            <h2 style={st.title}>Sales Quotes</h2>
            <p style={st.subtitle}>{selectedCompany ? `${totalCount} quote${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` : "Select a company to view quotes"}</p>
          </div>
        </div>
        {companies.length > 0 && (canCreate || canImportPo) && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {canCreate && <button style={st.addBtn} onClick={() => selectedCompany && (setEditQuote(null), setShowForm(true))}><MdAdd size={18} /> New Quote</button>}
            {canImportPo && <button style={{ ...st.addBtn, background: colors.teal, boxShadow: "0 4px 14px rgba(0,137,123,0.25)" }} onClick={() => selectedCompany && setShowImport(true)}><MdUploadFile size={18} /> Import PO</button>}
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
                <input type="text" placeholder="Search Quote#, Client, Enquiry..." className="filter-search-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <select className="filter-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">All Status</option>
                {["Active", "Expired", "Accepted"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select className="filter-select" value={clientFilter} onChange={(e) => { setClientFilter(e.target.value); setPage(1); }}>
                <option value="">All Clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ marginLeft: "auto" }}><PrintTemplateSelect picker={tplPicker} /></div>
            </div>
          )}
        </>
      ) : <Empty label="No companies available. Add a company first." />}

      {loading ? <Spinner label="Loading quotes..." /> : quotes.length === 0 && selectedCompany ? (
        <Empty label="No sales quotes found." />
      ) : (
        <>
          <div style={st.grid}>
            {quotes.map((q) => (
              <div key={q.id} style={st.card}>
                <div style={st.cardTop}>
                  <span style={st.qNum}>Quote #{q.quoteNumber}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <AttachmentBadge count={attachCounts[q.id]} onClick={() => setAttachTarget(q)} />
                    <span style={{ ...st.badge, background: `${STATUS_COLORS[q.status] || "#5f6d7e"}18`, color: STATUS_COLORS[q.status] || "#5f6d7e" }}>{q.status}</span>
                  </div>
                </div>
                <div style={st.client}>{q.clientName}</div>
                <div style={st.metaRow}><span>{fmtDate(q.date)}</span><span>{q.items?.length || 0} item{(q.items?.length || 0) !== 1 ? "s" : ""}</span></div>
                {q.customerEnquiryRef && <div style={st.meta}>Enquiry: {q.customerEnquiryRef}</div>}
                {q.validUntil && <div style={st.meta}>Valid until: {fmtDate(q.validUntil)}</div>}
                <div style={st.total}>Rs {Number(q.grandTotal).toLocaleString()}</div>
                <div style={st.subMeta}>Subtotal Rs {Number(q.subtotal).toLocaleString()} · GST {q.gstRate}% (Rs {Number(q.gstAmount).toLocaleString()})</div>
                {q.convertedToSalesOrderNumber && <div style={st.converted}>→ Sales Order #{q.convertedToSalesOrderNumber}</div>}
                <div style={st.actions}>
                  <button style={st.actBtn} onClick={() => setViewQuote(q)} title="View"><MdVisibility size={16} /></button>
                  {canUpdate && q.isEditable && <button style={st.actBtn} onClick={() => { setEditQuote(q); setShowForm(true); }} title="Edit"><MdEdit size={16} /></button>}
                  {canPrint && <button style={{ ...st.actBtn, opacity: tplPicker.noTemplate ? 0.5 : 1, cursor: tplPicker.noTemplate ? "not-allowed" : "pointer" }} onClick={() => handlePrint(q)} disabled={tplPicker.noTemplate} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"}><MdPrint size={16} /></button>}
                  {canPrint && <button style={{ ...st.actBtn, opacity: tplPicker.noTemplate || exportingId === q.id ? 0.5 : 1, cursor: tplPicker.noTemplate ? "not-allowed" : "pointer" }} onClick={() => handleExportPdf(q)} disabled={tplPicker.noTemplate || !!exportingId} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Download PDF"}><MdPictureAsPdf size={16} /></button>}
                  {canPrint && hasExcelTpl && <button style={{ ...st.actBtn, color: "#2e7d32", opacity: exportingId === q.id + "-excel" ? 0.5 : 1 }} onClick={() => handleExportExcel(q)} disabled={!!exportingId} title="Download Excel"><MdGridOn size={16} /></button>}
                  {canConvert && q.status !== "Accepted" && <button style={{ ...st.actBtn, color: colors.teal }} onClick={() => handleConvert(q)} title="Convert to Sales Order"><MdSwapHoriz size={16} /></button>}
                  {canDelete && <button style={{ ...st.actBtn, color: "#dc3545" }} onClick={() => handleDelete(q)} title="Delete"><MdDelete size={16} /></button>}
                </div>
              </div>
            ))}
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
        <SalesQuoteForm companyId={selectedCompany.id} quote={editQuote} onClose={() => { setShowForm(false); setEditQuote(null); }} onSaved={handleSave} />
      )}

      {showImport && selectedCompany && (
        <POImportForm
          companyId={selectedCompany.id}
          target="salesquote"
          onClose={() => setShowImport(false)}
          onSaved={() => { setShowImport(false); reload(); notify("Sales Quote created from PO.", "success"); }}
        />
      )}

      {attachTarget && selectedCompany && (
        <AttachmentQuickModal
          companyId={selectedCompany.id}
          entityType="SalesQuote"
          entityId={attachTarget.id}
          title={`Quote #${attachTarget.quoteNumber} — Attachments`}
          onClose={() => { setAttachTarget(null); refreshAttachCounts(); }}
        />
      )}

      {viewQuote && selectedCompany && (
        <SalesQuoteDetailModal
          quote={viewQuote}
          companyId={selectedCompany.id}
          canPrint={canPrint}
          onPrint={(q) => { setViewQuote(null); handlePrint(q); }}
          onClose={() => setViewQuote(null)}
        />
      )}
    </div>
  );
}

const fmtDate = (d) => { if (!d) return ""; const dt = new Date(d); const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${String(dt.getDate()).padStart(2,"0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; };
const Spinner = ({ label }) => <div style={st.loading}><div style={st.spin} /><span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>{label}</span></div>;
const Empty = ({ label }) => <div style={st.empty}><MdRequestQuote size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>{label}</p></div>;

const st = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  icon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "1rem" },
  card: { border: `1px solid ${colors.cardBorder}`, borderRadius: 14, padding: "1rem", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  qNum: { fontWeight: 800, fontSize: "1rem", color: colors.blue },
  badge: { fontSize: "0.72rem", fontWeight: 700, padding: "0.15rem 0.6rem", borderRadius: 20 },
  client: { marginTop: "0.5rem", fontWeight: 600, color: colors.textPrimary, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  metaRow: { display: "flex", justifyContent: "space-between", marginTop: "0.35rem", fontSize: "0.8rem", color: colors.textSecondary },
  meta: { marginTop: "0.2rem", fontSize: "0.78rem", color: colors.textSecondary },
  total: { marginTop: "0.5rem", fontWeight: 800, fontSize: "1.1rem", color: colors.textPrimary },
  subMeta: { marginTop: "0.1rem", fontSize: "0.74rem", color: colors.textSecondary },
  converted: { marginTop: "0.3rem", fontSize: "0.78rem", color: colors.teal, fontWeight: 600 },
  actions: { display: "flex", gap: "0.4rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "center" },
  actBtn: { display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, cursor: "pointer" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 0" },
  spin: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
};
