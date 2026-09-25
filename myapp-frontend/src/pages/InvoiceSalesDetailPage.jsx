import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MdAssessment, MdBusiness } from "react-icons/md";
import { getInvoiceSalesDetail, getInvoiceSalesDetailExcel } from "../api/reportApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, dropdownStyles } from "../theme";
import { FILTERS } from "../config/accountingReports";
import ReportFilterBar from "../Components/ReportFilterBar";
import { ReportHeader, TotalsStrip } from "../Components/ReportShell";
import Pagination from "../Components/Pagination";
import InvoiceSalesDetailGrid from "../Components/reports/InvoiceSalesDetailGrid";
import usePageSize from "../hooks/usePageSize";
import { notify } from "../utils/notify";
import {
  DEFAULT_PAGE_SIZE, FBR_STATUS_OPTIONS, ISD_PERIOD_OPTIONS, emptyText, excelFileName,
  filtersApplied, filtersFromSearch, filtersToSearch, groupBills, pageOfBills, printEnvelope,
  toApiParams, totalsFor,
} from "../utils/invoiceSalesDetail";

const FILTER_SET = [FILTERS.period, FILTERS.search, FILTERS.client, FILTERS.status];
const NOTE = "Every bill dated in the period, filed with FBR or not. Cancelled bills stay listed and "
  + "count in the totals. Buyer address and NTN are the buyer's current details.";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Reports ▸ Invoice Sales Detail: every bill line in the period, filed with FBR
 * or not, in the shape of the operator's own sales-detail workbook.
 *
 * Built from the pieces every other report uses — the Accounting Reports filter
 * bar, header, tiles and print builder — so it reads as the same product. The
 * server selects the bills for the screen and the Excel from ONE query, so the
 * workbook always holds exactly what is on screen, in the Excel's unchanged
 * format. Filters live in the URL, like Accounting Reports: a view is linkable
 * and survives a reload.
 */
export default function InvoiceSalesDetailPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has, loading: permsLoading } = usePermissions();
  const canView = has("reports.invoicedetail.view");
  const canExport = has("reports.invoicedetail.export");
  const companyId = selectedCompany?.id;

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearch(searchParams), [searchParams]);
  const apiParams = useMemo(() => toApiParams(filters), [filters]);
  const applyFilters = useCallback((next) => setSearchParams(filtersToSearch(next)), [setSearchParams]);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [storedSize, setPageSize] = usePageSize("invoiceSalesDetail");
  const pageSize = storedSize || DEFAULT_PAGE_SIZE;

  // A customer belongs to one company, so switching company drops that filter.
  const lastCompany = useRef(companyId);
  useEffect(() => {
    if (lastCompany.current !== undefined && lastCompany.current !== companyId && filters.clientId) {
      const { clientId, ...rest } = filters;
      applyFilters(rest);
    }
    lastCompany.current = companyId;
  }, [companyId, filters, applyFilters]);

  useEffect(() => {
    if (!companyId || !canView) return;
    let live = true;
    setLoading(true);
    setError("");
    getInvoiceSalesDetail(companyId, apiParams)
      .then(({ data }) => { if (live) { setReport(data); setPage(1); } })
      .catch((e) => {
        if (!live) return;
        setReport(null);
        setError(e?.response?.data?.message || "Could not load the invoice sales detail.");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [companyId, canView, apiParams]);

  const bills = useMemo(() => groupBills(report?.rows || []), [report]);
  const view = useMemo(() => pageOfBills(bills, page, pageSize), [bills, page, pageSize]);
  const applied = useMemo(() => filtersApplied(filters, report?.buyers || []), [filters, report]);
  const tiles = useMemo(() => (report ? totalsFor(report) : null), [report]);
  const clientOptions = useMemo(
    () => (report?.buyers || []).map((b) => ({ id: b.clientId, name: b.name, ntn: b.ntn })),
    [report]
  );
  const pageNote = view.totalPages > 1
    ? `Bills ${view.firstIndex + 1}–${view.lastIndex} of ${bills.length}; totals cover all ${bills.length}`
    : null;
  const envelope = useMemo(
    () => (report ? printEnvelope(report, view.bills, { filtersApplied: applied, pageNote }) : null),
    [report, view.bills, applied, pageNote]
  );

  const exportExcel = async () => {
    if (!companyId || !report || loading) return;
    try {
      const { data } = await getInvoiceSalesDetailExcel(companyId, apiParams);
      const url = URL.createObjectURL(new Blob([data], { type: XLSX }));
      const link = document.createElement("a");
      link.href = url;
      link.download = excelFileName(report);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      notify.error("Could not export the invoice sales detail.");
    }
  };

  if (permsLoading) return <div style={st.state}>Loading…</div>;
  if (!canView) return <div style={st.state}>You don’t have permission to view this report.</div>;

  return (
    <div style={st.page}>
      <div style={st.pageHead}>
        <div style={st.titleRow}>
          <MdAssessment size={24} color={colors.blue} />
          <h2 style={st.h2}>Reports</h2>
        </div>
        {companies.length > 1 && (
          <label style={st.companyPicker}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={{ ...dropdownStyles.base, minHeight: 44, flex: 1, minWidth: 0 }}
              value={selectedCompany?.id || ""}
              onChange={(e) => setSelectedCompany(companies.find((c) => String(c.id) === e.target.value))}
              aria-label="Company"
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {!companyId ? (
        <div style={st.state}>Select a company to view this report.</div>
      ) : (
        <>
          <ReportFilterBar
            companyId={companyId}
            filters={FILTER_SET}
            value={filters}
            onApply={applyFilters}
            loading={loading}
            periodOptions={ISD_PERIOD_OPTIONS}
            clientOptions={clientOptions}
            statusOptions={FBR_STATUS_OPTIONS}
            statusLabel="FBR status"
            searchPlaceholder="Bill no, party, NTN, HS code, item…"
          />

          {error && <div role="alert" style={st.error}>{error}</div>}

          {envelope && (
            <ReportHeader
              report={envelope}
              categoryTitle="Sales"
              canExport={canExport}
              onExportExcel={exportExcel}
              subtitle={NOTE}
            />
          )}
          {tiles && <TotalsStrip {...tiles} compact />}

          {!report ? (
            loading && <div style={st.state}>Loading report…</div>
          ) : (
            <>
              <InvoiceSalesDetailGrid
                report={report}
                bills={view.bills}
                allBillCount={bills.length}
                loading={loading}
                emptyText={emptyText(report, filters)}
              />
              <Pagination
                page={view.page}
                totalPages={view.totalPages}
                total={bills.length}
                onPage={setPage}
                pageSize={pageSize}
                onPageSize={(n) => { setPageSize(n); setPage(1); }}
                unit="bills"
                sizeLabel="Bills per page:"
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

const st = {
  page: { padding: "clamp(0.75rem, 2vw, 1.5rem)" },
  pageHead: {
    display: "flex", flexWrap: "wrap", alignItems: "center",
    justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.9rem",
  },
  titleRow: { display: "flex", alignItems: "center", gap: "0.5rem" },
  h2: { margin: 0, fontSize: "clamp(1.2rem, 3vw, 1.4rem)", color: colors.textPrimary, fontWeight: 800 },
  companyPicker: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    flex: "1 1 220px", minWidth: 0, maxWidth: 320,
  },
  state: {
    padding: "2.5rem 1.25rem", textAlign: "center", color: colors.textSecondary,
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14, fontSize: "0.92rem", lineHeight: 1.55,
  },
  error: {
    background: colors.dangerLight, color: colors.danger, border: `1px solid ${colors.danger}30`,
    borderRadius: 12, padding: "0.7rem 0.9rem", marginBottom: "1rem", fontSize: "0.88rem",
  },
};
