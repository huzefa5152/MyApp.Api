import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MdFactCheck, MdAdd, MdBusiness, MdEdit, MdDelete, MdPrint, MdVisibility, MdPictureAsPdf } from "react-icons/md";
import {
  getWithholdingReceiptsByCompany, createWithholdingReceipt,
  updateWithholdingReceipt, deleteWithholdingReceipt,
  getWithholdingReceiptPrintData,
} from "../api/withholdingTaxApi";
import WithholdingTaxReceiptForm from "../Components/WithholdingTaxReceiptForm";
import AttachmentManager from "../Components/AttachmentManager";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import useIsNarrow from "../hooks/useIsNarrow";
import { notify } from "../utils/notify";
import { writeAndPrint } from "../utils/printDocument";
import { mergeTemplate } from "../utils/templateEngine";
import { exportToPdf } from "../utils/exportUtils";
import { defaultWithholdingTaxTemplate } from "../utils/accountingDocTemplates";
import { formStyles, modalSizes, cardStyles } from "../theme";
import {
  PageHeader, CompanyPicker, Button, IconButton, Toolbar, SearchBox, TableWrap, EmptyState, Loading,
} from "../ui/Kit";

const money = (n) => "Rs. " + (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

export default function WithholdingTaxReceiptsPage() {
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("withholdingtax.list.view");
  const canCreate = has("withholdingtax.manage.create");
  const canUpdate = has("withholdingtax.manage.update");
  const canDelete = has("withholdingtax.manage.delete");
  const canPrint = has("withholdingtax.print.view");
  const isNarrow = useIsNarrow(1024);

  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const [search, setSearch] = useState("");
  // Company templates take precedence; otherwise use the built-in receipt layout.
  const tplPicker = usePrintTemplates("WithholdingTaxReceipt");
  const [showForm, setShowForm] = useState(false);
  const [editReceipt, setEditReceipt] = useState(null);
  const [viewReceipt, setViewReceipt] = useState(null);

  // Explicit dropdown pick wins; else the company default; else the built-in.
  const resolveTpl = (r) => tplPicker.resolveTemplate(r)?.htmlContent || defaultWithholdingTaxTemplate;

  const requestVersion = useRef(0);
  const fetchReceipts = useCallback(async (companyId) => {
    const version = ++requestVersion.current;
    setReceipts([]);
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await getWithholdingReceiptsByCompany(companyId);
      if (version === requestVersion.current) setReceipts(Array.isArray(data) ? data : []);
    } catch {
      if (version === requestVersion.current) notify("Could not load withholding receipts.", "error");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setShowForm(false);
    setEditReceipt(null);
    setViewReceipt(null);
    fetchReceipts(canView ? selectedCompany?.id : null);
    return () => { ++requestVersion.current; };
  }, [selectedCompany?.id, canView, fetchReceipts]);

  const handleSave = async (payload) => {
    const res = editReceipt
      ? await updateWithholdingReceipt(editReceipt.id, payload)
      : await createWithholdingReceipt(selectedCompany.id, payload);
    notify(editReceipt ? "Receipt updated." : "Receipt created.", "success");
    await fetchReceipts(selectedCompany.id);
    return res.data;
  };

  const handleDelete = async (r) => {
    const ok = await confirm({
      title: "Delete receipt?",
      message: `Delete Withholding Tax Receipt #${r.receiptNumber} for "${r.clientName}" (${money(r.amount)})? This cannot be undone.`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteWithholdingReceipt(r.id);
      notify("Receipt deleted.", "success");
      fetchReceipts(selectedCompany.id);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete the receipt.", "error");
    }
  };

  const handlePrint = async (r) => {
    // Open the popup BEFORE any await so the pop-up blocker doesn't kill it.
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Allow popups for this site to print.", "warning"); return; }
    w.document.write("<p style='font-family:sans-serif;padding:24px'>Loading certificate…</p>");
    try {
      const { data } = await getWithholdingReceiptPrintData(r.id);
      writeAndPrint(w, mergeTemplate(resolveTpl(r), data));
    } catch {
      w.close();
      notify("Failed to prepare the print view.", "error");
    }
  };

  const handleExportPdf = async (r) => {
    if (exportingId) return;
    setExportingId(r.id);
    try {
      const { data } = await getWithholdingReceiptPrintData(r.id);
      await exportToPdf(mergeTemplate(resolveTpl(r), data), `WHT Receipt ${data.receiptNumber || r.id}`);
    } catch {
      notify("Failed to export PDF.", "error");
    } finally {
      setExportingId(null);
    }
  };

  const filtered = useMemo(() => {
    return receipts.filter((r) => {
      if (!search.trim()) return true;
      const t = search.toLowerCase();
      return (r.clientName || "").toLowerCase().includes(t)
        || (r.description || "").toLowerCase().includes(t)
        || String(r.receiptNumber).includes(t);
    });
  }, [receipts, search]);

  const total = useMemo(() => filtered.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [filtered]);

  if (!canView) {
    return <EmptyState icon={MdFactCheck}>You don't have access to Withholding Tax Receipts.</EmptyState>;
  }

  // Row / card actions — the same set, gated the same way, in both layouts.
  const actions = (r) => (
    <>
      <IconButton icon={MdVisibility} label="View" onClick={() => setViewReceipt(r)} />
      {canPrint && (
        <IconButton icon={MdPrint} label="Print receipt" onClick={() => handlePrint(r)} />
      )}
      {canPrint && (
        <IconButton
          icon={MdPictureAsPdf}
          label="Download PDF"
          disabled={exportingId === r.id}
          onClick={() => handleExportPdf(r)}
        />
      )}
      {canUpdate && <IconButton icon={MdEdit} label="Edit" onClick={() => { setEditReceipt(r); setShowForm(true); }} />}
      {canDelete && r.isLatest && <IconButton danger icon={MdDelete} label="Delete (latest only)" onClick={() => handleDelete(r)} />}
    </>
  );

  return (
    <div>
      <PageHeader
        icon={MdFactCheck}
        tone="brand"
        title="Withholding Tax Receipts"
        subtitle={selectedCompany ? `${filtered.length} receipt${filtered.length !== 1 ? "s" : ""} · ${money(total)} total` : "Select a company"}
        actions={companies.length > 0 && canCreate && selectedCompany && (
          <Button variant="primary" icon={MdAdd} onClick={() => { setEditReceipt(null); setShowForm(true); }}>
            New Receipt
          </Button>
        )}
      />

      {loadingCompanies ? (
        <Loading>Loading companies…</Loading>
      ) : companies.length > 0 ? (
        <>
          <CompanyPicker />
          {(receipts.length > 3 || (canPrint && tplPicker.canChoose)) && (
            <Toolbar>
              {receipts.length > 3 && (
                <SearchBox value={search} onChange={setSearch} placeholder="Search customer / description…" />
              )}
              {canPrint && tplPicker.canChoose && <PrintTemplateSelect picker={tplPicker} />}
            </Toolbar>
          )}
        </>
      ) : (
        <EmptyState icon={MdBusiness}>No companies available.</EmptyState>
      )}

      {loading ? (
        <Loading>Loading receipts…</Loading>
      ) : selectedCompany && filtered.length === 0 ? (
        <EmptyState icon={MdFactCheck}>
          {receipts.length === 0 ? "No withholding tax receipts yet." : "No receipts match your search."}
        </EmptyState>
      ) : selectedCompany && isNarrow ? (
        <div style={styles.cardList}>
          {filtered.map((r) => (
            <div key={r.id} className="k-card" style={styles.card}>
              <div style={cardStyles.cardHeader}>
                <span style={styles.cardNum}>#{r.receiptNumber}</span>
                <span style={styles.cardDate}>{fmtDate(r.date)}</span>
              </div>
              <div style={cardStyles.cardLead}>
                {r.clientName}
              </div>
              <div style={cardStyles.metaGrid}>
                <div>
                  <span style={cardStyles.metaLabel}>Description</span>
                  <span style={cardStyles.metaValue}>{r.description || "—"}</span>
                </div>
              </div>
              <div style={cardStyles.amountBox}>
                <span style={cardStyles.amountLabel}>Amount</span>
                <span style={{ ...cardStyles.amount, fontVariantNumeric: "tabular-nums" }}>{money(r.amount)}</span>
              </div>
              <div style={styles.cardActions}>
                {actions(r)}
              </div>
            </div>
          ))}
          <div className="k-card" style={styles.totalCard}>
            <span style={styles.totalCardLabel}>Total ({filtered.length})</span>
            <span style={styles.totalCardValue}>{money(total)}</span>
          </div>
        </div>
      ) : selectedCompany ? (
        <TableWrap>
          <table className="k-table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th className="k-num" style={{ width: 50 }}>#</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Description</th>
                <th className="k-num">Amount</th>
                <th className="k-actions"><span style={styles.srOnly}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="k-num k-muted">{r.receiptNumber}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                  <td style={{ fontWeight: 600 }}>
                    {r.clientName}
                  </td>
                  <td className="k-muted">{r.description || "—"}</td>
                  <td className="k-num" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{money(r.amount)}</td>
                  <td className="k-actions">
                    <div style={styles.actionRow}>
                      {actions(r)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="k-num k-muted">Total</td>
                <td className="k-num" style={{ fontWeight: 800, color: "var(--k-blue)", whiteSpace: "nowrap" }}>{money(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      ) : null}

      {showForm && selectedCompany && (
        <WithholdingTaxReceiptForm
          companyId={selectedCompany.id}
          receipt={editReceipt}
          onClose={() => { setShowForm(false); setEditReceipt(null); }}
          onSaved={handleSave}
        />
      )}

      {viewReceipt && (
        <div style={formStyles.backdrop} onClick={() => setViewReceipt(null)}>
          <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h5 style={formStyles.title}>Withholding Tax Receipt #{viewReceipt.receiptNumber}</h5>
              <button type="button" aria-label="Close" style={formStyles.closeButton} onClick={() => setViewReceipt(null)}>&times;</button>
            </div>
            <div style={formStyles.body}>
              <div style={styles.vRow}><span style={styles.vLbl}>Customer</span><span style={styles.vVal}>{viewReceipt.clientName}</span></div>
              <div style={styles.vRow}><span style={styles.vLbl}>Date</span><span style={styles.vVal}>{fmtDate(viewReceipt.date)}</span></div>
              <div style={styles.vRow}><span style={styles.vLbl}>Description</span><span style={styles.vVal}>{viewReceipt.description || "—"}</span></div>
              <div style={{ ...styles.vRow, borderTop: "1px solid var(--k-line)", marginTop: 8, paddingTop: 12 }}>
                <span style={styles.vLbl}>Amount</span><span style={{ ...styles.vVal, fontSize: "1.2rem", fontWeight: 700, color: "var(--k-blue)", fontVariantNumeric: "tabular-nums" }}>{money(viewReceipt.amount)}</span>
              </div>
              <div style={{ marginTop: 14 }}>
                <AttachmentManager companyId={selectedCompany.id} entityType="WithholdingTaxReceipt" entityId={viewReceipt.id} mode="view" title="Certificate" />
              </div>
            </div>
            <div style={formStyles.footer}>
              <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => setViewReceipt(null)}>Close</button>
              {canPrint && (
                <button
                  type="button"
                  title={"Print receipt"}
                  style={{ ...formStyles.button, ...formStyles.submit, display: "inline-flex", alignItems: "center", gap: 6 }}
                  onClick={() => handlePrint(viewReceipt)}
                >
                  <MdPrint size={16} /> Print
                </button>
              )}
              {canPrint && (
                <button
                  type="button"
                  disabled={!!exportingId}
                  title={"Download PDF"}
                  style={{ ...formStyles.button, ...formStyles.submit, display: "inline-flex", alignItems: "center", gap: 6, ...((exportingId) ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                  onClick={() => handleExportPdf(viewReceipt)}
                >
                  <MdPictureAsPdf size={16} /> PDF
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 },
  actionRow: { display: "flex", gap: 4, justifyContent: "flex-end" },
  // Phone and tablet (<1024px) stacked-card fallback for the wide table.
  cardList: { display: "flex", flexDirection: "column", gap: "var(--k-gap)", marginTop: 8 },
  // marginTop: 0 — the flex gap spaces the cards, not the kit's ".k-card + .k-card" rule.
  card: { padding: "var(--k-card-pad)", marginTop: 0 },
  cardNum: { fontWeight: 700, fontSize: "calc(var(--k-font) + 0.05rem)", color: "var(--k-blue)" },
  cardDate: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },
  cardActions: { display: "flex", flexWrap: "wrap", gap: "0.4rem", justifyContent: "flex-end", borderTop: "1px solid var(--k-line)", paddingTop: "0.6rem" },
  totalCard: { marginTop: 0, padding: "0.75rem 0.95rem", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f0f7ff" },
  totalCardLabel: { fontWeight: 700, color: "var(--k-muted)" },
  totalCardValue: { fontWeight: 800, color: "var(--k-blue)", fontVariantNumeric: "tabular-nums" },
  vRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: "0.4rem 0" },
  vLbl: { fontSize: "0.78rem", fontWeight: 600, color: "var(--k-muted)", textTransform: "uppercase", letterSpacing: "0.02em" },
  vVal: { fontSize: "var(--k-font)", color: "var(--k-ink)", textAlign: "right", overflowWrap: "anywhere" },
};
