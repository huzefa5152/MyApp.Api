import { useState, useEffect, useCallback } from "react";
import { MdDescription, MdAdd, MdBusiness, MdSearch, MdChevronLeft, MdChevronRight, MdUploadFile } from "react-icons/md";
import ChallanList from "../Components/ChallanList";
import ChallanTable from "../Components/ChallanTable";
import ChallanForm from "../Components/ChallanForm";
import ChallanEditForm from "../Components/ChallanEditForm";
import POImportForm from "../Components/POImportForm";
import InvoiceForm from "../Components/InvoiceForm";
import ViewModeToggle from "../components/ViewModeToggle";
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
import { getTemplate, hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultChallanTemplate } from "../utils/defaultTemplates";
import { exportToPdf } from "../utils/exportUtils";
import { saveAs } from "file-saver";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import DuplicateChallanDialog from "../Components/DuplicateChallanDialog";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function ChallanPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("challans.manage.create");
  const canUpdate = has("challans.manage.update");
  const canDelete = has("challans.manage.delete");
  const canPrint = has("challans.print.view");
  const [viewMode, setViewMode] = useListViewMode("challans");
  const [clients, setClients] = useState([]);
  const [challans, setChallans] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editChallan, setEditChallan] = useState(null);
  const [loadingChallans, setLoadingChallans] = useState(false);
  // Generate-Bill shortcut: holds the challanId to prefill into InvoiceForm
  // when the user clicks the per-card button.
  const [generateBillChallanId, setGenerateBillChallanId] = useState(null);

  // Pagination & filters
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
    try {
      const { data } = await getClientsByCompany(companyId);
      setClients(data);
    } catch { setClients([]); }
  };

  const fetchChallans = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoadingChallans(true);
    try {
      const params = { page: pg || page };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (clientFilter) params.clientId = clientFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await getPagedChallansByCompany(companyId, params);
      setChallans(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
      setPageSize(data.pageSize);
    } catch {
      setChallans([]);
      setTotalCount(0);
      setTotalPages(0);
    } finally {
      setLoadingChallans(false);
    }
  }, [page, search, statusFilter, clientFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedCompany) {
      fetchClients(selectedCompany.id);
      setPage(1);
      fetchChallans(selectedCompany.id, 1);
      hasExcelTemplate(selectedCompany.id, "Challan")
        .then(r => setHasExcelTpl(r.data.hasExcelTemplate))
        .catch(() => setHasExcelTpl(false));
    } else {
      setChallans([]);
      setClients([]);
      setHasExcelTpl(false);
    }
  }, [selectedCompany]);

  // Re-fetch when filters or page change
  useEffect(() => {
    if (selectedCompany) fetchChallans(selectedCompany.id, page);
  }, [page, search, statusFilter, clientFilter, dateFrom, dateTo]);

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("");
    setClientFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  const handleAddChallan = () => { if (selectedCompany) setShowModal(true); };

  const handleSaveChallan = async (payload) => {
    if (!selectedCompany) return;
    await createDeliveryChallan(selectedCompany.id, payload);
    fetchChallans(selectedCompany.id, page);
    setShowModal(false);
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

  const handlePrint = async (challan) => {
    if (!selectedCompany) { notify("No company selected.", "error"); return; }
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading challan...</p>");
    try {
      const { data } = await getChallanPrintData(challan.id);
      let template = defaultChallanTemplate;
      try {
        const res = await getTemplate(selectedCompany.id, "Challan");
        if (res.data?.htmlContent) template = res.data.htmlContent;
      } catch { /* use default */ }
      const html = mergeTemplate(template, data);
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      w.onafterprint = () => w.close();
      w.print();
    } catch {
      w.close();
      notify("Failed to load print data.", "error");
    }
  };

  const handleEditItems = (challan) => setEditChallan(challan);
  const handleEditSaved = () => {
    setEditChallan(null);
    fetchChallans(selectedCompany.id, page);
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
      await fetchChallans(selectedCompany.id, page);
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
    if (exportingId) return;
    setExportingId(challan.id + "-pdf");
    try {
      const { data } = await getChallanPrintData(challan.id);
      let template = defaultChallanTemplate;
      try {
        const res = await getTemplate(selectedCompany.id, "Challan");
        if (res.data?.htmlContent) template = res.data.htmlContent;
      } catch { /* use default */ }
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

  const hasFilters = search || statusFilter || clientFilter || dateFrom || dateTo;

  return (
    <div>
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>
            <MdDescription size={28} color="#fff" />
          </div>
          <div>
            <h2 style={styles.pageTitle}>Delivery Challans</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? `${totalCount} challan${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
                : "Select a company to view challans"}
            </p>
          </div>
        </div>
        {companies.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {canCreate && (
              <button style={styles.addBtn} onClick={handleAddChallan}>
                <MdAdd size={18} /> New Challan
              </button>
            )}
            {canCreate && has("poformats.import.create") && (
              <button style={{ ...styles.addBtn, backgroundColor: "#00897b" }} onClick={() => selectedCompany && setShowImport(true)}>
                <MdUploadFile size={18} /> Import PO
              </button>
            )}
          </div>
        )}
      </div>

      {loadingCompanies ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>Loading companies...</span>
        </div>
      ) : companies.length > 0 ? (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={dropdownStyles.base}
              value={selectedCompany?.id || ""}
              onChange={(e) =>
                setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))
              }
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.brandName || c.name}</option>
              ))}
            </select>
          </div>

          {/* Filters + view-mode toggle */}
          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap">
                <MdSearch size={15} className="filter-search-icon" />
                <input
                  type="text"
                  placeholder="Search DC#, Client, PO..."
                  className="filter-search-input"
                  value={search}
                  onChange={handleFilterChange(setSearch)}
                />
              </div>
              <select className="filter-select" value={statusFilter} onChange={handleFilterChange(setStatusFilter)}>
                <option value="">All Status</option>
                <option value="Pending">Pending</option>
                <option value="Imported">Imported</option>
                <option value="No PO">No PO</option>
                <option value="Setup Required">Setup Required</option>
                <option value="Invoiced">Billed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
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
              <div style={{ marginLeft: "auto" }}>
                <ViewModeToggle mode={viewMode} onChange={setViewMode} ariaLabel="Delivery challan view mode" />
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={styles.emptyState}>
          <MdBusiness size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>No companies available. Add a company first.</p>
        </div>
      )}

      {loadingChallans ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>Loading challans...</span>
        </div>
      ) : challans.length === 0 && selectedCompany ? (
        <div style={styles.emptyState}>
          <MdDescription size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
            {hasFilters ? "No challans match the current filters." : "No delivery challans found for this company."}
          </p>
        </div>
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
              exportingId={exportingId}
              duplicatingId={duplicatingId}
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
              exportingId={exportingId}
              duplicatingId={duplicatingId}
            />
          )}
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

      {showModal && selectedCompany && (
        <ChallanForm
          companyId={selectedCompany.id}
          onClose={() => setShowModal(false)}
          onSaved={handleSaveChallan}
        />
      )}

      {showImport && selectedCompany && (
        <POImportForm
          companyId={selectedCompany.id}
          onClose={() => setShowImport(false)}
          onSaved={() => { setShowImport(false); fetchChallans(selectedCompany.id, page); }}
        />
      )}

      {editChallan && (
        <ChallanEditForm
          challan={editChallan}
          onClose={() => setEditChallan(null)}
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

    </div>
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
      <td class="cell item">${item.description}</td>
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

const styles = {
  pageHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1.5rem",
    flexWrap: "wrap",
    gap: "1rem",
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pageTitle: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 700,
    color: colors.textPrimary,
  },
  pageSubtitle: {
    margin: "0.15rem 0 0",
    fontSize: "0.88rem",
    color: colors.textSecondary,
  },
  addBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.55rem 1.25rem",
    borderRadius: 10,
    border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "filter 0.2s, transform 0.2s",
    boxShadow: "0 4px 14px rgba(13,71,161,0.25)",
  },
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    padding: "3rem 0",
  },
  spinner: {
    width: 28,
    height: 28,
    border: `3px solid ${colors.cardBorder}`,
    borderTopColor: colors.blue,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "3rem 1rem",
    textAlign: "center",
  },
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "1rem",
    padding: "1rem 0",
    marginTop: "0.5rem",
  },
  pageBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.2rem",
    padding: "0.4rem 0.8rem",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    backgroundColor: "#fff",
    color: colors.blue,
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  pageInfo: {
    fontSize: "0.82rem",
    color: colors.textSecondary,
    fontWeight: 500,
  },
};
