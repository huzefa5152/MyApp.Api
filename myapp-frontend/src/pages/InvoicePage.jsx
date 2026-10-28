import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MdInfoOutline, MdReceipt, MdAdd, MdBusiness, MdPrint, MdDescription, MdSearch, MdPictureAsPdf, MdGridOn, MdCloudUpload, MdCheckCircle, MdError, MdHourglassEmpty, MdDelete, MdCancel, MdEdit, MdVisibility, MdBlock, MdRestore, MdViewList, MdPayments, MdUndo, MdPostAdd, MdCopyAll, MdLocalShipping, MdDownload } from "react-icons/md";
import InvoiceForm from "../Components/InvoiceForm";
import PaymentForm from "../Components/PaymentForm";
import PaymentHistoryDialog from "../Components/PaymentHistoryDialog";
import StatusBadge from "../Components/StatusBadge";
import TaxRateBadge from "../Components/TaxRateBadge";
import { isFbrInFlight } from "../utils/fbrStatus";
import { documentReference } from "../utils/invoiceReference";
import SearchableSelect from "../Components/SearchableSelect";
import DivisionSelect from "../Components/DivisionSelect";
import StandaloneInvoiceForm from "../Components/StandaloneInvoiceForm";
import EditBillForm from "../Components/EditBillForm";
import BulkFbrResultsDialog from "../Components/BulkFbrResultsDialog";
import FbrPreviewDialog from "../Components/FbrPreviewDialog";
import BulkFbrPreviewDialog from "../Components/BulkFbrPreviewDialog";
import InvoiceTable from "../Components/InvoiceTable";
import CorrectionWizard from "../Components/CorrectionWizard";
import FbrResetModal from "../Components/FbrResetModal";
import FbrRecordManualModal from "../Components/FbrRecordManualModal";
import ViewModeToggle from "../Components/ViewModeToggle";
import InvoiceActionBar, { InvoiceFbrChip } from "../Components/InvoiceActionBar";
import { buildInvoiceActions, statusReason, fbrChip, isFiled } from "../utils/invoiceActions";
import { useListViewMode } from "../hooks/useListViewMode";
import { getPagedInvoicesByCompany, getInvoicePrintTaxInvoice, deleteInvoice, cancelInvoice, setInvoiceFbrExcluded } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { submitInvoiceToFbr, validateInvoiceWithFbr } from "../api/fbrApi";
import { dropdownStyles, cardStyles, cardHover, colors } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { getTemplate, hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { defaultTaxInvoiceTemplate } from "../utils/defaultTemplates";
import { defaultCreditNoteTemplate, defaultDebitNoteTemplate } from "../utils/purchaseNoteDocTemplates";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import BulkInvoiceDialog from "../Components/BulkInvoiceDialog";
import { resolveInvoiceBulk } from "../api/invoiceApi";
import { exportToPdf } from "../utils/exportUtils";
import { saveAs } from "file-saver";
import { notify } from "../utils/notify";
import CreateChallanFromBillModal from "../Components/CreateChallanFromBillModal";
import { isFutureDocDate } from "../utils/dateInput";
import CopyDocumentModal from "../Components/CopyDocumentModal";
import { DOC_COPY_TYPES } from "../api/documentCopyApi";
import { useDocumentCopy } from "../hooks/useDocumentCopy";
import { useConfirm } from "../Components/ConfirmDialog";
import Pagination from "../Components/Pagination";
import usePageSize from "../hooks/usePageSize";
import usePersistentFilter from "../hooks/usePersistentFilter";


// Payment-status pill (mirrors InvoiceTable's) for the card view.
// Per-document payment status is NOT shown (2026-09-03). Receipts in these
// books are taken ON ACCOUNT rather than against an invoice, so an individual
// document's "Unpaid" / "Overdue" pill described the allocation rather than the
// customer, and read as a debt that was in fact settled. The customer's real
// position is the Customer Ledger. The receipts drill-down stays: it shows what
// HAS been applied to this document, which is a fact rather than a verdict.

export default function InvoicePage({ mode = "invoices" }) {
  // One sales screen (2026-10-28): the importer used to split one document
  // across a Bills tab (create / edit / void) and an Invoices tab (FBR
  // classification and filing). Importers never adjust quantity or item type
  // for FBR, so both live here now. Each action keeps its own permission key.
  // Note tabs: `creditnotes` (returns / reversals, DocumentType 10) and
  // `debitnotes` (upward adjustments, DocumentType 9). Each lists ONLY its
  // type, numbered from its own per-company sequence (Credit Note #1…,
  // Debit Note #1…). Both behave like the sales screen (FBR validate /
  // submit visible) but with no create/edit — notes are generated from the
  // note screen and are immutable (void + recreate to change).
  const noteDocType = mode === "creditnotes" ? 10 : mode === "debitnotes" ? 9 : null;
  const isNotesMode = noteDocType !== null;
  const noteLabel = noteDocType === 10 ? "Credit Note" : "Debit Note";
  // Persist view-mode per tab so each tab remembers its own setting
  // (e.g. operator wants cards on Bills but table on Invoices).
  const [viewMode, setViewMode, isBigScreen] = useListViewMode(isNotesMode ? mode : "invoices");
  const filterScreen = isNotesMode ? mode : "invoices";
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canCreate = has("bills.manage.create");
  // Separate permission for the "Create Bill (No Challan)" flow — gates
  // the standalone create button. A role can be granted only this without
  // also gaining the regular create-from-challan flow, or vice-versa.
  const canCreateStandalone = has("bills.manage.create.standalone");
  // Only point at the setting if the reader can actually change it.
  const canManageCompany = has("companies.manage.update");
  const canUpdate = has("bills.manage.update");
  // Edit is always the full edit (PUT, bills.manage.update). The importer has
  // no FBR quantity / item-type adjustment, so the narrow
  // invoices.manage.update.itemtype[.qty] keys open nothing here.
  // Note tabs: notes are immutable (server rejects edits too) — no Edit.
  const canEditInThisMode = !isNotesMode && canUpdate;
  const canDelete = has("bills.manage.delete");
  // Void is its own permission (bills.manage.void), distinct from delete, so a
  // role can be allowed to void bills without also gaining hard-delete rights.
  const canVoid = has("bills.manage.void");
  // Reverse an FBR-submitted bill by generating a Credit/Debit Note. Its own
  // permission so the right to reverse a filed document is granted separately.
  const canReverse = has("invoices.note.create");
  // One printed document, the Invoice (TaxInvoice template). Either print key
  // opens it: bills.print.view and invoices.print.view both meant "print this
  // sale" when the screen was two tabs.
  const canPrint = has("bills.print.view") || has("invoices.print.view");
  // Bulk download produces the same documents the per-row Print / PDF
  // buttons do, so it carries the same permission. Notes are excluded:
  // a credit/debit note has its own numbering and is not an invoice.
  const canBulkPrint = canPrint && !isNotesMode;
  // Sales print with the TaxInvoice template (the type every live customer's
  // layout uses); note tabs → CreditNote / DebitNote.
  const printTemplateType = noteDocType === 9 ? "DebitNote"
    : noteDocType === 10 ? "CreditNote"
    : "TaxInvoice";
  // Division scope for the print-template picker (declared here so the hook can
  // consume it; the list filter + dropdown next to Company drive it). "All
  // Divisions" → company-wide templates; a specific division → that division's;
  // an empty scope hides the picker and blocks Print/PDF.
  const [divisionFilter, setDivisionFilter] = usePersistentFilter(filterScreen, "divisionFilter", "");
  const tplPicker = usePrintTemplates(printTemplateType, { divisionId: divisionFilter });
  const printFallbackTemplate = noteDocType === 9 ? defaultDebitNoteTemplate
    : noteDocType === 10 ? defaultCreditNoteTemplate
    : defaultTaxInvoiceTemplate;
  // Explicit dropdown pick wins; else the company default from the loaded
  // list; if the list couldn't load (no template perm / fetch error) fall
  // back to the legacy per-click default fetch, then the built-in template.
  const resolvePrintTemplate = async (inv) => {
    const picked = tplPicker.resolveTemplate(inv);
    if (picked?.htmlContent) return picked.htmlContent;
    if (!tplPicker.templatesLoaded) {
      try {
        const res = await getTemplate(selectedCompany.id, printTemplateType);
        if (res.data?.htmlContent) return res.data.htmlContent;
      } catch { /* use default */ }
    }
    return printFallbackTemplate;
  };
  // Two granular FBR perms — operator can be allowed to dry-run without
  // being trusted to commit. canFbrAny is just for showing the bulk bar.
  // FBR actions are gated by the company-level master switch IN ADDITION to
  // RBAC: a company with FBR disabled never shows Validate / Submit / Preview,
  // regardless of permission. (undefined → treated as enabled for back-compat
  // before the company list refreshes with the new field.)
  const fbrEnabled = selectedCompany?.fbrEnabled !== false;
  // When ON, every bill must come from a Sales Order: standalone bills are
  // disabled and the New-Bill challan picker shows only SO-linked challans.
  const requireSO = !!selectedCompany?.requireSalesOrderForBilling;
  const canFbrValidate = has("invoices.fbr.validate") && fbrEnabled;
  const canFbrSubmit = has("invoices.fbr.submit") && fbrEnabled;
  const canFbrAny = canFbrValidate || canFbrSubmit;
  // Dedicated permission for the per-bill Exclude / Include FBR toggle —
  // separated from invoices.manage.update so a role can be granted ONLY
  // the toggle without also gaining edit rights on the bill itself.
  const canFbrExclude = has("invoices.fbr.exclude") && fbrEnabled;
  // Admin recovery for a bill stuck in a non-resubmittable FBR state
  // ("Submitting"/"Uncertain") after a timed-out or crashed submit.
  const canFbrReset = has("invoices.fbr.reset");
  // Dedicated permission for the FBR preview dialog — operator can sanity-
  // check the grouped items / totals before clicking Validate or Submit
  // without being trusted to actually call FBR. Administrator gets it
  // automatically via RbacSeeder.
  const canFbrPreview = has("invoices.fbr.preview") && fbrEnabled;
  // Client-filter dropdown needs `clients.manage.view` because it calls
  // GET /api/clients/company/{id}. A read-only role (e.g. tax consultant
  // with invoices.list.view only) would 403 on that call AND see a
  // non-functional empty dropdown. Gate both the fetch and the UI on
  // this permission — list still works without the filter.
  const canViewClients = has("clients.manage.view");
  // Shortcut to record a receipt (money in) straight from a sales invoice/bill —
  // opens the PaymentForm pre-filled with this client + this document. Gated by
  // the same permission as the Receipts page create action.
  const canRecordReceipt = has("accounting.receipts.create");
  // View the receipts applied to an invoice (+ balance) — gates the clickable
  // payment-status pill on the card.
  const canViewReceipts = has("accounting.receipts.view");
  // { contactId, documentId } for the receipt shortcut; null when closed.
  const [receiptPreset, setReceiptPreset] = useState(null);
  // Invoice whose receipt history is open in the dialog; null when closed.
  const [paymentHistoryDoc, setPaymentHistoryDoc] = useState(null);
  // The bill currently shown in the FBR preview dialog (null when closed).
  const [fbrPreviewId, setFbrPreviewId] = useState(null);
  // Bulk FBR preview dialog — open shows every bill currently ready
  // for Validate All / Submit All as a collapsible list. Operators
  // use it to scan the whole queue before launching a bulk action,
  // without bouncing through each card's per-bill "View FBR" button.
  // 2026-05-13: added.
  const [showBulkFbrPreview, setShowBulkFbrPreview] = useState(false);
  // Bulk invoice download / consolidated print. The dialog and the
  // rendering are shared with the public Customer Portal; only the
  // resolve call differs, because only the authorization differs.
  const [bulkPrintOpen, setBulkPrintOpen] = useState(false);
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  // Bill currently open in the correction wizard (null when closed). Opens the
  // post-sale CorrectionWizard the same way Reverse-etc modals open from a row.
  const [correctTarget, setCorrectTarget] = useState(null);
  // Bill selected for the admin "Reset FBR state" modal (Submitting/Uncertain).
  const [resetTarget, setResetTarget] = useState(null);
  // Invoice being recorded as filed by hand on FBR's portal (null when closed).
  const [manualTarget, setManualTarget] = useState(null);
  const [showForm, setShowForm] = useState(false);
  // Separate visibility flag for the "Create Bill (No Challan)" modal so
  // it doesn't share state with the regular New Bill flow.
  const [showStandaloneForm, setShowStandaloneForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const navigate = useNavigate();
  // ?search=<invoice-number> deep-link support — dashboard drills, document
  // copy and the old /bills links land on `/invoices?search={number}`; this
  // hook seeds the search-box state with that value on mount and the existing
  // fetch pipeline narrows the list to a single card automatically. Distinct route
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
  // Rows-per-page is remembered per tab (Bills / Invoices / each note tab),
  // matching the per-tab view-mode persistence above.
  const [size, setSize] = usePageSize(isNotesMode ? mode : "invoices");
  const [search, setSearch] = usePersistentFilter(filterScreen, "search", "");
  // Keep the URL's ?search= in sync with the search-box state. Without
  // this, clearing the box would still leave the param in the URL, and
  // a page reload would re-seed the box from the stale value (a stale
  // deep-link filter used to stick that way).
  // replace:true so each keystroke doesn't pollute browser history.
  useEffect(() => {
    const current = searchParams.get("search") || "";
    if (search === current) return;
    const next = new URLSearchParams(searchParams);
    if (search) next.set("search", search);
    else next.delete("search");
    setSearchParams(next, { replace: true });
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  // Seed from ?clientId= so the Clients page "N sales invoices" chip deep-links
  // straight to this list filtered to that client (distinct route key remounts
  // the page, so this initializer always sees the current URL).
  const [clientFilter, setClientFilter] = usePersistentFilter(filterScreen, "clientFilter", "");
  const [dateFrom, setDateFrom] = usePersistentFilter(filterScreen, "dateFrom", "");
  const [dateTo, setDateTo] = usePersistentFilter(filterScreen, "dateTo", "");
  // Filters are remembered across visits, but a deep link (?search= /
  // ?clientId=) still wins — applied once, during the first render, so the
  // first fetch already uses it. filterCompanyId tags which company the
  // remembered filters belong to (see the company effect below).
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  if (!deepLinkApplied) {
    setDeepLinkApplied(true);
    const qSearch = searchParams.get("search");
    const qClient = searchParams.get("clientId");
    if (qSearch) setSearch(qSearch);
    if (qClient) setClientFilter(qClient);
  }
  const [filterCompanyId, setFilterCompanyId] = usePersistentFilter(filterScreen, "companyId", null);
  const [hasExcelTax, setHasExcelTax] = useState(false);
  const [exportingId, setExportingId] = useState(null);

  const fetchClients = async (companyId) => {
    // Skip the call entirely if the role can't view clients — avoids a
    // guaranteed 403 in the network log for view-only roles like tax
    // consultant. The client filter dropdown is hidden in that case.
    if (!canViewClients) { setClients([]); return; }
    try {
      const { data } = await getClientsByCompany(companyId);
      setClients(data);
    } catch { setClients([]); }
  };

  const [loadError, setLoadError] = useState(false);
  const fetchInvoices = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoadError(false);
    setLoadingInvoices(true);
    try {
      const params = { page: pg || page };
      if (size) params.pageSize = size;
      if (search) params.search = search;
      if (clientFilter) params.clientId = clientFilter;
      if (divisionFilter) params.divisionId = divisionFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      // Note tabs list ONLY their own type; other tabs get sale bills
      // only (server-side split — the three groups never mix).
      if (isNotesMode) params.type = noteDocType === 10 ? "creditnotes" : "debitnotes";
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
    } catch { setInvoices([]); setTotalCount(0); setTotalPages(0); setLoadError(true); }
    finally { setLoadingInvoices(false); }
  }, [page, size, search, clientFilter, divisionFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedCompany) {
      fetchClients(selectedCompany.id);
      setPage(1);
      const sameCompany = filterCompanyId === selectedCompany.id;
      setFilterCompanyId(selectedCompany.id);
      // Division ids are per-company — a stale filter would blank the list.
      // Resetting it retriggers the filter effect below, so only fetch
      // directly when there's no reset to piggyback on (avoids a stale-
      // division request racing the corrected one).
      if (divisionFilter && !sameCompany) setDivisionFilter("");
      else fetchInvoices(selectedCompany.id, 1);
      hasExcelTemplate(selectedCompany.id, "TaxInvoice")
        .then(r => setHasExcelTax(r.data.hasExcelTemplate))
        .catch(() => setHasExcelTax(false));
    } else {
      setInvoices([]);
      setClients([]);
      setHasExcelTax(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany) fetchInvoices(selectedCompany.id, page);
  }, [page, size, search, clientFilter, divisionFilter, dateFrom, dateTo]);

  const resetFilters = () => {
    setSearch(""); setClientFilter(""); setDivisionFilter(""); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const handleFilterChange = (setter) => (e) => { setter(e.target.value); setPage(1); };

  // The invoice just made, for the "saved" banner and its next steps (Print,
  // Validate). The print runs on the operator's click, so no popup blocker
  // stands in its way.
  const [justSaved, setJustSaved] = useState(null);
  const handleCreated = (created) => {
    setShowForm(false);
    setShowStandaloneForm(false);
    setPage(1);
    fetchInvoices(selectedCompany.id, 1);
    if (created?.id) setJustSaved(created);
  };
  // One "New invoice" entry. It asks which way only when both are allowed.
  const newPaths = [
    canCreate && { key: "challan", label: "From a delivery challan", hint: "Bill goods already delivered on a challan.", open: () => setShowForm(true) },
    canCreateStandalone && !requireSO && { key: "direct", label: "Without challan", hint: "Bill straight from stock.", open: () => setShowStandaloneForm(true) },
  ].filter(Boolean);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const startNewInvoice = () => {
    if (newPaths.length === 1) newPaths[0].open();
    else setNewMenuOpen((v) => !v);
  };

  const handlePrintTax = async (inv) => {
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading invoice...</p>");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      const template = await resolvePrintTemplate(inv);
      const html = mergeTemplate(template, data);
      writeAndPrint(w, html);
    } catch { w.close(); notify("Failed to load invoice data.", "error"); }
  };

  const handleExportTaxPdf = async (inv) => {
    if (exportingId) return;
    setExportingId(inv.id + "-tax-pdf");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      const template = await resolvePrintTemplate(inv);
      const html = mergeTemplate(template, data);
      // "INVOICE # ..."; note tabs name the file after the note kind
      // ("CREDIT NOTE # 3 ...").
      const pdfLabel = isNotesMode ? noteLabel.toUpperCase() : "INVOICE";
      await exportToPdf(html, `${pdfLabel} # ${documentReference(data) || data.invoiceNumber} ${data.buyerName || data.clientName}`);
    } catch { notify("Failed to export the invoice PDF.", "error"); }
    finally { setExportingId(null); }
  };

  const handleExportTaxExcel = async (inv) => {
    if (exportingId) return;
    setExportingId(inv.id + "-tax-excel");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      // Note tabs reuse the TaxInvoice Excel template (notes have no Excel
      // template of their own) but name the file after the note kind so a
      // credit/debit note export isn't mistaken for a sales invoice — same
      // convention as the PDF tax export above.
      const res = await exportExcel(selectedCompany.id, "TaxInvoice", data);
      // saveAs() overrides the server's Content-Disposition filename, so the
      // prefix MUST be correct on this line — fixing only the backend wasn't enough.
      const xlsLabel = isNotesMode ? noteLabel.toUpperCase() : "INVOICE";
      saveAs(res.data, `${xlsLabel} # ${documentReference(data) || data.invoiceNumber} ${data.buyerName || data.clientName}.xlsx`);
    } catch { notify("Failed to export the invoice Excel.", "error"); }
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

  // "Invoice" on the sales screen, the note kind on a note screen.
  const docName = isNotesMode ? noteLabel : "Invoice";

  const handleFbrSubmit = async (inv) => {
    if (!fbrValidated.has(inv.id)) {
      notify("Please validate with FBR first before submitting.", "error");
      return;
    }
    const ok = await confirm({
      title: `Submit ${docName} #${inv.invoiceNumber} to FBR?`,
      message: `FBR issues an IRN and ${docName} #${inv.invoiceNumber} is locked: from then on it is corrected only with a credit or debit note. This cannot be undone.`,
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

  // Open the admin "Reset FBR state" modal for a stuck bill (Submitting/Uncertain).
  const handleFbrReset = (inv) => setResetTarget(inv);

  const handleDeleteInvoice = async (inv) => {
    if (inv.fbrStatus === "Submitted") {
      notify("A filed invoice cannot be deleted.", "error");
      return;
    }
    const ok = await confirm({
      title: `Delete ${docName} #${inv.invoiceNumber}?`,
      message: `${docName} #${inv.invoiceNumber} is removed for good: its stock returns, its ledger entries are reversed and its challans can be billed again. Number ${inv.invoiceNumber} is left as a gap — use Void to keep it.`,
      variant: "danger",
      confirmText: `Delete ${docName.toLowerCase()}`,
    });
    if (!ok) return;
    try {
      await deleteInvoice(inv.id);
      notify(`${docName} #${inv.invoiceNumber} deleted.`, "success");
      fetchInvoices(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Could not delete it.", "error");
    }
  };

  const handleVoidInvoice = async (inv) => {
    if (inv.fbrStatus === "Submitted") {
      notify("A filed invoice cannot be voided — issue a credit note instead.", "error");
      return;
    }
    const res = await confirm({
      title: `Void ${docName} #${inv.invoiceNumber}?`,
      message: `${docName} #${inv.invoiceNumber} is cancelled and keeps its number (no gap). Its stock returns, it leaves the reports, and its challans can be billed again.`,
      variant: "warning",
      confirmText: `Void ${docName.toLowerCase()}`,
      input: { label: "Reason (optional)", placeholder: "e.g. wrong rate / wrong challan — re-billing" },
    });
    if (!res?.ok) return;
    try {
      await cancelInvoice(inv.id, res.value);
      notify(`${docName} #${inv.invoiceNumber} voided. Its challans can be billed again.`, "success");
      fetchInvoices(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Could not void it.", "error");
    }
  };

  // Reverse an FBR-submitted bill → opens the Credit Note screen prefilled
  // with this invoice (industry pattern: Odoo's Reverse dialog / SAP credit
  // memo by reference). The operator trims lines/quantities for a partial
  // return or leaves everything for a full reversal, picks the FBR reason,
  // and generates the note — which then Validates/Submits like any bill.
  const handleReverseInvoice = (inv) => {
    if (inv.fbrStatus !== "Submitted") {
      notify("Only a filed invoice takes a credit note. Void an unfiled one instead.", "error");
      return;
    }
    navigate(`/credit-debit-notes?type=credit&invoiceId=${inv.id}`);
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
  // Future-dated bills are excluded from every FBR bulk action and from these
  // counts: FBR rule [0043] rejects a future invoice date, so Validate All /
  // Submit All would only collect guaranteed failures. They rejoin the queue by
  // themselves on their own date — nothing to un-exclude. (2026-08-28)
  const unsubmittedInvoices = invoices.filter(inv => inv.fbrStatus !== "Submitted" && !inv.isCancelled && inv.fbrReady && !inv.isFbrExcluded && !isFutureDocDate(inv.date));
  const incompleteCount = invoices.filter(inv => inv.fbrStatus !== "Submitted" && !inv.isCancelled && !inv.fbrReady && !inv.isFbrExcluded).length;
  const validatedCount = unsubmittedInvoices.filter(inv => fbrValidated.has(inv.id)).length;

  // Copy always produces an ordinary standalone bill, so it is gated on the
  // standalone-create key and hidden in the Credit / Debit Note tabs (a note
  // only exists against the invoice it adjusts).
  const canCopyBill = !isNotesMode && has("bills.manage.create.standalone");
  // Raising a delivery challan against a bill produces a challan, so the
  // challan-create permission is the right gate -- same reasoning the sales
  // order fulfilment action uses.
  const canCreateChallan = !isNotesMode && has("challans.manage.create");
  const [challanFor, setChallanFor] = useState(null);
  const copy = useDocumentCopy({
    sourceType: DOC_COPY_TYPES.bill,
    onRefresh: () => selectedCompany && fetchInvoices(selectedCompany.id, page),
  });

  const handleToggleFbrExcluded = async (inv) => {
    const nextExcluded = !inv.isFbrExcluded;
    const ok = await confirm({
      title: nextExcluded
        ? `Keep ${docName} #${inv.invoiceNumber} out of FBR bulk actions?`
        : `Put ${docName} #${inv.invoiceNumber} back into FBR bulk actions?`,
      message: nextExcluded
        ? "Validate all / Submit all will skip it. Its own Validate / Submit still work."
        : "Validate all / Submit all will pick it up again.",
      variant: nextExcluded ? "warning" : "info",
      confirmText: nextExcluded ? "Exclude" : "Include",
    });
    if (!ok) return;
    try {
      await setInvoiceFbrExcluded(inv.id, nextExcluded);
      notify(
        nextExcluded
          ? `${docName} #${inv.invoiceNumber} kept out of FBR bulk actions.`
          : `${docName} #${inv.invoiceNumber} is back in FBR bulk actions.`,
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
    if (divisionFilter) params.divisionId = divisionFilter;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (isNotesMode) params.type = noteDocType === 10 ? "creditnotes" : "debitnotes";
    const { data } = await getPagedInvoicesByCompany(selectedCompany.id, params);
    const all = data.items || [];
    if (action === "validate") {
      // Skip FBR-excluded bills — operator explicitly opted them out of bulk
      // actions — and future-dated ones, which FBR would reject with [0043].
      return all.filter(inv => inv.fbrStatus !== "Submitted" && !inv.isCancelled && inv.fbrReady && !inv.isFbrExcluded && !isFutureDocDate(inv.date));
    }
    if (action === "submit") {
      return all.filter(inv => inv.fbrStatus !== "Submitted" && !inv.isCancelled && fbrValidated.has(inv.id) && !inv.isFbrExcluded && !isFutureDocDate(inv.date));
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
      notify(`No invoices ready for FBR${filterNote}.`, "info");
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

  const hasFilters = search || clientFilter || divisionFilter || dateFrom || dateTo;

  // What each row may offer, and what each action does. utils/invoiceActions
  // decides the list (card and table share it); these are the handlers.
  const actionCtx = (inv) => ({
    perms: {
      canEdit: canEditInThisMode, canPrint, canVoid, canDelete, canCopy: canCopyBill, canCreateChallan,
      canRecordReceipt, canReverse, canFbrPreview, canFbrValidate, canFbrSubmit, canFbrExclude, canFbrReset,
    },
    fbrEnabled,
    hasFbrToken: !!selectedCompany?.hasFbrToken,
    validated: fbrValidated.has(inv.id),
    hasExcel: hasExcelTax,
    noTemplate: tplPicker.noTemplate,
    noTemplateReason: tplPicker.noTemplateReason,
    futureDated: isFutureDocDate(inv.date),
    isNotesMode,
    noteLabel: isNotesMode ? noteLabel.toLowerCase() : null,
  });
  const runAction = (key, inv) => ({
    edit: () => setEditingId(inv.id),
    print: () => handlePrintTax(inv),
    view: () => setViewingId(inv.id),
    pdf: () => handleExportTaxPdf(inv),
    excel: () => handleExportTaxExcel(inv),
    validate: () => handleFbrValidate(inv),
    submit: () => handleFbrSubmit(inv),
    preview: () => setFbrPreviewId(inv.id),
    exclude: () => handleToggleFbrExcluded(inv),
    reset: () => handleFbrReset(inv),
    recordManual: () => setManualTarget(inv),
    receipt: () => setReceiptPreset({ contactId: inv.clientId, documentId: inv.id, divisionId: inv.divisionId }),
    copy: () => copy.openCopy(inv.id, `Invoice #${inv.invoiceNumber}`),
    challan: () => setChallanFor(inv),
    creditNote: () => handleReverseInvoice(inv),
    correct: () => setCorrectTarget(inv),
    void: () => handleVoidInvoice(inv),
    delete: () => handleDeleteInvoice(inv),
  })[key]?.();
  const busyKey = (inv) =>
    fbrLoading === inv.id + "-validate" ? "validate"
      : fbrLoading === inv.id + "-submit" ? "submit"
      : exportingId === inv.id + "-tax-pdf" ? "pdf"
      : exportingId === inv.id + "-tax-excel" ? "excel"
      : null;

  return (
    <div>
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}>{isNotesMode ? <MdUndo size={28} color={colors.white} /> : <MdReceipt size={28} color={colors.white} />}</div>
          <div>
            <h2 style={styles.pageTitle}>{isNotesMode ? `${noteLabel}s` : "Invoices"}</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? (isNotesMode
                    ? `${noteDocType === 10 ? "Returns / reversals of submitted invoices" : "Upward adjustments against submitted invoices"} — ${totalCount} note${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
                    : `${totalCount} invoice${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`)
                : "Select a company"}
            </p>
          </div>
        </div>
        {/* alignItems flex-start, or the row stretches New invoice to the
            height of the SO-only note beside it. */}
        {!isNotesMode && companies.length > 0 && (canCreate || canCreateStandalone) && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
            {newPaths.length > 0 && (
              <div style={{ position: "relative" }}>
                <button style={styles.addBtn} onClick={startNewInvoice} aria-expanded={newPaths.length > 1 ? newMenuOpen : undefined}
                        title={newPaths.length > 1 ? "Make an invoice from a delivery challan, or straight from stock" : newPaths[0].hint}>
                  <MdAdd size={18} /> New invoice
                </button>
                {newMenuOpen && newPaths.length > 1 && (
                  <div role="menu" style={styles.newMenu} onMouseLeave={() => setNewMenuOpen(false)}>
                    {newPaths.map((x) => (
                      <button key={x.key} role="menuitem" type="button" style={styles.newMenuItem}
                              onClick={() => { setNewMenuOpen(false); x.open(); }}>
                        <strong>{x.label}</strong>
                        <span style={{ fontSize: "0.76rem", color: colors.textSecondary }}>{x.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Say why the button is not here. An operator who has the
                standalone-create permission has seen that button on another
                company, so its silent absence reads as a fault rather than as
                the setting it is -- the same reasoning as FbrOnlyNotice. Shown
                ONLY to someone who would otherwise have had the button;
                without the permission there is nothing to explain. */}
            {canCreateStandalone && requireSO && (
              <div style={styles.soOnlyNote}>
                <MdInfoOutline size={18} style={{ color: colors.blue, flexShrink: 0, marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", color: colors.textPrimary }}>
                    Invoices without a challan are turned off for {selectedCompany?.brandName || selectedCompany?.name || "this company"}.
                  </strong>
                  <span style={{ color: colors.textSecondary }}>
                    This company requires every invoice to come from a Sales Order, so
                    use <strong>New invoice</strong> and pick one of that order's delivery challans.
                    {canManageCompany && " To bill without a challan, turn off “Require a Sales Order for billing” in Settings → Companies → Document Numbers."}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        {/* Note tabs: notes are generated from an existing submitted
            invoice — the "New" button opens the note screen in this
            tab's mode. */}
        {isNotesMode && companies.length > 0 && canReverse && (
          <button
            style={styles.addBtn}
            onClick={() => navigate(`/credit-debit-notes?type=${noteDocType === 10 ? "credit" : "debit"}`)}
            title={noteDocType === 10
              ? "Reverse a submitted invoice — fully or line-by-line — by generating a Credit Note"
              : "Record an upward adjustment (undercharge / rate change / extra goods) against a submitted invoice"}
          >
            <MdAdd size={18} /> New {noteLabel}
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
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
            {/* Division scope — next to Company. Drives the list filter + the
                print-template scope. Self-hides for companies with no divisions. */}
            {selectedCompany && (
              <DivisionSelect
                companyId={selectedCompany?.id}
                value={divisionFilter}
                onChange={(v) => { setDivisionFilter(v); setPage(1); }}
                mode="filter"
                style={dropdownStyles.base}
              />
            )}
          </div>

          {/* FBR Bulk Actions — bar shows if caller has either FBR perm.
              Validate All is gated on canFbrValidate; Submit All on
              canFbrSubmit. Asymmetric grants render a partial bar. */}
          {canFbrAny && selectedCompany?.hasFbrToken && (unsubmittedInvoices.length > 0 || incompleteCount > 0) && (
            <div style={styles.fbrBulkBar}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <MdCloudUpload size={18} color={colors.blue} />
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary }}>
                  FBR: {unsubmittedInvoices.length} ready to submit
                  {validatedCount > 0 ? `, ${validatedCount} validated` : ""}
                </span>
                {incompleteCount > 0 && (
                  <span style={{ fontSize: "0.78rem", padding: "0.15rem 0.5rem", borderRadius: 12, backgroundColor: colors.cautionSoft, color: colors.warn, border: `1px solid ${colors.warnLine}`, fontWeight: 700 }}>
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
                  placeholder="Search invoice #, challan #, PO #, customer, item…"
                  className="filter-search-input"
                  value={search}
                  onChange={handleFilterChange(setSearch)}
                />
              </div>
              {canViewClients && (
                <div className="filter-client" style={{ flex: "1 1 170px", minWidth: 170, maxWidth: 300 }}>
                  <SearchableSelect
                    items={clients}
                    value={clientFilter}
                    onChange={(id) => handleFilterChange(setClientFilter)({ target: { value: id ? String(id) : "" } })}
                    placeholder="All Clients"
                  />
                </div>
              )}
              <div className="filter-date-group">
                <input type="date" className="filter-date-input" value={dateFrom} onChange={handleFilterChange(setDateFrom)} title="From date" />
                <span className="filter-date-sep">–</span>
                <input type="date" className="filter-date-input" value={dateTo} onChange={handleFilterChange(setDateTo)} title="To date" />
              </div>
              {hasFilters && (
                <button className="filter-clear-btn" onClick={resetFilters}>Clear</button>
              )}
              <PrintTemplateSelect picker={tplPicker} />
              {canBulkPrint && (
                <button
                  type="button"
                  className="filter-clear-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  onClick={() => setBulkPrintOpen(true)}
                  title={`Download every ${isNotesMode ? noteLabel.toLowerCase() : "invoice"} matching these filters`}
                >
                  <MdDownload size={14} /> Bulk PDF
                </button>
              )}
              {isBigScreen && (
                <div style={{ marginLeft: "auto" }}>
                  <ViewModeToggle
                    mode={viewMode}
                    onChange={setViewMode}
                    ariaLabel={isNotesMode ? `${noteLabel}s view mode` : "Invoices view mode"}
                  />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={styles.emptyState}><p style={{ color: colors.textSecondary }}>No companies available.</p></div>
      )}

      {justSaved && !isNotesMode && (
        <div style={styles.savedBanner} role="status">
          <MdCheckCircle size={20} color={colors.successDark} style={{ flexShrink: 0 }} />
          <span style={{ flex: "1 1 200px", minWidth: 0 }}>
            <strong>Invoice #{justSaved.invoiceNumber} saved.</strong> Next: print it{canFbrValidate && selectedCompany?.hasFbrToken ? ", or check it with FBR" : ""}.
          </span>
          <InvoiceActionBar
            inv={justSaved}
            actions={buildInvoiceActions(justSaved, actionCtx(justSaved)).filter((a) => ["print", "validate", "submit"].includes(a.key)).map((a) => ({ ...a, primary: true }))}
            onAction={runAction}
            busy={busyKey(justSaved)}
          />
          <button type="button" onClick={() => setJustSaved(null)} style={styles.bannerClose} aria-label="Dismiss" title="Dismiss">×</button>
        </div>
      )}

      {loadingInvoices ? (
        <div style={styles.loadingContainer} role="status" aria-label="Loading invoices"><div style={styles.spinner} /><span style={{ color: colors.textSecondary }}>Loading invoices…</span></div>
      ) : loadError && selectedCompany ? (
        <div style={styles.emptyState} role="alert">
          <MdError size={40} color={colors.error} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>The invoices could not be loaded. Check your connection, then try again.</p>
          <button type="button" style={styles.addBtnSecondary} onClick={() => fetchInvoices(selectedCompany.id, page)}>Try again</button>
        </div>
      ) : invoices.length === 0 && selectedCompany ? (
        <div style={styles.emptyState}>
          <MdReceipt size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
            {hasFilters
              ? "No invoices match these filters — clear them to see everything."
              : isNotesMode
                ? `No ${noteLabel.toLowerCase()}s yet.`
                : newPaths.length > 0 ? "No invoices yet — use New invoice to make the first one." : "No invoices yet."}
          </p>
          {hasFilters
            ? <button type="button" style={styles.addBtnSecondary} onClick={resetFilters}>Clear filters</button>
            : !isNotesMode && newPaths.length > 0 && <button type="button" style={styles.addBtn} onClick={startNewInvoice}><MdAdd size={18} /> New invoice</button>}
        </div>
      ) : (
        <>
          {viewMode === "table" ? (
            <InvoiceTable
              invoices={invoices}
              isReturnsMode={isNotesMode}
              noteDocType={noteDocType}
              perms={{ canViewReceipts }}
              onShowPayments={(inv) => setPaymentHistoryDoc(inv)}
              renderFbr={(inv) => (
                <InvoiceFbrChip chip={fbrChip(inv, { fbrEnabled, validated: fbrValidated.has(inv.id), futureDated: isFutureDocDate(inv.date) })} />
              )}
              renderActions={(inv) => (
                <InvoiceActionBar compact inv={inv} actions={buildInvoiceActions(inv, actionCtx(inv))}
                                  onAction={runAction} busy={busyKey(inv)} />
              )}
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
                      {isNotesMode ? noteLabel : "Invoice"} #{inv.invoiceNumber}
                    </h5>
                    {/* The company's own prefix ("PTC-52"): the reference the
                        customer quotes back. Hidden when it would just repeat
                        the number above it. */}
                    {documentReference(inv) && (
                      <p style={{ ...cardStyles.text, fontFamily: "monospace", fontSize: "0.72rem", color: colors.textSecondary, margin: "0 0 0.35rem" }}>
                        {documentReference(inv)}
                      </p>
                    )}
                    <p style={cardStyles.text}><strong>Client:</strong> {inv.clientName}</p>
                    {inv.divisionName && (
                      <p style={cardStyles.text}>
                        <strong>Division:</strong>{" "}
                        <span style={{ display: "inline-block", fontSize: "0.72rem", fontWeight: 700, color: colors.violetInk, background: colors.violetSoft, padding: "0.1rem 0.45rem", borderRadius: 8, verticalAlign: "middle" }}>{inv.divisionName}</span>
                      </p>
                    )}
                    {/* PO Number / Indent No / Site come from the linked
                        DeliveryChallans (aggregated server-side). All
                        three are optional — render only when present so
                        sparse bills don't get noisy. */}
                    {inv.poNumber && <p style={cardStyles.text}><strong>PO:</strong> {inv.poNumber}</p>}
                    {inv.indentNo && <p style={cardStyles.text}><strong>Indent:</strong> {inv.indentNo}</p>}
                    {inv.site && <p style={cardStyles.text}><strong>Site:</strong> {inv.site}</p>}
                    <p style={cardStyles.text}><strong>Date:</strong> {new Date(inv.date).toLocaleDateString()}</p>
                    <p style={cardStyles.text}><strong>Grand Total:</strong> Rs. {inv.grandTotal?.toLocaleString()}</p>
                    {/* Payment status + balance — clickable to see all receipts
                        applied to this invoice and how much remains. */}
                    {!inv.isCancelled && (
                      <button
                        type="button"
                        onClick={canViewReceipts ? () => setPaymentHistoryDoc(inv) : undefined}
                        title={canViewReceipts ? "View receipts & balance" : undefined}
                        style={{ all: "unset", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6, cursor: canViewReceipts ? "pointer" : "default" }}
                      >
                        <span style={{ fontSize: "0.74rem", color: colors.blue, fontWeight: 700 }}>Receipts</span>
                        {/* Says why the row has no items before the operator
                            opens it and finds an empty table. */}
                        {inv.isMigrated && (
                          <span
                            title={`Brought in by a ledger import${inv.migratedReference ? ` — reference ${inv.migratedReference}` : ""}. Carries a total, not line items.`}
                            style={{
                              fontSize: "0.68rem", fontWeight: 700, padding: "1px 6px",
                              borderRadius: 999, backgroundColor: colors.violetSoft, color: colors.violetInk,
                              letterSpacing: "0.02em",
                            }}
                          >
                            IMPORTED
                          </span>
                        )}
                        {inv.balanceDue > 0 && (
                          <span style={{ fontSize: "0.74rem", color: colors.textSecondary, fontWeight: 600 }}>
                            Bal: Rs {inv.balanceDue?.toLocaleString()}
                          </span>
                        )}
                      </button>
                    )}
                    <p style={{ ...cardStyles.text, fontSize: "0.78rem", color: colors.textSecondary }}>
                      {inv.challanNumbers?.length > 0 && <>Challan #{inv.challanNumbers.join(", #")} · </>}
                      {inv.items?.length} line{inv.items?.length === 1 ? "" : "s"}
                    </p>
                    {/* Which HS codes this document covers and how much sits
                        against each -- the question an operator reconciling
                        against a tariff asks of the list, not of one bill at a
                        time. Highest value first, so the chip that matters is
                        the one that fits; an unclassified line says so rather
                        than being left out. */}
                    {inv.hsBreakdown?.length > 0 && (
                      <div style={cardStyles.hsWrap}>
                        {inv.hsBreakdown.map((h, i) => (
                          <span key={h.hsCode || `none-${i}`}
                                style={h.hsCode ? cardStyles.hsChip : cardStyles.hsChipNone}
                                title={`${h.hsCode || "No HS code"} — ${Number(h.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}${h.uom ? " " + h.uom : ""} for Rs ${Number(h.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}>
                            <b>{h.hsCode || "No HS code"}</b>
                            {" · "}
                            {Number(h.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            {h.uom ? ` ${h.uom}` : ""}
                            {" · "}
                            Rs {Number(h.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* FBR status row — current status, or 'Setup Incomplete' when fields are missing. */}
                    {/* Goods billed at a rate other than the one they came in at. */}
                    <TaxRateBadge inv={inv} />
                    {/* This document IS a credit/debit note — show what it adjusts. */}
                    {(inv.documentType === 9 || inv.documentType === 10) && (
                      <div
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.35rem 0.7rem", borderRadius: 8, background: colors.violetSoft, color: colors.violet, fontSize: "0.78rem", fontWeight: 700, border: `1px solid ${colors.violetLine}` }}
                        title={inv.originalInvoiceNumber ? `${inv.documentType === 10 ? "Credit" : "Debit"} Note against Invoice #${inv.originalInvoiceNumber}${inv.originalInvoiceRefIRN ? ` (IRN ${inv.originalInvoiceRefIRN})` : ""}` : undefined}
                      >
                        <MdUndo size={14} color={colors.violet} />
                        <span>{inv.documentType === 10 ? "Credit Note" : "Debit Note"}{inv.originalInvoiceNumber ? ` ↩ against Invoice #${inv.originalInvoiceNumber}` : ""}</span>
                      </div>
                    )}
                    {/* This invoice HAS notes against it — clear indicators. */}
                    {inv.documentType !== 9 && inv.documentType !== 10 && inv.reversedByCreditNoteNumber && (
                      <div
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.35rem 0.7rem", borderRadius: 8, background: colors.violetSoft, color: colors.violet, fontSize: "0.78rem", fontWeight: 700, border: `1px solid ${colors.violetLine}` }}
                        title={`A Credit Note (#${inv.reversedByCreditNoteNumber}) has been created against this invoice. It reverses this sale.`}
                      >
                        <MdUndo size={14} color={colors.violet} />
                        <span>Reversed — Credit Note #{inv.reversedByCreditNoteNumber} created</span>
                      </div>
                    )}
                    {inv.documentType !== 9 && inv.documentType !== 10 && inv.adjustedByDebitNoteNumber && (
                      <div
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.35rem 0.7rem", borderRadius: 8, background: colors.tealSoft, color: colors.tealDark, fontSize: "0.78rem", fontWeight: 700, border: `1px solid ${colors.tealLine}` }}
                        title={`A Debit Note (#${inv.adjustedByDebitNoteNumber}) adjusts this invoice upward.`}
                      >
                        <MdUndo size={14} color={colors.tealDark} />
                        <span>Adjusted — Debit Note #{inv.adjustedByDebitNoteNumber}</span>
                      </div>
                    )}
                    {/* One FBR chip (utils/invoiceActions.fbrChip), the same words
                        as the table; the line under it says why an expected action
                        is missing (e.g. no Edit on a filed invoice). */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 6 }}>
                      <InvoiceFbrChip chip={fbrChip(inv, { fbrEnabled, validated: fbrValidated.has(inv.id), futureDated: isFutureDocDate(inv.date) })} />
                    </div>
                    {statusReason(inv) && <p style={styles.statusReason}>{statusReason(inv)}</p>}
                    {!inv.isCancelled && inv.fbrStatus === "Failed" && inv.fbrErrorMessage && (
                      <p style={{ ...styles.statusReason, color: colors.error, wordBreak: "break-word" }}>{inv.fbrErrorMessage}</p>
                    )}
                    {fbrEnabled && !inv.isCancelled && !isFiled(inv) && !inv.fbrReady && inv.fbrMissing?.length > 0 && (
                      <p style={styles.statusReason}>Missing for FBR: {inv.fbrMissing.slice(0, 3).join(" · ")}{inv.fbrMissing.length > 3 ? ` · +${inv.fbrMissing.length - 3} more` : ""}</p>
                    )}
                  </div>
                  <InvoiceActionBar
                    inv={inv}
                    actions={buildInvoiceActions(inv, actionCtx(inv))}
                    onAction={runAction}
                    busy={busyKey(inv)}
                    style={cardStyles.buttonGroup}
                  />
                </div>
              </div>
            ))}
          </div>
          )}
          {/* Pagination */}
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

      {/* The create and edit forms run in bill mode: item type per line
          (it fills HS / UOM / sale type) and the full edit. There is no
          separate FBR classification step on the importer. */}
      {showForm && selectedCompany && (
        <InvoiceForm
          companyId={selectedCompany.id}
          company={selectedCompany}
          billsMode
          defaultDivisionId={divisionFilter}
          onClose={() => setShowForm(false)}
          onSaved={(created) => handleCreated(created)}
        />
      )}

      {showStandaloneForm && selectedCompany && (
        <StandaloneInvoiceForm
          companyId={selectedCompany.id}
          company={selectedCompany}
          billsMode
          defaultDivisionId={divisionFilter}
          onClose={() => setShowStandaloneForm(false)}
          onSaved={(created) => handleCreated(created)}
        />
      )}

      {receiptPreset && selectedCompany && (
        <PaymentForm
          mode="receipts"
          companyId={selectedCompany.id}
          preset={receiptPreset}
          onClose={() => setReceiptPreset(null)}
          onSaved={() => { setReceiptPreset(null); fetchInvoices(selectedCompany.id, page); }}
        />
      )}

      {paymentHistoryDoc && selectedCompany && (
        <PaymentHistoryDialog
          mode="receipts"
          companyId={selectedCompany.id}
          doc={{ ...paymentHistoryDoc, number: paymentHistoryDoc.invoiceNumber }}
          onClose={() => setPaymentHistoryDoc(null)}
        />
      )}

      {/* Post-sale correction wizard — opens from a row's Correct action.
          supp → new unclassified delta bill (navigate to it on the Invoices
          tab to classify); credit/debit → a note against the original (refresh
          so the original's Reversed/Adjusted badge appears). */}
      {copy.source && (
        <CopyDocumentModal
          sourceType={DOC_COPY_TYPES.bill}
          sourceId={copy.source.id}
          sourceLabel={copy.source.label}
          onClose={copy.close}
          onCopied={copy.onCopied}
        />
      )}

      {/* Bulk download / consolidated print. Seeded with the screen's own date
          filter and carrying the same client / division / search filters, so it
          operates on exactly the set the operator is looking at. */}
      {selectedCompany && (
        <BulkInvoiceDialog
          open={bulkPrintOpen}
          onClose={() => setBulkPrintOpen(false)}
          title={isNotesMode ? `Download ${noteLabel}s` : "Download invoices"}
          documentType={printTemplateType}
          templates={tplPicker.templates}
          initialFrom={dateFrom}
          initialTo={dateTo}
          extraFilters={{
            clientId: clientFilter ? Number(clientFilter) : null,
            divisionId: divisionFilter ? Number(divisionFilter) : null,
            search: search || null,
          }}
          // Named, not id'd: "Client: 75" tells an operator nothing. Without
          // this the dialog reports a count the operator cannot account for —
          // over a wide date range, an inherited client filter looks exactly
          // like a broken query.
          inheritedFilters={[
            clientFilter
              ? `Client: ${clients.find((c) => String(c.id) === String(clientFilter))?.name || clientFilter}`
              : null,
            divisionFilter ? "Division filter" : null,
            search ? `Search: "${search}"` : null,
          ].filter(Boolean)}
          resolve={async (request) => {
            const { data } = await resolveInvoiceBulk(selectedCompany.id, request);
            return data;
          }}
        />
      )}

      {correctTarget && (
        <CorrectionWizard
          invoice={correctTarget}
          onClose={() => setCorrectTarget(null)}
          onCreated={(doc, correctionMode) => {
            setCorrectTarget(null);
            if (selectedCompany) fetchInvoices(selectedCompany.id, page);
            if (correctionMode === "supp") {
              notify(`Invoice #${doc.invoiceNumber} created for the balance quantity — check its lines, then validate and submit it to FBR.`, "success");
              navigate(`/invoices?search=${doc.invoiceNumber}`);
            } else {
              const kind = correctionMode === "credit" ? "Credit" : "Debit";
              notify(`${kind} Note #${doc.invoiceNumber} created — open the ${kind} Notes tab to validate and submit it to FBR.`, "success");
            }
          }}
        />
      )}

      {manualTarget && (
        <FbrRecordManualModal
          invoice={manualTarget}
          trackStock={!!selectedCompany?.inventoryTrackingEnabled}
          onClose={() => setManualTarget(null)}
          onDone={() => {
            const done = manualTarget;
            setManualTarget(null);
            if (selectedCompany) fetchInvoices(selectedCompany.id, page);
            notify(`${docName} #${done.invoiceNumber} recorded as filed on FBR's portal.`, "success");
          }}
        />
      )}

      {resetTarget && (
        <FbrResetModal
          invoice={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={() => {
            const wasRetry = resetTarget;
            setResetTarget(null);
            if (selectedCompany) fetchInvoices(selectedCompany.id, page);
            notify(`Bill #${wasRetry.invoiceNumber}: FBR state reset.`, "success");
          }}
        />
      )}

      {editingId && (
        <EditBillForm
          invoiceId={editingId}
          billsMode
          fbrEnabled={fbrEnabled}
          stockHardBlock={!!selectedCompany?.stockGuardHardBlock}
          inventoryOverlay={!!selectedCompany?.inventoryOverlayEnabled}
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
          billsMode
          fbrEnabled={fbrEnabled}
          stockHardBlock={!!selectedCompany?.stockGuardHardBlock}
          inventoryOverlay={!!selectedCompany?.inventoryOverlayEnabled}
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

      {challanFor && (
        <CreateChallanFromBillModal
          invoice={challanFor}
          onClose={() => setChallanFor(null)}
          onCreated={() => {
            setChallanFor(null);
            // Re-read the list so the action disappears once the bill is fully
            // delivered, and the remaining figure drops when it is partly.
            if (selectedCompany?.id) fetchInvoices(selectedCompany.id, page);
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
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: colors.white, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  // Visually distinct from the primary "New Bill" — outlined treatment
  // makes the standalone path the secondary action without losing
  // discoverability for roles that also have the primary permission.
  addBtnSecondary: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: `1px solid ${colors.blue}`, background: colors.white, color: colors.blue, fontSize: "0.9rem", fontWeight: 600, cursor: "pointer" },
  soOnlyNote: {
    display: "flex", alignItems: "flex-start", gap: 10,
    flex: "1 1 320px", minWidth: 0, maxWidth: 620,
    padding: "0.55rem 0.75rem", borderRadius: 10,
    background: colors.infoTint, border: `1px solid ${colors.infoLine}`, borderLeft: `3px solid ${colors.blue}`,
    fontSize: "0.8rem", lineHeight: 1.45,
  },
  loadingContainer: { display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  statusReason: { margin: "0.3rem 0 0", fontSize: "0.74rem", lineHeight: 1.35, color: colors.textSecondary },
  newMenu: {
    position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, minWidth: 260, maxWidth: "calc(100vw - 32px)",
    display: "flex", flexDirection: "column", padding: 6, borderRadius: 10,
    background: colors.white, border: `1px solid ${colors.cardBorder}`, boxShadow: "0 8px 24px rgba(12,24,48,0.12)",
  },
  newMenuItem: {
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minHeight: 44, padding: "0.5rem 0.75rem",
    border: "none", borderRadius: 8, background: "transparent", color: colors.textPrimary, textAlign: "left",
    cursor: "pointer", boxShadow: "none", fontSize: "0.86rem",
  },
  savedBanner: {
    position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", marginBottom: "1rem",
    padding: "0.6rem 3.2rem 0.6rem 0.8rem",
    borderRadius: 10, background: colors.successSoft, border: `1px solid ${colors.successLine}`, color: colors.successInk,
  },
  bannerClose: {
    position: "absolute", top: 2, right: 2,
    display: "grid", placeItems: "center", width: 44, height: 44, padding: 0, boxShadow: "none",
    border: "none", background: "transparent", color: colors.successInk, fontSize: "1.4rem", cursor: "pointer",
  },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`, backgroundColor: colors.white, color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
  fbrBulkBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", padding: "0.65rem 1rem", borderRadius: 10, border: `1px solid ${colors.infoSoft}`, backgroundColor: colors.infoTint },
  // FBR-status pills used in Bills mode. Soft-tinted background with a
  // matching border + an icon and label, sitting under the bill metadata
  // row so the operator gets a clear at-a-glance "locked / not yet" cue.
  // Invoices-mode FBR status pills — same shape as the Bills-mode ones
  // (Pending / Submitted) but tinted for the workflow states the FBR
  // officer needs to track: Ready, Setup Incomplete, Failed, Excluded.
  fbrBulkBtn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 1rem", borderRadius: 8, border: "none", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", transition: "filter 0.2s" },
  // 2026-05-13: neutral-blue outline for "Preview All" — distinct from
  // the amber Validate All (action) and solid-blue Submit All (terminal
  // action). Reads as an inspector button, not a workflow trigger.
  fbrBulkPreviewBtn: { backgroundColor: colors.white, color: colors.blue, border: `1px solid ${colors.infoLine}` },
  fbrBulkValidateBtn: { backgroundColor: colors.warnSoft, color: colors.warn },
  fbrBulkSubmitBtn: { backgroundColor: colors.blue, color: colors.white, boxShadow: "0 2px 8px rgba(13,71,161,0.2)" },
};
