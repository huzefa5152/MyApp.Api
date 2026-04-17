import { useState, useEffect, useCallback } from "react";
import { MdReceipt, MdAdd, MdBusiness, MdPrint, MdDescription, MdSearch, MdChevronLeft, MdChevronRight, MdPictureAsPdf, MdGridOn, MdCloudUpload, MdCheckCircle, MdError, MdDelete, MdEdit } from "react-icons/md";
import InvoiceForm from "../Components/InvoiceForm";
import EditBillForm from "../Components/EditBillForm";
import { getPagedInvoicesByCompany, getInvoicePrintBill, getInvoicePrintTaxInvoice, deleteInvoice } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { submitInvoiceToFbr, validateInvoiceWithFbr } from "../api/fbrApi";
import { dropdownStyles, cardStyles, cardHover } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { getTemplate, hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultBillTemplate, defaultTaxInvoiceTemplate } from "../utils/defaultTemplates";
import { exportToPdf } from "../utils/exportUtils";
import { saveAs } from "file-saver";
import { notify } from "../utils/notify";

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
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Pagination & filters
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hasExcelBill, setHasExcelBill] = useState(false);
  const [hasExcelTax, setHasExcelTax] = useState(false);
  const [exportingId, setExportingId] = useState(null);

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

  useEffect(() => {
    if (selectedCompany) {
      fetchClients(selectedCompany.id);
      setPage(1);
      fetchInvoices(selectedCompany.id, 1);
      hasExcelTemplate(selectedCompany.id, "Bill")
        .then(r => setHasExcelBill(r.data.hasExcelTemplate))
        .catch(() => setHasExcelBill(false));
      hasExcelTemplate(selectedCompany.id, "TaxInvoice")
        .then(r => setHasExcelTax(r.data.hasExcelTemplate))
        .catch(() => setHasExcelTax(false));
    } else {
      setInvoices([]);
      setClients([]);
      setHasExcelBill(false);
      setHasExcelTax(false);
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
    setPage(1);
    fetchInvoices(selectedCompany.id, 1);
  };

  const handlePrintBill = async (inv) => {
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
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
    } catch { w.close(); notify("Failed to load bill data.", "error"); }
  };

  const handlePrintTax = async (inv) => {
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
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
    } catch { w.close(); notify("Failed to load tax invoice data.", "error"); }
  };

  const handleExportBillPdf = async (inv) => {
    if (exportingId) return;
    setExportingId(inv.id + "-bill-pdf");
    try {
      const { data } = await getInvoicePrintBill(inv.id);
      let template = defaultBillTemplate;
      try {
        const res = await getTemplate(selectedCompany.id, "Bill");
        if (res.data?.htmlContent) template = res.data.htmlContent;
      } catch { /* use default */ }
      const html = mergeTemplate(template, data);
      await exportToPdf(html, `Bill # ${data.invoiceNumber} ${data.clientName}`);
    } catch { notify("Failed to export Bill PDF.", "error"); }
    finally { setExportingId(null); }
  };

  const handleExportBillExcel = async (inv) => {
    if (exportingId) return;
    setExportingId(inv.id + "-bill-excel");
    try {
      const { data } = await getInvoicePrintBill(inv.id);
      const res = await exportExcel(selectedCompany.id, "Bill", data);
      saveAs(res.data, `Bill # ${data.invoiceNumber} ${data.clientName}.xlsx`);
    } catch { notify("Failed to export Bill Excel.", "error"); }
    finally { setExportingId(null); }
  };

  const handleExportTaxPdf = async (inv) => {
    if (exportingId) return;
    setExportingId(inv.id + "-tax-pdf");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      let template = defaultTaxInvoiceTemplate;
      try {
        const res = await getTemplate(selectedCompany.id, "TaxInvoice");
        if (res.data?.htmlContent) template = res.data.htmlContent;
      } catch { /* use default */ }
      const html = mergeTemplate(template, data);
      await exportToPdf(html, `Bill # ${data.invoiceNumber} ${data.buyerName || data.clientName}`);
    } catch { notify("Failed to export Tax Invoice PDF.", "error"); }
    finally { setExportingId(null); }
  };

  const handleExportTaxExcel = async (inv) => {
    if (exportingId) return;
    setExportingId(inv.id + "-tax-excel");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      const res = await exportExcel(selectedCompany.id, "TaxInvoice", data);
      saveAs(res.data, `Bill # ${data.invoiceNumber} ${data.buyerName || data.clientName}.xlsx`);
    } catch { notify("Failed to export Tax Invoice Excel.", "error"); }
    finally { setExportingId(null); }
  };

  const [fbrLoading, setFbrLoading] = useState(null);
  const [fbrValidated, setFbrValidated] = useState(new Set());

  const handleFbrValidate = async (inv) => {
    setFbrLoading(inv.id + "-validate");
    try {
      const { data } = await validateInvoiceWithFbr(inv.id);
      if (data.success) {
        notify("FBR validation passed! You can now submit this invoice.", "success");
        setFbrValidated(prev => new Set(prev).add(inv.id));
      } else {
        notify(`FBR validation failed: ${data.errorMessage}`, "error");
        setFbrValidated(prev => { const s = new Set(prev); s.delete(inv.id); return s; });
      }
    } catch (err) {
      notify(err.response?.data?.errorMessage || "FBR validation failed.", "error");
      setFbrValidated(prev => { const s = new Set(prev); s.delete(inv.id); return s; });
    } finally { setFbrLoading(null); }
  };

  const handleFbrSubmit = async (inv) => {
    if (!fbrValidated.has(inv.id)) {
      notify("Please validate with FBR first before submitting.", "error");
      return;
    }
    if (!confirm(`Submit Bill #${inv.invoiceNumber} to FBR? This action cannot be undone.`)) return;
    setFbrLoading(inv.id + "-submit");
    try {
      const { data } = await submitInvoiceToFbr(inv.id);
      if (data.success) {
        notify(`Submitted to FBR! IRN: ${data.irn}`, "success");
        setFbrValidated(prev => { const s = new Set(prev); s.delete(inv.id); return s; });
        fetchInvoices(selectedCompany.id, page);
      } else {
        notify(`FBR submission failed: ${data.errorMessage}`, "error");
        fetchInvoices(selectedCompany.id, page);
      }
    } catch (err) {
      notify(err.response?.data?.errorMessage || "FBR submission failed.", "error");
      fetchInvoices(selectedCompany.id, page);
    } finally { setFbrLoading(null); }
  };

  const handleDeleteInvoice = async (inv) => {
    if (inv.fbrStatus === "Submitted") {
      notify("Cannot delete an FBR-submitted bill.", "error");
      return;
    }
    if (!confirm(`Delete Bill #${inv.invoiceNumber}? This will revert linked challans back to Pending.`)) return;
    try {
      await deleteInvoice(inv.id);
      notify(`Bill #${inv.invoiceNumber} deleted.`, "success");
      fetchInvoices(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete bill.", "error");
    }
  };

  const [bulkFbrLoading, setBulkFbrLoading] = useState(false);

  // Get unsubmitted invoices for bulk operations
  const unsubmittedInvoices = invoices.filter(inv => inv.fbrStatus !== "Submitted");
  const validatedCount = unsubmittedInvoices.filter(inv => fbrValidated.has(inv.id)).length;

  const handleBulkValidateAll = async () => {
    if (unsubmittedInvoices.length === 0) { notify("No invoices to validate.", "info"); return; }
    setBulkFbrLoading(true);
    let passed = 0, failed = 0;
    for (const inv of unsubmittedInvoices) {
      if (fbrValidated.has(inv.id)) { passed++; continue; }
      setFbrLoading(inv.id + "-validate");
      try {
        const { data } = await validateInvoiceWithFbr(inv.id);
        if (data.success) {
          setFbrValidated(prev => new Set(prev).add(inv.id));
          passed++;
        } else {
          failed++;
          // Stop bulk if token/connection error (affects all invoices)
          const msg = data.errorMessage || "";
          if (msg.includes("token") || msg.includes("authentication") || msg.includes("Cannot connect")) {
            notify(msg, "error");
            break;
          }
        }
      } catch (err) {
        failed++;
        const msg = err.response?.data?.errorMessage || err.message || "";
        if (msg.includes("token") || msg.includes("authentication") || msg.includes("Cannot connect") || err.code === "ERR_NETWORK") {
          notify(msg || "Cannot connect to FBR. Check your connection and FBR token.", "error");
          break;
        }
      }
      setFbrLoading(null);
    }
    setFbrLoading(null);
    if (passed > 0 || failed > 0)
      notify(`Validation complete: ${passed} passed, ${failed} failed.`, failed > 0 ? "error" : "success");
    setBulkFbrLoading(false);
  };

  const handleBulkSubmitValidated = async () => {
    const toSubmit = unsubmittedInvoices.filter(inv => fbrValidated.has(inv.id));
    if (toSubmit.length === 0) { notify("No validated invoices to submit. Validate first.", "error"); return; }
    if (!confirm(`Submit ${toSubmit.length} validated invoice(s) to FBR? This cannot be undone.`)) return;
    setBulkFbrLoading(true);
    let submitted = 0, failed = 0;
    for (const inv of toSubmit) {
      setFbrLoading(inv.id + "-submit");
      try {
        const { data } = await submitInvoiceToFbr(inv.id);
        if (data.success) {
          setFbrValidated(prev => { const s = new Set(prev); s.delete(inv.id); return s; });
          submitted++;
        } else {
          failed++;
          const msg = data.errorMessage || "";
          if (msg.includes("token") || msg.includes("authentication") || msg.includes("Cannot connect")) {
            notify(msg, "error");
            break;
          }
        }
      } catch (err) {
        failed++;
        const msg = err.response?.data?.errorMessage || err.message || "";
        if (msg.includes("token") || msg.includes("authentication") || msg.includes("Cannot connect") || err.code === "ERR_NETWORK") {
          notify(msg || "Cannot connect to FBR. Check your connection and FBR token.", "error");
          break;
        }
      }
      setFbrLoading(null);
    }
    setFbrLoading(null);
    notify(`FBR submission: ${submitted} submitted, ${failed} failed.`, failed > 0 ? "error" : "success");
    fetchInvoices(selectedCompany.id, page);
    setBulkFbrLoading(false);
  };

  const hasFilters = search || clientFilter || dateFrom || dateTo;

  return (
    <div>
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdReceipt size={28} color="#fff" /></div>
          <div>
            <h2 style={styles.pageTitle}>Bills</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany ? `${totalCount} bill${totalCount !== 1 ? "s" : ""} for ${selectedCompany.name}` : "Select a company"}
            </p>
          </div>
        </div>
        {companies.length > 0 && (
          <button style={styles.addBtn} onClick={() => setShowForm(true)}>
            <MdAdd size={18} /> New Bill
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

          {/* FBR Bulk Actions */}
          {selectedCompany?.hasFbrToken && unsubmittedInvoices.length > 0 && (
            <div style={styles.fbrBulkBar}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <MdCloudUpload size={18} color="#0d47a1" />
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary }}>
                  FBR: {unsubmittedInvoices.length} unsubmitted{validatedCount > 0 ? `, ${validatedCount} validated` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  style={{ ...styles.fbrBulkBtn, ...styles.fbrBulkValidateBtn }}
                  disabled={bulkFbrLoading}
                  onClick={handleBulkValidateAll}
                >
                  {bulkFbrLoading ? <span className="btn-spinner" /> : <MdCheckCircle size={15} />}
                  Validate All
                </button>
                <button
                  style={{
                    ...styles.fbrBulkBtn, ...styles.fbrBulkSubmitBtn,
                    opacity: validatedCount === 0 ? 0.4 : 1,
                    cursor: validatedCount === 0 ? "not-allowed" : "pointer",
                  }}
                  disabled={bulkFbrLoading || validatedCount === 0}
                  onClick={handleBulkSubmitValidated}
                >
                  {bulkFbrLoading ? <span className="btn-spinner" /> : <MdCloudUpload size={15} />}
                  Submit {validatedCount > 0 ? `${validatedCount} ` : ""}to FBR
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap">
                <MdSearch size={15} className="filter-search-icon" />
                <input
                  type="text"
                  placeholder="Search Bill#, Challan#, PO#, Client, Item..."
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
                      Bill #{inv.invoiceNumber}
                    </h5>
                    <p style={cardStyles.text}><strong>Client:</strong> {inv.clientName}</p>
                    <p style={cardStyles.text}><strong>Date:</strong> {new Date(inv.date).toLocaleDateString()}</p>
                    <p style={cardStyles.text}><strong>Grand Total:</strong> Rs. {inv.grandTotal?.toLocaleString()}</p>
                    <p style={{ ...cardStyles.text, fontSize: "0.78rem", color: colors.textSecondary }}>
                      DC#{inv.challanNumbers?.join(", #")} | {inv.items?.length} items
                    </p>
                    {inv.fbrStatus && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.25rem" }}>
                        {inv.fbrStatus === "Submitted" && <MdCheckCircle size={14} color="#2e7d32" />}
                        {inv.fbrStatus === "Failed" && <MdError size={14} color="#c62828" />}
                        <span style={{ fontSize: "0.76rem", fontWeight: 600, color: inv.fbrStatus === "Submitted" ? "#2e7d32" : inv.fbrStatus === "Failed" ? "#c62828" : colors.textSecondary }}>
                          FBR: {inv.fbrStatus}
                        </span>
                        {inv.fbrIRN && <span style={{ fontSize: "0.72rem", color: colors.textSecondary }}>(IRN: {inv.fbrIRN})</span>}
                      </div>
                    )}
                    {inv.fbrStatus === "Failed" && inv.fbrErrorMessage && (
                      <p style={{ fontSize: "0.72rem", color: "#c62828", marginTop: "0.15rem", wordBreak: "break-word" }}>{inv.fbrErrorMessage}</p>
                    )}
                  </div>
                  <div style={{ ...cardStyles.buttonGroup, flexWrap: "wrap" }}>
                    <button style={styles.printBtn} onClick={() => handlePrintBill(inv)}>
                      <MdPrint size={14} /> Bill
                    </button>
                    <button style={styles.taxBtn} onClick={() => handlePrintTax(inv)}>
                      <MdDescription size={14} /> Tax Invoice
                    </button>
                    <button style={{ ...styles.pdfBtn, opacity: exportingId ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => handleExportBillPdf(inv)}>
                      {exportingId === inv.id + "-bill-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} Bill PDF
                    </button>
                    <button style={{ ...styles.pdfBtn, opacity: exportingId ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => handleExportTaxPdf(inv)}>
                      {exportingId === inv.id + "-tax-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} Tax PDF
                    </button>
                    {hasExcelBill && (
                      <button style={{ ...styles.excelBtn, opacity: exportingId ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => handleExportBillExcel(inv)}>
                        {exportingId === inv.id + "-bill-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Bill XLS
                      </button>
                    )}
                    {hasExcelTax && (
                      <button style={{ ...styles.excelBtn, opacity: exportingId ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => handleExportTaxExcel(inv)}>
                        {exportingId === inv.id + "-tax-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Tax XLS
                      </button>
                    )}
                    {selectedCompany?.hasFbrToken && inv.fbrStatus !== "Submitted" && (
                      <>
                        <button
                          style={{ ...styles.fbrValidateBtn, opacity: fbrLoading ? 0.5 : 1, ...(fbrValidated.has(inv.id) ? { backgroundColor: "#e8f5e9", color: "#2e7d32" } : {}) }}
                          disabled={!!fbrLoading}
                          onClick={() => handleFbrValidate(inv)}
                          title="Dry-run: checks all invoice data with FBR without recording it. Must pass before you can submit."
                        >
                          {fbrLoading === inv.id + "-validate" ? <span className="btn-spinner" /> : <MdCheckCircle size={14} />}
                          {fbrValidated.has(inv.id) ? "Validated" : "Validate"}
                        </button>
                        <button
                          style={{
                            ...styles.fbrSubmitBtn,
                            opacity: fbrLoading || !fbrValidated.has(inv.id) ? 0.4 : 1,
                            cursor: !fbrValidated.has(inv.id) ? "not-allowed" : "pointer",
                          }}
                          disabled={!!fbrLoading || !fbrValidated.has(inv.id)}
                          onClick={() => handleFbrSubmit(inv)}
                          title={fbrValidated.has(inv.id) ? "Permanently submit this invoice to FBR. Cannot be undone." : "Validate first before submitting to FBR."}
                        >
                          {fbrLoading === inv.id + "-submit" ? <span className="btn-spinner" /> : <MdCloudUpload size={14} />} Submit FBR
                        </button>
                      </>
                    )}
                    {inv.fbrStatus !== "Submitted" && (
                      <button
                        style={{ ...styles.printBtn, backgroundColor: "#fff3e0", color: "#e65100", border: "1px solid #ffcc80" }}
                        onClick={() => setEditingId(inv.id)}
                        title="Edit items and prices on this bill"
                      >
                        <MdEdit size={14} /> Edit
                      </button>
                    )}
                    {inv.fbrStatus !== "Submitted" && (
                      <button
                        style={{ ...styles.printBtn, backgroundColor: "#ffebee", color: "#c62828", border: "1px solid #ef9a9a" }}
                        onClick={() => handleDeleteInvoice(inv)}
                        title="Delete this bill and revert challans to Pending"
                      >
                        <MdDelete size={14} /> Delete
                      </button>
                    )}
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

      {editingId && (
        <EditBillForm
          invoiceId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            notify("Bill updated.", "success");
            fetchInvoices(selectedCompany.id, page);
            // clear any stale validation state for this bill
            setFbrValidated((prev) => {
              const next = new Set(prev);
              next.delete(editingId);
              return next;
            });
          }}
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
  pdfBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", backgroundColor: "#ffebee", color: "#c62828" },
  excelBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", backgroundColor: "#e8f5e9", color: "#1b5e20" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
  fbrValidateBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", backgroundColor: "#fff3e0", color: "#e65100" },
  fbrSubmitBtn: { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", backgroundColor: "#e3f2fd", color: "#0d47a1" },
  fbrBulkBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", padding: "0.65rem 1rem", borderRadius: 10, border: "1px solid #e3f2fd", backgroundColor: "#f8faff" },
  fbrBulkBtn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 1rem", borderRadius: 8, border: "none", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", transition: "filter 0.2s" },
  fbrBulkValidateBtn: { backgroundColor: "#fff3e0", color: "#e65100" },
  fbrBulkSubmitBtn: { backgroundColor: "#0d47a1", color: "#fff", boxShadow: "0 2px 8px rgba(13,71,161,0.2)" },
};
