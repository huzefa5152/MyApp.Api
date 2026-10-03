import { useState, useEffect, useCallback, useMemo } from "react";
import RichText from "../Components/RichText";
import { MdHistory, MdBusiness, MdInsights, MdVisibility } from "react-icons/md";
import { getItemRateHistory } from "../api/invoiceApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getClientsByCompany } from "../api/clientApi";
import EditBillForm from "../Components/EditBillForm";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import Pagination from "../Components/Pagination";
import SearchableSelect from "../Components/SearchableSelect";
import SearchableClientSelect from "../Components/SearchableClientSelect";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { PageHeader, CompanyPicker, Button, IconButton, Toolbar, SearchBox, TableWrap, StatGrid, StatCard, EmptyState, Loading } from "../ui/Kit";

export default function ItemRateHistoryPage() {
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  // Client-filter dropdown calls /api/clients/company/{id}. View-only
  // roles that lack clients.manage.view would 403 — skip both the fetch
  // and the dropdown for them; rate-history list still works.
  const canViewClients = has("clients.manage.view");
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

  // Pagination — pageSize is server-driven, sourced from the appsettings
  // Pagination:DefaultPageSize value via the controller. We don't send a
  // pageSize on the request so the server applies the configured default,
  // and we read the value back from the response so totalPages is accurate.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(null); // server-echoed size (drives page math)
  const [userPageSize, setUserPageSize] = usePageSize("itemRateHistory"); // operator-chosen override
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = useMemo(
    () => (pageSize && pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0),
    [totalCount, pageSize]
  );

  useEffect(() => {
    getItemTypes()
      .then((r) => setItemTypes(r.data || []))
      .catch(() => setItemTypes([]));
  }, []);

  useEffect(() => {
    if (selectedCompany && canViewClients) {
      getClientsByCompany(selectedCompany.id)
        .then((r) => setClients(r.data || []))
        .catch(() => setClients([]));
    } else {
      setClients([]);
    }
  }, [selectedCompany, canViewClients]);

  const fetchRows = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      // Intentionally NOT sending pageSize — the backend pulls the
      // configured Pagination:DefaultPageSize so we get a single source
      // of truth across pages and respect operator-tuned values.
      const params = { page };
      if (userPageSize) params.pageSize = userPageSize;
      if (itemTypeId) params.itemTypeId = itemTypeId;
      else if (search) params.search = search;
      if (clientId) params.clientId = clientId;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;

      const { data } = await getItemRateHistory(selectedCompany.id, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setPageSize(data.pageSize || 0);
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
  }, [selectedCompany, page, userPageSize, itemTypeId, search, clientId, dateFrom, dateTo]);

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
    <div className="irh-page">
      <PageHeader
        icon={MdHistory}
        tone="brand"
        title="Item Rate History"
        subtitle={selectedCompany
          ? `Search past bills to see the rate you've billed for an item`
          : "Select a company"}
      />

      {loadingCompanies ? (
        <Loading>Loading companies…</Loading>
      ) : companies.length > 0 ? (
        <>
          {/* Company picker */}
          <CompanyPicker />

          {/* Filters */}
          {selectedCompany && (
            <Toolbar>
              <SearchBox
                placeholder="Search by item description..."
                value={search}
                onChange={(text) => handleSearchChange({ target: { value: text } })}
              />
              <div title="Pick an item from the catalog (exact match)" style={styles.pickerWrap}>
                <SearchableSelect
                  items={itemTypes}
                  value={itemTypeId}
                  onChange={(id) => handleItemTypeChange({ target: { value: String(id) } })}
                  searchKeys={["name", "hsCode"]}
                  subLabel={(it) => it.hsCode || ""}
                  placeholder="All catalog items"
                />
              </div>
              {canViewClients && (
                <SearchableClientSelect
                  clients={clients}
                  value={clientId}
                  onChange={(id) => handleFilterChange(setClientId)({ target: { value: String(id) } })}
                  placeholder="All Clients"
                  style={styles.pickerWrap}
                />
              )}
              <div style={styles.dateGroup}>
                <input
                  type="date"
                  className="k-input"
                  style={styles.dateInput}
                  value={dateFrom}
                  onChange={handleFilterChange(setDateFrom)}
                  title="From date"
                  aria-label="From date"
                />
                <span style={{ color: "var(--k-muted)" }}>–</span>
                <input
                  type="date"
                  className="k-input"
                  style={styles.dateInput}
                  value={dateTo}
                  onChange={handleFilterChange(setDateTo)}
                  title="To date"
                  aria-label="To date"
                />
              </div>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Clear
                </Button>
              )}
            </Toolbar>
          )}

          {/* Summary band — avg / min / max across the FULL filtered set */}
          {selectedCompany && summary.total > 0 && (
            <StatGrid>
              <StatCard tone="blue" icon={MdInsights} label="Lines" value={summary.total} />
              <StatCard tone="teal" label="Avg rate" value={`Rs. ${fmt(summary.avg)}`} />
              <StatCard tone="slate" label="Min" value={`Rs. ${fmt(summary.min)}`} />
              <StatCard tone="slate" label="Max" value={`Rs. ${fmt(summary.max)}`} />
            </StatGrid>
          )}

          {/* Grid */}
          {loading ? (
            <Loading>Loading rate history…</Loading>
          ) : selectedCompany && rows.length === 0 ? (
            <EmptyState icon={MdHistory}>
              {hasFilters
                ? "No bill lines match the current filters."
                : "Type an item name above to see past rates."}
            </EmptyState>
          ) : selectedCompany ? (
            <>
              {/* Desktop / tablet — table */}
              <TableWrap className="irh-table">
                <table className="k-table">
                  <thead>
                    <tr>
                      <th>Bill #</th>
                      <th>Date</th>
                      <th>Client</th>
                      <th>Description</th>
                      <th className="k-num">Qty</th>
                      <th className="k-num">Unit Price</th>
                      <th className="k-num">Line Total</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.invoiceItemId}>
                        <td style={styles.top}>
                          <strong style={{ color: "var(--k-blue)" }}>#{r.invoiceNumber}</strong>
                        </td>
                        <td style={styles.top}>{new Date(r.date).toLocaleDateString()}</td>
                        <td style={styles.top}>{r.clientName}</td>
                        <td style={{ ...styles.top, maxWidth: 360 }}>
                          <div><RichText text={r.description} /></div>
                          {r.itemTypeName && (
                            <div className="k-muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                              {r.itemTypeName}
                            </div>
                          )}
                        </td>
                        <td className="k-num" style={styles.top}>
                          {r.quantity}
                          {r.uom ? <span className="k-muted" style={{ fontSize: "0.75rem" }}> {r.uom}</span> : null}
                        </td>
                        <td className="k-num" style={{ ...styles.top, fontWeight: 600 }}>
                          Rs. {fmt(r.unitPrice)}
                        </td>
                        <td className="k-num" style={styles.top}>
                          Rs. {fmt(r.lineTotal)}
                        </td>
                        <td className="is-center" style={styles.top}>
                          <IconButton
                            icon={MdVisibility}
                            size={16}
                            label="View this bill"
                            onClick={() => setViewingId(r.invoiceId)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>


              {/* Mobile — stacked cards. Same data, prioritised differently:
                  Unit Price is the answer this page exists to surface, so it
                  goes top-right, large + bold. Description carries the visual
                  weight in the middle since that's how operators recognise
                  the line. Footer = qty, line total, view button. */}
              <div className="irh-cards">
                {rows.map((r) => (
                  <div key={r.invoiceItemId} className="irh-card">
                    <div className="irh-card__top">
                      <div className="irh-card__top-left">
                        <span className="irh-card__bill">#{r.invoiceNumber}</span>
                        <span className="irh-card__date">{new Date(r.date).toLocaleDateString()}</span>
                      </div>
                      <div className="irh-card__rate">
                        <span className="irh-card__rate-label">Rate</span>
                        <span className="irh-card__rate-value">Rs. {fmt(r.unitPrice)}</span>
                      </div>
                    </div>

                    <div className="irh-card__client">{r.clientName}</div>
                    <div className="irh-card__desc"><RichText text={r.description} /></div>
                    {r.itemTypeName && (
                      <div className="irh-card__itemtype">{r.itemTypeName}</div>
                    )}

                    <div className="irh-card__footer">
                      <div className="irh-card__qty">
                        <span className="irh-card__field-label">Qty</span>
                        <span className="irh-card__field-value">
                          {r.quantity}
                          {r.uom ? <span className="irh-card__uom"> {r.uom}</span> : null}
                        </span>
                      </div>
                      <div className="irh-card__total">
                        <span className="irh-card__field-label">Line Total</span>
                        <span className="irh-card__field-value">Rs. {fmt(r.lineTotal)}</span>
                      </div>
                      <button
                        className="irh-card__view-btn"
                        onClick={() => setViewingId(r.invoiceId)}
                        aria-label="View this bill"
                      >
                        <MdVisibility size={16} />
                        <span>View</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {totalCount > PAGE_SIZE_OPTIONS[0] && (
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={totalCount}
                  onPage={setPage}
                  pageSize={userPageSize ?? pageSize}
                  onPageSize={(n) => { setUserPageSize(n); setPage(1); }}
                />
              )}
            </>
          ) : (
            <EmptyState>Select a company to begin.</EmptyState>
          )}
        </>
      ) : (
        <EmptyState icon={MdBusiness}>No companies available.</EmptyState>
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
  pickerWrap: { flex: "1 1 200px", maxWidth: 260, minWidth: 0 },
  dateGroup: { display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" },
  dateInput: { width: "auto" },
  top: { verticalAlign: "top" },
};
