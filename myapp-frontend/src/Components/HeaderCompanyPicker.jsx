import { MdBusiness } from "react-icons/md";
import { colors, dropdownStyles } from "../theme";
import "./HeaderCompanyPicker.css";

/** The company picker that sits in a list screen's title row. Hidden when there is one company. */
export default function HeaderCompanyPicker({ companies, selectedCompany, onChange }) {
  if (!companies || companies.length <= 1) return null;
  return (
    <div className="header-company-picker">
      <MdBusiness aria-hidden="true" size={18} color={colors.blue} />
      <select
        aria-label="Company"
        style={dropdownStyles.base}
        value={selectedCompany?.id || ""}
        onChange={(e) =>
          onChange(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))
        }
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.brandName || c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
