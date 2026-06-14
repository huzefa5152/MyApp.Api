import { useState, useEffect, useCallback } from "react";
import { MdRequestQuote, MdAdd, MdBusiness, MdSearch, MdChevronLeft, MdChevronRight, MdPrint, MdEdit, MdDelete, MdSwapHoriz } from "react-icons/md";
import SalesQuoteForm from "../Components/SalesQuoteForm";
import {
  getPagedSalesQuotesByCompany, createSalesQuote, updateSalesQuote,
  deleteSalesQuote, setSalesQuoteStatus, convertQuoteToOrder, getSalesQuotePrintData,
} from "../api/salesQuoteApi";
import { getTemplate } from "../api/printTemplateApi";
import { getClientsByCompany } from "../api/clientApi";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultQuoteTemplate } from "../utils/salesDocTemplates";
import { dropdownStyles } from "../theme";
import DivisionSelect from "../Components/DivisionSelect";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3", inputBorder: "#d0d7e2" };

const STATUS_COLORS = {
  Draft: "#5f6d7e", Sent: "#1565c0", Accepted: "#28a745", Rejected: "#dc3545", Expired: "#f57c00", Converted: "#00897b",
};
const STATUS_OPTIONS = ["Draft", "Sent", "Accepted", "Rejected", "Expired"];

export default function SalesQuotePage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("salesquotes.manage.create");
  const canUpdate = has("salesquotes.manage.update");
  const canDelete = has("salesquotes.manage.delete");
  const canPrint = has("salesquotes.print.view");
  const canConvert = has("salesorders.manage.create");

  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editQuote, setEditQuote] = useState(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [clients, setClients] = useState([]);

  const fetchQuotes = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (divisionFilter) params.divisionId = divisionFilter;
      if (clientFilter) params.clientId = clientFilter;
      const { data } = await getPagedSalesQuotesByCompany(companyId, params);
      setQuotes(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
    } catch { setQuotes([]); setTotalCount(0); setTotalPages(0); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, divisionFilter, clientFilter]);

  // Reset paging + filters and load the client list when the company changes.
  useEffect(() => {
    setPage(1); setSearch(""); setStatusFilter(""); setDivisionFilter(""); setClientFilter("");
    if (selectedCompany) {
      getClientsByCompany(selectedCompany.id).then(({ data }) => setClients(data || [])).catch(() => setClients([]));
    } else { setClients([]); setQuotes([]); }
  }, [selectedCompany]);

  // Fetch whenever the company, page, or any filter changes.
  useEffect(() => {
    if (selectedCompany) fetchQuotes(selectedCompany.id, page);
    else setQuotes([]);
  }, [selectedCompany, page, search, statusFilter, divisionFilter, clientFilter]);

  const reload = () => selectedCompany && fetchQuotes(selectedCompany.id, page);

  const handleSave = async (payload) => {
    if (editQuote) await updateSalesQuote(editQuote.id, payload);
    else await createSalesQuote(selectedCompany.id, payload);
    reload();
    setShowForm(false);
    setEditQuote(null);
    notify(editQuote ? "Quote updated." : "Quote created.", "success");
  };

  const handleStatus = async (q, status) => {
    try { await setSalesQuoteStatus(q.id, status); reload(); }
    catch (err) { notify(err.response?.data?.error || "Failed to update status.", "error"); }
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
    const ok = await confirm({ title: "Delete Quote?", message: `Delete Quote #${q.quoteNumber}? This cannot be undone.`, variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try { await deleteSalesQuote(q.id); reload(); }
    catch (err) { notify(err.response?.data?.error || "Failed to delete.", "error"); }
  };

  const handlePrint = async (q) => {
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading quote...</p>");
    try {
      const { data } = await getSalesQuotePrintData(q.id);
      let template = defaultQuoteTemplate;
      try { const res = await getTemplate(selectedCompany.id, "SalesQuote"); if (res.data?.htmlContent) template = res.data.htmlContent; } catch { /* default */ }
      const html = mergeTemplate(template, data);
      w.document.open(); w.document.write(html); w.document.close(); w.focus();
      w.onafterprint = () => w.close();
      w.print();
    } catch { w.close(); notify("Failed to load print data.", "error"); }
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
        {companies.length > 0 && canCreate && (
          <button style={st.addBtn} onClick={() => selectedCompany && (setEditQuote(null), setShowForm(true))}><MdAdd size={18} /> New Quote</button>
        )}
      </div>

      {loadingCompanies ? <Spinner label="Loading companies..." /> : companies.length > 0 ? (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""} onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
            <DivisionSelect companyId={selectedCompany?.id} value={divisionFilter} onChange={(v) => { setDivisionFilter(v); setPage(1); }} style={dropdownStyles.base} />
          </div>
          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap">
                <MdSearch size={15} className="filter-search-icon" />
                <input type="text" placeholder="Search Quote#, Client, Enquiry..." className="filter-search-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <select className="filter-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">All Status</option>
                {["Draft", "Sent", "Accepted", "Rejected", "Expired", "Converted"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select className="filter-select" value={clientFilter} onChange={(e) => { setClientFilter(e.target.value); setPage(1); }}>
                <option value="">All Clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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
                  <span style={{ ...st.badge, background: `${STATUS_COLORS[q.status] || "#5f6d7e"}18`, color: STATUS_COLORS[q.status] || "#5f6d7e" }}>{q.status}</span>
                </div>
                <div style={st.client}>{q.clientName}</div>
                <div style={st.metaRow}><span>{fmtDate(q.date)}</span><span>{q.items?.length || 0} item{(q.items?.length || 0) !== 1 ? "s" : ""}</span></div>
                {q.divisionName && <span style={st.divisionChip}>{q.divisionName}</span>}
                {q.customerEnquiryRef && <div style={st.meta}>Enquiry: {q.customerEnquiryRef}</div>}
                {q.validUntil && <div style={st.meta}>Valid until: {fmtDate(q.validUntil)}</div>}
                <div style={st.total}>Rs {Number(q.grandTotal).toLocaleString()}</div>
                <div style={st.subMeta}>Subtotal Rs {Number(q.subtotal).toLocaleString()} · GST {q.gstRate}% (Rs {Number(q.gstAmount).toLocaleString()})</div>
                {q.convertedToSalesOrderNumber && <div style={st.converted}>→ Sales Order #{q.convertedToSalesOrderNumber}</div>}
                <div style={st.actions}>
                  {canUpdate && q.isEditable && <button style={st.actBtn} onClick={() => { setEditQuote(q); setShowForm(true); }} title="Edit"><MdEdit size={16} /></button>}
                  {canPrint && <button style={st.actBtn} onClick={() => handlePrint(q)} title="Print"><MdPrint size={16} /></button>}
                  {canConvert && q.status !== "Converted" && <button style={{ ...st.actBtn, color: colors.teal }} onClick={() => handleConvert(q)} title="Convert to Sales Order"><MdSwapHoriz size={16} /></button>}
                  {canUpdate && q.status !== "Converted" && (
                    <select style={st.statusSelect} value={q.status} onChange={(e) => handleStatus(q, e.target.value)} title="Set status">
                      {STATUS_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  )}
                  {canDelete && q.isLatest && q.status !== "Converted" && <button style={{ ...st.actBtn, color: "#dc3545" }} onClick={() => handleDelete(q)} title="Delete"><MdDelete size={16} /></button>}
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
        <SalesQuoteForm companyId={selectedCompany.id} quote={editQuote} defaultDivisionId={editQuote ? null : divisionFilter} onClose={() => { setShowForm(false); setEditQuote(null); }} onSaved={handleSave} />
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
  divisionChip: { display: "inline-block", marginTop: "0.35rem", fontSize: "0.72rem", fontWeight: 700, color: colors.blue, background: "#e3f0ff", padding: "0.12rem 0.55rem", borderRadius: 6 },
  total: { marginTop: "0.5rem", fontWeight: 800, fontSize: "1.1rem", color: colors.textPrimary },
  subMeta: { marginTop: "0.1rem", fontSize: "0.74rem", color: colors.textSecondary },
  converted: { marginTop: "0.3rem", fontSize: "0.78rem", color: colors.teal, fontWeight: 600 },
  actions: { display: "flex", gap: "0.4rem", marginTop: "0.75rem", flexWrap: "wrap", alignItems: "center" },
  // grid + placeItems centres the icon WITHOUT the flexbox quirk that
  // collapses a lone react-icon SVG to width:0 inside a fixed-width flex button.
  actBtn: { display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, cursor: "pointer" },
  statusSelect: { padding: "0.3rem 0.4rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, fontSize: "0.78rem", color: colors.textSecondary, background: "#fff", cursor: "pointer" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 0" },
  spin: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
};
