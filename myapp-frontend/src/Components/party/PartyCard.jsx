import { MdEmail, MdPhone, MdLocationOn, MdErrorOutline, MdGroups } from "react-icons/md";
import { initials, avatarGradient, badgeTone, missingFbrDetails } from "./partyUtils";
import "./PartyDirectory.css";

/**
 * One customer or supplier on the directory screens. Presentational only:
 * the caller decides which actions the user may see (permission-gated) and
 * what each one does.
 *
 * actions: [{ key, label, icon, onClick, variant: "primary"|"soft"|"danger", iconOnly, title }]
 * shared:  the common-party group this record belongs to ({ companyCount, companyNames }), or null.
 */
export default function PartyCard({ party, actions = [], footnote, shared, style }) {
  const sub = [party.contactPerson, party.site].filter(Boolean).join(" · ");
  const missing = missingFbrDetails(party);
  const ids = [["NTN", party.ntn], ["STRN", party.strn], ["CNIC", party.cnic]].filter(([, v]) => v);

  return (
    <article className={`pd-card${shared ? " pd-card--shared" : ""}`} style={style} aria-label={party.name}>
      <div className="pd-card__body">
        <div className="pd-card__head">
          <div className="pd-avatar" style={{ background: avatarGradient(party.name) }} aria-hidden="true">
            {initials(party.name)}
          </div>
          <div className="pd-card__titles">
            <h3 className="pd-card__name" title={party.name}>{party.name}</h3>
            {sub && <div className="pd-card__sub">{sub}</div>}
            {shared && (
              <span className="pd-common" title={(shared.companyNames || []).join(", ")}>
                <MdGroups size={13} /> Common · {shared.companyCount} companies
              </span>
            )}
          </div>
          <span className={`pd-badge pd-badge--${badgeTone(party.registrationType)}`}>
            {party.registrationType || "No type"}
          </span>
        </div>

        {ids.length > 0 && (
          <div className="pd-ids">
            {ids.map(([label, value]) => (
              <span key={label} className="pd-id"><small>{label}</small>{value}</span>
            ))}
          </div>
        )}

        {shared?.companyNames?.length > 0 && (
          <div className="pd-companies" aria-label="Companies that have this record">
            {shared.companyNames.slice(0, 3).map((n) => <span key={n} className="pd-company">{n}</span>)}
            {shared.companyNames.length > 3 && (
              <span className="pd-company pd-company--more" title={shared.companyNames.slice(3).join(", ")}>
                +{shared.companyNames.length - 3} more
              </span>
            )}
          </div>
        )}

        {(party.phone || party.email || party.address) && (
          <div className="pd-contact">
            {party.phone && <div className="pd-contact__row"><MdPhone aria-label="Phone" /><span>{party.phone}</span></div>}
            {party.email && <div className="pd-contact__row"><MdEmail aria-label="Email" /><span>{party.email}</span></div>}
            {party.address && <div className="pd-contact__row"><MdLocationOn aria-label="Address" /><span>{party.address}</span></div>}
          </div>
        )}

        {missing.length > 0 && (
          <span className="pd-warn" title="FBR needs these on every invoice">
            <MdErrorOutline size={14} /> FBR details missing: {missing.join(", ")}
          </span>
        )}
        {footnote}
      </div>

      {actions.length > 0 && (
        <div className="pd-actions">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`pd-btn pd-btn--${a.variant || "soft"}${a.iconOnly ? " pd-btn--icon" : ""}`}
              onClick={a.onClick}
              title={a.title || a.label}
              aria-label={a.iconOnly ? a.title || a.label : undefined}
            >
              {a.icon}{!a.iconOnly && <span>{a.label}</span>}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
