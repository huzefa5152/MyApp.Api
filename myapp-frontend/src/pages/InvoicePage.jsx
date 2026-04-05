import { useState, useEffect, useCallback } from "react";
import { MdReceipt, MdAdd, MdBusiness, MdPrint, MdDescription, MdSearch, MdChevronLeft, MdChevronRight } from "react-icons/md";
import InvoiceForm from "../Components/InvoiceForm";
import { getPagedInvoicesByCompany, getInvoicePrintBill, getInvoicePrintTaxInvoice } from "../api/invoiceApi";
import { getCompanies } from "../api/companyApi";
import { getClientsByCompany } from "../api/clientApi";
import { dropdownStyles, cardStyles, cardHover } from "../theme";
import { getTemplate } from "../api/printTemplateApi";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultBillTemplate, defaultTaxInvoiceTemplate } from "../utils/defaultTemplates";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function InvoicePage() {
  const [companies, setCompanies] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Pagination & filters
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchCompanies = async () => {
    setLoadingCompanies(true);
    try {
      const { data } = await getCompanies();
      setCompanies(data);
      if (!selectedCompany && data.length > 0) setSelectedCompany(data[0]);
    } catch { alert("Failed to load companies."); }
    finally { setLoadingCompanies(false); }
  };

  const fetchClients = async (companyId) => {
    try {
      const { data } = await getClientsByCompany(companyId);
      setClients(data);
    } catch { setClients([]); }
  };

  const fetchInvoices = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoadingInvoices(true);
    try {
      const params = { page: pg || page };
      if (search) params.search = search;
      if (clientFilter) params.clientId = clientFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await getPagedInvoicesByCompany(companyId, params);
      setInvoices(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
    } catch { setInvoices([]); setTotalCount(0); setTotalPages(0); }
    finally { setLoadingInvoices(false); }
  }, [page, search, clientFilter, dateFrom, dateTo]);

  useEffect(() => { fetchCompanies(); }, []);

  useEffect(() => {
    if (selectedCompany) {
      fetchClients(selectedCompany.id);
      setPage(1);
      fetchInvoices(selectedCompany.id, 1);
    } else {
      setInvoices([]);
      setClients([]);
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany) fetchInvoices(selectedCompany.id, page);
  }, [page, search, clientFilter, dateFrom, dateTo]);

  const resetFilters = () => {
    setSearch(""); setClientFilter(""); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const handleFilterChange = (setter) => (e) => { setter(e.target.value); setPage(1); };

  const handleCreated = () => {
    setShowForm(false);
    fetchInvoices(selectedCompany.id, page);
  };

  const handlePrintBill = async (inv) => {
    const w = window.open("", "_blank");
    if (!w) { alert("Popup blocked. Please allow popups for this site."); return; }
    w.document.write("<p>Loading bill...</p>");
    try {
      const { data } = await getInvoicePrintBill(inv.id);
      let template = defaultBillTemplate;
      try {
        const res = await getTemplate(selectedCompany.id, "Bill");
        if (res.data?.htmlContent) template = res.data.htmlContent;
      } catch { /* use default */ }
      const html = mergeTemplate(template, data);
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      w.onafterprint = () => w.close();
      w.print();
    } catch { w.close(); alert("Failed to load bill data."); }
  };

  const handlePrintTax = async (inv) => {
    const w = window.open("", "_blank");
    if (!w) { alert("Popup blocked. Please allow popups for this site."); return; }
    w.document.write("<p>Loading tax invoice...</p>");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      let template = defaultTaxInvoiceTemplate;
      try {
        const res = await getTemplate(selectedCompany.id, "TaxInvoice");
        if (res.data?.htmlContent) template = res.data.htmlContent;
      } catch { /* use default */ }
      const html = mergeTemplate(template, data);
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      w.onafterprint = () => w.close();
      w.print();
    } catch { w.close(); alert("Failed to load tax invoice data."); }
  };

  const hasFilters = search || clientFilter || dateFrom || dateTo;

  return (
    <div>
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdReceipt size={28} color="#fff" /></div>
          <div>
            <h2 style={styles.pageTitle}>Invoices</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany ? `${totalCount} invoice${totalCount !== 1 ? "s" : ""} for ${selectedCompany.name}` : "Select a company"}
            </p>
          </div>
        </div>
        {companies.length > 0 && (
          <button style={styles.addBtn} onClick={() => setShowForm(true)}>
            <MdAdd size={18} /> New Invoice
          </button>
        )}
      </div>

      {loadingCompanies ? (
        <div style={styles.loadingContainer}><div style={styles.spinner} /></div>
      ) : companies.length > 0 ? (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={dropdownStyles.base}
              value={selectedCompany?.id || ""}
              onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Filters */}
          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap">
                <MdSearch size={15} className="filter-search-icon" />
                <input
                  type="text"
                  placeholder="Search Invoice#, Client..."
                  className="filter-search-input"
                  value={search}
                  onChange={handleFilterChange(setSearch)}
                />
              </div>
              <select className="filter-select" value={clientFilter} onChange={handleFilterChange(setClientFilter)}>
                <option value="">All Clients</option>
                {clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
              </select>
              <div className="filter-date-group">
                <input type="date" className="filter-date-input" value={dateFrom} onChange={handleFilterChange(setDateFrom)} title="From date" />
                <span className="filter-date-sep">–</span>
                <input type="date" className="filter-date-input" value={dateTo} onChange={handleFilterChange(setDateTo)} title="To date" />
              </div>
              {hasFilters && (
                <button className="filter-clear-btn" onClick={resetFilters}>Clear</button>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={styles.emptyState}><p style={{ color: colors.textSecondary }}>No companies available.</p></div>
      )}

      {loadingInvoices ? (
        <div style={styles.loadingContainer}><div style={styles.spinner} /></div>
      ) : invoices.length === 0 && selectedCompany ? (
        <div style={styles.emptyState}>
          <MdReceipt size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
            {hasFilters ? "No invoices match the current filters." : "No invoices found. Create one from pending challans."}
          </p>
        </div>
      ) : (
        <>
          <div className="card-grid">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                style={cardStyles.card}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
                onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" })}
              >
                <div style={cardStyles.cardContent}>
                  <div>
                    <h5 style={cardStyles.title}>
                      <MdReceipt style={{ color: colors.blue, marginRight: 6 }} />
                      Invoice #{inv.invoiceNumber}
                    </h5>
                    <p style={cardStyles.text}><strong>Client:</strong> {inv.clientName}</p>
                    <p style={cardStyles.text}><strong>Date:</strong> {new Date(inv.date).toLocaleDateString()}</p>
                    <p style={cardStyles.text}><strong>Grand Total:</strong> Rs. {inv.grandTotal?.toLocaleString()}</p>
                    <p style={{ ...cardStyles.text, fontSize: "0.78rem", color: colors.textSecondary }}>
                      DC#{inv.challanNumbers?.join(", #")} | {inv.items?.length} items
                    </p>
                  </div>
                  <div style={{ ...cardStyles.buttonGroup, flexWrap: "wrap" }}>
                    <button style={styles.printBtn} onClick={() => handlePrintBill(inv)}>
                      <MdPrint size={14} /> Bill
                    </button>
                    <button style={styles.taxBtn} onClick={() => handlePrintTax(inv)}>
                      <MdDescription size={14} /> Tax Invoice
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button
                style={{ ...styles.pageBtn, opacity: page <= 1 ? 0.4 : 1 }}
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <MdChevronLeft size={20} /> Prev
              </button>
              <span style={styles.pageInfo}>
                Page {page} of {totalPages} ({totalCount} total)
              </span>
              <button
                style={{ ...styles.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }}
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next <MdChevronRight size={20} />
              </button>
            </div>
          )}
        </>
      )}

      {showForm && selectedCompany && (
        <InvoiceForm
          companyId={selectedCompany.id}
          company={selectedCompany}
          onClose={() => setShowForm(false)}
          onSaved={handleCreated}
        />
      )}
    </div>
  );
}

const styles = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center" },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  loadingContainer: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
  printBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", backgroundColor: "#f3e5f5", color: "#7b1fa2" },
  taxBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", backgroundColor: "#e8f5e9", color: "#2e7d32" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
};
