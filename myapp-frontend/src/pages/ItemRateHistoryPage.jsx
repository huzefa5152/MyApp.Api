import { useState, useEffect, useCallback, useMemo } from "react";
import { MdHistory, MdBusiness, MdSearch, MdChevronLeft, MdChevronRight, MdInsights, MdVisibility } from "react-icons/md";
import { getItemRateHistory } from "../api/invoiceApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getClientsByCompany } from "../api/clientApi";
import EditBillForm from "../Components/EditBillForm";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  rowAlt: "#fafbfd",
  summaryBg: "#f0f7ff",
};

export default function ItemRateHistoryPage() {
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const [itemTypes, setItemTypes] = useState([]);
  const [clients, setClients] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ avg: null, min: null, max: null, total: 0 });
  const [loading, setLoading] = useState(false);
  const [viewingId, setViewingId] = useState(null);

  // Filters
  const [search, setSearch] = useState("");
  const [itemTypeId, setItemTypeId] = useState("");
  const [clientId, setClientId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = useMemo(
    () => (pageSize ? Math.ceil(totalCount / pageSize) : 0),
    [totalCount, pageSize]
  );

  useEffect(() => {
    getItemTypes()
      .then((r) => setItemTypes(r.data || []))
      .catch(() => setItemTypes([]));
  }, []);

  useEffect(() => {
    if (selectedCompany) {
      getClientsByCompany(selectedCompany.id)
        .then((r) => setClients(r.data || []))
        .catch(() => setClients([]));
    } else {
      setClients([]);
    }
  }, [selectedCompany]);

  const fetchRows = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const params = { page, pageSize };
      if (itemTypeId) params.itemTypeId = itemTypeId;
      else if (search) params.search = search;
      if (clientId) params.clientId = clientId;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;

      const { data } = await getItemRateHistory(selectedCompany.id, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setSummary({
        avg: data.avgUnitPrice,
        min: data.minUnitPrice,
        max: data.maxUnitPrice,
        total: data.totalCount || 0,
      });
    } catch {
      setRows([]);
      setTotalCount(0);
      setSummary({ avg: null, min: null, max: null, total: 0 });
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, page, pageSize, itemTypeId, search, clientId, dateFrom, dateTo]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Reset to page 1 whenever a filter changes (otherwise we may land on an
  // empty page when the result set shrinks under the current offset).
  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  // Picking an ItemType clears the free-text search (they're alternatives —
  // the catalog id is the precise match, free-text is the fallback).
  const handleItemTypeChange = (e) => {
    setItemTypeId(e.target.value);
    if (e.target.value) setSearch("");
    setPage(1);
  };

  const handleSearchChange = (e) => {
    setSearch(e.target.value);
    if (e.target.value) setItemTypeId("");
    setPage(1);
  };

  const resetFilters = () => {
    setSearch("");
    setItemTypeId("");
    setClientId("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasFilters = !!(search || itemTypeId || clientId || dateFrom || dateTo);
  const fmt = (n) =>
    n == null
      ? "-"
      : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ padding: "1.5rem 2rem" }}>
      <div style={styles.pageHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <div style={styles.headerIcon}>
            <MdHistory size={28} color="#fff" />
          </div>
          <div>
            <h2 style={styles.pageTitle}>Item Rate History</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany
                ? `Search past bills to see the rate you've billed for an item`
                : "Select a company"}
            </p>
          </div>
        </div>
      </div>

      {loadingCompanies ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
        </div>
      ) : companies.length > 0 ? (
        <>
          {/* Company picker */}
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={dropdownStyles.base}
              value={selectedCompany?.id || ""}
              onChange={(e) =>
                setSelectedCompany(
                  companies.find((c) => parseInt(c.id) === parseInt(e.target.value))
                )
              }
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.brandName || c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Filters */}
          {selectedCompany && (
            <div className="filters-row">
              <div className="filter-search-wrap" style={{ flex: "2 1 240px" }}>
                <MdSearch size={15} className="filter-search-icon" />
                <input
                  type="text"
                  placeholder="Search by item description..."
                  className="filter-search-input"
                  value={search}
                  onChange={handleSearchChange}
                />
              </div>
              <select
                className="filter-select"
                value={itemTypeId}
                onChange={handleItemTypeChange}
                title="Pick an item from the catalog (exact match)"
              >
                <option value="">All catalog items</option>
                {itemTypes.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                    {it.hsCode ? ` — ${it.hsCode}` : ""}
                  </option>
                ))}
              </select>
              <select
                className="filter-select"
                value={clientId}
                onChange={handleFilterChange(setClientId)}
              >
                <option value="">All Clients</option>
                {clients.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.name}
                  </option>
                ))}
              </select>
              <div className="filter-date-group">
                <input
                  type="date"
                  className="filter-date-input"
                  value={dateFrom}
                  onChange={handleFilterChange(setDateFrom)}
                  title="From date"
                />
                <span className="filter-date-sep">–</span>
                <input
                  type="date"
                  className="filter-date-input"
                  value={dateTo}
                  onChange={handleFilterChange(setDateTo)}
                  title="To date"
                />
              </div>
              {hasFilters && (
                <button className="filter-clear-btn" onClick={resetFilters}>
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Summary band — avg / min / max across the FULL filtered set */}
          {selectedCompany && summary.total > 0 && (
            <div style={styles.summaryBand}>
              <div style={styles.summaryItem}>
                <MdInsights size={16} color={colors.blue} />
                <span style={styles.summaryLabel}>Lines:</span>
                <span style={styles.summaryValue}>{summary.total}</span>
              </div>
              <div style={styles.summaryItem}>
                <span style={styles.summaryLabel}>Avg rate:</span>
                <span style={styles.summaryValue}>Rs. {fmt(summary.avg)}</span>
              </div>
              <div style={styles.summaryItem}>
                <span style={styles.summaryLabel}>Min:</span>
                <span style={styles.summaryValue}>Rs. {fmt(summary.min)}</span>
              </div>
              <div style={styles.summaryItem}>
                <span style={styles.summaryLabel}>Max:</span>
                <span style={styles.summaryValue}>Rs. {fmt(summary.max)}</span>
              </div>
            </div>
          )}

          {/* Grid */}
          {loading ? (
            <div style={styles.loadingContainer}>
              <div style={styles.spinner} />
            </div>
          ) : selectedCompany && rows.length === 0 ? (
            <div style={styles.emptyState}>
              <MdHistory size={40} color={colors.cardBorder} />
              <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                {hasFilters
                  ? "No bill lines match the current filters."
                  : "Type an item name above to see past rates."}
              </p>
            </div>
          ) : selectedCompany ? (
            <>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Bill #</th>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Client</th>
                      <th style={styles.th}>Description</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>Qty</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>Unit Price</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>Line Total</th>
                      <th style={{ ...styles.th, width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr
                        key={r.invoiceItemId}
                        style={{
                          backgroundColor: idx % 2 === 0 ? "#fff" : colors.rowAlt,
                        }}
                      >
                        <td style={styles.td}>
                          <strong style={{ color: colors.blue }}>#{r.invoiceNumber}</strong>
                        </td>
                        <td style={styles.td}>{new Date(r.date).toLocaleDateString()}</td>
                        <td style={styles.td}>{r.clientName}</td>
                        <td style={{ ...styles.td, maxWidth: 360 }}>
                          <div style={{ fontSize: "0.85rem" }}>{r.description}</div>
                          {r.itemTypeName && (
                            <div
                              style={{
                                fontSize: "0.72rem",
                                color: colors.textSecondary,
                                marginTop: 2,
                              }}
                            >
                              {r.itemTypeName}
                            </div>
                          )}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right" }}>
                          {r.quantity}
                          {r.uom ? <span style={{ color: colors.textSecondary, fontSize: "0.75rem" }}> {r.uom}</span> : null}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
                          Rs. {fmt(r.unitPrice)}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right" }}>
                          Rs. {fmt(r.lineTotal)}
                        </td>
                        <td style={{ ...styles.td, textAlign: "center" }}>
                          <button
                            style={styles.viewBtn}
                            onClick={() => setViewingId(r.invoiceId)}
                            title="View this bill"
                          >
                            <MdVisibility size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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
          ) : (
            <div style={styles.emptyState}>
              <p style={{ color: colors.textSecondary }}>Select a company to begin.</p>
            </div>
          )}
        </>
      ) : (
        <div style={styles.emptyState}>
          <p style={{ color: colors.textSecondary }}>No companies available.</p>
        </div>
      )}

      {viewingId && (
        <EditBillForm
          invoiceId={viewingId}
          readOnly
          onClose={() => setViewingId(null)}
          onSaved={() => setViewingId(null)}
        />
      )}
    </div>
  );
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
  },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
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
  summaryBand: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1.25rem",
    padding: "0.65rem 1rem",
    marginBottom: "0.85rem",
    backgroundColor: colors.summaryBg,
    border: "1px solid #c5dcf5",
    borderRadius: 10,
  },
  summaryItem: { display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" },
  summaryLabel: { color: colors.textSecondary, fontWeight: 500 },
  summaryValue: { color: colors.textPrimary, fontWeight: 700 },
  tableWrap: {
    overflowX: "auto",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" },
  th: {
    textAlign: "left",
    padding: "0.65rem 0.85rem",
    backgroundColor: "#f5f8fc",
    borderBottom: `1px solid ${colors.cardBorder}`,
    fontSize: "0.78rem",
    fontWeight: 700,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  td: {
    padding: "0.6rem 0.85rem",
    borderBottom: `1px solid ${colors.cardBorder}`,
    color: colors.textPrimary,
    verticalAlign: "top",
  },
  viewBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.3rem 0.5rem",
    borderRadius: 6,
    border: "1px solid #90caf9",
    backgroundColor: "#e3f2fd",
    color: "#0d47a1",
    fontSize: "0.76rem",
    fontWeight: 600,
    cursor: "pointer",
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
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
};
