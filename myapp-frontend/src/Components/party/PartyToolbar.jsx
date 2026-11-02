import { MdSearch, MdBusiness } from "react-icons/md";
import { REGISTRATION_TYPES } from "./partyUtils";
import useUi2 from "../../ui2/useUi2";
import "./PartyDirectory.css";

/**
 * Company picker + search + registration-type filter for the directory
 * screens. Type chips show only the types present, with their counts.
 * The company select follows the kit CompanyPicker rule: hidden in the
 * Workspace layout, where the topbar switcher drives the same CompanyContext.
 */
export default function PartyToolbar({
  companies,
  selectedCompany,
  onCompanyChange,
  search,
  onSearch,
  searchPlaceholder,
  typeFilter,
  onTypeFilter,
  counts,
}) {
  const topbarSwitcher = useUi2();
  const types = [...REGISTRATION_TYPES, "None"].filter((t) => counts[t] > 0);
  const chip = (key, label, n) => (
    <button
      key={key}
      type="button"
      className="pd-chip"
      aria-pressed={typeFilter === key}
      onClick={() => onTypeFilter(key)}
    >
      {label} <span className="pd-chip__count">{n}</span>
    </button>
  );

  return (
    <div className="pd-toolbar" data-admin-toolbar="">
      {!topbarSwitcher && companies.length > 1 && (
        <label className="pd-toolbar__company">
          <MdBusiness size={20} aria-hidden="true" />
          <select
            aria-label="Company"
            value={selectedCompany?.id || ""}
            onChange={(e) =>
              onCompanyChange(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))
            }
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.brandName || c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="pd-search">
        <MdSearch size={18} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
      </div>
      {(types.length > 1 || counts.common > 0) && (
        <div
          className="pd-chips"
          role="group"
          aria-label="Filter by registration type or shared status"
        >
          {chip("all", "All", counts.all)}
          {counts.common > 0 && chip("common", "Common", counts.common)}
          {types.length > 1 && types.map((t) => chip(t, t === "None" ? "No type" : t, counts[t]))}
        </div>
      )}
    </div>
  );
}
