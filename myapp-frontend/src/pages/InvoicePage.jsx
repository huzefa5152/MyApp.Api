import { createSalesOrderFromBill } from "../api/salesOrderApi";
import DocumentLinesNavigation from "../Components/DocumentLinesNavigation";
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MdReceipt, MdAdd, MdBusiness, MdPrint, MdDescription, MdPictureAsPdf, MdGridOn, MdCloudUpload, MdCheckCircle, MdError, MdHourglassEmpty, MdDelete, MdCancel, MdEdit, MdVisibility, MdBlock, MdRestore, MdOpenInNew, MdViewList, MdUndo, MdPostAdd, MdLocalShipping, MdAssignmentTurnedIn } from "react-icons/md";
import InvoiceForm from "../Components/InvoiceForm";
import StandaloneInvoiceForm from "../Components/StandaloneInvoiceForm";
import EditBillForm from "../Components/EditBillForm";
import BulkFbrResultsDialog from "../Components/BulkFbrResultsDialog";
import FbrPreviewDialog from "../Components/FbrPreviewDialog";
import BulkFbrPreviewDialog from "../Components/BulkFbrPreviewDialog";
import InvoiceTable from "../Components/InvoiceTable";
import Pagination from "../Components/Pagination";
import CorrectionWizard from "../Components/CorrectionWizard";
import FbrResetModal from "../Components/FbrResetModal";
import HandoverDialog from "../Components/HandoverDialog";
import ViewModeToggle from "../Components/ViewModeToggle";
import AttachmentBadge from "../Components/AttachmentBadge";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import { useListViewMode } from "../hooks/useListViewMode";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import PageSizeSelect from "../Components/PageSizeSelect";
import { getPagedInvoicesByCompany, getInvoicePrintBill, getInvoicePrintTaxInvoice, deleteInvoice, cancelInvoice, setInvoiceFbrExcluded, markInvoiceHandover, revertInvoiceHandover, bulkInvoiceHandover } from "../api/invoiceApi";
import { getClientsByCompany } from "../api/clientApi";
import { submitInvoiceToFbr, validateInvoiceWithFbr } from "../api/fbrApi";
import { cardStyles } from "../theme";
import { PageHeader, CompanyPicker, Button, Toolbar, ToolbarSpacer, SearchBox, Loading, EmptyState } from "../ui/Kit";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { hasExcelTemplate, exportExcel } from "../api/printTemplateApi";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import PaymentStatusBadge from "../Components/PaymentStatusBadge";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultBillTemplate, defaultTaxInvoiceTemplate } from "../utils/defaultTemplates";
import { exportToPdf } from "../utils/exportUtils";
import { saveAs } from "file-saver";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";

// Compact status pills for the invoice/bill cards — the FBR lifecycle and any
// note relationship collapse to a single small pill each (full detail on hover)
// so the card stays short. Payment status lives in the Grand Total row.
const PILL_BASE = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.72rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", lineHeight: 1.2 };
const PILL_TONE = {
  blue: { background: "#E6F1FB", color: "#0C447C" },
  amber: { background: "#FAEEDA", color: "#633806" },
  green: { background: "#E1F5EE", color: "#085041" },
  red: { background: "#FCEBEB", color: "#791F1F" },
  purple: { background: "#ede7f6", color: "#4527a0" },
  teal: { background: "#e0f2f1", color: "#00695c" },
  gray: { background: "#eceff1", color: "#37474f" },
};
function statusPill(tone, Icon, label, title) {
  return (
    <span style={{ ...PILL_BASE, ...PILL_TONE[tone] }} title={title}>
      {Icon ? <Icon size={13} /> : null}
      {label}
    </span>
  );
}
function renderFbrPill(inv, isBillsMode) {
  if (inv.isCancelled) return statusPill("red", MdCancel, "Cancelled", inv.cancelReason ? `Cancelled — ${inv.cancelReason}` : "Cancelled (voided). Its delivery challan(s) were reverted to Pending.");
  if (inv.fbrStatus === "Submitted") return statusPill("green", MdCheckCircle, "Submitted", inv.fbrIRN ? `Submitted to FBR — IRN ${inv.fbrIRN} (locked from edits)` : "Submitted to FBR (locked from edits)");
  if (inv.fbrStatus === "Submitting") return statusPill("blue", MdHourglassEmpty, "Submitting…", "A submission is in progress. Please wait and refresh — do not submit again.");
  if (inv.fbrStatus === "Uncertain") return statusPill("amber", MdError, "Uncertain", "A previous submission timed out and its FBR outcome is unconfirmed. An administrator must verify it at FBR and reset it before it can be submitted again.");
  if (inv.fbrReviewRequired) return statusPill("amber", MdError, "Needs consultant review", "Challans changed. Next: a tax consultant opens Invoices, checks all current items and chooses Complete review. FBR submission is blocked.");
  if (isBillsMode) return statusPill("amber", MdHourglassEmpty, "Pending", "Pending FBR submission — open the Invoices tab to validate & submit.");
  if (inv.fbrStatus === "Failed") return statusPill("red", MdError, "Failed", inv.fbrErrorMessage || "FBR rejected this submission. Open View FBR for details.");
  if (inv.fbrAdjustmentStale) return statusPill("amber", MdError, "Re-adjust", `Bill changed after FBR adjust — Bill Rs. ${Number(inv.subtotal).toLocaleString()} vs FBR Rs. ${Number(inv.fbrAdjustedSubtotal ?? inv.subtotal).toLocaleString()}. Reopen, re-adjust qty/price, then save.`);
  if (!inv.fbrReady) return statusPill("amber", MdError, inv.fbrMissing?.length ? `Setup · ${inv.fbrMissing.length}` : "Setup", inv.fbrMissing?.length ? `FBR setup incomplete — missing:\n• ${inv.fbrMissing.join("\n• ")}` : "FBR setup incomplete");
  if (inv.isFbrExcluded) return statusPill("gray", MdBlock, "Excluded", "Excluded from Validate All / Submit All bulk actions. Per-bill actions still work.");
  return statusPill("blue", MdCheckCircle, "Ready", "All FBR fields set — Validate to dry-run, or Submit to issue the IRN.");
}
function renderNotePill(inv) {
  if (inv.documentType === 10) return statusPill("purple", MdUndo, inv.originalInvoiceNumber ? `CN ↩#${inv.originalInvoiceNumber}` : "Credit Note", inv.originalInvoiceNumber ? `Credit Note against Bill #${inv.originalInvoiceNumber}${inv.originalInvoiceRefIRN ? ` (IRN ${inv.originalInvoiceRefIRN})` : ""}` : "Credit Note");
  if (inv.documentType === 9) return statusPill("teal", MdUndo, inv.originalInvoiceNumber ? `DN ↩#${inv.originalInvoiceNumber}` : "Debit Note", inv.originalInvoiceNumber ? `Debit Note against Bill #${inv.originalInvoiceNumber}` : "Debit Note");
  // Withdrawn at the FBR portal. Shown BEFORE the reversal pill: when a bill is
  // both cancelled at FBR and credit-noted, the cancellation is the stronger
  // fact — the filing no longer exists.
  if (inv.fbrCancelledAt) return statusPill("red", MdBlock, "FBR CANCELLED",
    `Cancelled on the FBR portal on ${new Date(inv.fbrCancelledAt).toLocaleDateString()}`
    + (inv.fbrCancelledReason ? ` — ${inv.fbrCancelledReason}` : "")
    + ". The bill keeps its number and IRN but no longer counts as a sale.");
  if (inv.reversedByCreditNoteNumber) return statusPill("purple", MdUndo, "Reversed", `Reversed by Credit Note #${inv.reversedByCreditNoteNumber}`);
  if (inv.adjustedByDebitNoteNumber) return statusPill("teal", MdUndo, "Adjusted", `Adjusted by Debit Note #${inv.adjustedByDebitNoteNumber}`);
  return null;
}
// Customer document handover pill (Invoices / Notes views). Answers "were the
// printed customer copies physically handed over?" — separate from the FBR
// pill. Renders only for FBR-submitted rows; "—" (NotApplicable) shows nothing.
function renderHandoverPill(inv) {
  if (inv.handoverStatus === "Delivered") {
    const when = inv.handoverAt ? new Date(inv.handoverAt).toLocaleDateString() : "";
    const who = inv.handoverByName ? ` by ${inv.handoverByName}` : " (migrated)";
    const remark = inv.handoverRemark ? `\nNote: ${inv.handoverRemark}` : "";
    return statusPill("green", MdAssignmentTurnedIn, "Docs delivered",
      `Customer documents handed over${when ? ` on ${when}` : ""}${who}.${remark}`);
  }
  if (inv.handoverStatus === "Pending") {
    return statusPill("amber", MdLocalShipping, "Docs pending",
      "Submitted to FBR but the printed customer copies have not been marked handed over yet.");
  }
  return null;
}

// Colour-coded tints for the card action buttons. Size, padding, radius, focus
// and disabled dimming come from the kit <Button size="sm"> (theme tokens); the
// tint keeps each action family recognisable (print / PDF / XLS / FBR / edit /
// delete / void / reverse …), exactly as before.
const tint = (bg, fg, border = "transparent") => ({ backgroundColor: bg, color: fg, borderColor: border });
const TONE = {
  view: tint("#e3f2fd", "#0d47a1", "#90caf9"),
  openTeal: tint("#e0f2f1", "#00695c", "#80cbc4"),
  print: tint("#f3e5f5", "#7b1fa2"),
  tax: tint("#e8f5e9", "#2e7d32"),
  pdf: tint("#ffebee", "#c62828"),
  excel: tint("#e8f5e9", "#1b5e20"),
  reset: tint("#fff8e1", "#8a6d00", "#ffe082"),
  validate: tint("#fff3e0", "#e65100"),
  validated: tint("#e8f5e9", "#2e7d32"),
  submit: tint("#e3f2fd", "#0d47a1"),
  edit: tint("#fff3e0", "#e65100", "#ffcc80"),
  include: tint("#e8f5e9", "#2e7d32", "#a5d6a7"),
  exclude: tint("#eceff1", "#546e7a", "#b0bec5"),
  deliver: tint("#e8f5e9", "#2e7d32", "#a5d6a7"),
  revert: tint("#fff8e1", "#8a6d00", "#ffe082"),
  delete: tint("#ffebee", "#c62828", "#ef9a9a"),
  void: tint("#fff8e1", "#b26a00", "#ffe082"),
  reverse: tint("#ede7f6", "#5e35b1", "#b39ddb"),
  correct: tint("#d6eee8", "#0a5d50", "#b6ddd3"),
};

export default function InvoicePage({ mode = "invoices" }) {
  // Tab split: `bills` mode is pre-FBR data entry — no item-type column
  // in the create/edit forms, no Validate All / Submit All bulk bar, no
  // per-card FBR Validate / Submit / Exclude buttons. The FBR-submitted
  // status badge still renders in both modes so the operator can see at
  // a glance which rows are locked. `invoices` mode keeps everything.
  const isBillsMode = mode === "bills";
  // Note tabs: `creditnotes` (returns / reversals, DocumentType 10) and
  // `debitnotes` (upward adjustments, DocumentType 9). Each lists ONLY its
  // type, numbered from its own per-company sequence (Credit Note #1…,
  // Debit Note #1…). Both behave like the Invoices tab (FBR validate /
  // submit visible) but with no create/edit — notes are generated from the
  // note screen and are immutable (void + recreate to change).
  const noteDocType = mode === "creditnotes" ? 10 : mode === "debitnotes" ? 9 : null;
  const isNotesMode = noteDocType !== null;
  const noteLabel = noteDocType === 10 ? "Credit Note" : "Debit Note";
  // Persist view-mode per tab so each tab remembers its own setting
  // (e.g. operator wants cards on Bills but table on Invoices).
  const [viewMode, setViewMode, isBigScreen] = useListViewMode(isBillsMode ? "bills" : isNotesMode ? mode : "invoices");
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
  // Print-template picker, keyed on the mode: Bills print the "Bill" type;
  // Invoices the "TaxInvoice" type; Credit/Debit notes their own distinct types.
  const printTemplateType = isBillsMode
    ? "Bill"
    : (mode === "creditnotes" ? "CreditNote" : mode === "debitnotes" ? "DebitNote" : "TaxInvoice");
  const tplPicker = usePrintTemplates(printTemplateType);
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canCreateOrderFromBill = has("salesorders.manage.create") && has("challans.manage.update");
  const [creatingOrderFor, setCreatingOrderFor] = useState(null);
  const handleCreateOrderFromBill = async inv => {
    if (creatingOrderFor) return;
    if (!await confirm({ title: `Create sales order from bill #${inv.invoiceNumber}?`,
      message: "Record an order from this bill's existing delivery challans. All challans will be attached; no duplicate delivery, bill or stock movement will be created. The order will show fully delivered, billed and closed. Filed bill details remain unchanged.", confirmText: "Create sales order" })) return;
    setCreatingOrderFor(inv.id);
    try { const { data } = await createSalesOrderFromBill(inv.id); notify(`Sales order #${data.salesOrderNumber} created · Fully delivered · Billed · Closed.`, "success"); await fetchInvoices(selectedCompany.id, page); }
    catch (e) { notify(e.response?.data?.error || "Could not create sales order.", "error"); }
    finally { setCreatingOrderFor(null); }
  };
  const canCreate = has("bills.manage.create");
  // Gates the payment-status badge (AR receipts). No key → no badge, either mode.
  const canViewPaymentStatus = has("accounting.paymentstatus.view");
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
  // Edit entry point is gated PER TAB to match the backend authorization:
  //   • Bills tab    → full bill PUT (InvoicesController.Update) → requires
  //     bills.manage.update.
  //   • Invoices tab → item-type(+qty) PATCH → requires the narrow
  //     invoices.manage.update.itemtype[.qty] perms.
  // A user holding ONLY the narrow item-type perms must NOT get an Edit
  // button on the Bills tab (the full PUT would 403); the item-type/qty
  // perms drive the Invoices tab only. A bills.manage.update user edits on
  // the Bills tab, not the item-type classification flow.
  // Note tabs: notes are immutable (server rejects edits too) — no Edit.
  const canEditInThisMode = isNotesMode
    ? false
    : isBillsMode
      ? canUpdate
      : (canEditItemType || canEditItemTypeAndQty);
  const canDelete = has("bills.manage.delete");
  // Void is its own permission (bills.manage.void), distinct from delete, so a
  // role can be allowed to void bills without also gaining hard-delete rights.
  const canVoid = has("bills.manage.void");
  // Reverse an FBR-submitted bill by generating a Credit/Debit Note. Its own
  // permission so the right to reverse a filed document is granted separately.
  const canReverse = has("invoices.note.create");
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
  // Admin recovery for a bill stuck in a non-resubmittable FBR state
  // ("Submitting"/"Uncertain") after a timed-out or crashed submit.
  const canFbrReset = has("invoices.fbr.reset");
  // Dedicated permission for the FBR preview dialog — operator can sanity-
  // check the grouped items / totals before clicking Validate or Submit
  // without being trusted to actually call FBR. Administrator gets it
  // automatically via RbacSeeder.
  const canFbrPreview = has("invoices.fbr.preview");
  // Customer document handover — mark delivered (single/bulk) and revert.
  // The "Documents" badge renders for anyone with invoices.list.view; only
  // these WRITE actions are gated (least-privilege — CLAUDE.md §2).
  const canDocsDeliver = has("invoices.docs.deliver");
  const canDocsRevert = has("invoices.docs.revert");
  // Client-filter dropdown needs `clients.manage.view` because it calls
  // GET /api/clients/company/{id}. A read-only role (e.g. tax consultant
  // with invoices.list.view only) would 403 on that call AND see a
  // non-functional empty dropdown. Gate both the fetch and the UI on
  // this permission — list still works without the filter.
  const canViewClients = has("clients.manage.view");
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
  const [attachTarget, setAttachTarget] = useState(null);
  const [correctTarget, setCorrectTarget] = useState(null);
  // Bill selected for the admin "Reset FBR state" modal (Submitting/Uncertain).
  const [resetTarget, setResetTarget] = useState(null);
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(selectedCompany?.id, "Invoice", invoices.map((r) => r.id));
  const [showForm, setShowForm] = useState(false);
  // Separate visibility flag for the "Create Bill (No Challan)" modal so
  // it doesn't share state with the regular New Bill flow.
  const [showStandaloneForm, setShowStandaloneForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  useEffect(() => { const id = Number(new URLSearchParams(window.location.search).get("viewBill")); if (id > 0) setViewingId(id); }, []);
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
  const [pageSize, setPageSize] = usePageSize("invoices");
  // Effective size echoed by the server when the user hasn't chosen one,
  // so the dropdown shows the real backend default (appsettings) not a guess.
  const [observedSize, setObservedSize] = useState(null);
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
  // FBR workflow-status filter: "" (all) | "notadjusted" | "ready" | "submitted".
  // Applied server-side (paged endpoint) so it paginates correctly. Shown on the
  // Bills and Invoices tabs. See InvoiceRepository.GetPagedByCompanyAsync.
  const [fbrFilter, setFbrFilter] = useState("");
  // Customer document-handover filter: "" (all) | "pending" | "delivered".
  // Server-side (paged endpoint), like fbrFilter. Invoices + Notes views only.
  const [handoverFilter, setHandoverFilter] = useState("");
  // Handover dialog: null | { mode:"single", inv } | { mode:"bulk", ids:[], count }
  const [handoverTarget, setHandoverTarget] = useState(null);
  const [handoverBulkBusy, setHandoverBulkBusy] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hasExcelBill, setHasExcelBill] = useState(false);
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

  const fetchInvoices = useCallback(async (companyId, pg) => {
    if (!companyId) return;
    setLoadingInvoices(true);
    try {
      const params = { page: pg || page };
      if (pageSize) params.pageSize = pageSize;
      if (search) params.search = search;
      if (clientFilter) params.clientId = clientFilter;
      if (fbrFilter) params.fbrFilter = fbrFilter;
      if (handoverFilter) params.handoverFilter = handoverFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      // Note tabs list ONLY their own type; other tabs get sale bills
      // only (server-side split — the three groups never mix).
      if (isNotesMode) params.type = noteDocType === 10 ? "creditnotes" : "debitnotes";
      const { data } = await getPagedInvoicesByCompany(companyId, params);
      setInvoices(data.items);
      setTotalCount(data.totalCount);
      setTotalPages(data.totalPages);
      setObservedSize(data.pageSize ?? null);
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
  }, [page, pageSize, search, clientFilter, fbrFilter, handoverFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedCompany) {
      // Clear on company switch so the spinner shows for the fresh load
      // rather than briefly displaying the previous company's invoices
      // (the refetch path now keeps the list mounted to preserve scroll).
      setInvoices([]);
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
  }, [page, pageSize, search, clientFilter, fbrFilter, handoverFilter, dateFrom, dateTo]);

  const resetFilters = () => {
    setSearch(""); setClientFilter(""); setFbrFilter(""); setHandoverFilter(""); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const handleFilterChange = (setter) => (e) => { setter(e.target.value); setPage(1); };

  const handleCreated = () => {
    setShowForm(false);
    setPage(1);
    fetchInvoices(selectedCompany.id, 1);
    refreshAttachCounts();
  };

  // Print only once every image in the popup has finished loading. Without
  // this, w.print() fires before the FBR QR (a base64 data-URL) and the FBR
  // logo (/images/fbr-logo.png, a network fetch) have decoded — so the FIRST
  // print comes out with them blank/missing and they only appear on a 2nd/3rd
  // attempt once cached. On production the network-fetched logo is slower, so
  // it misses consistently. `error` listeners + a 3s safety timeout guarantee
  // a broken or slow image never blocks the print dialog.
  const printWindowWhenImagesReady = (w) => {
    const imgs = Array.from(w.document.images || []);
    const ready = Promise.all(imgs.map((img) => (
      img.complete && img.naturalHeight !== 0
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          })
    )));
    const safety = new Promise((resolve) => setTimeout(resolve, 3000));
    Promise.race([ready, safety]).then(() => {
      try { w.focus(); w.print(); } catch { /* popup already closed */ }
    });
  };

  const handlePrintBill = async (inv) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading bill...</p>");
    try {
      const { data } = await getInvoicePrintBill(inv.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(inv)?.htmlContent || defaultBillTemplate, data);
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.onafterprint = () => w.close();
      printWindowWhenImagesReady(w);
    } catch { w.close(); notify("Failed to load bill data.", "error"); }
  };

  const handlePrintTax = async (inv) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading tax invoice...</p>");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(inv)?.htmlContent || defaultTaxInvoiceTemplate, data);
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.onafterprint = () => w.close();
      printWindowWhenImagesReady(w);
    } catch { w.close(); notify("Failed to load tax invoice data.", "error"); }
  };

  const handleExportBillPdf = async (inv) => {
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (exportingId) return;
    setExportingId(inv.id + "-bill-pdf");
    try {
      const { data } = await getInvoicePrintBill(inv.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(inv)?.htmlContent || defaultBillTemplate, data);
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
    if (tplPicker.noTemplate) { notify(tplPicker.noTemplateReason, "warning"); return; }
    if (exportingId) return;
    setExportingId(inv.id + "-tax-pdf");
    try {
      const { data } = await getInvoicePrintTaxInvoice(inv.id);
      const html = mergeTemplate(tplPicker.resolveTemplate(inv)?.htmlContent || defaultTaxInvoiceTemplate, data);
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

  // Open the admin "Reset FBR state" modal for a stuck bill (Submitting/Uncertain).
  const handleFbrReset = (inv) => setResetTarget(inv);

  const handleDeleteInvoice = async (inv) => {
    if (inv.fbrStatus === "Submitted") {
      notify("Cannot delete an FBR-submitted bill.", "error");
      return;
    }
    const ok = await confirm({
      title: inv.isCancelled ? `Delete voided Bill #${inv.invoiceNumber}?` : `Delete Bill #${inv.invoiceNumber}?`,
      message: inv.isCancelled
        ? "This bill was already voided, so its challans are billable already. Deleting removes the row entirely and rolls the bill number back."
        : "Linked delivery challans will revert back to Pending and become billable again.",
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

  const handleVoidInvoice = async (inv) => {
    if (inv.fbrStatus === "Submitted") {
      notify("Cannot void an FBR-submitted bill — issue a Credit Note instead.", "error");
      return;
    }
    const res = await confirm({
      title: `Void Bill #${inv.invoiceNumber}?`,
      message: "The bill keeps its number (no gap in the sequence) but is marked Cancelled and dropped from reports. Its delivery challan(s) revert to Pending so you can re-bill them.",
      variant: "warning",
      confirmText: "Void bill",
      input: { label: "Reason (optional)", placeholder: "e.g. wrong rate / wrong challan — re-billing" },
    });
    if (!res?.ok) return;
    try {
      await cancelInvoice(inv.id, res.value);
      notify(`Bill #${inv.invoiceNumber} voided. Challan(s) reverted to Pending.`, "success");
      fetchInvoices(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to void bill.", "error");
    }
  };

  // Reverse an FBR-submitted bill → opens the Credit Note screen prefilled
  // with this invoice (industry pattern: Odoo's Reverse dialog / SAP credit
  // memo by reference). The operator trims lines/quantities for a partial
  // return or leaves everything for a full reversal, picks the FBR reason,
  // and generates the note — which then Validates/Submits like any bill.
  const handleReverseInvoice = (inv) => {
    if (inv.fbrStatus !== "Submitted") {
      notify("Only an FBR-submitted bill can be reversed. Void a non-submitted bill instead.", "error");
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
  const unsubmittedInvoices = invoices.filter(inv => inv.fbrStatus !== "Submitted" && !inv.isCancelled && inv.fbrReady && !inv.isFbrExcluded);
  const incompleteCount = invoices.filter(inv => inv.fbrStatus !== "Submitted" && !inv.isCancelled && !inv.fbrReady && !inv.isFbrExcluded).length;
  const validatedCount = unsubmittedInvoices.filter(inv => fbrValidated.has(inv.id)).length;
  // Documents pending handover on the CURRENT page (drives the handover bulk
  // bar's label + visibility). The bulk action itself re-fetches ALL filtered
  // pending across pages, so it isn't limited to this count.
  const pendingHandoverCount = invoices.filter(inv => inv.handoverStatus === "Pending").length;

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

  // ── Customer document handover ──────────────────────────────────
  // Single mark opens the dialog (optional remark); the dialog calls
  // confirmSingleHandover with the remark. Revert is a plain confirm.
  const handleRevertHandover = async (inv) => {
    const ok = await confirm({
      title: `Revert delivery for #${inv.invoiceNumber}?`,
      message: "This marks the customer documents as NOT handed over (back to Pending). Who reverted it is recorded in the audit log.",
      variant: "warning",
      confirmText: "Revert to Pending",
    });
    if (!ok) return;
    try {
      await revertInvoiceHandover(inv.id);
      notify(`Bill #${inv.invoiceNumber}: documents reverted to Pending.`, "success");
      fetchInvoices(selectedCompany.id, page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to revert handover.", "error");
    }
  };

  const confirmSingleHandover = async (remark) => {
    const inv = handoverTarget?.inv;
    if (!inv) return;
    // Let the dialog surface any thrown error; only close + refetch on success.
    await markInvoiceHandover(inv.id, remark);
    notify(`Bill #${inv.invoiceNumber}: documents marked delivered.`, "success");
    setHandoverTarget(null);
    fetchInvoices(selectedCompany.id, page);
  };

  // Gather ALL pending invoices matching the current filters (across pages),
  // then open the bulk dialog. Mirrors fetchAllFilteredBills (FBR bulk).
  const openBulkHandover = async () => {
    setHandoverBulkBusy(true);
    try {
      const params = { page: 1, pageSize: 10000, handoverFilter: "pending" };
      if (search) params.search = search;
      if (clientFilter) params.clientId = clientFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (isNotesMode) params.type = noteDocType === 10 ? "creditnotes" : "debitnotes";
      const { data } = await getPagedInvoicesByCompany(selectedCompany.id, params);
      const ids = (data.items || []).map((i) => i.id);
      if (ids.length === 0) { notify("No pending documents to mark delivered.", "info"); return; }
      setHandoverTarget({ mode: "bulk", ids, count: ids.length });
    } catch {
      notify("Failed to load pending invoices.", "error");
    } finally {
      setHandoverBulkBusy(false);
    }
  };

  const confirmBulkHandover = async (remark) => {
    const ids = handoverTarget?.ids || [];
    if (ids.length === 0) return;
    const { data } = await bulkInvoiceHandover(ids, remark);
    const msg = data.skipped > 0
      ? `Marked ${data.delivered} delivered, skipped ${data.skipped} (already delivered or not eligible).`
      : `Marked ${data.delivered} invoice${data.delivered === 1 ? "" : "s"} delivered.`;
    notify(msg, data.delivered > 0 ? "success" : "info");
    setHandoverTarget(null);
    fetchInvoices(selectedCompany.id, page);
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
    if (isNotesMode) params.type = noteDocType === 10 ? "creditnotes" : "debitnotes";
    const { data } = await getPagedInvoicesByCompany(selectedCompany.id, params);
    const all = data.items || [];
    if (action === "validate") {
      // Skip FBR-excluded bills — operator explicitly opted them out of bulk actions.
      return all.filter(inv => inv.fbrStatus !== "Submitted" && !inv.isCancelled && inv.fbrReady && !inv.isFbrExcluded);
    }
    if (action === "submit") {
      return all.filter(inv => inv.fbrStatus !== "Submitted" && !inv.isCancelled && fbrValidated.has(inv.id) && !inv.isFbrExcluded);
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

  const hasFilters = search || clientFilter || fbrFilter || handoverFilter || dateFrom || dateTo;

  return (
    <DocumentLinesNavigation type={isBillsMode ? "bill" : mode === "creditnotes" ? "creditNote" : mode === "debitnotes" ? "debitNote" : "taxInvoice"}>
    <div>
      <PageHeader
        icon={isNotesMode ? MdUndo : MdReceipt}
        tone="brand"
        title={isNotesMode ? `${noteLabel}s` : isBillsMode ? "Bills" : "Invoices"}
        subtitle={selectedCompany
          ? (isNotesMode
              ? `${noteDocType === 10 ? "Returns / reversals of submitted invoices" : "Upward adjustments against submitted invoices"} — ${totalCount} note${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
              : isBillsMode
              ? `${totalCount} bill${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
              : `Classify items and submit to FBR — ${totalCount} record${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`)
          : "Select a company"}
        actions={(
          <>
            {/* Creation buttons live on the Bills tab only — Invoices tab is
                for FBR classification & submission of existing records. */}
            {isBillsMode && companies.length > 0 && canCreate && (
              <Button variant="primary" icon={MdAdd} onClick={() => setShowForm(true)}>
                New Bill
              </Button>
            )}
            {isBillsMode && companies.length > 0 && canCreateStandalone && (
              <Button
                variant="secondary"
                icon={MdAdd}
                onClick={() => setShowStandaloneForm(true)}
                title="Create a bill directly without linking a delivery challan (FBR-only flow)"
              >
                New Bill (No Challan)
              </Button>
            )}
            {/* Note tabs: notes are generated from an existing submitted
                invoice — the "New" button opens the note screen in this
                tab's mode. */}
            {isNotesMode && companies.length > 0 && canReverse && (
              <Button
                variant="primary"
                icon={MdAdd}
                onClick={() => navigate(`/credit-debit-notes?type=${noteDocType === 10 ? "credit" : "debit"}`)}
                title={noteDocType === 10
                  ? "Reverse a submitted invoice — fully or line-by-line — by generating a Credit Note"
                  : "Record an upward adjustment (undercharge / rate change / extra goods) against a submitted invoice"}
              >
                New {noteLabel}
              </Button>
            )}
          </>
        )}
      />

      {loadingCompanies ? (
        <Loading />
      ) : companies.length > 0 ? (
        <>
          <CompanyPicker />

          {/* FBR Bulk Actions — bar shows if caller has either FBR perm.
              Validate All is gated on canFbrValidate; Submit All on
              canFbrSubmit. Asymmetric grants render a partial bar.
              Bills tab hides the bar entirely — bulk FBR ops live on
              the Invoices tab. */}
          {!isBillsMode && canFbrAny && selectedCompany?.hasFbrToken && unsubmittedInvoices.length > 0 && (
            <div className="k-card" style={styles.bulkBar}>
              <div style={styles.bulkLead}>
                <MdCloudUpload size={18} color="#0d47a1" />
                <span style={styles.bulkText}>
                  FBR: {unsubmittedInvoices.length} ready to submit
                  {validatedCount > 0 ? `, ${validatedCount} validated` : ""}
                </span>
                {incompleteCount > 0 && (
                  <span style={{ fontSize: "0.78rem", padding: "0.15rem 0.5rem", borderRadius: 12, backgroundColor: "#fff8e1", color: "#e65100", border: "1px solid #ffcc80", fontWeight: 700 }}>
                    {incompleteCount} setup incomplete
                  </span>
                )}
              </div>
              <div style={styles.bulkActions}>
                {/* Preview All — read-only inspector for the whole bulk
                    queue. Gated on the same permission as the per-bill
                    preview dialog so we don't unintentionally expose
                    payload data to roles that lacked it before. Hidden
                    on tabs without ready bills. 2026-05-13. */}
                {canFbrPreview && unsubmittedInvoices.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={MdViewList}
                    onClick={() => setShowBulkFbrPreview(true)}
                    title="Preview the FBR payload for every bill that's ready to validate — collapsible rows, no network call to FBR."
                  >
                    Preview All
                  </Button>
                )}
                {canFbrValidate && (
                  <Button
                    size="sm"
                    style={TONE.validate}
                    disabled={bulkFbrLoading}
                    onClick={handleBulkValidateAll}
                  >
                    {bulkFbrLoading ? <span className="btn-spinner" /> : <MdCheckCircle size={15} />}
                    Validate All
                  </Button>
                )}
                {canFbrSubmit && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={bulkFbrLoading || validatedCount === 0}
                    onClick={handleBulkSubmitValidated}
                  >
                    {bulkFbrLoading ? <span className="btn-spinner" /> : <MdCloudUpload size={15} />}
                    Submit {validatedCount > 0 ? `${validatedCount} ` : ""}to FBR
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Customer document handover — bulk bar. Invoices + Notes only,
              shown when the caller can mark delivered and there are pending
              documents on the current page. "Mark delivered" acts on ALL
              pending rows matching the current filters (across pages). */}
          {!isBillsMode && canDocsDeliver && pendingHandoverCount > 0 && (
            <div className="k-card" style={styles.bulkBar}>
              <div style={styles.bulkLead}>
                <MdLocalShipping size={18} color="#e65100" />
                <span style={styles.bulkText}>
                  Documents: {pendingHandoverCount} pending on this page
                </span>
              </div>
              <div style={styles.bulkActions}>
                <Button
                  size="sm"
                  style={tint("#2e7d32", "#fff")}
                  disabled={handoverBulkBusy}
                  onClick={openBulkHandover}
                  title="Mark every pending invoice matching the current filters as documents delivered"
                >
                  {handoverBulkBusy ? <span className="btn-spinner" /> : <MdAssignmentTurnedIn size={15} />}
                  Mark delivered
                </Button>
              </div>
            </div>
          )}

          {/* Filters */}
          {selectedCompany && (
            <Toolbar>
              <SearchBox
                placeholder="Search Bill#, Challan#, PO#, Client, Item..."
                value={search}
                onChange={(text) => handleFilterChange(setSearch)({ target: { value: text } })}
              />
              {canViewClients && (
                <SearchableClientSelect
                  clients={clients}
                  value={clientFilter}
                  onChange={(id) => handleFilterChange(setClientFilter)({ target: { value: String(id) } })}
                  placeholder="All Clients"
                  style={styles.clientPicker}
                />
              )}
              {/* FBR workflow-status filter — Bills & Invoices tabs (not the
                  immutable note tabs). Server-side, so it paginates correctly. */}
              {!isNotesMode && (
                <select
                  className="k-select"
                  value={fbrFilter}
                  onChange={handleFilterChange(setFbrFilter)}
                  title="Filter by FBR status"
                >
                  <option value="">All FBR statuses</option>
                  <option value="notadjusted">Needs review / setup</option>
                  <option value="ready">Ready to validate</option>
                  <option value="submitted">Submitted to FBR</option>
                  <option value="fbrcancelled">Cancelled at FBR</option>
                  <option value="excluded">FBR excluded</option>
                </select>
              )}
              {/* Customer document-handover filter — Invoices + Notes views
                  (not the pre-FBR Bills tab, where nearly every row is "—").
                  Server-side, so it paginates correctly. */}
              {!isBillsMode && (
                <select
                  className="k-select"
                  value={handoverFilter}
                  onChange={handleFilterChange(setHandoverFilter)}
                  title="Filter by customer document handover"
                >
                  <option value="">All documents</option>
                  <option value="pending">Docs pending</option>
                  <option value="delivered">Docs delivered</option>
                </select>
              )}
              <div style={styles.dateGroup}>
                <input type="date" className="k-input" style={styles.dateInput} value={dateFrom} onChange={handleFilterChange(setDateFrom)} title="From date" aria-label="From date" />
                <span style={{ color: "var(--k-muted)" }}>–</span>
                <input type="date" className="k-input" style={styles.dateInput} value={dateTo} onChange={handleFilterChange(setDateTo)} title="To date" aria-label="To date" />
              </div>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters}>Clear</Button>
              )}
              <ToolbarSpacer />
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                {canPrint && <PrintTemplateSelect picker={tplPicker} />}
                {isBigScreen && (
                  <ViewModeToggle
                    mode={viewMode}
                    onChange={setViewMode}
                    ariaLabel={isBillsMode ? "Bills view mode" : "Invoices view mode"}
                  />
                )}
              </div>
            </Toolbar>
          )}
        </>
      ) : (
        <EmptyState icon={MdBusiness}>No companies available.</EmptyState>
      )}

      {/* Spinner ONLY on the initial/empty load. During a REFETCH (validate,
          submit, edit-save, delete, void…) we keep the existing list mounted
          so the browser preserves the scroll position — unmounting it here was
          why the page jumped to the top after every action. */}
      {loadingInvoices && invoices.length === 0 ? (
        <Loading />
      ) : invoices.length === 0 && selectedCompany ? (
        <EmptyState icon={MdReceipt}>
          {hasFilters ? "No invoices match the current filters." : "No invoices found. Create one from pending challans."}
        </EmptyState>
      ) : (
        <>
          {viewMode === "table" ? (
            <InvoiceTable
              invoices={invoices}
              attachCounts={attachCounts}
              onAttach={(inv) => setAttachTarget(inv)}
              isBillsMode={isBillsMode}
              isReturnsMode={isNotesMode}
              noteDocType={noteDocType}
              showPaymentStatus={canViewPaymentStatus}
              perms={{
                canPrint,
                canFbrPreview,
                canFbrAny,
                canFbrValidate,
                canFbrSubmit,
                canOpenEdit: canEditInThisMode,
                canCreateOrderFromBill, canViewOrders: has("salesorders.list.view"),
                canFbrExclude,
                canFbrReset,
                canDelete,
                canVoid,
                canReverse,
                canDocsDeliver,
                canDocsRevert,
              }}
              hasExcelBill={hasExcelBill}
              hasExcelTax={hasExcelTax}
              selectedCompanyHasFbrToken={!!selectedCompany?.hasFbrToken}
              fbrValidated={fbrValidated}
              fbrLoading={fbrLoading}
              exportingId={exportingId}
              printDisabled={tplPicker.noTemplate}
              printDisabledReason={tplPicker.noTemplateReason}
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
              onFbrReset={handleFbrReset}
              onCreateOrderFromBill={handleCreateOrderFromBill}
              creatingOrderFor={creatingOrderFor}
              onEdit={(inv) => setEditingId(inv.id)}
              onToggleFbrExcluded={handleToggleFbrExcluded}
              onDelete={handleDeleteInvoice}
              onVoid={handleVoidInvoice}
              onReverse={handleReverseInvoice}
              onCorrect={setCorrectTarget}
              onMarkHandover={(inv) => setHandoverTarget({ mode: "single", inv })}
              onRevertHandover={handleRevertHandover}
            />
          ) : (
          <div className="card-grid">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="k-card"
                style={styles.card}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, styles.cardHoverOn)}
                onMouseLeave={(e) => Object.assign(e.currentTarget.style, styles.cardHoverOff)}
              >
                <div style={styles.cardContent}>
                  <div>
                    <div style={cardStyles.cardHeader}>
                      <h5 style={styles.cardTitle}>
                        <MdReceipt style={{ color: "var(--k-blue)", marginRight: 6 }} />
                        {isNotesMode ? noteLabel : isBillsMode ? "Bill" : "Invoice"} #{inv.invoiceNumber}
                      </h5>
                      {/* FBR lifecycle + note relationship as compact pills;
                          detail on hover. Payment status is in the total row. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {renderNotePill(inv)}
                        {renderFbrPill(inv, isBillsMode)}
                        {!isBillsMode && renderHandoverPill(inv)}
                        <AttachmentBadge count={attachCounts[inv.id]} onClick={() => setAttachTarget(inv)} />
                      </div>
                    </div>
                    {/* Client is the card's primary line. */}
                    <p style={cardStyles.cardLead}>{inv.clientName || "—"}</p>
                    {/* PO / Indent / Site / Date / Lines / Challan — compact
                        labelled meta grid; the challan-sourced fields (PO /
                        Indent / Site) render only when present so sparse bills
                        stay clean. */}
                    <div style={cardStyles.metaGrid}>
                      {inv.poNumber && <div><span style={cardStyles.metaLabel}>PO</span><span style={cardStyles.metaValue}>{inv.poNumber}</span></div>}
                      {inv.indentNo && <div><span style={cardStyles.metaLabel}>Indent</span><span style={cardStyles.metaValue}>{inv.indentNo}</span></div>}
                      {inv.site && <div><span style={cardStyles.metaLabel}>Site</span><span style={cardStyles.metaValue}>{inv.site}</span></div>}
                      <div><span style={cardStyles.metaLabel}>Date</span><span style={cardStyles.metaValue}>{new Date(inv.date).toLocaleDateString()}</span></div>
                      <div><span style={cardStyles.metaLabel}>Lines</span><span style={cardStyles.metaValue}>{inv.items?.length || 0} item{inv.items?.length === 1 ? "" : "s"}</span></div>
                      {inv.challanNumbers?.length > 0 && <div><span style={cardStyles.metaLabel}>Challan</span><span style={cardStyles.metaValue}>#{inv.challanNumbers.join(", #")}</span></div>}
                    </div>
                    <div style={{ ...cardStyles.amountBox, alignItems: "center" }}>
                      <span style={{ display: "flex", flexDirection: "column" }}>
                        <span style={cardStyles.amountLabel}>Grand Total</span>
                        {isBillsMode && Number(inv.freightCharges) > 0 && <span style={cardStyles.amountLabel}>Includes freight / cartage: Rs. {Number(inv.freightCharges).toLocaleString()}</span>}
                        <span style={cardStyles.amount}>Rs. {(isBillsMode ? (inv.commercialTotal ?? ((Number(inv.grandTotal) || 0) + (Number(inv.freightCharges) || 0))) : inv.grandTotal)?.toLocaleString()}</span>
                      </span>
                      {/* Payment status (AR) sits with the amount — gated by
                          accounting.paymentstatus.view; hidden on cancelled docs
                          and credit/debit notes. FBR + note status are compact
                          pills in the card header (renderFbrPill/renderNotePill). */}
                      {canViewPaymentStatus && !inv.isCancelled && inv.documentType !== 9 && inv.documentType !== 10 && inv.paymentStatus && (
                        <PaymentStatusBadge
                          status={inv.paymentStatus}
                          balanceDue={inv.balanceDue}
                          daysOverdue={inv.daysOverdue}
                        />
                      )}
                    </div>
                  </div>
                  <div style={styles.buttonGroup}>
                    {/* Bills card: View, Print Bill, Bill PDF, Bill XLS, Edit, Delete.
                        Invoices card: View, Tax Print, Tax PDF, Tax XLS, View FBR, Validate, Submit. */}
                    {/* Read-only View — shown on BOTH tabs. On the Invoices tab
                        it opens the same read-only bill view so the operator can
                        inspect the grouped-by-Item-Type and individual line
                        items without switching to the Bills tab. */}
                    <Button size="sm"
                      style={TONE.view}
                      onClick={() => setViewingId(inv.id)}
                      title="View bill details (read-only) — grouped & individual line items"
                    >
                      <MdVisibility size={14} /> View
                    </Button>
                    {/* Cross-tab locator — Bills tab only. Navigates to
                        the Invoices tab with ?search=<billNumber> seeded;
                        the Invoices page reads the param on mount so the
                        list filters down to a single card. Operator can
                        clear the search box to see the full Invoices list
                        again. Reuses the existing search pipeline so no
                        new filter logic is needed. */}
                    {isBillsMode && (
                      <Button size="sm"
                        style={TONE.openTeal}
                        onClick={() => navigate(`/invoices?search=${encodeURIComponent(inv.invoiceNumber)}`)}
                        title="Find this bill on the Invoices tab so you can classify items and submit to FBR"
                      >
                        <MdOpenInNew size={14} /> Open in Invoices
                      </Button>
                    )}
                    {isBillsMode && canPrint && (
                      <Button size="sm"
                        style={TONE.print}
                        disabled={tplPicker.noTemplate}
                        title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"}
                        onClick={() => handlePrintBill(inv)}
                      >
                        <MdPrint size={14} /> Bill
                      </Button>
                    )}
                    {!isBillsMode && canPrint && (
                      <Button size="sm"
                        style={TONE.tax}
                        disabled={tplPicker.noTemplate}
                        title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"}
                        onClick={() => handlePrintTax(inv)}
                      >
                        <MdDescription size={14} /> Tax Invoice
                      </Button>
                    )}
                    {isBillsMode && canPrint && (
                      <Button size="sm" style={TONE.pdf} disabled={tplPicker.noTemplate || !!exportingId} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Export PDF"} onClick={() => handleExportBillPdf(inv)}>
                        {exportingId === inv.id + "-bill-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} Bill PDF
                      </Button>
                    )}
                    {!isBillsMode && canPrint && (
                      <Button size="sm" style={TONE.pdf} disabled={tplPicker.noTemplate || !!exportingId} title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Export PDF"} onClick={() => handleExportTaxPdf(inv)}>
                        {exportingId === inv.id + "-tax-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} Tax PDF
                      </Button>
                    )}
                    {isBillsMode && canPrint && hasExcelBill && (
                      <Button size="sm" style={TONE.excel} disabled={!!exportingId} onClick={() => handleExportBillExcel(inv)}>
                        {exportingId === inv.id + "-bill-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Bill XLS
                      </Button>
                    )}
                    {!isBillsMode && canPrint && hasExcelTax && (
                      <Button size="sm" style={TONE.excel} disabled={!!exportingId} onClick={() => handleExportTaxExcel(inv)}>
                        {exportingId === inv.id + "-tax-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Tax XLS
                      </Button>
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
                      <Button size="sm"
                        style={TONE.view}
                        onClick={() => setFbrPreviewId(inv.id)}
                        title="Preview the FBR payload — grouped items, total qty, total value, total tax. Read-only, doesn't send anything."
                      >
                        <MdVisibility size={14} /> View FBR
                      </Button>
                    )}
                    {!isBillsMode && canFbrReset && (inv.fbrStatus === "Submitting" || inv.fbrStatus === "Uncertain") && (
                      <Button size="sm"
                        style={TONE.reset}
                        onClick={() => handleFbrReset(inv)}
                        title="Reset this bill's FBR state (stuck after a timed-out/uncertain submit). Verify at FBR first."
                      >
                        <MdRestore size={14} /> Reset FBR
                      </Button>
                    )}
                    {!isBillsMode && canFbrAny && selectedCompany?.hasFbrToken && inv.fbrReady && inv.fbrStatus !== "Submitted" && inv.fbrStatus !== "Submitting" && inv.fbrStatus !== "Uncertain" && !inv.isCancelled && (
                      <>
                        {canFbrValidate && (
                          <Button size="sm"
                            style={fbrValidated.has(inv.id) ? TONE.validated : TONE.validate}
                            disabled={!!fbrLoading || !inv.fbrReady}
                            onClick={() => handleFbrValidate(inv)}
                            title={
                              inv.fbrAdjustmentStale
                                ? "Bill changed after this invoice was adjusted — open it, re-adjust qty / unit price so the FBR total matches the bill total, then Save. Validate is blocked until they match."
                                : !inv.fbrReady
                                  ? `Complete FBR setup first:\n• ${inv.fbrMissing?.join("\n• ") || "Missing FBR fields"}`
                                  : "Dry-run: checks all bill data with FBR without recording it. Must pass before you can submit."
                            }
                          >
                            {fbrLoading === inv.id + "-validate" ? <span className="btn-spinner" /> : <MdCheckCircle size={14} />}
                            {fbrValidated.has(inv.id) ? "Validated" : "Validate"}
                          </Button>
                        )}
                        {canFbrSubmit && (
                          <Button size="sm"
                            style={TONE.submit}
                            disabled={!!fbrLoading || !fbrValidated.has(inv.id) || !inv.fbrReady}
                            onClick={() => handleFbrSubmit(inv)}
                            title={
                              inv.fbrAdjustmentStale
                                ? "Bill changed after this invoice was adjusted — re-adjust it so the FBR total matches the bill total, then Save. Submit is blocked until they match."
                                : !inv.fbrReady
                                ? "Complete FBR setup first."
                                : fbrValidated.has(inv.id)
                                ? "Permanently submit this bill to FBR. Cannot be undone."
                                : "Validate first before submitting to FBR."
                            }
                          >
                            {fbrLoading === inv.id + "-submit" ? <span className="btn-spinner" /> : <MdCloudUpload size={14} />} Submit FBR
                          </Button>
                        )}
                      </>
                    )}
                    {/* Edit on Bills tab: full bill edit (per the user's
                        permissions) — items, prices, dates, etc. Item Type
                        column is hidden so classification only happens on
                        the Invoices tab. Hidden once FBR-submitted (locks
                        edits permanently). */}
                    {isBillsMode && canCreateOrderFromBill && inv.canCreateSalesOrder && <button style={styles.printBtn} disabled={!!creatingOrderFor} onClick={() => handleCreateOrderFromBill(inv)}>Create sales order</button>}
                    {isBillsMode && has("salesorders.list.view") && inv.salesOrders?.map(o => <button key={o.id} style={styles.printBtn} onClick={() => navigate(`/sales-orders?viewOrder=${o.id}`)}>Open sales order #{o.number || o.id}</button>)}
                    {isBillsMode && canEditInThisMode && inv.isEditable && (
                      <Button size="sm"
                        style={TONE.edit}
                        onClick={() => setEditingId(inv.id)}
                        title={canUpdate
                          ? "Edit items and prices on this bill"
                          : "Edit bill (your permissions)"}
                      >
                        <MdEdit size={14} /> Edit
                      </Button>
                    )}
                    {/* Edit on Invoices tab: ONLY allows picking the Item
                        Type for each line. Everything else (items, prices,
                        qty, dates) is read-only and reflects whatever was
                        last saved on the Bills tab. Hidden once submitted. */}
                    {!isBillsMode && canEditInThisMode && inv.isEditable && (
                      <Button size="sm"
                        style={TONE.edit}
                        onClick={() => setEditingId(inv.id)}
                        title="Review and adjust the current bill for FBR; commercial bill edits are on Bills"
                      >
                        <MdEdit size={14} /> {inv.fbrReviewRequired ? "Review changes" : "Adjust invoice"}
                      </Button>
                    )}
                    {!isBillsMode && canFbrExclude && inv.fbrStatus !== "Submitted" && !inv.isCancelled && (
                      <Button size="sm"
                        style={inv.isFbrExcluded ? TONE.include : TONE.exclude}
                        onClick={() => handleToggleFbrExcluded(inv)}
                        title={
                          inv.isFbrExcluded
                            ? "Re-enable this bill for Validate All / Submit All bulk actions."
                            : "Exclude this bill from Validate All / Submit All. Per-bill Validate / Submit still work."
                        }
                      >
                        {inv.isFbrExcluded ? <MdRestore size={14} /> : <MdBlock size={14} />}
                        {inv.isFbrExcluded ? "Include in FBR" : "Exclude from FBR"}
                      </Button>
                    )}
                    {/* Customer document handover — Invoices + Notes only. Mark
                        on Pending rows, Revert on Delivered rows. Both gated by
                        their own permission (button hidden otherwise). */}
                    {!isBillsMode && canDocsDeliver && inv.handoverStatus === "Pending" && (
                      <Button size="sm"
                        style={TONE.deliver}
                        onClick={() => setHandoverTarget({ mode: "single", inv })}
                        title="Mark the customer's printed documents (Bill + Tax Invoice) as handed over to the customer"
                      >
                        <MdAssignmentTurnedIn size={14} /> Mark Delivered
                      </Button>
                    )}
                    {!isBillsMode && canDocsRevert && inv.handoverStatus === "Delivered" && (
                      <Button size="sm"
                        style={TONE.reset}
                        onClick={() => handleRevertHandover(inv)}
                        title={`Delivered${inv.handoverAt ? ` on ${new Date(inv.handoverAt).toLocaleDateString()}` : ""}${inv.handoverByName ? ` by ${inv.handoverByName}` : " (migrated)"}${inv.handoverRemark ? ` — ${inv.handoverRemark}` : ""}. Click to revert to Pending.`}
                      >
                        <MdUndo size={14} /> Revert Delivery
                      </Button>
                    )}
                    {/* Delete: Bills tab only, last-created bill only,
                        not FBR-submitted. A CANCELLED bill still shows Delete
                        while it is the latest — the server has always allowed
                        it, and hiding the button stranded a voided trailing
                        bill with no way to remove it once the bill above it
                        was gone. */}
                    {(isBillsMode || isNotesMode) && canDelete && inv.fbrStatus !== "Submitted" && inv.isLatest && (
                      <Button size="sm"
                        style={TONE.delete}
                        onClick={() => handleDeleteInvoice(inv)}
                        title={inv.isCancelled
                          ? "Delete this voided document entirely — it is the latest in its sequence, so removing it rolls the number back."
                          : "Delete this document entirely — latest in its sequence only. Use Void to cancel an earlier one without leaving a gap."}
                      >
                        <MdDelete size={14} /> Delete
                      </Button>
                    )}
                    {/* Void: Bills tab, ANY non-submitted, non-cancelled bill
                        (not just the latest). Keeps the bill number so the
                        sequence stays gap-free, marks the bill Cancelled, and
                        reverts its delivery challan(s) to Pending for re-billing. */}
                    {(isBillsMode || isNotesMode) && canVoid && inv.fbrStatus !== "Submitted" && !inv.isCancelled && (
                      <Button size="sm"
                        style={TONE.void}
                        onClick={() => handleVoidInvoice(inv)}
                        title={isNotesMode
                          ? "Void this note — keeps its number (no gap), frees the original invoice so it can be reversed again."
                          : "Void this bill — keeps the bill number (no gap), marks it Cancelled and reverts its delivery challan(s) to Pending so they can be re-billed."}
                      >
                        <MdCancel size={14} /> Void
                      </Button>
                    )}
                    {/* Reverse: an FBR-SUBMITTED sale invoice (not itself a
                        note) can be reversed → generates a Credit Note as a new
                        unsubmitted bill to Validate + Submit. Replaces Void once
                        the bill has reached FBR. */}
                    {canReverse && inv.fbrStatus === "Submitted" && !inv.isCancelled && !inv.fbrCancelledAt &&
                     inv.documentType !== 9 && inv.documentType !== 10 && (
                      <Button size="sm"
                        style={TONE.reverse}
                        onClick={() => handleReverseInvoice(inv)}
                        title="Reverse this FBR-submitted bill — generates a Credit Note (new unsubmitted bill) that you then Validate and Submit to FBR."
                      >
                        <MdUndo size={14} /> Reverse
                      </Button>
                    )}
                    {canReverse && inv.fbrStatus === "Submitted" && !inv.isCancelled &&
                     inv.documentType !== 9 && inv.documentType !== 10 && (
                      <Button size="sm"
                        style={TONE.correct}
                        onClick={() => setCorrectTarget(inv)}
                        title="Bill the balance quantity under-reported on this submitted bill — creates a new unclassified bill (+ same challan/PO) for the tax consultant to classify and submit to FBR."
                      >
                        <MdPostAdd size={14} /> Correct
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          )}
          {/* Pagination */}
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

      {correctTarget && (
        <CorrectionWizard
          invoice={correctTarget}
          onClose={() => setCorrectTarget(null)}
          onCreated={(bill) => {
            setCorrectTarget(null);
            if (selectedCompany) fetchInvoices(selectedCompany.id, page);
            notify(`Bill #${bill.invoiceNumber} created for the balance quantity — classify it for FBR in Invoice mode.`, "success");
            navigate(`/invoices?search=${bill.invoiceNumber}`);
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

      {handoverTarget && (
        <HandoverDialog
          mode={handoverTarget.mode}
          invoiceNumber={handoverTarget.inv?.invoiceNumber}
          count={handoverTarget.count}
          onClose={() => setHandoverTarget(null)}
          onConfirm={handoverTarget.mode === "bulk" ? confirmBulkHandover : confirmSingleHandover}
        />
      )}

      {editingId && (
        <EditBillForm
          invoiceId={editingId}
          onLayoutSaved={() => fetchInvoices(selectedCompany.id, page)}
          billsMode={isBillsMode}
          // Invoices-tab edit lets the FBR officer set Item Type AND Qty —
          // descriptions, prices, dates, payment terms etc. stay read-only
          // and reflect whatever was last saved on the Bills tab. Set on
          // the Invoice card's Edit button only.
          forceItemTypeAndQty={!isBillsMode}
          onClose={() => { setEditingId(null); refreshAttachCounts(); }}
          onSaved={(result) => {
            setEditingId(null);
            notify(result?.reviewCompleted ? "Review completed. Next: validate the invoice before FBR submission." : result?.reviewPending ? "Progress saved. Consultant review is still required before FBR validation." : "Bill updated. Check its review status before FBR validation.", "success");
            fetchInvoices(selectedCompany.id, page);
            refreshAttachCounts();
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
          onLayoutSaved={() => fetchInvoices(selectedCompany.id, page)}
          readOnly
          // Read-only View is tab-aware, mirroring the Edit forms: the Bills
          // tab shows the original bill qty/price; the Invoices tab applies the
          // dual-book adjustment overlay so it shows the SAVED invoice-mode
          // qty/price (grouped + individual), not the underlying bill values.
          billsMode={isBillsMode}
          forceItemTypeAndQty={!isBillsMode}
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

      {attachTarget && selectedCompany && (
        <AttachmentQuickModal
          companyId={selectedCompany.id}
          entityType="Invoice"
          entityId={attachTarget.id}
          title={`#${attachTarget.invoiceNumber} — Attachments`}
          onClose={() => { setAttachTarget(null); refreshAttachCounts(); }}
        />
      )}
    </div>
    </DocumentLinesNavigation>
  );
}

const styles = {
  // FBR / handover bulk strips — a k-card surface laid out as a wrap row.
  bulkBar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", margin: "0 0 0.75rem", padding: "0.5rem 0.85rem", background: "#f8faff", boxShadow: "none" },
  bulkLead: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", minWidth: 0 },
  bulkText: { fontSize: "var(--k-font)", fontWeight: 600, color: "var(--k-ink)" },
  bulkActions: { display: "flex", gap: "0.5rem", flexWrap: "wrap" },
  // Client filter: grows with the toolbar, capped on desktop, full row on phones.
  clientPicker: { flex: "1 1 200px", minWidth: "min(200px, 100%)", maxWidth: 260 },
  dateGroup: { display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" },
  dateInput: { width: "auto", maxWidth: "100%" },
  // Invoice / bill card (card view). Surface comes from .k-card; the hover lift
  // follows --k-lift (Classic lifts, Workspace stays flat).
  // marginTop 0 cancels `.k-card + .k-card` stacking margin inside the grid.
  card: { marginTop: 0, overflow: "hidden", transition: "transform 0.2s ease, border-color 0.2s ease" },
  cardHoverOn: { transform: "var(--k-lift)", borderColor: "#b9c4d3" },
  cardHoverOff: { transform: "", borderColor: "" },
  cardContent: { display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", padding: "var(--k-card-pad)" },
  cardTitle: { ...cardStyles.title, fontSize: "calc(var(--k-font) + 0.2rem)" },
  buttonGroup: { ...cardStyles.buttonGroup, marginTop: "0.85rem", paddingTop: "0.75rem", flexWrap: "wrap", gap: "0.4rem" },
};
