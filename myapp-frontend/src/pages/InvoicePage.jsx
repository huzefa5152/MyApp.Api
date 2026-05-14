import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MdReceipt, MdAdd, MdBusiness, MdPrint, MdDescription, MdSearch, MdChevronLeft, MdChevronRight, MdPictureAsPdf, MdGridOn, MdCloudUpload, MdCheckCircle, MdError, MdHourglassEmpty, MdDelete, MdEdit, MdVisibility, MdBlock, MdRestore, MdOpenInNew, MdViewList } from "react-icons/md";
import InvoiceForm from "../Components/InvoiceForm";
import StandaloneInvoiceForm from "../Components/StandaloneInvoiceForm";
import EditBillForm from "../Components/EditBillForm";
import BulkFbrResultsDialog from "../Components/BulkFbrResultsDialog";
import FbrPreviewDialog from "../Components/FbrPreviewDialog";
import BulkFbrPreviewDialog from "../Components/BulkFbrPreviewDialog";
import InvoiceTable from "../Components/InvoiceTable";
import ViewModeToggle from "../components/ViewModeToggle";
import { useListViewMode } from "../hooks/useListViewMode";
import { getPagedInvoicesByCompany, getInvoicePrintBill, getInvoicePrintTaxInvoice, deleteInvoice, setInvoiceFbrExcluded } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { submitInvoiceToFbr, validateInvoiceWithFbr } from "../api/fbrApi";
import { dropdownStyles, cardStyles, cardHover } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getTemplate, hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultBillTemplate, defaultTaxInvoiceTemplate } from "../utils/defaultTemplates";
import { exportToPdf } from "../utils/exportUtils";
import { saveAs } from "file-saver";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function InvoicePage({ mode = "invoices" }) {
  // Tab split: `bills` mode is pre-FBR data entry — no item-type column
  // in the create/edit forms, no Validate All / Submit All bulk bar, no
  // per-card FBR Validate / Submit / Exclude buttons. The FBR-submitted
  // status badge still renders in both modes so the operator can see at
  // a glance which rows are locked. `invoices` mode keeps everything.
  const isBillsMode = mode === "bills";
  // Persist view-mode per tab so Bills + Invoices can each remember their
  // own setting (e.g. operator wants cards on Bills but table on Invoices).
  const [viewMode, setViewMode] = useListViewMode(isBillsMode ? "bills" : "invoices");
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canCreate = has("bills.manage.create");
  // Separate permission for the "Create Bill (No Challan)" flow — gates
  // the standalone create button. A role can be granted only this without
  // also gaining the regular create-from-challan flow, or vice-versa.
  const canCreateStandalone = has("bills.manage.create.standalone");
  const canUpdate = has("bills.manage.update");
  // Users with only the narrow ItemType-only permission still need the
  // Edit button to reach the form, even though they can only change the
  // ItemType column inside it. EditBillForm enforces the field-level
  // restriction on its own.
  const canEditItemType = has("invoices.manage.update.itemtype");
  // Slightly broader narrow permission — Item Type AND Quantity. Same
  // Edit button entry point, EditBillForm enforces field-level lock.
  const canEditItemTypeAndQty = has("invoices.manage.update.itemtype.qty");
  const canOpenEdit = canUpdate || canEditItemTypeAndQty || canEditItemType;
  const canDelete = has("bills.manage.delete");
  // Print is split now: bills.print.view → Bill print/PDF/XLS,
  // invoices.print.view → Tax-Invoice print/PDF/XLS. Bills tab uses
  // canPrintBill, Invoices tab uses canPrintTax.
  const canPrintBill = has("bills.print.view");
  const canPrintTax  = has("invoices.print.view");
  const canPrint = isBillsMode ? canPrintBill : canPrintTax;
  // Two granular FBR perms — operator can be allowed to dry-run without
  // being trusted to commit. canFbrAny is just for showing the bulk bar.
  const canFbrValidate = has("invoices.fbr.validate");
  const canFbrSubmit = has("invoices.fbr.submit");
  const canFbrAny = canFbrValidate || canFbrSubmit;
  // Dedicated permission for the per-bill Exclude / Include FBR toggle —
  // separated from invoices.manage.update so a role can be granted ONLY
  // the toggle without also gaining edit rights on the bill itself.
  const canFbrExclude = has("invoices.fbr.exclude");
  // Dedicated permission for the FBR preview dialog — operator can sanity-
  // check the grouped items / totals before clicking Validate or Submit
  // without being trusted to actually call FBR. Administrator gets it
  // automatically via RbacSeeder.
  const canFbrPreview = has("invoices.fbr.preview");
  // The bill currently shown in the FBR preview dialog (null when closed).
  const [fbrPreviewId, setFbrPreviewId] = useState(null);
  // Bulk FBR preview dialog — open shows every bill currently ready
  // for Validate All / Submit All as a collapsible list. Operators
  // use it to scan the whole queue before launching a bulk action,
  // without bouncing through each card's per-bill "View FBR" button.
  // 2026-05-13: added.
  const [showBulkFbrPreview, setShowBulkFbrPreview] = useState(false);
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  // Separate visibility flag for the "Create Bill (No Challan)" modal so
  // it doesn't share state with the regular New Bill flow.
  const [showStandaloneForm, setShowStandaloneForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const navigate = useNavigate();
  // ?search=<bill-number> deep-link support — let a Bill card on the
  // Bills tab jump directly to the matching record on the Invoices tab.
  // The card's "Open in Invoices" button navigates to
  // `/invoices?search={billNumber}`; this hook seeds the search-box
  // state with that value on mount and the existing fetch pipeline
  // narrows the list to a single card automatically. Distinct route
  // keys in App.jsx force a remount on tab switch so this initializer
  // always sees the current URL.
  //
  // The search box is also two-way bound to ?search below — when the
  // operator clears it, the URL drops the param so a page reload or
  // browser back/forward doesn't re-seed a stale filter.
  const [searchParams, setSearchParams] = useSearchParams();

  // Pagination & filters
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  // Keep the URL's ?search= in sync with the search-box state. Without
  // this, clearing the box would still leave the param in the URL, and
  // a page reload would re-seed the box from the stale value (which is
  // exactly what bit us when "Open in Invoices" left a sticky filter).
  // replace:true so each keystroke doesn't pollute browser history.
  useEffect(() => {
    const current = searchParams.get("search") || "";
    if (search === current) return;
    const next = new URLSearchParams(searchParams);
    if (search) next.set("search", search);
    else next.delete("search");
    setSearchParams(next, { replace: true });
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
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
      // Hydrate the in-memory "locally validated" Set from the
      // persisted FbrStatus. Pre-fix the Set was session-only, so a
      // bill that had been validated successfully (now persisted as
      // FbrStatus = "Validated", see FbrService 2026-05-08) would
      // load with an empty Set after refresh and the UI would fall
      // back to the orange "pending FBR" pill — confusing the
      // operator who just saw the green "validated" pill before the
      // refresh. Bills already at "Submitted" stay out of the Set —
      // they're past validation and have the dedicated submitted
      // pill / IRN display path.
      setFbrValidated((prev) => {
        const next = new Set(prev);
        for (const inv of data.items || []) {
          if (inv.fbrStatus === "Validated") next.add(inv.id);
        }
        return next;
      });
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
      // Tax invoice uses "INVOICE # ..." prefix to distinguish from the non-tax
      // Bill exports (which keep the "Bill # ..." prefix on lines 160 + 171 above).
      await exportToPdf(html, `INVOICE # ${data.invoiceNumber} ${data.buyerName || data.clientName}`);
    } catch { notify("Failed to export Tax Invoice PDF.", "error"); }
    finally { setExportingId(null); }
  };

  const handleExportTaxExcel = async (inv) => {
    if (exportingId) return;
    setExportingId(inv.id + "-tax-excel");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      const res = await exportExcel(selectedCompany.id, "TaxInvoice", data);
      // Same "INVOICE # ..." convention as the PDF tax export above.
      // saveAs() overrides the server's Content-Disposition filename, so the
      // prefix MUST be correct on this line — fixing only the backend wasn't enough.
      saveAs(res.data, `INVOICE # ${data.invoiceNumber} ${data.buyerName || data.clientName}.xlsx`);
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
        // 2026-05-08: a failed re-validate must NOT wipe a bill's
        // previously-Validated state. The backend doesn't persist
        // failures (only successes write FbrStatus = "Validated"),
        // so the DB still says Validated; if we drop the row from
        // the Set here the badge flips orange until refresh, where
        // hydration re-adds it. The bulk path already gets this
        // right — single-validate now matches: toast the error,
        // leave the Set alone.
        notify(`FBR validation failed: ${data.errorMessage}`, "error");
      }
    } catch (err) {
      notify(err.response?.data?.errorMessage || "FBR validation failed.", "error");
      // Same rationale as the !data.success branch — don't touch
      // the Set on failure.
    } finally { setFbrLoading(null); }
  };

  const handleFbrSubmit = async (inv) => {
    if (!fbrValidated.has(inv.id)) {
      notify("Please validate with FBR first before submitting.", "error");
      return;
    }
    const ok = await confirm({
      title: `Submit Bill #${inv.invoiceNumber} to FBR?`,
      message: "Once submitted, the bill is locked from edits and assigned an IRN. This action cannot be undone.",
      variant: "warning",
      confirmText: "Submit to FBR",
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: `Delete Bill #${inv.invoiceNumber}?`,
      message: "Linked delivery challans will revert back to Pending and become billable again.",
      variant: "danger",
      confirmText: "Delete bill",
    });
    if (!ok) return;
    try {
      await deleteInvoice(inv.id);
      notify(`Bill #${inv.invoiceNumber} deleted.`, "success");
      fetchInvoices(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete bill.", "error");
    }
  };

  const [bulkFbrLoading, setBulkFbrLoading] = useState(false);
  // Per-bill outcome of the most recent Validate All / Submit All run.
  // Replaces the old summary toast — the operator sees a scrollable grid
  // with each bill's status and the FBR error so failures can be acted on
  // directly instead of disappearing after a few seconds.
  const [bulkResults, setBulkResults] = useState({ open: false, action: "validate", items: [] });

  // Get unsubmitted invoices for bulk operations — only those that are FBR-ready
  // (have HS Code + Sale Type + UOM on every item). Others are surfaced as
  // "FBR Setup Incomplete" on the card itself.
  //
  // IMPORTANT: these counts are per-PAGE (for the badges in the header). The
  // actual Validate All / Submit All actions below re-fetch the ENTIRE filtered
  // set across all pages, so users with 30 bills on page 1 of 4 can click once
  // and have all 120 (or whatever the filter returns) processed in a single go.
  // Bills the operator has flagged as "FBR-excluded" are deliberately skipped
  // by Validate All / Submit All (bulk actions) but the per-bill buttons still
  // work. So we exclude them from these counts too — the badges are about what
  // the bulk buttons will process.
  const unsubmittedInvoices = invoices.filter(inv => inv.fbrStatus !== "Submitted" && inv.fbrReady && !inv.isFbrExcluded);
  const incompleteCount = invoices.filter(inv => inv.fbrStatus !== "Submitted" && !inv.fbrReady && !inv.isFbrExcluded).length;
  const validatedCount = unsubmittedInvoices.filter(inv => fbrValidated.has(inv.id)).length;

  const handleToggleFbrExcluded = async (inv) => {
    const nextExcluded = !inv.isFbrExcluded;
    const ok = await confirm({
      title: nextExcluded
        ? `Exclude Bill #${inv.invoiceNumber} from FBR bulk actions?`
        : `Include Bill #${inv.invoiceNumber} back in FBR bulk actions?`,
      message: nextExcluded
        ? "Validate All / Submit All will skip this bill. Per-bill Validate / Submit still work."
        : "This bill will be picked up by Validate All / Submit All again.",
      variant: nextExcluded ? "warning" : "info",
      confirmText: nextExcluded ? "Exclude" : "Include",
    });
    if (!ok) return;
    try {
      await setInvoiceFbrExcluded(inv.id, nextExcluded);
      notify(
        nextExcluded
          ? `Bill #${inv.invoiceNumber} excluded from FBR bulk actions.`
          : `Bill #${inv.invoiceNumber} re-enabled for FBR bulk actions.`,
        "success"
      );
      fetchInvoices(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to update FBR exclusion.", "error");
    }
  };

  // Fetches every bill matching the current filters (client / date range /
  // search) across all pages, not just the current page. Uses a large pageSize
  // to pull everything in a single round-trip. Returns only bills eligible for
  // the given action:
  //   action="validate" → not yet Submitted AND FBR-ready
  //   action="submit"   → not yet Submitted AND already locally validated
  //                       (user must Validate All first, or click Validate per bill)
  const fetchAllFilteredBills = async (action) => {
    const params = { page: 1, pageSize: 10000 };
    if (search) params.search = search;
    if (clientFilter) params.clientId = clientFilter;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    const { data } = await getPagedInvoicesByCompany(selectedCompany.id, params);
    const all = data.items || [];
    if (action === "validate") {
      // Skip FBR-excluded bills — operator explicitly opted them out of bulk actions.
      return all.filter(inv => inv.fbrStatus !== "Submitted" && inv.fbrReady && !inv.isFbrExcluded);
    }
    if (action === "submit") {
      return all.filter(inv => inv.fbrStatus !== "Submitted" && fbrValidated.has(inv.id) && !inv.isFbrExcluded);
    }
    return all;
  };

  const handleBulkValidateAll = async () => {
    const filterNote = hasFilters ? " matching current filters" : "";
    setBulkFbrLoading(true);
    setFbrLoading("bulk-validate-fetching");
    let candidates = [];
    try { candidates = await fetchAllFilteredBills("validate"); }
    catch { notify("Failed to fetch bill list for validation.", "error"); setBulkFbrLoading(false); setFbrLoading(null); return; }
    if (candidates.length === 0) {
      notify(`No FBR-ready unsubmitted bills${filterNote}.`, "info");
      setBulkFbrLoading(false); setFbrLoading(null); return;
    }
    // Per-bill rows for the results dialog. Replaces the old summary toast —
    // failures stay on screen with the FBR message until the operator
    // dismisses the dialog.
    const results = [];
    // Once we see a token/auth/connectivity error we stop making new FBR
    // calls (they would all fail the same way) but keep RECORDING the
    // remaining bills as "not attempted" so the operator's report is
    // truthful about scope.
    let stopFurtherCalls = false;
    let stopReason = "";
    for (const inv of candidates) {
      if (fbrValidated.has(inv.id)) {
        results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "already", message: "Already validated locally — no new call to FBR." });
        continue;
      }
      if (stopFurtherCalls) {
        results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "skipped", message: stopReason || "Skipped after token/connectivity error on an earlier bill." });
        continue;
      }
      setFbrLoading(inv.id + "-validate");
      try {
        const { data } = await validateInvoiceWithFbr(inv.id);
        if (data.success) {
          setFbrValidated(prev => new Set(prev).add(inv.id));
          results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "passed", message: "Passed FBR validation." });
        } else {
          const msg = data.errorMessage || "FBR rejected the bill (no message returned).";
          results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "failed", message: msg });
          if (msg.includes("token") || msg.includes("authentication") || msg.includes("Cannot connect")) {
            stopFurtherCalls = true; stopReason = msg;
          }
        }
      } catch (err) {
        // Prefer the server's user-facing message; fall back to a stable
        // friendly string (axios's raw err.message is "Network Error" /
        // "Request failed with status code 500" — not user-friendly).
        const serverMsg = err.response?.data?.errorMessage || err.response?.data?.message;
        const msg = serverMsg
          || (!err.response ? "Could not reach the server." : "Request failed unexpectedly.");
        results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "failed", message: msg });
        if ((serverMsg && (serverMsg.includes("token") || serverMsg.includes("authentication") || serverMsg.includes("Cannot connect"))) || err.code === "ERR_NETWORK") {
          stopFurtherCalls = true;
          stopReason = msg;
        }
      }
    }
    setFbrLoading(null);
    setBulkFbrLoading(false);
    setBulkResults({ open: true, action: "validate", items: results });
  };

  const handleBulkSubmitValidated = async () => {
    const filterNote = hasFilters ? " matching current filters" : "";
    setBulkFbrLoading(true);
    setFbrLoading("bulk-submit-fetching");
    let toSubmit = [];
    try { toSubmit = await fetchAllFilteredBills("submit"); }
    catch { notify("Failed to fetch bill list for submission.", "error"); setBulkFbrLoading(false); setFbrLoading(null); return; }
    if (toSubmit.length === 0) {
      notify(`No locally-validated bills to submit${filterNote}. Click Validate All first.`, "error");
      setBulkFbrLoading(false); setFbrLoading(null); return;
    }
    const ok = await confirm({
      title: `Submit ${toSubmit.length} bill${toSubmit.length !== 1 ? "s" : ""} to FBR?`,
      message: `${toSubmit.length} locally-validated bill${toSubmit.length !== 1 ? "s" : ""}${filterNote} will be sent to FBR. Once submitted, each bill is locked from edits and assigned an IRN. This cannot be undone.`,
      variant: "warning",
      confirmText: "Submit all",
    });
    if (!ok) {
      setBulkFbrLoading(false); setFbrLoading(null); return;
    }
    const results = [];
    let stopFurtherCalls = false;
    let stopReason = "";
    for (const inv of toSubmit) {
      if (stopFurtherCalls) {
        results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "skipped", message: stopReason || "Skipped after token/connectivity error on an earlier bill." });
        continue;
      }
      setFbrLoading(inv.id + "-submit");
      try {
        const { data } = await submitInvoiceToFbr(inv.id);
        if (data.success) {
          setFbrValidated(prev => { const s = new Set(prev); s.delete(inv.id); return s; });
          const irn = data.irn || data.IRN || null;
          results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "submitted", message: irn ? null : "Submitted to FBR.", irn });
        } else {
          const msg = data.errorMessage || "FBR rejected the bill (no message returned).";
          results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "failed", message: msg });
          if (msg.includes("token") || msg.includes("authentication") || msg.includes("Cannot connect")) {
            stopFurtherCalls = true; stopReason = msg;
          }
        }
      } catch (err) {
        // Prefer the server's user-facing message; fall back to a stable
        // friendly string (axios's raw err.message is "Network Error" /
        // "Request failed with status code 500" — not user-friendly).
        const serverMsg = err.response?.data?.errorMessage || err.response?.data?.message;
        const msg = serverMsg
          || (!err.response ? "Could not reach the server." : "Request failed unexpectedly.");
        results.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "failed", message: msg });
        if ((serverMsg && (serverMsg.includes("token") || serverMsg.includes("authentication") || serverMsg.includes("Cannot connect"))) || err.code === "ERR_NETWORK") {
          stopFurtherCalls = true;
          stopReason = msg;
        }
      }
    }
    setFbrLoading(null);
    setBulkFbrLoading(false);
    fetchInvoices(selectedCompany.id, page);
    setBulkResults({ open: true, action: "submit", items: results });
  };

  const hasFilters = search || clientFilter || dateFrom || dateTo;

  return (
    <div>
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdReceipt size={28} color="#fff" /></div>
          <div>
            <h2 style={styles.pageTitle}>{isBillsMode ? "Bills" : "Invoices"}</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? (isBillsMode
                    ? `${totalCount} bill${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
                    : `Classify items and submit to FBR — ${totalCount} record${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`)
                : "Select a company"}
            </p>
          </div>
        </div>
        {/* Creation buttons live on the Bills tab only — Invoices tab is
            for FBR classification & submission of existing records. */}
        {isBillsMode && companies.length > 0 && (canCreate || canCreateStandalone) && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {canCreate && (
              <button style={styles.addBtn} onClick={() => setShowForm(true)}>
                <MdAdd size={18} /> New Bill
              </button>
            )}
            {canCreateStandalone && (
              <button
                style={styles.addBtnSecondary}
                onClick={() => setShowStandaloneForm(true)}
                title="Create a bill directly without linking a delivery challan (FBR-only flow)"
              >
                <MdAdd size={18} /> New Bill (No Challan)
              </button>
            )}
          </div>
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
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>

          {/* FBR Bulk Actions — bar shows if caller has either FBR perm.
              Validate All is gated on canFbrValidate; Submit All on
              canFbrSubmit. Asymmetric grants render a partial bar.
              Bills tab hides the bar entirely — bulk FBR ops live on
              the Invoices tab. */}
          {!isBillsMode && canFbrAny && selectedCompany?.hasFbrToken && (unsubmittedInvoices.length > 0 || incompleteCount > 0) && (
            <div style={styles.fbrBulkBar}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <MdCloudUpload size={18} color="#0d47a1" />
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary }}>
                  FBR: {unsubmittedInvoices.length} ready to submit
                  {validatedCount > 0 ? `, ${validatedCount} validated` : ""}
                </span>
                {incompleteCount > 0 && (
                  <span style={{ fontSize: "0.78rem", padding: "0.15rem 0.5rem", borderRadius: 12, backgroundColor: "#fff8e1", color: "#e65100", border: "1px solid #ffcc80", fontWeight: 700 }}>
                    {incompleteCount} setup incomplete
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {/* Preview All — read-only inspector for the whole bulk
                    queue. Gated on the same permission as the per-bill
                    preview dialog so we don't unintentionally expose
                    payload data to roles that lacked it before. Hidden
                    on tabs without ready bills. 2026-05-13. */}
                {canFbrPreview && unsubmittedInvoices.length > 0 && (
                  <button
                    style={{ ...styles.fbrBulkBtn, ...styles.fbrBulkPreviewBtn }}
                    onClick={() => setShowBulkFbrPreview(true)}
                    title="Preview the FBR payload for every bill that's ready to validate — collapsible rows, no network call to FBR."
                  >
                    <MdViewList size={15} />
                    Preview All
                  </button>
                )}
                {canFbrValidate && (
                  <button
                    style={{ ...styles.fbrBulkBtn, ...styles.fbrBulkValidateBtn }}
                    disabled={bulkFbrLoading}
                    onClick={handleBulkValidateAll}
                  >
                    {bulkFbrLoading ? <span className="btn-spinner" /> : <MdCheckCircle size={15} />}
                    Validate All
                  </button>
                )}
                {canFbrSubmit && (
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
                )}
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
              <div style={{ marginLeft: "auto" }}>
                <ViewModeToggle
                  mode={viewMode}
                  onChange={setViewMode}
                  ariaLabel={isBillsMode ? "Bills view mode" : "Invoices view mode"}
                />
              </div>
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
          {viewMode === "table" ? (
            <InvoiceTable
              invoices={invoices}
              isBillsMode={isBillsMode}
              perms={{
                canPrint,
                canFbrPreview,
                canFbrAny,
                canFbrValidate,
                canFbrSubmit,
                canOpenEdit,
                canFbrExclude,
                canDelete,
              }}
              hasExcelBill={hasExcelBill}
              hasExcelTax={hasExcelTax}
              selectedCompanyHasFbrToken={!!selectedCompany?.hasFbrToken}
              fbrValidated={fbrValidated}
              fbrLoading={fbrLoading}
              exportingId={exportingId}
              onView={(inv) => setViewingId(inv.id)}
              onPrintBill={handlePrintBill}
              onPrintTax={handlePrintTax}
              onExportBillPdf={handleExportBillPdf}
              onExportBillExcel={handleExportBillExcel}
              onExportTaxPdf={handleExportTaxPdf}
              onExportTaxExcel={handleExportTaxExcel}
              onFbrPreview={(inv) => setFbrPreviewId(inv.id)}
              onFbrValidate={handleFbrValidate}
              onFbrSubmit={handleFbrSubmit}
              onEdit={(inv) => setEditingId(inv.id)}
              onToggleFbrExcluded={handleToggleFbrExcluded}
              onDelete={handleDeleteInvoice}
            />
          ) : (
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
                      {isBillsMode ? "Bill" : "Invoice"} #{inv.invoiceNumber}
                    </h5>
                    <p style={cardStyles.text}><strong>Client:</strong> {inv.clientName}</p>
                    {/* PO Number / Indent No / Site come from the linked
                        DeliveryChallans (aggregated server-side). All
                        three are optional — render only when present so
                        sparse bills don't get noisy. */}
                    {inv.poNumber && <p style={cardStyles.text}><strong>PO:</strong> {inv.poNumber}</p>}
                    {inv.indentNo && <p style={cardStyles.text}><strong>Indent:</strong> {inv.indentNo}</p>}
                    {inv.site && <p style={cardStyles.text}><strong>Site:</strong> {inv.site}</p>}
                    <p style={cardStyles.text}><strong>Date:</strong> {new Date(inv.date).toLocaleDateString()}</p>
                    <p style={cardStyles.text}><strong>Grand Total:</strong> Rs. {inv.grandTotal?.toLocaleString()}</p>
                    <p style={{ ...cardStyles.text, fontSize: "0.78rem", color: colors.textSecondary }}>
                      DC#{inv.challanNumbers?.join(", #")} | {inv.items?.length} items
                    </p>
                    {/* FBR status row — shows current status OR 'Setup Incomplete' when fields are missing.
                        In Bills mode we keep only the binary "Submitted to FBR" / "Pending FBR submission"
                        identifier as a pill so the operator sees at a glance which rows are locked.
                        Workflow detail (Ready / Setup Incomplete / Excluded) lives on the Invoices tab. */}
                    {/* 2026-05-08: Bills + Invoices modes now share the
                        same green pill for Submitted. The Invoices mode
                        previously rendered plain inline text so the
                        styling was inconsistent with the other status
                        pills (Ready / Validated / Failed / etc.). */}
                    {inv.fbrStatus === "Submitted" && (
                      <div style={styles.fbrPillSubmitted} title={inv.fbrIRN ? `IRN: ${inv.fbrIRN}` : "This bill has been submitted to FBR and is locked from edits."}>
                        <MdCheckCircle size={14} color="#1b5e20" />
                        <span>{isBillsMode ? "Submitted to FBR" : "FBR: Submitted"}</span>
                        {inv.fbrIRN && <span style={styles.fbrPillIrn}>IRN {inv.fbrIRN}</span>}
                      </div>
                    )}
                    {isBillsMode && inv.fbrStatus !== "Submitted" && (
                      <div style={styles.fbrPillPending} title="This bill hasn't been submitted to FBR yet. Open the Invoices tab to validate and submit.">
                        <MdHourglassEmpty size={14} color="#b26a00" />
                        <span>Pending FBR submission</span>
                      </div>
                    )}
                    {!isBillsMode && inv.fbrStatus === "Failed" && (
                      <div style={styles.fbrPillFailed} title={inv.fbrErrorMessage || "FBR rejected this submission. Open View FBR for details."}>
                        <MdError size={14} color="#b71c1c" />
                        <span>FBR Failed</span>
                      </div>
                    )}
                    {!isBillsMode && inv.fbrStatus === "Failed" && inv.fbrErrorMessage && (
                      <p style={{ fontSize: "0.72rem", color: "#c62828", marginTop: "0.35rem", wordBreak: "break-word", lineHeight: 1.35 }}>
                        {inv.fbrErrorMessage}
                      </p>
                    )}
                    {!isBillsMode && inv.fbrStatus !== "Submitted" && !inv.fbrReady && (
                      <div
                        style={styles.fbrPillIncomplete}
                        title={inv.fbrMissing?.length ? `Missing:\n• ${inv.fbrMissing.join("\n• ")}` : ""}
                      >
                        <MdError size={14} color="#b26a00" style={{ flexShrink: 0 }} />
                        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                          <span>FBR Setup Incomplete</span>
                          {inv.fbrMissing?.length > 0 && (
                            <span style={styles.fbrPillIncompleteHint}>
                              {inv.fbrMissing.slice(0, 3).join(" · ")}
                              {inv.fbrMissing.length > 3 && ` · +${inv.fbrMissing.length - 3} more`}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {!isBillsMode && inv.fbrStatus !== "Submitted" && inv.fbrReady && !inv.isFbrExcluded && (
                      <div style={styles.fbrPillReady} title="All FBR fields are set. Click Validate to dry-run, or Submit to issue the IRN.">
                        <MdCheckCircle size={14} color="#0d47a1" />
                        <span>Ready to Validate</span>
                      </div>
                    )}
                    {!isBillsMode && inv.fbrStatus !== "Submitted" && inv.isFbrExcluded && (
                      <div
                        style={styles.fbrPillExcluded}
                        title="This bill is excluded from Validate All / Submit All bulk actions. Per-bill Validate / Submit still work."
                      >
                        <MdBlock size={14} color="#455a64" />
                        <span>Excluded from FBR bulk</span>
                      </div>
                    )}
                  </div>
                  <div style={{ ...cardStyles.buttonGroup, flexWrap: "wrap" }}>
                    {/* Bills card: View, Print Bill, Bill PDF, Bill XLS, Edit, Delete.
                        Invoices card: Tax Print, Tax PDF, Tax XLS, View FBR, Validate, Submit. */}
                    {isBillsMode && (
                      <button
                        style={{ ...styles.printBtn, backgroundColor: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" }}
                        onClick={() => setViewingId(inv.id)}
                        title="View bill details (read-only)"
                      >
                        <MdVisibility size={14} /> View
                      </button>
                    )}
                    {/* Cross-tab locator — Bills tab only. Navigates to
                        the Invoices tab with ?search=<billNumber> seeded;
                        the Invoices page reads the param on mount so the
                        list filters down to a single card. Operator can
                        clear the search box to see the full Invoices list
                        again. Reuses the existing search pipeline so no
                        new filter logic is needed. */}
                    {isBillsMode && (
                      <button
                        style={{ ...styles.printBtn, backgroundColor: "#e0f2f1", color: "#00695c", border: "1px solid #80cbc4" }}
                        onClick={() => navigate(`/invoices?search=${encodeURIComponent(inv.invoiceNumber)}`)}
                        title="Find this bill on the Invoices tab so you can classify items and submit to FBR"
                      >
                        <MdOpenInNew size={14} /> Open in Invoices
                      </button>
                    )}
                    {isBillsMode && canPrint && (
                      <button style={styles.printBtn} onClick={() => handlePrintBill(inv)}>
                        <MdPrint size={14} /> Bill
                      </button>
                    )}
                    {!isBillsMode && canPrint && (
                      <button style={styles.taxBtn} onClick={() => handlePrintTax(inv)}>
                        <MdDescription size={14} /> Tax Invoice
                      </button>
                    )}
                    {isBillsMode && canPrint && (
                      <button style={{ ...styles.pdfBtn, opacity: exportingId ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => handleExportBillPdf(inv)}>
                        {exportingId === inv.id + "-bill-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} Bill PDF
                      </button>
                    )}
                    {!isBillsMode && canPrint && (
                      <button style={{ ...styles.pdfBtn, opacity: exportingId ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => handleExportTaxPdf(inv)}>
                        {exportingId === inv.id + "-tax-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} Tax PDF
                      </button>
                    )}
                    {isBillsMode && canPrint && hasExcelBill && (
                      <button style={{ ...styles.excelBtn, opacity: exportingId ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => handleExportBillExcel(inv)}>
                        {exportingId === inv.id + "-bill-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Bill XLS
                      </button>
                    )}
                    {!isBillsMode && canPrint && hasExcelTax && (
                      <button style={{ ...styles.excelBtn, opacity: exportingId ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => handleExportTaxExcel(inv)}>
                        {exportingId === inv.id + "-tax-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Tax XLS
                      </button>
                    )}
                    {/* View what FBR will see — grouped items, totals, raw
                        JSON. Pure read-only, no calls to FBR. Available for
                        any bill (even submitted ones — useful to inspect
                        what was sent historically). Gated by its own perm
                        so it can be granted without Validate/Submit rights. */}
                    {/* Bills tab hides FBR preview / validate / submit /
                        exclude — those live on the Invoices tab. The FBR
                        status badge above the buttons still shows in both
                        modes so the operator can see locked rows. */}
                    {!isBillsMode && canFbrPreview && (
                      <button
                        style={{ ...styles.printBtn, backgroundColor: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" }}
                        onClick={() => setFbrPreviewId(inv.id)}
                        title="Preview the FBR payload — grouped items, total qty, total value, total tax. Read-only, doesn't send anything."
                      >
                        <MdVisibility size={14} /> View FBR
                      </button>
                    )}
                    {!isBillsMode && canFbrAny && selectedCompany?.hasFbrToken && inv.fbrStatus !== "Submitted" && (
                      <>
                        {canFbrValidate && (
                          <button
                            style={{
                              ...styles.fbrValidateBtn,
                              opacity: fbrLoading || !inv.fbrReady ? 0.4 : 1,
                              cursor: !inv.fbrReady ? "not-allowed" : "pointer",
                              ...(fbrValidated.has(inv.id) ? { backgroundColor: "#e8f5e9", color: "#2e7d32" } : {}),
                            }}
                            disabled={!!fbrLoading || !inv.fbrReady}
                            onClick={() => handleFbrValidate(inv)}
                            title={
                              !inv.fbrReady
                                ? `Complete FBR setup first:\n• ${inv.fbrMissing?.join("\n• ") || "Missing FBR fields"}`
                                : "Dry-run: checks all bill data with FBR without recording it. Must pass before you can submit."
                            }
                          >
                            {fbrLoading === inv.id + "-validate" ? <span className="btn-spinner" /> : <MdCheckCircle size={14} />}
                            {fbrValidated.has(inv.id) ? "Validated" : "Validate"}
                          </button>
                        )}
                        {canFbrSubmit && (
                          <button
                            style={{
                              ...styles.fbrSubmitBtn,
                              opacity: fbrLoading || !fbrValidated.has(inv.id) || !inv.fbrReady ? 0.4 : 1,
                              cursor: !fbrValidated.has(inv.id) || !inv.fbrReady ? "not-allowed" : "pointer",
                            }}
                            disabled={!!fbrLoading || !fbrValidated.has(inv.id) || !inv.fbrReady}
                            onClick={() => handleFbrSubmit(inv)}
                            title={
                              !inv.fbrReady
                                ? "Complete FBR setup first."
                                : fbrValidated.has(inv.id)
                                ? "Permanently submit this bill to FBR. Cannot be undone."
                                : "Validate first before submitting to FBR."
                            }
                          >
                            {fbrLoading === inv.id + "-submit" ? <span className="btn-spinner" /> : <MdCloudUpload size={14} />} Submit FBR
                          </button>
                        )}
                      </>
                    )}
                    {/* Edit on Bills tab: full bill edit (per the user's
                        permissions) — items, prices, dates, etc. Item Type
                        column is hidden so classification only happens on
                        the Invoices tab. Hidden once FBR-submitted (locks
                        edits permanently). */}
                    {isBillsMode && canOpenEdit && inv.fbrStatus !== "Submitted" && (
                      <button
                        style={{ ...styles.printBtn, backgroundColor: "#fff3e0", color: "#e65100", border: "1px solid #ffcc80" }}
                        onClick={() => setEditingId(inv.id)}
                        title={canUpdate
                          ? "Edit items and prices on this bill"
                          : "Edit bill (your permissions)"}
                      >
                        <MdEdit size={14} /> Edit
                      </button>
                    )}
                    {/* Edit on Invoices tab: ONLY allows picking the Item
                        Type for each line. Everything else (items, prices,
                        qty, dates) is read-only and reflects whatever was
                        last saved on the Bills tab. Hidden once submitted. */}
                    {!isBillsMode && canOpenEdit && inv.fbrStatus !== "Submitted" && (
                      <button
                        style={{ ...styles.printBtn, backgroundColor: "#fff3e0", color: "#e65100", border: "1px solid #ffcc80" }}
                        onClick={() => setEditingId(inv.id)}
                        title="Classify line items by Item Type (other fields read-only — edit on the Bills tab)"
                      >
                        <MdEdit size={14} /> Edit
                      </button>
                    )}
                    {!isBillsMode && canFbrExclude && inv.fbrStatus !== "Submitted" && (
                      <button
                        style={{
                          ...styles.printBtn,
                          backgroundColor: inv.isFbrExcluded ? "#e8f5e9" : "#eceff1",
                          color: inv.isFbrExcluded ? "#2e7d32" : "#546e7a",
                          border: `1px solid ${inv.isFbrExcluded ? "#a5d6a7" : "#b0bec5"}`,
                        }}
                        onClick={() => handleToggleFbrExcluded(inv)}
                        title={
                          inv.isFbrExcluded
                            ? "Re-enable this bill for Validate All / Submit All bulk actions."
                            : "Exclude this bill from Validate All / Submit All. Per-bill Validate / Submit still work."
                        }
                      >
                        {inv.isFbrExcluded ? <MdRestore size={14} /> : <MdBlock size={14} />}
                        {inv.isFbrExcluded ? "Include in FBR" : "Exclude from FBR"}
                      </button>
                    )}
                    {/* Delete: Bills tab only, last-created bill only,
                        not FBR-submitted. Same gates as before plus Bills mode. */}
                    {isBillsMode && canDelete && inv.fbrStatus !== "Submitted" && inv.isLatest && (
                      <button
                        style={{ ...styles.printBtn, backgroundColor: "#ffebee", color: "#c62828", border: "1px solid #ef9a9a" }}
                        onClick={() => handleDeleteInvoice(inv)}
                        title="Only the latest bill can be deleted — earlier bills must be edited to keep numbering gap-free."
                      >
                        <MdDelete size={14} /> Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
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

      {/* Bills mode shows the Item Type column (item-type pick is the
          ONE FBR-classification field exposed in Bills) but hides the
          rest of the FBR machinery (HS Code, Sale Type, scenario picker).
          Picking an item type still auto-fills HS / UOM / Sale Type
          behind the scenes so the bill is ready for FBR validation on
          the Invoices tab. */}
      {showForm && selectedCompany && (
        <InvoiceForm
          companyId={selectedCompany.id}
          company={selectedCompany}
          billsMode={isBillsMode}
          onClose={() => setShowForm(false)}
          onSaved={handleCreated}
        />
      )}

      {showStandaloneForm && selectedCompany && (
        <StandaloneInvoiceForm
          companyId={selectedCompany.id}
          company={selectedCompany}
          billsMode={isBillsMode}
          onClose={() => setShowStandaloneForm(false)}
          onSaved={() => { setShowStandaloneForm(false); handleCreated(); }}
        />
      )}

      {editingId && (
        <EditBillForm
          invoiceId={editingId}
          billsMode={isBillsMode}
          // Invoices-tab edit lets the FBR officer set Item Type AND Qty —
          // descriptions, prices, dates, payment terms etc. stay read-only
          // and reflect whatever was last saved on the Bills tab. Set on
          // the Invoice card's Edit button only.
          forceItemTypeAndQty={!isBillsMode}
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

      {viewingId && (
        <EditBillForm
          invoiceId={viewingId}
          readOnly
          onClose={() => setViewingId(null)}
          onSaved={() => setViewingId(null)}
        />
      )}

      <BulkFbrResultsDialog
        open={bulkResults.open}
        action={bulkResults.action}
        items={bulkResults.items}
        onClose={() => setBulkResults((prev) => ({ ...prev, open: false }))}
      />

      {/* FBR submission preview — read-only inspector. Operator can see
          grouped items, totals, raw JSON before clicking Validate / Submit. */}
      {fbrPreviewId !== null && (
        <FbrPreviewDialog
          invoiceId={fbrPreviewId}
          onClose={() => setFbrPreviewId(null)}
        />
      )}

      {/* Bulk FBR preview — every Validate All / Submit All candidate as
          a collapsible list, lazy-loading per-row payload on expand. */}
      {showBulkFbrPreview && (
        <BulkFbrPreviewDialog
          invoices={unsubmittedInvoices}
          onClose={() => setShowBulkFbrPreview(false)}
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
  // Visually distinct from the primary "New Bill" — outlined treatment
  // makes the standalone path the secondary action without losing
  // discoverability for roles that also have the primary permission.
  addBtnSecondary: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: `1px solid ${colors.blue}`, background: "#fff", color: colors.blue, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer" },
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
  // FBR-status pills used in Bills mode. Soft-tinted background with a
  // matching border + an icon and label, sitting under the bill metadata
  // row so the operator gets a clear at-a-glance "locked / not yet" cue.
  fbrPillPending: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    marginTop: "0.5rem",
    padding: "0.3rem 0.7rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#8a4b00",
    backgroundColor: "#fff4e0",
    border: "1px solid #ffcc80",
    letterSpacing: "0.01em",
  },
  fbrPillSubmitted: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    marginTop: "0.5rem",
    padding: "0.3rem 0.7rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#1b5e20",
    backgroundColor: "#eafbef",
    border: "1px solid #a5d6a7",
    letterSpacing: "0.01em",
  },
  fbrPillIrn: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "#2e7d32",
    backgroundColor: "#fff",
    padding: "0.05rem 0.4rem",
    borderRadius: 50,
    border: "1px solid #c8e6c9",
  },
  // Invoices-mode FBR status pills — same shape as the Bills-mode ones
  // (Pending / Submitted) but tinted for the workflow states the FBR
  // officer needs to track: Ready, Setup Incomplete, Failed, Excluded.
  fbrPillReady: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    marginTop: "0.5rem",
    padding: "0.3rem 0.7rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#0d47a1",
    backgroundColor: "#e3f2fd",
    border: "1px solid #90caf9",
    letterSpacing: "0.01em",
  },
  fbrPillIncomplete: {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: "0.45rem",
    marginTop: "0.5rem",
    padding: "0.35rem 0.7rem",
    borderRadius: 12,
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#8a4b00",
    backgroundColor: "#fff4e0",
    border: "1px solid #ffcc80",
    letterSpacing: "0.01em",
    maxWidth: "100%",
  },
  fbrPillIncompleteHint: {
    display: "block",
    fontSize: "0.7rem",
    fontWeight: 500,
    color: "#a35400",
    marginTop: "0.15rem",
    wordBreak: "break-word",
  },
  fbrPillFailed: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    marginTop: "0.5rem",
    padding: "0.3rem 0.7rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#b71c1c",
    backgroundColor: "#ffebee",
    border: "1px solid #ef9a9a",
    letterSpacing: "0.01em",
  },
  fbrPillExcluded: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    marginTop: "0.5rem",
    padding: "0.3rem 0.7rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#37474f",
    backgroundColor: "#eceff1",
    border: "1px solid #b0bec5",
    letterSpacing: "0.01em",
  },
  fbrBulkBtn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 1rem", borderRadius: 8, border: "none", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", transition: "filter 0.2s" },
  // 2026-05-13: neutral-blue outline for "Preview All" — distinct from
  // the amber Validate All (action) and solid-blue Submit All (terminal
  // action). Reads as an inspector button, not a workflow trigger.
  fbrBulkPreviewBtn: { backgroundColor: "#fff", color: "#0d47a1", border: "1px solid #b7d4f0" },
  fbrBulkValidateBtn: { backgroundColor: "#fff3e0", color: "#e65100" },
  fbrBulkSubmitBtn: { backgroundColor: "#0d47a1", color: "#fff", boxShadow: "0 2px 8px rgba(13,71,161,0.2)" },
};
