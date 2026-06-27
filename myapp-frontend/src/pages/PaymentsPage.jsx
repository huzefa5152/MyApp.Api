import { useState, useEffect, useCallback } from "react";
import { MdAdd, MdDelete, MdChevronLeft, MdChevronRight, MdReceiptLong, MdPayments, MdSearch } from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, dropdownStyles } from "../theme";
import StatusBadge from "../Components/StatusBadge";
import PaymentForm from "../Components/PaymentForm";
import { getPagedPayments, deletePayment } from "../api/paymentApi";

/**
 * Receipts (money in) / Payments (money out) list. mode = "receipts" |
 * "payments" — one component, registered twice in App.jsx. Responsive card
 * grid (collapses to one column on phones). Gated by accounting.<mode>.*.
 */
export default function PaymentsPage({ mode = "receipts" }) {
  const isReceipt = mode === "receipts";
  const dir = isReceipt ? "receipts" : "payments";
  const title = isReceipt ? "Receipts" : "Payments";
  const Icon = isReceipt ? MdReceiptLong : MdPayments;

  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has(`accounting.${dir}.view`);
  const canCreate = has(`accounting.${dir}.create`);
  const canDelete = has(`accounting.${dir}.delete`);

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const companyId = selectedCompany?.id;

  const fetchRows = useCallback(async (pg) => {
    if (!companyId) { setRows([]); return; }
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search.trim()) params.search = search.trim();
      const { data } = await getPagedPayments(dir, companyId, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(data.totalPages || 0);
    } catch {
      setRows([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, dir, page, search]);

  // Reset to page 1 on company / mode switch.
  useEffect(() => { setPage(1); setSearch(""); }, [companyId, dir]);
  useEffect(() => { fetchRows(page); }, [fetchRows, page]);

  const handleDelete = async (p) => {
    const ok = await confirm({
      title: `Delete ${isReceipt ? "Receipt" : "Payment"}?`,
      message: `Delete ${p.reference}? The settled ${isReceipt ? "invoices" : "bills"} will have their balance restored. This cannot be undone.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deletePayment(dir, p.id);
      notify(`${p.reference} deleted.`, "success");
      fetchRows(page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete.", "error");
    }
  };

  const onSaved = () => { setPage(1); fetchRows(1); notify(`${isReceipt ? "Receipt" : "Payment"} saved.`, "success"); };

  if (!canView) {
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to view {title.toLowerCase()}.</div>;
  }

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Icon size={26} color={colors.blue} />
          <h2 style={st.h2}>{title}</h2>
        </div>
        {canCreate && companyId && (
          <button style={st.primaryBtn} onClick={() => setShowForm(true)}>
            <MdAdd size={18} /> {isReceipt ? "Record Receipt" : "Record Payment"}
          </button>
        )}
      </div>

      {!companyId ? (
        <div style={st.empty}>Select a company to view {title.toLowerCase()}.</div>
      ) : (
        <>
          <div style={st.toolbar}>
            <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
              <MdSearch size={18} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary }} />
              <input
                style={{ ...dropdownStyles.base, width: "100%", paddingLeft: 34 }}
                placeholder={`Search ${title.toLowerCase()}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchRows(1); } }}
              />
            </div>
          </div>

          {loading ? (
            <div style={st.empty}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={st.empty}>No {title.toLowerCase()} yet.</div>
          ) : (
            <div style={st.grid}>
              {rows.map((p) => (
                <div key={p.id} style={st.card}>
                  <div style={st.cardTop}>
                    <span style={st.ref}>{p.reference}</span>
                    {p.isPostDated && <StatusBadge tone="warning">PDC</StatusBadge>}
                  </div>
                  <div style={st.amount}>Rs {p.amount.toLocaleString()}</div>
                  <div style={st.meta}>{p.date ? new Date(p.date).toLocaleDateString() : "—"} · {p.method}</div>
                  {p.contactName && <div style={st.contact}>{p.contactName}</div>}
                  <div style={st.allocs}>
                    {p.allocations.map((a) => (
                      <span key={a.id} style={st.allocChip}>{a.documentLabel}: {a.amount.toLocaleString()}</span>
                    ))}
                  </div>
                  {canDelete && (
                    <div style={st.cardActions}>
                      <button style={st.delBtn} onClick={() => handleDelete(p)} title="Delete"><MdDelete size={16} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div style={st.pagination}>
              <button style={{ ...st.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <MdChevronLeft size={20} /> Prev
              </button>
              <span style={st.pageInfo}>Page {page} of {totalPages} ({totalCount} total)</span>
              <button style={{ ...st.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next <MdChevronRight size={20} />
              </button>
            </div>
          )}
        </>
      )}

      {showForm && companyId && (
        <PaymentForm mode={mode} companyId={companyId} onClose={() => setShowForm(false)} onSaved={onSaved} />
      )}
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer" },
  toolbar: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: "1rem" },
  card: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", position: "relative" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 },
  ref: { fontWeight: 800, color: colors.blue, fontSize: "0.9rem" },
  amount: { fontSize: "1.3rem", fontWeight: 800, color: colors.textPrimary, marginTop: 4 },
  meta: { fontSize: "0.8rem", color: colors.textSecondary, marginTop: 2 },
  contact: { fontSize: "0.85rem", color: colors.textPrimary, marginTop: 4, fontWeight: 600 },
  allocs: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 },
  allocChip: { fontSize: "0.7rem", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 6, padding: "0.15rem 0.4rem", color: colors.textSecondary },
  cardActions: { display: "flex", justifyContent: "flex-end", marginTop: 8 },
  delBtn: { display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.danger, cursor: "pointer" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginTop: "1.25rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "0.45rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, fontWeight: 600, cursor: "pointer" },
  pageInfo: { fontSize: "0.85rem", color: colors.textSecondary },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
