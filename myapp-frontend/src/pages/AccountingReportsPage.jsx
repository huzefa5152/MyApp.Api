import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  MdAccountBalance, MdAccountBalanceWallet, MdAssessment, MdBusiness,
  MdCheckCircle, MdChevronRight, MdInsights, MdLocalShipping, MdPeople,
  MdPointOfSale, MdReceiptLong, MdRuleFolder, MdShoppingCart, MdWarning,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors, dropdownStyles } from "../theme";
import useIsNarrow from "../hooks/useIsNarrow";
import usePageSize from "../hooks/usePageSize";
import ReportFilterBar from "../Components/ReportFilterBar";
import ReportShell from "../Components/ReportShell";
import { getReport, downloadReportExcel, saveBlob } from "../api/accountingReportApi";
import { getTrialBalance, getAgedReceivables, getAgedPayables } from "../api/accountingApi";
import {
  REPORT_CATEGORIES, REPORTS_BY_ID, isAvailable,
} from "../config/accountingReports";

/**
 * Accounting → Reports.
 *
 * Two modes behind one route:
 *   /accounting/reports            the categorised index
 *   /accounting/reports/:reportId  one report
 *
 * The index exists because twenty-plus reports in a dropdown is not navigation.
 * Categories mirror the questions a business actually asks — where did the money
 * go, who owes us, what do we hold — and reports that are not built yet are
 * listed honestly with a badge rather than hidden, so the module's shape is
 * visible from the start.
 *
 * Filters live in the URL, which makes every report view linkable and lets a
 * dashboard card or a drill-down arrive pre-filtered.
 */
export default function AccountingReportsPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has, loading: permsLoading } = usePermissions();
  const { reportId } = useParams();
  const navigate = useNavigate();

  const canView = has("accounting.reports.view");
  const canExport = has("accounting.reports.export");
  const companyId = selectedCompany?.id;

  // Wait for permissions rather than flashing a denial at someone who has access.
  if (permsLoading) return <div style={st.state}>Loading…</div>;
  if (!canView) {
    return <div style={st.state}>You don’t have permission to view accounting reports.</div>;
  }

  const report = reportId ? REPORTS_BY_ID[reportId] : null;

  return (
    <div style={st.page}>
      <div style={st.pageHead}>
        <div style={st.pageTitleRow}>
          <MdAssessment size={26} color={colors.blue} />
          <h2 style={st.h2}>Accounting Reports</h2>
        </div>

        {companies.length > 1 && (
          <label style={st.companyPicker}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={{ ...dropdownStyles.base, minHeight: 44, flex: 1, minWidth: 0 }}
              value={selectedCompany?.id || ""}
              onChange={(e) =>
                setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))
              }
              aria-label="Company"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.brandName || c.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!companyId ? (
        <div style={st.state}>Select a company to view reports.</div>
      ) : !reportId ? (
        <ReportIndex onOpen={(id) => navigate(`/accounting/reports/${id}`)} />
      ) : !report ? (
        <div style={st.state}>
          That report doesn’t exist.{" "}
          <button style={st.linkBtn} onClick={() => navigate("/accounting/reports")}>
            Back to all reports
          </button>
        </div>
      ) : report.legacy ? (
        <LegacyReport
          companyId={companyId}
          kind={report.legacy}
          title={report.title}
          categoryTitle={report.categoryTitle}
          onBack={() => navigate("/accounting/reports")}
        />
      ) : !isAvailable(report) ? (
        <NotBuiltYet report={report} onBack={() => navigate("/accounting/reports")} />
      ) : (
        <GenericReport
          key={reportId}
          companyId={companyId}
          report={report}
          canExport={canExport}
          onBack={() => navigate("/accounting/reports")}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}

// ── The index ───────────────────────────────────────────────────────────────

const CATEGORY_ICONS = {
  expenses: MdReceiptLong,
  "cash-bank": MdAccountBalanceWallet,
  "financial-statements": MdAccountBalance,
  customers: MdPeople,
  suppliers: MdLocalShipping,
  sales: MdPointOfSale,
  purchases: MdShoppingCart,
  taxes: MdRuleFolder,
  control: MdCheckCircle,
  management: MdInsights,
};

function ReportIndex({ onOpen }) {
  const featured = useMemo(
    () => REPORT_CATEGORIES.flatMap((c) => c.reports)
      .filter((r) => r.featured && isAvailable(r)),
    []
  );

  return (
    <div>
      {featured.length > 0 && (
        <>
          <SectionLabel>Start here</SectionLabel>
          <div style={st.featuredGrid}>
            {featured.map((r) => (
              <button key={r.id} type="button" style={st.featuredCard} onClick={() => onOpen(r.id)}>
                <span style={st.featuredTitle}>{r.title}</span>
                <span style={st.featuredBlurb}>{r.blurb}</span>
                <span style={st.featuredGo}>Open <MdChevronRight size={15} /></span>
              </button>
            ))}
          </div>
        </>
      )}

      <SectionLabel>All reports</SectionLabel>
      <div style={st.categoryGrid}>
        {REPORT_CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.id] || MdAssessment;
          const live = cat.reports.filter(isAvailable).length;
          return (
            <section key={cat.id} style={st.categoryCard}>
              <header style={st.categoryHead}>
                <span style={st.categoryIcon}><Icon size={19} color="#fff" /></span>
                <div style={{ minWidth: 0 }}>
                  <h3 style={st.categoryTitle}>{cat.title}</h3>
                  <p style={st.categoryBlurb}>{cat.blurb}</p>
                </div>
                <span style={st.categoryCount}>
                  {live}/{cat.reports.length}
                </span>
              </header>

              <ul style={st.reportList}>
                {cat.reports.map((r) => {
                  const available = isAvailable(r);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        style={{ ...st.reportRow, ...(available ? {} : st.reportRowMuted) }}
                        onClick={available ? () => onOpen(r.id) : undefined}
                        disabled={!available}
                        title={available ? r.blurb : r.blockedReason || "Not built yet"}
                      >
                        <span style={{ minWidth: 0, textAlign: "left" }}>
                          <span style={st.reportName}>{r.title}</span>
                          <span style={st.reportBlurb}>{r.blurb}</span>
                        </span>
                        {available ? (
                          <MdChevronRight size={18} color={colors.textSecondary} style={{ flexShrink: 0 }} />
                        ) : (
                          <span style={r.status === "blocked" ? st.badgeBlocked : st.badgeSoon}>
                            {r.status === "blocked" ? "Blocked" : "Soon"}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={st.sectionLabel}>{children}</div>;
}

/** A listed-but-unbuilt report. Says why, rather than 404ing. */
function NotBuiltYet({ report, onBack }) {
  return (
    <div style={st.state}>
      <h3 style={{ margin: "0 0 0.5rem", color: colors.textPrimary }}>{report.title}</h3>
      <p style={{ margin: "0 0 0.75rem" }}>{report.blurb}</p>
      {report.blockedReason ? (
        <p style={{ margin: "0 0 1rem", color: "#8a5a00", fontWeight: 600 }}>
          {report.blockedReason}
        </p>
      ) : (
        <p style={{ margin: "0 0 1rem" }}>This report isn’t built yet.</p>
      )}
      <button style={st.linkBtn} onClick={onBack}>Back to all reports</button>
    </div>
  );
}

// ── A registry-driven report ────────────────────────────────────────────────

function GenericReport({ companyId, report, canExport, onBack, onNavigate }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pageSize, setPageSize] = usePageSize(`acctReport:${report.id}`);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The URL is the filter state, so a report view is linkable and a drill-down
  // or dashboard card can arrive pre-filtered.
  const filters = useMemo(() => {
    const f = {};
    searchParams.forEach((v, k) => { f[k] = NUMERIC_KEYS.has(k) ? parseInt(v, 10) : v; });
    if (!f.period) f.period = report.id.startsWith("expenses") ? "thisMonth" : "thisMonth";
    if (!f.page) f.page = 1;
    return f;
  }, [searchParams, report.id]);

  const applyFilters = useCallback((next) => {
    const params = {};
    Object.entries(next).forEach(([k, v]) => {
      if (v === null || v === undefined || v === "" || k === "pageSize") return;
      params[k] = String(v);
    });
    setSearchParams(params, { replace: false });
  }, [setSearchParams]);

  const requestParams = useMemo(
    () => ({ ...filters, ...(report.query || {}), ...(pageSize ? { pageSize } : {}) }),
    [filters, report.query, pageSize]
  );

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    (async () => {
      setLoading(true); setError("");
      try {
        const { data } = await getReport(companyId, report.path, requestParams);
        if (alive) setData(data);
      } catch (err) {
        if (alive) {
          setData(null);
          setError(
            err?.response?.data?.message
            || "Could not load this report. Check the filters and try again."
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [companyId, report.path, requestParams]);

  const exportExcel = async () => {
    try {
      const res = await downloadReportExcel(companyId, report.exportId || report.id, requestParams);
      saveBlob(res, `${report.title}.xlsx`);
    } catch {
      setError("Could not build the Excel file.");
    }
  };

  /**
   * Summary → detail. A group row carries the filter key and value that narrow
   * the detail report to exactly that group, so the accounting trail is never
   * lost between the two views.
   */
  const drill = (filterKey, value) => {
    const target = report.drill?.to || report.detailTarget || "expenses-detail";
    const carried = { ...filters, [filterKey]: value, page: 1 };
    delete carried.pageSize;
    const qs = new URLSearchParams(
      Object.entries(carried)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)])
    );
    onNavigate(`/accounting/reports/${target}?${qs}`);
  };

  /** Detail → original document. */
  const openRow = (row) => {
    const route = documentRoute(row);
    if (route) onNavigate(route);
  };

  return (
    <div>
      <ReportFilterBar
        companyId={companyId}
        filters={report.filters || []}
        value={filters}
        onApply={applyFilters}
        loading={loading}
        accountKind={report.accountKind}
      />
      <ReportShell
        report={data}
        loading={loading}
        error={error}
        categoryTitle={report.categoryTitle}
        onBack={onBack}
        onPage={(p) => applyFilters({ ...filters, page: p })}
        onPageSize={setPageSize}
        pageSize={pageSize}
        canExport={canExport}
        onExportExcel={exportExcel}
        onDrill={report.drill || report.detailTarget ? drill : undefined}
        onOpenRow={openRow}
      />
    </div>
  );
}

const NUMERIC_KEYS = new Set([
  "divisionId", "accountId", "accountGroupId", "paymentAccountId",
  "payeeId", "clientId", "supplierId", "page",
]);

/**
 * Where a report row's source document lives. Receipts and payments are separate
 * screens with separate permissions, so the direction decides the route.
 */
function documentRoute(row) {
  const type = row?.sourceType || (row?.paymentId ? "Payment" : null);
  const id = row?.sourceId ?? row?.paymentId;
  if (!id) return null;
  switch (type) {
    case "Payment":
      return row?.direction === "Receipt" || String(row?.documentNo || "").startsWith("RCP")
        ? `/receipts?highlight=${id}`
        : `/payments?highlight=${id}`;
    case "PurchaseBill": return `/purchase-bills?highlight=${id}`;
    case "Invoice": return `/bills?highlight=${id}`;
    case "ManualJournal": return `/journal-entries?highlight=${id}`;
    case "AccountTransfer": return `/transfers?highlight=${id}`;
    default: return null;
  }
}

// ── The three reports that already existed ──────────────────────────────────
// Trial Balance and AR/AP aging were built before this module and are correct;
// they keep their own rendering rather than being force-fitted into the generic
// envelope. Re-homing them here means the index covers everything.

function LegacyReport({ companyId, kind, title, categoryTitle, onBack }) {
  return (
    <div>
      <div style={st.legacyHead}>
        <div style={st.headerBar} />
        <div style={st.legacyHeadInner}>
          <button type="button" style={st.backBtn} onClick={onBack}>← All reports</button>
          <div style={st.crumb}>{categoryTitle}</div>
          <h2 style={st.legacyTitle}>{title}</h2>
        </div>
      </div>
      {kind === "trial-balance"
        ? <TrialBalanceReport companyId={companyId} />
        : <AgingReport companyId={companyId} kind={kind} />}
    </div>
  );
}

function TrialBalanceReport({ companyId }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const narrow = useIsNarrow(820);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = {};
      if (applied.from) params.from = applied.from;
      if (applied.to) params.to = applied.to;
      const { data } = await getTrialBalance(companyId, params);
      setData(data);
    } catch {
      setData(null);
      setError("Could not load the trial balance.");
    } finally { setLoading(false); }
  }, [companyId, applied]);

  useEffect(() => { load(); }, [load]);

  const diff = Number(data?.totalDebit || 0) - Number(data?.totalCredit || 0);
  const balanced = Math.abs(diff) < 0.005;

  return (
    <div>
      <div style={st.simpleFilterBar}>
        <label style={st.field}>
          <span style={st.fieldLabel}>From</span>
          <input type="date" style={st.dateInput} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={st.field}>
          <span style={st.fieldLabel}>To</span>
          <input type="date" style={st.dateInput} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button style={st.applyBtn} onClick={() => setApplied({ from, to })} disabled={loading}>Apply</button>
        {data && (balanced ? (
          <span style={st.okChip}><MdCheckCircle size={16} /> Debits = Credits</span>
        ) : (
          <span style={st.badChip}><MdWarning size={16} /> Out of balance by Rs {money(Math.abs(diff))}</span>
        ))}
      </div>

      {loading ? <div style={st.state}>Loading…</div>
        : error ? <div style={{ ...st.state, color: colors.danger }}>{error}</div>
        : !data || (data.rows || []).length === 0
          ? <div style={st.state}>No account activity {applied.from || applied.to ? "in this period" : "yet"}.</div>
          : narrow ? (
            <div style={st.cardList}>
              {data.rows.map((r) => (
                <div key={r.accountId} style={st.miniCard}>
                  <div style={st.miniCardTop}>
                    <span style={st.miniLead}>{r.name}</span>
                    <span style={st.miniAmount}>{money(r.closing)}</span>
                  </div>
                  <div style={st.miniMeta}>
                    <Meta label="Code" value={r.code || "—"} />
                    <Meta label="Type" value={r.accountType} />
                    <Meta label="Opening" value={money(r.opening)} />
                    <Meta label="Debit" value={money(r.debit)} />
                    <Meta label="Credit" value={money(r.credit)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={st.tableWrap}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>Code</th>
                    <th style={st.th}>Account</th>
                    <th style={st.th}>Type</th>
                    <th style={st.thNum}>Opening</th>
                    <th style={st.thNum}>Debit</th>
                    <th style={st.thNum}>Credit</th>
                    <th style={st.thNum}>Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.accountId} style={st.tr}>
                      <td style={st.tdCode}>{r.code || ""}</td>
                      <td style={st.tdName}><span style={st.clamp2}>{r.name}</span></td>
                      <td style={st.tdMuted}>{r.accountType}</td>
                      <td style={st.tdNum}>{money(r.opening)}</td>
                      <td style={st.tdNum}>{money(r.debit)}</td>
                      <td style={st.tdNum}>{money(r.credit)}</td>
                      <td style={{ ...st.tdNum, fontWeight: 700 }}>{money(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={st.totalsRow}>
                    <td style={st.tdCode} />
                    <td style={st.tdName}>Total</td>
                    <td style={st.tdMuted} />
                    <td style={st.tdNum}>{money(data.totalOpening)}</td>
                    <td style={st.tdNum}>{money(data.totalDebit)}</td>
                    <td style={st.tdNum}>{money(data.totalCredit)}</td>
                    <td style={st.tdNum}>{money(data.totalClosing)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
    </div>
  );
}

function AgingReport({ companyId, kind }) {
  const isReceivables = kind === "receivables";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const narrow = useIsNarrow(820);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError("");
      try {
        const fn = isReceivables ? getAgedReceivables : getAgedPayables;
        const { data } = await fn(companyId);
        if (alive) setData(data);
      } catch {
        if (alive) { setData(null); setError(`Could not load aged ${kind}.`); }
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [companyId, kind, isReceivables]);

  if (loading) return <div style={st.state}>Loading…</div>;
  if (error) return <div style={{ ...st.state, color: colors.danger }}>{error}</div>;
  if (!data) return null;

  const rows = data.rows || [];
  const bucket = (v, tone) => {
    const has = Number(v || 0) > 0;
    const tint = !has ? {} : tone === "amber" ? st.cellAmber : st.cellRed;
    return <td style={{ ...st.tdNum, ...tint }}>{money(v)}</td>;
  };

  return (
    <div>
      <div style={st.totalsStrip}>
        <Tile label="Total outstanding" value={data.total} strong />
        <Tile label="Current" value={data.current} />
        <Tile label="1–30 days" value={data.days1To30} />
        <Tile label="31–60 days" value={data.days31To60} />
        <Tile label="61–90 days" value={data.days61To90} />
        <Tile label="Over 90 days" value={data.over90} danger />
      </div>
      <div style={st.asOf}>As of {new Date(data.asOf).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>

      {rows.length === 0 ? (
        <div style={st.state}>No outstanding {isReceivables ? "invoices" : "bills"}. All settled.</div>
      ) : narrow ? (
        <div style={st.cardList}>
          {rows.map((r) => (
            <div key={r.partyId} style={st.miniCard}>
              <div style={st.miniCardTop}>
                <span style={st.miniLead}>{r.name}</span>
                <span style={st.miniAmount}>{money(r.total)}</span>
              </div>
              <div style={st.miniMeta}>
                <Meta label="Open docs" value={r.openDocuments} />
                <Meta label="Current" value={money(r.current)} />
                <Meta label="1–30" value={money(r.days1To30)} />
                <Meta label="31–60" value={money(r.days31To60)} />
                <Meta label="61–90" value={money(r.days61To90)} />
                <Meta label="90+" value={money(r.over90)} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>{isReceivables ? "Customer" : "Supplier"}</th>
                <th style={st.thNum}>Open docs</th>
                <th style={st.thNum}>Current</th>
                <th style={st.thNum}>1–30</th>
                <th style={st.thNum}>31–60</th>
                <th style={st.thNum}>61–90</th>
                <th style={st.thNum}>90+</th>
                <th style={st.thNum}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partyId} style={st.tr}>
                  <td style={st.tdName}><span style={st.clamp2}>{r.name}</span></td>
                  <td style={st.tdNum}>{r.openDocuments}</td>
                  <td style={st.tdNum}>{money(r.current)}</td>
                  <td style={st.tdNum}>{money(r.days1To30)}</td>
                  <td style={st.tdNum}>{money(r.days31To60)}</td>
                  {bucket(r.days61To90, "amber")}
                  {bucket(r.over90, "red")}
                  <td style={{ ...st.tdNum, fontWeight: 700 }}>{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={st.totalsRow}>
                <td style={st.tdName}>Total</td>
                <td style={st.tdNum}>{rows.reduce((s, r) => s + Number(r.openDocuments || 0), 0)}</td>
                <td style={st.tdNum}>{money(data.current)}</td>
                <td style={st.tdNum}>{money(data.days1To30)}</td>
                <td style={st.tdNum}>{money(data.days31To60)}</td>
                {bucket(data.days61To90, "amber")}
                {bucket(data.over90, "red")}
                <td style={st.tdNum}>{money(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, strong, danger }) {
  return (
    <div style={st.totalTile}>
      <span style={st.fieldLabel}>{label}</span>
      <span style={{
        ...st.totalValue,
        ...(strong ? { fontSize: "1.45rem" } : {}),
        ...(danger && Number(value) > 0 ? { color: colors.danger } : {}),
      }}>{money(value)}</span>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span style={st.metaLabel}>{label}</span>
      <span style={st.metaValue}>{value}</span>
    </div>
  );
}

const money = (n) => {
  const v = Number(n || 0);
  const abs = Math.abs(v).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
};

// ── Styles ──────────────────────────────────────────────────────────────────
const st = {
  page: { padding: "clamp(0.75rem, 2vw, 1.5rem)" },
  pageHead: {
    display: "flex", flexWrap: "wrap", alignItems: "center",
    justifyContent: "space-between", gap: "0.75rem", marginBottom: "1.25rem",
  },
  pageTitleRow: { display: "flex", alignItems: "center", gap: "0.5rem" },
  h2: { margin: 0, fontSize: "clamp(1.25rem, 3vw, 1.5rem)", color: colors.textPrimary, fontWeight: 800 },
  companyPicker: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    flex: "1 1 220px", minWidth: 0, maxWidth: 320,
  },

  state: {
    padding: "2.5rem 1.25rem", textAlign: "center", color: colors.textSecondary,
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14, fontSize: "0.92rem", lineHeight: 1.55,
  },
  linkBtn: {
    background: "none", border: "none", padding: 0,
    color: colors.blue, fontWeight: 700, cursor: "pointer", fontSize: "inherit",
    boxShadow: "none",
  },

  sectionLabel: {
    fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase",
    letterSpacing: "0.07em", color: colors.textSecondary,
    margin: "0 0 0.6rem", paddingTop: "0.25rem",
  },

  // Quick links: the four or five reports most people open.
  featuredGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
    gap: "0.85rem", marginBottom: "1.75rem",
  },
  featuredCard: {
    display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-start",
    textAlign: "left", padding: "1rem 1.1rem", borderRadius: 14, cursor: "pointer",
    border: `1px solid ${colors.cardBorder}`,
    background: `linear-gradient(135deg, rgba(13,71,161,0.05), rgba(0,137,123,0.07))`,
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)", minHeight: 44,
  },
  featuredTitle: { fontSize: "1rem", fontWeight: 800, color: colors.textPrimary, lineHeight: 1.25 },
  featuredBlurb: { fontSize: "0.8rem", color: colors.textSecondary, lineHeight: 1.45 },
  featuredGo: {
    display: "inline-flex", alignItems: "center", gap: 2, marginTop: 4,
    fontSize: "0.78rem", fontWeight: 700, color: colors.blue,
  },

  categoryGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))",
    gap: "1rem", alignItems: "start",
  },
  categoryCard: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
  },
  categoryHead: {
    display: "flex", alignItems: "flex-start", gap: "0.7rem",
    padding: "0.9rem 1rem", borderBottom: `1px solid ${colors.cardBorder}`,
    background: "#f7f9fc",
  },
  categoryIcon: {
    display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, flexShrink: 0,
  },
  categoryTitle: { margin: 0, fontSize: "0.98rem", fontWeight: 800, color: colors.textPrimary },
  categoryBlurb: { margin: "2px 0 0", fontSize: "0.78rem", color: colors.textSecondary, lineHeight: 1.4 },
  categoryCount: {
    marginLeft: "auto", flexShrink: 0, fontSize: "0.7rem", fontWeight: 700,
    color: colors.textSecondary, background: colors.inputBg,
    border: `1px solid ${colors.inputBorder}`, borderRadius: 20, padding: "0.15rem 0.5rem",
  },
  reportList: { listStyle: "none", margin: 0, padding: 0 },
  reportRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    width: "100%", minHeight: 52, padding: "0.6rem 1rem",
    border: "none", borderBottom: `1px solid ${colors.cardBorder}`,
    background: "none", cursor: "pointer", textAlign: "left", boxShadow: "none",
  },
  reportRowMuted: { cursor: "default", opacity: 0.6 },
  reportName: { display: "block", fontSize: "0.87rem", fontWeight: 700, color: colors.textPrimary, lineHeight: 1.3 },
  reportBlurb: {
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
    fontSize: "0.75rem", color: colors.textSecondary, lineHeight: 1.35, marginTop: 1,
  },
  badgeSoon: {
    flexShrink: 0, fontSize: "0.66rem", fontWeight: 800, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.textSecondary,
    background: colors.inputBg, border: `1px solid ${colors.inputBorder}`,
    borderRadius: 20, padding: "0.15rem 0.5rem",
  },
  badgeBlocked: {
    flexShrink: 0, fontSize: "0.66rem", fontWeight: 800, textTransform: "uppercase",
    letterSpacing: "0.05em", color: "#8a5a00",
    background: "#fff8e1", border: "1px solid #ffe0a3",
    borderRadius: 20, padding: "0.15rem 0.5rem",
  },

  // Legacy report header — same identity band as ReportShell.
  legacyHead: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 14, overflow: "hidden", marginBottom: "1rem",
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
  },
  headerBar: { height: 4, background: `linear-gradient(90deg, ${colors.blue}, ${colors.teal})` },
  legacyHeadInner: { padding: "1rem clamp(0.85rem, 1.8vw, 1.3rem)" },
  legacyTitle: { margin: "0.15rem 0 0", fontSize: "clamp(1.15rem, 2.4vw, 1.5rem)", fontWeight: 800, color: colors.textPrimary },
  backBtn: {
    display: "inline-flex", alignItems: "center", minHeight: 44,
    padding: "0 0.75rem 0 0", marginBottom: 2,
    border: "none", background: "none", color: colors.textSecondary,
    fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none",
  },
  crumb: {
    fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.06em", color: colors.teal,
  },

  simpleFilterBar: {
    display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap",
    marginBottom: "1rem", background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`, borderRadius: 14,
    padding: "0.9rem clamp(0.75rem, 1.6vw, 1.1rem)",
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
  },
  field: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px", maxWidth: 220, minWidth: 0 },
  fieldLabel: {
    fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.textSecondary,
  },
  dateInput: { ...dropdownStyles.base, minHeight: 44, width: "100%", minWidth: 0, cursor: "auto" },
  applyBtn: {
    minHeight: 44, padding: "0 1.3rem", borderRadius: 10, border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    color: "#fff", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer",
    boxShadow: "0 2px 8px rgba(13,71,161,0.22)",
  },
  okChip: {
    display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44,
    padding: "0 0.8rem", borderRadius: 22, background: "#e8f5e9",
    color: colors.success, border: "1px solid #c8e6c9", fontSize: "0.82rem", fontWeight: 700,
  },
  badChip: {
    display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44,
    padding: "0 0.8rem", borderRadius: 22, background: colors.dangerLight,
    color: colors.danger, border: "1px solid #f5c6cb", fontSize: "0.82rem", fontWeight: 700,
  },

  totalsStrip: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
    gap: "0.7rem", marginBottom: "0.9rem",
  },
  totalTile: {
    display: "flex", flexDirection: "column", gap: 3,
    padding: "0.75rem 0.9rem", borderRadius: 12,
    background: "linear-gradient(135deg, rgba(13,71,161,0.06), rgba(0,137,123,0.07))",
    border: `1px solid ${colors.cardBorder}`,
  },
  totalValue: { fontSize: "1.2rem", fontWeight: 800, color: colors.blue, fontVariantNumeric: "tabular-nums" },
  asOf: { fontSize: "0.82rem", fontWeight: 700, color: colors.textSecondary, marginBottom: "0.75rem" },

  tableWrap: {
    overflowX: "auto", background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`, borderRadius: 14,
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" },
  th: {
    textAlign: "left", padding: "0.7rem 0.8rem", background: "#f7f9fc",
    fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.blue,
    borderBottom: `2px solid ${colors.cardBorder}`, whiteSpace: "nowrap",
  },
  get thNum() { return { ...this.th, textAlign: "right" }; },
  tr: { borderBottom: `1px solid ${colors.cardBorder}` },
  tdCode: { padding: "0.55rem 0.8rem", fontFamily: "monospace", fontSize: "0.76rem", color: colors.textSecondary, whiteSpace: "nowrap" },
  tdName: { padding: "0.55rem 0.8rem", color: colors.textPrimary, fontWeight: 600, minWidth: 160, maxWidth: 280 },
  tdMuted: { padding: "0.55rem 0.8rem", color: colors.textSecondary, whiteSpace: "nowrap" },
  tdNum: { padding: "0.55rem 0.8rem", textAlign: "right", color: colors.textPrimary, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  totalsRow: { fontWeight: 800, background: colors.inputBg, borderTop: `2px solid ${colors.blue}` },
  clamp2: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.35 },
  cellAmber: { background: "#fff8e1", color: "#b26a00", fontWeight: 700 },
  cellRed: { background: colors.dangerLight, color: colors.danger, fontWeight: 700 },

  cardList: { display: "flex", flexDirection: "column", gap: "0.7rem" },
  miniCard: {
    background: colors.cardBg, border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12, padding: "0.85rem 0.95rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
  },
  miniCardTop: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: "0.55rem" },
  miniLead: {
    fontSize: "0.92rem", fontWeight: 700, color: colors.textPrimary, lineHeight: 1.3,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  miniAmount: { fontSize: "1.05rem", fontWeight: 800, color: colors.blue, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  miniMeta: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: "0.45rem 0.85rem" },
  metaLabel: {
    display: "block", fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.textSecondary, marginBottom: 1,
  },
  metaValue: { fontSize: "0.83rem", fontWeight: 600, color: colors.textPrimary, lineHeight: 1.3, wordBreak: "break-word" },
};
