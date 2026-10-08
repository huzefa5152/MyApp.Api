import DocumentLinesNavigation from "../Components/DocumentLinesNavigation";
import { useState, useEffect, useCallback } from "react";
import { MdRequestQuote, MdAdd, MdPrint, MdPictureAsPdf, MdEdit, MdDelete, MdSwapHoriz, MdVisibility, MdUploadFile, MdGridOn } from "react-icons/md";
import { saveAs } from "file-saver";
import { hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import SalesQuoteForm from "../Components/SalesQuoteForm";
import SalesQuoteDetailModal from "../Components/SalesQuoteDetailModal";
import Pagination from "../Components/Pagination";
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
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { PageHeader, CompanyPicker, Button, IconButton, Toolbar, ToolbarSpacer, SearchBox, Card, EmptyState, Loading } from "../ui/Kit";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";

// Status is derived server-side (never operator-set): Active / Expired / Accepted.
const STATUS_COLORS = { Active: "#1565c0", Expired: "#f57c00", Accepted: "#28a745" };

export default function SalesQuotePage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
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
  const [pageSize, setPageSize] = usePageSize("salesQuotes");
  const [observedSize, setObservedSize] = useState(null);
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
      if (pageSize) params.pageSize = pageSize;
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (clientFilter) params.clientId = clientFilter;
      const { data } = await getPagedSalesQuotesByCompany(companyId, params);
      setQuotes(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
      setObservedSize(data.pageSize ?? null);
    } catch { setQuotes([]); setTotalCount(0); setTotalPages(0); }
    finally { setLoading(false); }
  }, [page, pageSize, search, statusFilter, clientFilter]);

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
  }, [selectedCompany, page, pageSize, search, statusFilter, clientFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <DocumentLinesNavigation type="quote">
    <div>
      <PageHeader
        icon={MdRequestQuote}
        tone="brand"
        title="Sales Quotes"
        subtitle={selectedCompany ? `${totalCount} quote${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}` : "Select a company to view quotes"}
        actions={companies.length > 0 && (canCreate || canImportPo) ? (
          <>
            {canCreate && <Button variant="primary" icon={MdAdd} onClick={() => selectedCompany && (setEditQuote(null), setShowForm(true))}>New Quote</Button>}
            {canImportPo && <Button variant="teal" icon={MdUploadFile} onClick={() => selectedCompany && setShowImport(true)}>Import Enquiry / Demand</Button>}
          </>
        ) : null}
      />

      {loadingCompanies ? <Loading>Loading companies...</Loading> : companies.length > 0 ? (
        <>
          <CompanyPicker />
          {selectedCompany && (
            <Toolbar>
              <SearchBox placeholder="Search Quote#, Client, Enquiry..." value={search} onChange={(text) => { setSearch(text); setPage(1); }} />
              <select className="k-select" aria-label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">All Status</option>
                {["Active", "Expired", "Accepted"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <SearchableClientSelect
                clients={clients}
                value={clientFilter}
                onChange={(id) => { setClientFilter(String(id)); setPage(1); }}
                placeholder="All Clients"
                style={{ flex: "1 1 200px", maxWidth: 260 }}
              />
              <ToolbarSpacer />
              <PrintTemplateSelect picker={tplPicker} />
            </Toolbar>
          )}
        </>
      ) : <EmptyState icon={MdRequestQuote}>No companies available. Add a company first.</EmptyState>}

      {loading ? <Loading>Loading quotes...</Loading> : quotes.length === 0 && selectedCompany ? (
        <EmptyState icon={MdRequestQuote}>No sales quotes found.</EmptyState>
      ) : (
        <>
          <div style={st.grid}>
            {quotes.map((q) => (
              <Card key={q.id} style={st.card}>
                <div style={st.cardTop}>
                  <span style={st.qNum}>Quote #{q.quoteNumber}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <AttachmentBadge count={attachCounts[q.id]} onClick={() => setAttachTarget(q)} />
                    <span style={{ ...st.badge, background: `${STATUS_COLORS[q.status] || "#5f6d7e"}18`, color: STATUS_COLORS[q.status] || "#5f6d7e" }}>{q.status}</span>
                    {Number(q.subtotal) === 0 && <span style={{ ...st.badge, color: "#9a5700", background: "#fff3e0" }}>Needs pricing</span>}
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
                  <IconButton style={st.actBtn} icon={MdVisibility} size={16} label="View" onClick={() => setViewQuote(q)} />
                  {canUpdate && q.isEditable && <IconButton style={st.actBtn} icon={MdEdit} size={16} label="Edit" onClick={() => { setEditQuote(q); setShowForm(true); }} />}
                  {canPrint && <IconButton style={st.actBtn} icon={MdPrint} size={16} label={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"} onClick={() => handlePrint(q)} disabled={tplPicker.noTemplate} />}
                  {canPrint && <IconButton style={{ ...st.actBtn, opacity: exportingId === q.id ? 0.5 : undefined }} icon={MdPictureAsPdf} size={16} label={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Download PDF"} onClick={() => handleExportPdf(q)} disabled={tplPicker.noTemplate || !!exportingId} />}
                  {canPrint && hasExcelTpl && <IconButton style={{ ...st.actBtn, color: "#2e7d32", opacity: exportingId === q.id + "-excel" ? 0.5 : undefined }} icon={MdGridOn} size={16} label="Download Excel" onClick={() => handleExportExcel(q)} disabled={!!exportingId} />}
                  {canConvert && q.status !== "Accepted" && <IconButton style={{ ...st.actBtn, color: "var(--k-teal)" }} icon={MdSwapHoriz} size={16} label="Convert to Sales Order" onClick={() => handleConvert(q)} />}
                  {canDelete && <IconButton danger style={{ ...st.actBtn, color: "var(--k-danger)" }} icon={MdDelete} size={16} label="Delete" onClick={() => handleDelete(q)} />}
                </div>
              </Card>
            ))}
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

      {showForm && selectedCompany && (
        <SalesQuoteForm companyId={selectedCompany.id} quote={editQuote} onClose={() => { setShowForm(false); setEditQuote(null); refreshAttachCounts(); }} onSaved={handleSave} />
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
    </DocumentLinesNavigation>
  );
}

const fmtDate = (d) => { if (!d) return ""; const dt = new Date(d); const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${String(dt.getDate()).padStart(2,"0")}-${m[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; };
const st = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: "var(--k-gap)" },
  card: { marginTop: 0 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  qNum: { fontWeight: 800, fontSize: "calc(var(--k-font) + 0.1rem)", color: "var(--k-blue)" },
  badge: { fontSize: "0.72rem", fontWeight: 700, padding: "0.15rem 0.6rem", borderRadius: 20 },
  client: { marginTop: "0.5rem", fontWeight: 600, color: "var(--k-ink)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  metaRow: { display: "flex", justifyContent: "space-between", marginTop: "0.35rem", fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  meta: { marginTop: "0.2rem", fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  total: { marginTop: "0.5rem", fontWeight: 800, fontSize: "calc(var(--k-font) + 0.2rem)", color: "var(--k-ink)" },
  subMeta: { marginTop: "0.1rem", fontSize: "0.74rem", color: "var(--k-muted)" },
  converted: { marginTop: "0.3rem", fontSize: "var(--k-font-sm)", color: "var(--k-teal)", fontWeight: 600 },
  actions: { display: "flex", gap: "0.4rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "center" },
  actBtn: { borderColor: "var(--k-line)", background: "var(--k-surface)", color: "var(--k-blue)" },
};
