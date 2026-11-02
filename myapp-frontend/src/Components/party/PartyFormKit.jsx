import { initials, avatarGradient } from "./partyUtils";
import "./PartyDirectory.css";

/**
 * Header for the client / supplier forms: live initials avatar of the name
 * being typed, the title, and a one-line subtitle. Keeps the data-admin-*
 * hooks the admin theme and density layers key off.
 */
export function PartyFormHeader({ title, subtitle, name, onClose }) {
  return (
    <div data-admin-header="" className="pf-head">
      <div className="pf-head__avatar" style={{ background: name ? avatarGradient(name) : undefined }} aria-hidden="true">
        {name ? initials(name) : "+"}
      </div>
      <div className="pf-head__text">
        <h5 className="pf-head__title">{title}</h5>
        {subtitle && <div className="pf-head__sub">{subtitle}</div>}
      </div>
      <button type="button" data-admin-close="" className="pf-head__close" onClick={onClose} aria-label="Close">&times;</button>
    </div>
  );
}

/** A titled card that groups related fields inside a form body. */
export function FormSection({ icon, title, hint, aside, children, tone }) {
  return (
    <section className={`pf-section${tone ? ` pf-section--${tone}` : ""}`}>
      <div className="pf-section__head">
        {icon && <span className="pf-section__icon" aria-hidden="true">{icon}</span>}
        <div className="pf-section__text">
          <div className="pf-section__title">{title}</div>
          {hint && <div className="pf-section__hint">{hint}</div>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
