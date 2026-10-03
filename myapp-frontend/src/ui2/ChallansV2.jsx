import { useState } from "react";
import {
  MdAdd, MdUploadFile, MdSearch, MdClose, MdVisibility, MdPrint, MdPictureAsPdf, MdGridOn, MdEdit, MdContentCopy, MdRequestQuote, MdLink,
  MdCancel, MdDelete, MdWarning, MdDescription, MdBusiness, MdViewModule, MdViewList, MdErrorOutline, MdRefresh, MdFilterList, MdReceipt, MdPerson, MdCalendarToday, MdEventNote, MdLocationOn, MdAssignmentTurnedIn, MdListAlt,
} from "react-icons/md";
import { statusTones, toneForStatus } from "../Components/StatusBadge";
import DocumentLinesLink from "../Components/DocumentLinesLink";
import { lineSources } from "../utils/documentLines";
import ChallanDetailV2 from "./ChallanDetailV2";
import AttachmentBadge from "../Components/AttachmentBadge";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import SearchableSelect from "../Components/SearchableSelect";
import { evalRowFlags } from "../Components/ChallanTable";
import { usePermissions } from "../contexts/PermissionsContext";
import { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import { Btn, EmptyState, IconBtn, RowMenu, StatusPill, TableSkeleton } from "./primitives";
import DataGrid from "./DataGrid";
import Pager from "./Pager";
import "./ui2.css";

const STATUSES = [
  ["Pending", "Pending"], ["Imported", "Imported"], ["No PO", "No PO"], ["Setup Required", "Setup required"], ["Invoiced", "Billed"], ["Cancelled", "Cancelled"],
];
const CARD_BTN = ["view", "bill", "print", "pdf", "xlsx"]; // labelled buttons on a card; everything else lives in the ⋯ menu
const CARD_LABEL = { view: "View", bill: "Bill", print: "Print", pdf: "PDF", xlsx: "Excel" };
const statusLabel = (s) => (s === "Invoiced" ? "Billed" : s);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

/**
 * Delivery Challans, redesigned. This is a PRESENTATION layer only: ChallanPage still owns every
 * piece of state and every handler (fetching, filters, paging, create / edit / cancel / delete /
 * print / export / duplicate / link / bill / attach) and passes them in here. Nothing about what
 * the screen does, or who may do it, changes.
 */
export default function ChallansV2(p) {
  const { has } = usePermissions();
  const [viewing, setViewing] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Filters that live in the panel (search has its own box); drives the badge on the button.
  const panelCount = [p.statusFilter, p.clientFilter, p.salesOrderFilter, p.dateFrom, p.dateTo].filter(Boolean).length;
  const perms = {
    permUpdate: has("challans.manage.update"),
    permDelete: has("challans.manage.delete"),
    permPrint: has("challans.print.view"),
    permCreateBill: has("bills.manage.create"),
    permDuplicate: has("challans.manage.duplicate"),
  };

  // Every action the old row offered, as data. `inline` ones are icon buttons; the rest live in the ⋯ menu.
  const rowActions = (c) => {
    const f = evalRowFlags(c, perms);
    const canLink = p.canLinkOrder && c.status === "No PO" && !c.salesOrderId && !c.invoiceId;
    const list = [{ key: "view", label: "View challan", icon: MdVisibility, inline: true, onClick: () => setViewing(c) }];
    if (f.canGenerateBill) list.push({ key: "bill", label: "Generate bill", title: "Generate a bill from this challan", icon: MdRequestQuote, inline: true, onClick: () => p.onGenerateBill(c) });
    if (perms.permPrint) {
      list.push({ key: "print", label: "Print", icon: MdPrint, disabled: p.printDisabled, title: p.printDisabled ? p.printDisabledReason : "Print", onClick: () => p.onPrint(c) });
      list.push({ key: "pdf", label: "Export PDF", icon: MdPictureAsPdf, disabled: p.printDisabled || !!p.exportingId, loading: p.exportingId === c.id + "-pdf", title: p.printDisabled ? p.printDisabledReason : "Export PDF", onClick: () => p.onExportPdf(c) });
      if (p.onExportExcel) list.push({ key: "xlsx", label: "Export Excel", icon: MdGridOn, disabled: !!p.exportingId, loading: p.exportingId === c.id + "-excel", onClick: () => p.onExportExcel(c) });
    }
    if (perms.permUpdate && f.isEditable) list.push({ key: "edit", label: "Edit items", icon: MdEdit, onClick: () => p.onEditItems(c) });
    if (f.canDuplicate && p.onDuplicate) list.push({ key: "dup", label: "Duplicate", icon: MdContentCopy, disabled: !!p.duplicatingId, loading: p.duplicatingId === c.id, onClick: () => p.onDuplicate(c) });
    if (canLink) list.push({ key: "link", label: "Link to sales order", icon: MdLink, onClick: () => p.onLinkOrder(c) });
    if (perms.permUpdate && f.canCancel) list.push({ key: "cancel", label: "Cancel challan", icon: MdCancel, danger: true, separatorBefore: true, onClick: () => p.onCancel(c) });
    if (perms.permDelete && f.canDelete) list.push({ key: "delete", label: "Delete", icon: MdDelete, danger: true, onClick: () => p.onDelete(c) });
    return list;
  };

  const dcCell = (c, card = false) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      {card ? (
        <button type="button" className="u2-card__title" onClick={() => setViewing(c)} title={`View challan ${c.challanNumber}`}>Challan #{c.challanNumber}</button>
      ) : (
        <button type="button" className="u2-dc" onClick={() => setViewing(c)} title={`View challan ${c.challanNumber}`} aria-label={`View challan ${c.challanNumber}`}>{c.challanNumber}</button>
      )}
      {c.duplicatedFromId != null && (
        <span title={c.duplicatedFromChallanNumber ? `Duplicate of #${c.duplicatedFromChallanNumber}` : "Duplicate"} style={{ color: "#4527a0", display: "inline-flex" }}><MdContentCopy size={13} aria-label="Duplicate" /></span>
      )}
      {c.warnings && c.warnings.length > 0 && (
        <span title={`FBR setup issues:\n• ${c.warnings.join("\n• ")}`} style={{ color: "#e65100", display: "inline-flex" }}><MdWarning size={14} aria-label="FBR setup issues" /></span>
      )}
      <AttachmentBadge count={p.attachCounts?.[c.id]} onClick={() => p.onAttach(c)} />
    </div>
  );

  const columns = [
    { key: "challanNumber", header: "DC #", width: 120, accessor: (c) => Number(c.challanNumber) || c.challanNumber, render: dcCell },
    { key: "clientName", header: "Client", render: (c) => <span className="u2-clamp" style={{ fontWeight: 600 }}>{c.clientName || "—"}</span> },
    { key: "poNumber", header: "PO", width: 130, render: (c) => c.poNumber || <span className="u2-cell-muted">—</span> },
    { key: "salesOrderNumber", header: "SO #", width: 80, accessor: (c) => c.salesOrderNumber || 0, render: (c) => (c.salesOrderNumber ? <span className="u2-cell-strong">#{c.salesOrderNumber}</span> : <span className="u2-cell-muted">—</span>) },
    { key: "indentNo", header: "Indent", width: 110, defaultHidden: true, render: (c) => c.indentNo || "—" },
    { key: "site", header: "Site", defaultHidden: true, render: (c) => c.site || "—" },
    { key: "deliveryDate", header: "Date", width: 104, accessor: (c) => (c.deliveryDate ? new Date(c.deliveryDate).getTime() : 0), render: (c) => fmtDate(c.deliveryDate) },
    { key: "items", header: "Lines", width: 64, align: "right", accessor: (c) => c.items?.length || 0, render: (c) => c.items?.length || 0 },
    { key: "status", header: "Status", width: 128, accessor: (c) => c.status, render: (c) => <StatusPill status={c.status} label={statusLabel(c.status)} /> },
  ];

  const clientName = (id) => p.clients.find((c) => String(c.id) === String(id))?.name || `Client ${id}`;
  const soLabel = (id) => p.orderOptions.find((o) => String(o.id) === String(id))?.label || `Sales order ${id}`;
  const chips = [
    p.search && { key: "search", label: `Search: ${p.search}`, clear: () => p.setSearch("") },
    p.statusFilter && { key: "status", label: `Status: ${statusLabel(p.statusFilter)}`, clear: () => p.setStatusFilter("") },
    p.clientFilter && { key: "client", label: `Client: ${clientName(p.clientFilter)}`, clear: () => p.handleClientFilter({ target: { value: "" } }) },
    p.salesOrderFilter && { key: "so", label: soLabel(p.salesOrderFilter), clear: () => p.handleSalesOrderFilter("") },
    p.dateFrom && { key: "from", label: `From ${p.dateFrom}`, clear: () => p.setDateFrom("") },
    p.dateTo && { key: "to", label: `To ${p.dateTo}`, clear: () => p.setDateTo("") },
  ].filter(Boolean);

  const company = p.selectedCompany;
  const subtitle = company
    ? `${p.totalCount} challan${p.totalCount !== 1 ? "s" : ""} for ${company.brandName || company.name}`
    : "Select a company to view challans";

  return (
    <>
      <header className="u2-bar">
        <h1 className="u2-bar__title">
          Delivery Challans
          {company && <span className="u2-bar__count" title={subtitle}>{p.totalCount.toLocaleString()}</span>}
        </h1>
        {p.companies.length > 0 && (
          <div className="u2-actions">
            {has(lineSources.challan?.permission) && <DocumentLinesLink type="challan" className="u2-doclink" />}
            {p.canCreate && p.canImport && <Btn variant="secondary" icon={MdUploadFile} onClick={p.onImport}>Import PO</Btn>}
            {p.canCreate && <Btn variant="primary" icon={MdAdd} onClick={p.onNew}>New challan</Btn>}
          </div>
        )}
      </header>

      {p.loadingCompanies ? (
        <TableSkeleton columns={6} rows={5} />
      ) : p.companies.length === 0 ? (
        <EmptyState icon={MdBusiness} title="No companies available">Add a company first, then come back to create challans.</EmptyState>
      ) : (
        <>
          {company && (
            <div className="u2-tb" role="search" aria-label="Filter delivery challans" onKeyDown={(e) => { if (e.key === "Escape" && filtersOpen) setFiltersOpen(false); }}>
              <div className="u2-search u2-search--grow">
                <MdSearch size={15} aria-hidden="true" />
                <input type="search" className="u2-input" placeholder="Search DC #, client, PO…" aria-label="Search DC number, client or PO" value={p.search} onChange={p.handleFilterChange(p.setSearch)} />
              </div>
              <Btn variant="secondary" icon={MdFilterList} aria-expanded={filtersOpen} aria-controls="u2-fpanel" onClick={() => setFiltersOpen((v) => !v)}>
                Filters{panelCount > 0 && <span className="u2-badge" aria-label={`${panelCount} active`}>{panelCount}</span>}
              </Btn>
              <span className="u2-tb__spacer" />
              <PrintTemplateSelect picker={p.tplPicker} />
              {p.isBigScreen && (
                <div className="u2-segment" role="group" aria-label="View mode">
                  <button type="button" aria-pressed={p.viewMode === "table"} onClick={() => p.setViewMode("table")}><MdViewList size={15} aria-hidden="true" />Table</button>
                  <button type="button" aria-pressed={p.viewMode === "card"} onClick={() => p.setViewMode("card")}><MdViewModule size={15} aria-hidden="true" />Cards</button>
                </div>
              )}
            </div>
          )}

          {company && filtersOpen && (
            <div id="u2-fpanel" className="u2-fpanel" role="group" aria-label="Filters" onKeyDown={(e) => { if (e.key === "Escape") setFiltersOpen(false); }}>
              <label className="u2-field">
                <span className="u2-field__label">Status</span>
                <select className="u2-select" value={p.statusFilter} onChange={p.handleFilterChange(p.setStatusFilter)}>
                  <option value="">All statuses</option>
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              {p.canViewClients && (
                <label className="u2-field">
                  <span className="u2-field__label">Client</span>
                  <select className="u2-select" value={p.clientFilter} onChange={p.handleClientFilter}>
                    <option value="">All clients</option>
                    {p.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                  </select>
                </label>
              )}
              {p.canViewSalesOrders && (
                <div className="u2-field">
                  <span className="u2-field__label">Sales order</span>
                  <SearchableSelect
                    items={p.orderOptions} value={p.salesOrderFilter} onChange={(id) => p.handleSalesOrderFilter(id)}
                    labelKey="label" searchKeys={["label"]} placeholder="All sales orders"
                    style={{ minHeight: 32, height: 32, padding: "0 0.5rem", fontSize: "0.8125rem", background: "#fff", borderRadius: 8 }}
                  />
                </div>
              )}
              <div className="u2-field">
                <span className="u2-field__label">Delivery date</span>
                <div className="u2-daterange">
                  <input type="date" className="u2-input" aria-label="From date" value={p.dateFrom} onChange={p.handleFilterChange(p.setDateFrom)} />
                  <span aria-hidden="true">–</span>
                  <input type="date" className="u2-input" aria-label="To date" value={p.dateTo} onChange={p.handleFilterChange(p.setDateTo)} />
                </div>
              </div>
              <div className="u2-fpanel__foot">
                <Btn variant="ghost" onClick={p.resetFilters} disabled={!p.hasFilters}>Clear all</Btn>
                <Btn variant="secondary" onClick={() => setFiltersOpen(false)}>Done</Btn>
              </div>
            </div>
          )}

          {chips.length > 0 && (
            <div className="u2-chips" aria-label="Active filters">
              {chips.map((c) => (
                <span key={c.key} className="u2-chip">{c.label}<button type="button" aria-label={`Remove filter: ${c.label}`} onClick={c.clear}><MdClose size={12} aria-hidden="true" /></button></span>
              ))}
              <Btn variant="ghost" style={{ height: 22, padding: "0 0.4rem", fontSize: "0.72rem" }} onClick={p.resetFilters}>Clear all</Btn>
            </div>
          )}

          {p.loadingChallans ? (
            <TableSkeleton columns={7} rows={7} />
          ) : p.loadFailed ? (
            <EmptyState icon={MdErrorOutline} title="Could not load challans" action={<Btn variant="secondary" icon={MdRefresh} onClick={p.onRetry}>Try again</Btn>}>
              Check your connection and try again. Nothing was changed.
            </EmptyState>
          ) : p.challans.length === 0 && company ? (
            <EmptyState
              icon={MdDescription}
              title={p.hasFilters ? "No challans match these filters" : "No delivery challans yet"}
              action={p.hasFilters ? <Btn variant="secondary" onClick={p.resetFilters}>Clear filters</Btn> : (p.canCreate ? <Btn variant="primary" icon={MdAdd} onClick={p.onNew}>New challan</Btn> : null)}
            >
              {p.hasFilters ? "Try a different search, status or date range." : "Create the first delivery challan for this company."}
            </EmptyState>
          ) : p.viewMode === "table" ? (
            <DataGrid columns={columns} rows={p.challans} rowKey={(c) => c.id} rowActions={rowActions} storageKey="challans"emptyMessage="No delivery challans on this page." />
          ) : (
            <div className="u2-cards">
              {p.challans.map((c) => {
                const acts = rowActions(c);
                const edge = (statusTones[toneForStatus(c.status)] || statusTones.neutral).color;
                const lines = c.items?.length || 0;
                return (
                  <article key={c.id} className="u2-card" style={{ "--u2-edge": edge }} aria-label={`Challan ${c.challanNumber}`}>
                    <div className="u2-card__head">
                      <span className="u2-card__icon" aria-hidden="true"><MdReceipt size={18} /></span>
                      {dcCell(c, true)}
                      <span style={{ marginLeft: "auto" }}><StatusPill status={c.status} label={statusLabel(c.status)} /></span>
                    </div>
                    <div className="u2-card__client u2-clamp"><MdPerson size={15} aria-hidden="true" />{c.clientName || "—"}</div>
                    <dl className="u2-facts2">
                      <div><MdReceipt size={14} aria-hidden="true" /><dt>PO</dt><dd>{c.poNumber || "—"}</dd></div>
                      <div><MdCalendarToday size={14} aria-hidden="true" /><dt>Delivery</dt><dd>{fmtDate(c.deliveryDate)}</dd></div>
                      {c.poDate ? <div><MdEventNote size={14} aria-hidden="true" /><dt>PO date</dt><dd>{fmtDate(c.poDate)}</dd></div> : null}
                      {c.site ? <div><MdLocationOn size={14} aria-hidden="true" /><dt>Site</dt><dd>{c.site}</dd></div> : null}
                      {c.indentNo ? <div><MdAssignmentTurnedIn size={14} aria-hidden="true" /><dt>Indent</dt><dd>{c.indentNo}</dd></div> : null}
                      {c.salesOrderNumber ? <div><MdRequestQuote size={14} aria-hidden="true" /><dt>Sales order</dt><dd>#{c.salesOrderNumber}</dd></div> : null}
                      <div><MdListAlt size={14} aria-hidden="true" /><dt>Items</dt><dd>{lines}</dd></div>
                    </dl>
                    <div className="u2-card__foot">
                      {acts.filter((a) => CARD_BTN.includes(a.key)).map((a) => (
                        <button key={a.key} type="button" className={`u2-abtn u2-abtn--${a.key}`} disabled={a.disabled} title={a.title || a.label} onClick={a.onClick}>
                          {a.loading ? <span className="u2-spinner" aria-hidden="true" /> : <a.icon size={15} aria-hidden="true" />}
                          {CARD_LABEL[a.key] || a.label}
                        </button>
                      ))}
                      <span style={{ marginLeft: "auto" }}><RowMenu items={acts.filter((a) => !CARD_BTN.includes(a.key))} /></span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!p.loadingChallans && !p.loadFailed && p.totalCount > PAGE_SIZE_OPTIONS[0] && (
            <Pager page={p.page} totalPages={p.totalPages} total={p.totalCount} pageSize={p.pageSize} onPage={p.setPage} onPageSize={p.onPageSize} noun="challans" />
          )}
        </>
      )}

      <ChallanDetailV2 challan={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
