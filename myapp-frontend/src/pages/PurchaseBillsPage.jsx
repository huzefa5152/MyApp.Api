import { useState, useEffect, useCallback } from "react";
import { MdShoppingCart, MdAdd, MdBusiness, MdSearch, MdEdit, MdDelete, MdVisibility, MdChevronLeft, MdChevronRight } from "react-icons/md";
import { getPurchaseBillsByCompanyPaged, deletePurchaseBill } from "../api/purchaseBillApi";
import { getSuppliersByCompany } from "../api/supplierApi";
import { dropdownStyles, cardStyles, cardHover } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import PurchaseBillForm from "../Components/PurchaseBillForm";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  purple: "#6a1b9a",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBorder: "#d0d7e2",
};

export default function PurchaseBillsPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("purchasebills.manage.create");
  const canUpdate = has("purchasebills.manage.update");
  const canDelete = has("purchasebills.manage.delete");

  const [bills, setBills] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const fetchBills = useCallback(async (pg) => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search) params.search = search;
      if (supplierFilter) params.supplierId = supplierFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await getPurchaseBillsByCompanyPaged(selectedCompany.id, params);
      setBills(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(Math.ceil((data.totalCount || 0) / (data.pageSize || 10)));
    } catch {
      setBills([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, page, search, supplierFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedCompany) {
      getSuppliersByCompany(selectedCompany.id).then(r => setSuppliers(r.data || [])).catch(() => setSuppliers([]));
      setPage(1);
      fetchBills(1);
    } else {
      setBills([]);
    }
  }, [selectedCompany]);

  useEffect(() => { if (selectedCompany) fetchBills(page); }, [page, search, supplierFilter, dateFrom, dateTo]);

  const onFilterChange = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const hasFilters = search || supplierFilter || dateFrom || dateTo;
  const resetFilters = () => { setSearch(""); setSupplierFilter(""); setDateFrom(""); setDateTo(""); setPage(1); };

  const handleDelete = async (b) => {
    const ok = await confirm({
      title: "Delete Purchase Bill?",
      message: `Delete purchase bill #${b.purchaseBillNumber}? Any Stock IN movement it produced will be reversed.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deletePurchaseBill(b.id);
      notify("Purchase bill deleted; stock reversed.", "success");
      fetchBills(page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete bill.", "error");
    }
  };

  return (
    <div>
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdShoppingCart size={28} color="#fff" /></div>
          <div>
            <h2 style={styles.pageTitle}>Purchase Bills</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? `${totalCount} purchase bill${totalCount !== 1 ? "s" : ""} for ${selectedCompany.brandName || selectedCompany.name}`
                : "Select a company"}
            </p>
          </div>
        </div>
        {companies.length > 0 && canCreate && (
          <button style={styles.addBtn} onClick={() => { setEditingId(null); setShowForm(true); }}>
            <MdAdd size={18} /> New Purchase Bill
          </button>
        )}
      </div>

      {loadingCompanies ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : companies.length === 0 ? (
        <div style={styles.empty}>No companies available.</div>
      ) : (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""} onChange={e => setSelectedCompany(companies.find(c => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>

          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap">
                <MdSearch size={15} className="filter-search-icon" />
                <input type="text" placeholder="Search bill#, IRN, supplier, item..." className="filter-search-input" value={search} onChange={onFilterChange(setSearch)} />
              </div>
              <select className="filter-select" value={supplierFilter} onChange={onFilterChange(setSupplierFilter)}>
                <option value="">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="filter-date-group">
                <input type="date" className="filter-date-input" value={dateFrom} onChange={onFilterChange(setDateFrom)} title="From" />
                <span className="filter-date-sep">–</span>
                <input type="date" className="filter-date-input" value={dateTo} onChange={onFilterChange(setDateTo)} title="To" />
              </div>
              {hasFilters && <button className="filter-clear-btn" onClick={resetFilters}>Clear</button>}
            </div>
          )}

          {loading ? (
            <div style={styles.loading}><div style={styles.spinner} /></div>
          ) : bills.length === 0 ? (
            <div style={styles.empty}>
              <MdShoppingCart size={40} color={colors.cardBorder} />
              <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                {hasFilters ? "No purchase bills match the current filters." : "No purchase bills yet."}
              </p>
            </div>
          ) : (
            <>
              <div className="card-grid">
                {bills.map(b => (
                  <div key={b.id} style={cardStyles.card}
                       onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
                       onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" })}>
                    <div style={cardStyles.cardContent}>
                      <div>
                        <h5 style={cardStyles.title}>
                          <MdShoppingCart style={{ color: colors.purple, marginRight: 6 }} />
                          PB #{b.purchaseBillNumber}
                        </h5>
                        <p style={cardStyles.text}><strong>Supplier:</strong> {b.supplierName}</p>
                        <p style={cardStyles.text}><strong>Date:</strong> {new Date(b.date).toLocaleDateString()}</p>
                        <p style={cardStyles.text}><strong>Grand Total:</strong> Rs. {b.grandTotal?.toLocaleString()}</p>
                        {b.supplierIRN && (
                          <p style={{ ...cardStyles.text, fontFamily: "monospace", fontSize: "0.74rem", color: colors.textSecondary, wordBreak: "break-all" }}>
                            IRN: {b.supplierIRN}
                          </p>
                        )}
                        <p style={{ ...cardStyles.text, fontSize: "0.74rem" }}>
                          {b.items?.length || 0} items · Status: {b.reconciliationStatus}
                        </p>
                      </div>
                      <div style={{ ...cardStyles.buttonGroup, flexWrap: "wrap" }}>
                        <button style={btnView} onClick={() => { setEditingId(b.id); setShowForm(true); }}>
                          <MdVisibility size={14} /> View
                        </button>
                        {canUpdate && (
                          <button style={btnEdit} onClick={() => { setEditingId(b.id); setShowForm(true); }}>
                            <MdEdit size={14} /> Edit
                          </button>
                        )}
                        {canDelete && (
                          <button style={btnDelete} onClick={() => handleDelete(b)}>
                            <MdDelete size={14} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div style={styles.pagination}>
                  <button style={{ ...styles.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <MdChevronLeft size={20} /> Prev
                  </button>
                  <span style={styles.pageInfo}>Page {page} of {totalPages} ({totalCount} total)</span>
                  <button style={{ ...styles.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                    Next <MdChevronRight size={20} />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {showForm && selectedCompany && (
        <PurchaseBillForm
          companyId={selectedCompany.id}
          billId={editingId}
          onClose={() => { setShowForm(false); setEditingId(null); }}
          onSaved={() => { setShowForm(false); setEditingId(null); fetchBills(page); }}
        />
      )}
    </div>
  );
}

const styles = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${colors.purple}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center" },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center", color: colors.textSecondary },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "1rem 0", marginTop: "0.5rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: "0.2rem", padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
};
const baseBtn = { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "none", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" };
const btnView = { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" };
const btnEdit = { ...baseBtn, backgroundColor: "#fff3e0", color: "#e65100" };
const btnDelete = { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" };
