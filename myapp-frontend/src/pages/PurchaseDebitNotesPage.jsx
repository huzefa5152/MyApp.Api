import RecordsViewport from "../Components/RecordsViewport";
import "../Components/AccountingModalTables.css";
import DocumentLinesNavigation, {
  DocumentLinesHeaderLink,
} from "../Components/DocumentLinesNavigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  MdReceiptLong,
  MdVisibility,
  MdDelete,
  MdPrint,
  MdPictureAsPdf,
  MdEdit,
  MdAdd,
} from "react-icons/md";
import {
  getPurchaseDebitNotesByCompany,
  deletePurchaseDebitNote,
  getPurchaseDebitNotePrintData,
} from "../api/purchaseDebitNoteApi";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import PurchaseDebitNoteForm from "../Components/PurchaseDebitNoteForm";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import useIsNarrow from "../hooks/useIsNarrow";
import { writeAndPrint } from "../utils/printDocument";
import { mergeTemplate } from "../utils/templateEngine";
import { exportToPdf } from "../utils/exportUtils";
import { defaultDebitNoteTemplate } from "../utils/purchaseNoteDocTemplates";
import { formStyles, modalSizes, cardStyles } from "../theme";
import {
  Button,
  CompanyPicker,
  EmptyState,
  IconButton,
  Loading,
  PageHeader,
  SearchBox,
  TableWrap,
  Toolbar,
} from "../ui/Kit";

const money = (n) =>
  "Rs. " +
  (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

export default function PurchaseDebitNotesPage() {
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("purchasedebitnotes.list.view");
  const canDelete = has("purchasedebitnotes.manage.delete");
  const canPrint = has("purchasedebitnotes.print.view");
  const canCreate = has("purchasedebitnotes.manage.create");
  const canUpdate = has("purchasedebitnotes.manage.update");
  const isNarrow = useIsNarrow();

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [viewNote, setViewNote] = useState(null);
  const [exportingId, setExportingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formNoteId, setFormNoteId] = useState(null);

  const openCreate = () => {
    setFormNoteId(null);
    setFormOpen(true);
  };
  const openEdit = (n) => {
    setFormNoteId(n.id);
    setFormOpen(true);
  };
  const closeForm = () => setFormOpen(false);

  // Reuse the "Debit Note" print template (issuer letterhead = our company,
  // the debited supplier = the buyer block). Scoped to the company filter so
  // a company-specific default template wins when one is set.
  const tplPicker = usePrintTemplates("DebitNote");
  const resolveTpl = (n) => tplPicker.resolveTemplate(n)?.htmlContent || defaultDebitNoteTemplate;

  const handlePrint = async (n) => {
    const w = window.open("", "_blank");
    if (!w) {
      notify("Popup blocked. Allow popups for this site to print.", "warning");
      return;
    }
    w.document.write("<p style='font-family:sans-serif;padding:24px'>Loading debit note…</p>");
    try {
      const { data } = await getPurchaseDebitNotePrintData(n.id);
      writeAndPrint(w, mergeTemplate(resolveTpl(n), data));
    } catch {
      w.close();
      notify("Failed to prepare the print view.", "error");
    }
  };

  const handleExportPdf = async (n) => {
    if (exportingId) return;
    setExportingId(n.id);
    try {
      const { data } = await getPurchaseDebitNotePrintData(n.id);
      await exportToPdf(
        mergeTemplate(resolveTpl(n), data),
        `Debit Note ${n.debitNoteNumber || n.id}`,
      );
    } catch {
      notify("Failed to export PDF.", "error");
    } finally {
      setExportingId(null);
    }
  };

  const fetchNotes = useCallback(async (companyId) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data } = await getPurchaseDebitNotesByCompany(companyId);
      setNotes(Array.isArray(data) ? data : []);
    } catch {
      notify("Failed to load purchase debit notes.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCompany?.id) fetchNotes(selectedCompany.id);
  }, [selectedCompany, fetchNotes]);

  const handleDelete = async (n) => {
    if (
      !(await confirm({
        title: "Delete purchase debit note?",
        message: `Debit note #${n.debitNoteNumber} to ${n.supplierName} will be removed.`,
        confirmText: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await deletePurchaseDebitNote(n.id);
      notify("Purchase debit note deleted.", "success");
      fetchNotes(selectedCompany.id);
    } catch (err) {
      notify(err.response?.data?.error || "Delete failed.", "error");
    }
  };

  const filtered = useMemo(
    () =>
      notes.filter((n) => {
        if (!search.trim()) return true;
        const t = search.toLowerCase();
        return (
          (n.supplierName || "").toLowerCase().includes(t) ||
          (n.notes || "").toLowerCase().includes(t) ||
          String(n.debitNoteNumber).includes(t)
        );
      }),
    [notes, search],
  );

  const total = useMemo(
    () => filtered.reduce((s, n) => s + (Number(n.grandTotal) || 0), 0),
    [filtered],
  );

  if (!canView) {
    return (
      <EmptyState icon={MdReceiptLong}>You don't have access to Purchase Debit Notes.</EmptyState>
    );
  }

  const rowActions = (n) => (
    <>
      <IconButton label="View" icon={MdVisibility} size={16} onClick={() => setViewNote(n)} />
      {canUpdate && <IconButton label="Edit" icon={MdEdit} size={16} onClick={() => openEdit(n)} />}
      {canPrint && (
        <IconButton
          label={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print"}
          icon={MdPrint}
          size={16}
          disabled={tplPicker.noTemplate}
          onClick={() => handlePrint(n)}
        />
      )}
      {canPrint && (
        <IconButton
          label={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Download PDF"}
          icon={MdPictureAsPdf}
          size={16}
          disabled={tplPicker.noTemplate || exportingId === n.id}
          onClick={() => handleExportPdf(n)}
        />
      )}
      {canDelete && (
        <IconButton
          danger
          label="Delete"
          icon={MdDelete}
          size={16}
          onClick={() => handleDelete(n)}
        />
      )}
    </>
  );

  return (
    <DocumentLinesNavigation type="purchaseDebit">
      <div>
        <PageHeader
          icon={MdReceiptLong}
          tone="brand"
          title="Purchase Debit Notes"
          subtitle={`${filtered.length} note${filtered.length !== 1 ? "s" : ""} · ${money(total)} total`}
          actions={
            <>
              <DocumentLinesHeaderLink />
              {canCreate && companies?.length > 0 && (
                <Button variant="primary" icon={MdAdd} onClick={openCreate}>
                  New Purchase Debit Note
                </Button>
              )}
            </>
          }
        />

        <CompanyPicker />

        <Toolbar data-admin-toolbar="">
          <PrintTemplateSelect picker={tplPicker} />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search supplier / description / #…"
          />
        </Toolbar>

        <RecordsViewport label="Purchase Debit Notes records">
          {loading ? (
            <Loading>Loading debit notes…</Loading>
          ) : filtered.length === 0 ? (
            <EmptyState icon={MdReceiptLong}>No purchase debit notes for this company.</EmptyState>
          ) : isNarrow ? (
            <div style={styles.cardList}>
              {filtered.map((n) => (
                <div key={n.id} style={styles.card}>
                  <div style={cardStyles.cardHeader}>
                    <span style={styles.cardNum}>#{n.debitNoteNumber}</span>
                    <span style={styles.cardDate}>{fmtDate(n.date)}</span>
                  </div>
                  <div style={cardStyles.cardLead}>
                    {n.supplierName}
                    {n.companyName ? <span style={styles.divTag}>{n.companyName}</span> : null}
                  </div>
                  <div style={cardStyles.metaGrid}>
                    <div>
                      <span style={cardStyles.metaLabel}>Notes</span>
                      <span style={cardStyles.metaValue}>{n.supplierRef || n.notes || "—"}</span>
                    </div>
                  </div>
                  <div style={cardStyles.amountBox}>
                    <span style={cardStyles.amountLabel}>Amount</span>
                    <span style={cardStyles.amount}>{money(n.grandTotal)}</span>
                  </div>
                  <div style={styles.cardActions}>{rowActions(n)}</div>
                </div>
              ))}
              <div style={styles.totalCard}>
                <span style={styles.totalCardLabel}>Total ({filtered.length})</span>
                <span style={styles.totalCardValue}>{money(total)}</span>
              </div>
            </div>
          ) : (
            <TableWrap>
              <table className="k-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>#</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Notes</th>
                    <th className="k-num">Amount</th>
                    <th className="k-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((n) => (
                    <tr key={n.id}>
                      <td className="k-muted">{n.debitNoteNumber}</td>
                      <td>{fmtDate(n.date)}</td>
                      <td style={{ fontWeight: 600 }}>
                        {n.supplierName}
                        {n.companyName ? <span style={styles.divTag}>{n.companyName}</span> : null}
                      </td>
                      <td className="k-muted">{n.supplierRef || n.notes || "—"}</td>
                      <td className="k-num">{money(n.grandTotal)}</td>
                      <td className="k-actions">
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {rowActions(n)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="k-num k-muted" style={{ fontWeight: 700 }}>
                      Total
                    </td>
                    <td className="k-num" style={styles.total}>
                      {money(total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
        </RecordsViewport>

        {viewNote && (
          <div data-admin-backdrop="" style={formStyles.backdrop} onClick={() => setViewNote(null)}>
            <div
              data-admin-dialog=""
              style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <div data-admin-header="" style={formStyles.header}>
                <h5 style={formStyles.title}>Purchase Debit Note #{viewNote.debitNoteNumber}</h5>
                <button
                  data-admin-close=""
                  style={formStyles.closeButton}
                  onClick={() => setViewNote(null)}
                >
                  &times;
                </button>
              </div>
              <div data-admin-body="" style={formStyles.body}>
                <div style={styles.vRow}>
                  <span style={styles.vLbl}>Supplier</span>
                  <span style={styles.vVal}>{viewNote.supplierName}</span>
                </div>
                <div style={styles.vRow}>
                  <span style={styles.vLbl}>Date</span>
                  <span style={styles.vVal}>{fmtDate(viewNote.date)}</span>
                </div>
                {viewNote.companyName && (
                  <div style={styles.vRow}>
                    <span style={styles.vLbl}>Company</span>
                    <span style={styles.vVal}>{viewNote.companyName}</span>
                  </div>
                )}
                {viewNote.supplierRef && (
                  <div style={styles.vRow}>
                    <span style={styles.vLbl}>Reference</span>
                    <span style={styles.vVal}>{viewNote.supplierRef}</span>
                  </div>
                )}
                <TableWrap className="accounting-modal-cards">
                  <table className="k-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="k-num">Qty</th>
                        <th>UOM</th>
                        <th className="k-num">Unit Price</th>
                        <th className="k-num">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(viewNote.items || []).map((i) => (
                        <tr key={i.id}>
                          <td data-label="Description">{i.description}</td>
                          <td data-label="Quantity" className="k-num">
                            {Number(i.quantity).toLocaleString()}
                          </td>
                          <td data-label="UOM">{i.uom || "—"}</td>
                          <td data-label="Unit price" className="k-num">
                            {money(i.unitPrice)}
                          </td>
                          <td data-label="Line total" className="k-num">
                            {money(i.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                <div
                  style={{
                    ...styles.vRow,
                    borderTop: "1px solid var(--k-line)",
                    marginTop: 8,
                    paddingTop: 12,
                  }}
                >
                  <span style={styles.vLbl}>Total</span>
                  <span
                    style={{
                      ...styles.vVal,
                      fontSize: "var(--k-fs-lg)",
                      fontWeight: 700,
                      color: "var(--k-blue)",
                    }}
                  >
                    {money(viewNote.grandTotal)}
                  </span>
                </div>
              </div>
              <div data-admin-footer="" style={formStyles.footer}>
                <button
                  data-admin-close=""
                  type="button"
                  style={{ ...formStyles.button, ...formStyles.cancel }}
                  onClick={() => setViewNote(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {formOpen && selectedCompany && (
          <PurchaseDebitNoteForm
            companyId={selectedCompany.id}
            company={selectedCompany}
            noteId={formNoteId}
            onClose={closeForm}
            onSaved={() => {
              closeForm();
              fetchNotes(selectedCompany.id);
            }}
          />
        )}
      </div>
    </DocumentLinesNavigation>
  );
}

const styles = {
  total: { fontWeight: 800, color: "var(--k-blue)", whiteSpace: "nowrap" },
  divTag: {
    marginLeft: 6,
    padding: "0.1rem 0.4rem",
    borderRadius: "var(--k-r-xs)",
    background: "var(--k-surface-3)",
    color: "var(--k-blue)",
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 700,
  },
  cardList: { display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: 8 },
  card: { ...cardStyles.card, padding: "0.85rem 0.95rem" },
  cardNum: { fontWeight: 700, fontSize: "var(--k-fs-md)", color: "var(--k-blue)" },
  cardDate: { fontSize: "var(--k-fs-xs)", color: "var(--k-muted)" },
  cardActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.4rem",
    justifyContent: "flex-end",
    borderTop: "1px solid var(--k-line)",
    paddingTop: "0.6rem",
  },
  totalCard: {
    ...cardStyles.card,
    padding: "0.75rem 0.95rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "var(--k-surface-2)",
  },
  totalCardLabel: { fontWeight: 700, color: "var(--k-muted)" },
  totalCardValue: { fontWeight: 800, color: "var(--k-blue)" },
  vRow: { display: "flex", justifyContent: "space-between", padding: "0.3rem 0", gap: 12 },
  vLbl: { color: "var(--k-muted)", fontSize: "var(--k-fs-base)" },
  vVal: {
    color: "var(--k-ink)",
    fontSize: "var(--k-fs-base)",
    fontWeight: 500,
    textAlign: "right",
  },
};
