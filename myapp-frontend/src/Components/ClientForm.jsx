import { useState, useEffect } from "react";
import { createClient, createClientBatch, updateClient } from "../api/clientApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { getFbrRegistrationType } from "../api/fbrApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { formStyles } from "../theme";

const {
  backdrop, modal, header, title, closeButton,
  body, error: errorStyle, formGroup, label, input,
  footer, button, cancel, submit,
} = formStyles;

/**
 * Per-company client form. Two modes:
 *
 *  • EDIT (`client` prop set) — exactly the existing behaviour. The
 *    company can't change here; if the operator wants the same
 *    edits to land on every company's record they should open the
 *    Common Client form instead.
 *
 *  • CREATE (`client` null) — the new "multi-company" flow. The
 *    operator can pick one OR more companies; the form posts to
 *    /api/clients/batch and the backend creates one Client row per
 *    company, all auto-linked to the same ClientGroup. When
 *    `companies` prop is empty (or only one is provided) the picker
 *    is hidden and the form falls back to the legacy single-company
 *    POST /api/clients call — keeping screens that don't yet pass
 *    the company list working.
 *
 * Props:
 *  • client     — existing client to edit, or null for create.
 *  • companyId  — currently-selected company in the parent dropdown.
 *                 Used as the legacy single-company create target AND
 *                 as the default-checked entry in the multi-company
 *                 picker.
 *  • companies  — full list of companies the operator may create the
 *                 client under (typically from useCompany().companies).
 *                 Optional — when omitted, multi-company picker is
 *                 hidden.
 */
export default function ClientForm({ client, companyId, companies = [], fbrEnabled, onClose, onSaved }) {
  const [formData, setFormData] = useState(
    client
      ? { ...client, ntn: client.ntn || "", strn: client.strn || "", site: client.site || "", registrationType: client.registrationType || "", cnic: client.cnic || "", fbrProvinceCode: client.fbrProvinceCode ?? "" }
      : { id: null, name: "", address: "", email: "", phone: "", ntn: "", strn: "", site: "", registrationType: "", cnic: "", fbrProvinceCode: "" }
  );
  const [errors, setErrors] = useState({});
  const [provinces, setProvinces] = useState([]);
  const [regTypes, setRegTypes] = useState([]);
  // "Check with FBR": FBR's Get_Reg_Type answer for the typed NTN/CNIC. The
  // registration type decides the scenario a bill files under, and a buyer
  // recorded as Registered whom FBR holds as Unregistered is refused [0205]
  // on every bill -- three live bills hit exactly that (2026-09-10).
  const { has } = usePermissions();
  const canAskFbr = has("fbr.config.view");
  const [fbrCheck, setFbrCheck] = useState({ busy: false, result: "" });

  // Multi-company picker state (CREATE mode only). Default-selected
  // is the currently-active company so the existing single-company
  // workflow stays one click — operator just opens the form, fills,
  // saves. Adding a second company is one extra checkbox click.
  const isCreate = !client;
  const showCompanyPicker = isCreate && Array.isArray(companies) && companies.length > 1;
  const [selectedCompanyIds, setSelectedCompanyIds] = useState(() =>
    companyId ? [Number(companyId)] : []
  );

  // Keep the default in sync if the parent dropdown changes the
  // active company while the modal is closed (rare, but safe).
  useEffect(() => {
    if (isCreate && companyId) {
      setSelectedCompanyIds((prev) =>
        prev.length === 0 ? [Number(companyId)] : prev
      );
    }
  }, [companyId, isCreate]);

  const toggleCompany = (id) => {
    const n = Number(id);
    setSelectedCompanyIds((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]
    );
  };

  // FBR identity fields are required only when this client will belong to at
  // least one company that has FBR integration enabled. Callers that pass a
  // `companies` list (the Clients page) let us derive it from the target
  // company/companies; callers without that list (the inline add-client in
  // the invoice forms) pass an explicit `fbrEnabled` instead. Unknown → keep
  // it required, so turning the flag off is the only thing that relaxes it.
  const fbrTargetIds = isCreate
    ? (showCompanyPicker ? selectedCompanyIds : (companyId != null ? [Number(companyId)] : []))
    : (companyId != null ? [Number(companyId)] : []);
  const fbrRequired = typeof fbrEnabled === "boolean"
    ? fbrEnabled
    : (() => {
        const known = (companies || []).filter((c) => fbrTargetIds.includes(Number(c.id)));
        return known.length === 0 ? true : known.some((c) => c.fbrEnabled !== false);
      })();

  useEffect(() => {
    if (client) setFormData({ ...client, ntn: client.ntn || "", strn: client.strn || "", site: client.site || "", registrationType: client.registrationType || "", cnic: client.cnic || "", fbrProvinceCode: client.fbrProvinceCode ?? "" });
  }, [client]);

  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [provRes, regRes] = await Promise.all([
          getFbrLookupsByCategory("Province"),
          getFbrLookupsByCategory("RegistrationType"),
        ]);
        setProvinces(provRes.data);
        setRegTypes(regRes.data);
      } catch { /* ignore — fallback to empty */ }
    };
    loadLookups();
  }, []);

  // Registration-type → which identity fields apply.
  // What FBR's buyer block actually needs (V1.12, proven against the sandbox
  // 2026-09-10): name, registration type, province, and an NTN/CNIC for a
  // REGISTERED buyer. Everything else on this form is optional -- STRN is not
  // sent at all, an unregistered buyer's CNIC is optional, and FBR accepted a
  // buyer with no address. So:
  //   • Registered    — NTN (7 digits) required.
  //   • FTN           — Federal Tax Number lives in the NTN column; required.
  //   • Unregistered  — no NTN; CNIC optional (13 digits when given).
  //   • CNIC          — same as Unregistered for the form's purposes.
  const regType = formData.registrationType;
  const showNtn  = regType === "Registered" || regType === "FTN";
  const showStrn = regType === "Registered"; // STRN truly required only for Registered
  // CNIC shows for every type once one is picked: an unregistered buyer may
  // give one, and a REGISTERED buyer whose NTN has a letter prefix (A113680-1)
  // MUST -- FBR's invoice API refuses that NTN form and files the buyer under
  // the CNIC instead (2026-09-10).
  const showCnic = !!regType;
  const ntnHasLetter = /[A-Za-z]/.test(formData.ntn || "");
  const cnicNeededForNtn = showNtn && ntnHasLetter;
  const star = fbrRequired ? " *" : "";
  const ntnLabel = (regType === "FTN" ? "FTN" : "NTN") + star;

  const checkRegistrationWithFbr = async () => {
    const regNo = (formData.ntn || formData.cnic || "").trim();
    if (!regNo || !companyId) return;
    setFbrCheck({ busy: true, result: "" });
    try {
      const { data } = await getFbrRegistrationType(companyId, regNo);
      const type = (data?.registratioN_TYPE || data?.registrationType || "").trim();
      if (type === "Registered" || type === "Unregistered") {
        setFormData((f) => ({ ...f, registrationType: type, ...(type === "Unregistered" ? { strn: "" } : {}) }));
        setErrors((e) => ({ ...e, registrationType: "" }));
        const letter = /[A-Za-z]/.test(regNo) && !/^\d{13}$/.test(regNo.replace(/\D/g, ""));
        setFbrCheck({ busy: false, result: `FBR: ${regNo} is ${type}` + (letter && type === "Registered"
          ? " — but an NTN with a letter prefix cannot go on an invoice; enter the buyer's 13-digit CNIC below."
          : "") });
      } else {
        setFbrCheck({ busy: false, result: "FBR gave no registration type for this number." });
      }
    } catch (err) {
      setFbrCheck({ busy: false, result: err?.response?.data?.message || "Could not reach FBR — try again." });
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";

    // FBR identity is enforced only when this client will live on an
    // FBR-enabled company. With the company's FBR integration off the
    // operator may still record these details, but none are mandatory.
    if (fbrRequired) {
      if (!formData.registrationType) newErrors.registrationType = "Registration Type is required";
      if (!formData.fbrProvinceCode && formData.fbrProvinceCode !== 0) newErrors.fbrProvinceCode = "Province is required";
      // NTN/STRN: required only for Registered and (NTN only) FTN. The
      // form-level fields are still in state — if the operator switched
      // type they get blanked on switch, so this stays in sync.
      if (showNtn && !formData.ntn.trim()) newErrors.ntn = regType === "FTN" ? "FTN is required" : "NTN is required";
      // STRN is deliberately NOT required (2026-09-10): the FBR buyer block
      // carries NTN/CNIC, name, province, address and registration type --
      // no STRN -- and demanding one here kept real buyers out of FBR.
      // An unregistered buyer's CNIC is optional on FBR's side (buyerNTNCNIC
      // may be empty for Unregistered). A registered buyer with a
      // letter-prefixed NTN cannot be filed without one.
      if (cnicNeededForNtn && !formData.cnic.trim())
        newErrors.cnic = "FBR cannot file an NTN with a letter prefix — enter the buyer's 13-digit CNIC";
    }
    // CNIC must be 13 digits whenever one is entered (Pakistan ID format) —
    // checked even when FBR is off, so a typo never gets saved.
    if (showCnic && formData.cnic.trim() && formData.cnic.replace(/\D/g, "").length !== 13) {
      newErrors.cnic = "CNIC must be 13 digits";
    }

    if (isCreate && showCompanyPicker && selectedCompanyIds.length === 0) {
      newErrors.companies = "Pick at least one company.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    // Switching registration type clears the identity fields that no
    // longer apply — so a Registered → Unregistered switch doesn't
    // leave a stale NTN/STRN in state that the operator can't see and
    // would silently get saved. Mirror behaviour: switching back to
    // Registered keeps the new (empty) state until the operator types.
    if (name === "registrationType") {
      const next = { ...formData, registrationType: value };
      const willShowNtn  = value === "Registered" || value === "FTN";
      const willShowStrn = value === "Registered";
      if (!willShowNtn)  next.ntn  = "";
      if (!willShowStrn) next.strn = "";
      setFormData(next);
      setErrors({ ...errors, registrationType: "", ntn: "", strn: "", cnic: "" });
      return;
    }

    setFormData({ ...formData, [name]: value });
    setErrors({ ...errors, [name]: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const base = {
        ...formData,
        fbrProvinceCode: formData.fbrProvinceCode === "" ? null : Number(formData.fbrProvinceCode),
        registrationType: formData.registrationType || null,
        cnic: formData.cnic || null,
      };

      // EDIT — single record, unchanged path.
      if (formData.id) {
        const { data } = await updateClient(formData.id, { ...base, companyId });
        onSaved(data);
        onClose();
        return;
      }

      // CREATE — branch on whether we have a multi-company picker.
      // When the picker is hidden (legacy callers / single-company
      // setups) fall back to the original POST /api/clients.
      if (showCompanyPicker) {
        const { data } = await createClientBatch({ ...base, companyIds: selectedCompanyIds });
        const created = data.created || [];
        const skipped = data.skippedReasons || [];
        if (skipped.length > 0) {
          notify(skipped.join(" "), "warning");
        }
        if (created.length > 0) {
          notify(
            `Created ${created.length} client record${created.length !== 1 ? "s" : ""}` +
              (data.clientGroupId ? " (linked as a Common Client)" : ""),
            "success"
          );
        }
        onSaved(created[0] || null);
      } else {
        const { data } = await createClient({ ...base, companyId });
        onSaved(data);
      }
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to save client. Please try again.";
      notify(msg, "error");
    }
  };

  const fieldError = (name) =>
    errors[name] ? { border: "1px solid #dc3545" } : {};

  const errorMsg = (name) =>
    errors[name] ? <span style={{ color: "#dc3545", fontSize: "0.78rem", marginTop: "0.2rem", display: "block" }}>{errors[name]}</span> : null;

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={header}>
          <h5 style={title}>{client ? "Edit Client" : "New Client"}</h5>
          <button style={closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div style={body}>
            {/* Multi-company picker — CREATE mode only, when the parent
                has supplied the companies list and the operator has
                more than one to pick from. Default-checked is the
                currently-active company so single-company creates
                stay one click. Picking 2+ auto-collapses the new
                rows into a Common Client group via EnsureGroup. */}
            {showCompanyPicker && (
              <div style={pickerStyles.box}>
                <div style={pickerStyles.headerRow}>
                  <span style={pickerStyles.title}>Create under which companies?</span>
                  <span style={pickerStyles.hint}>
                    Pick one to add this client to a single tenant, or 2+ to share it as a Common Client.
                  </span>
                </div>
                <div style={pickerStyles.chips}>
                  {companies.map((c) => {
                    const id = Number(c.id);
                    const checked = selectedCompanyIds.includes(id);
                    const lbl = c.brandName || c.name;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleCompany(id)}
                        style={{
                          ...pickerStyles.chip,
                          ...(checked ? pickerStyles.chipOn : pickerStyles.chipOff),
                        }}
                        title={checked ? `Tap to remove ${lbl}` : `Tap to include ${lbl}`}
                      >
                        {checked ? "✓ " : ""}{lbl}
                      </button>
                    );
                  })}
                </div>
                {errorMsg("companies")}
              </div>
            )}

            <div style={formGroup}>
              <label style={label}>Name *</label>
              <input type="text" name="name" value={formData.name} onChange={handleChange} style={{ ...input, ...fieldError("name") }} />
              {errorMsg("name")}
            </div>

            <div style={formGroup}>
              <label style={label}>Address</label>
              <input type="text" name="address" value={formData.address} onChange={handleChange} style={input} />
            </div>

            <div className="form-grid-2col">
              <div style={formGroup}>
                <label style={label}>Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} style={input} />
              </div>
              <div style={formGroup}>
                <label style={label}>Phone</label>
                <input type="text" name="phone" value={formData.phone} onChange={handleChange} style={input} />
              </div>
            </div>

            {/* FBR identity — hidden entirely when the target company's FBR
                integration is off (user rule). When shown: pick Registration
                Type first; the relevant identity fields render conditionally
                (NTN/STRN for Registered/FTN, CNIC for Unregistered). */}
            {fbrRequired && (
            <div style={{ marginTop: "0.5rem", padding: "0.75rem", borderRadius: 10, border: "1px solid #0d47a130", backgroundColor: "#e3f2fd" }}>
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.85rem", color: "#0d47a1" }}>FBR Details</p>
              <div className="form-grid-2col">
                <div style={formGroup}>
                  <label style={label}>Registration Type{star}</label>
                  <select name="registrationType" value={formData.registrationType} onChange={handleChange} style={{ ...input, ...fieldError("registrationType") }}>
                    <option value="">Select...</option>
                    {regTypes.map((rt) => (
                      <option key={rt.id} value={rt.code}>{rt.label}</option>
                    ))}
                  </select>
                  {errorMsg("registrationType")}
                  {canAskFbr && companyId && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        disabled={fbrCheck.busy || !(formData.ntn || formData.cnic).trim()}
                        title="Ask FBR whether this NTN/CNIC is registered for sales tax and set the type accordingly"
                        onClick={checkRegistrationWithFbr}
                        style={{ ...input, width: "auto", minHeight: 44, padding: "0 0.8rem", cursor: fbrCheck.busy ? "wait" : "pointer", background: "#fff", color: "#0d47a1", fontWeight: 700, borderColor: "#0d47a1" }}
                      >
                        {fbrCheck.busy ? "Asking FBR…" : "Check with FBR"}
                      </button>
                      {fbrCheck.result && (
                        <span style={{ fontSize: "0.78rem", color: fbrCheck.result.startsWith("FBR:") ? "#1b5e20" : "#b71c1c" }}>{fbrCheck.result}</span>
                      )}
                    </div>
                  )}
                </div>
                <div style={formGroup}>
                  <label style={label}>Province{star}</label>
                  <select name="fbrProvinceCode" value={formData.fbrProvinceCode} onChange={handleChange} style={{ ...input, ...fieldError("fbrProvinceCode") }}>
                    <option value="">Select...</option>
                    {provinces.map((p) => (
                      <option key={p.id} value={p.code}>{p.label}</option>
                    ))}
                  </select>
                  {errorMsg("fbrProvinceCode")}
                </div>
              </div>

              {/* Identity fields — type-driven. */}
              {!regType && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.78rem", color: "#5f6d7e" }}>
                  Pick a registration type to see the right identity fields.
                </p>
              )}

              {(showNtn || showStrn) && (
                <div className="form-grid-2col" style={{ marginTop: "0.5rem" }}>
                  {showNtn && (
                    <div style={formGroup}>
                      <label style={label}>{ntnLabel}</label>
                      <input
                        type="text"
                        name="ntn"
                        value={formData.ntn}
                        onChange={handleChange}
                        style={{ ...input, ...fieldError("ntn") }}
                        placeholder={regType === "FTN" ? "Federal Tax Number" : "7-digit NTN"}
                      />
                      {errorMsg("ntn")}
                    </div>
                  )}
                  {showStrn && (
                    <div style={formGroup}>
                      <label style={label}>STRN <span style={{ fontWeight: 400, color: "#5f6d7e" }}>(optional — not sent to FBR)</span></label>
                      <input
                        type="text"
                        name="strn"
                        value={formData.strn}
                        onChange={handleChange}
                        style={{ ...input, ...fieldError("strn") }}
                        placeholder="13-digit Sales Tax Registration Number"
                      />
                      {errorMsg("strn")}
                    </div>
                  )}
                </div>
              )}

              {showCnic && (
                <div style={{ ...formGroup, marginTop: "0.5rem" }}>
                  <label style={label}>CNIC (13 digits) <span style={{ fontWeight: 400, color: cnicNeededForNtn ? "#b71c1c" : "#5f6d7e" }}>{cnicNeededForNtn ? "(required — this NTN has a letter prefix)" : "(optional)"}</span></label>
                  <input
                    type="text"
                    name="cnic"
                    value={formData.cnic}
                    onChange={handleChange}
                    style={{ ...input, ...fieldError("cnic") }}
                    placeholder="3520112345678"
                    maxLength={13}
                  />
                  {errorMsg("cnic")}
                  <span style={{ fontSize: "0.75rem", color: "#5f6d7e", marginTop: "0.2rem", display: "block" }}>
                    {cnicNeededForNtn
                      ? "FBR's invoice API only accepts a 7-digit NTN or a 13-digit CNIC. An NTN like A113680-1 is a real registration, but the invoice must carry the buyer's CNIC instead."
                      : "Optional — FBR files an unregistered buyer without one. Give the CNIC when you have it."}
                  </span>
                </div>
              )}
            </div>
            )}

            {/* FBR-off companies still want NTN/STRN on record (e.g. migrated
                clients that carry them) — surface both as OPTIONAL fields.
                When FBR is on, the identity fields live in the FBR block above
                (type-driven + required), so this stays hidden to avoid dupes. */}
            {!fbrRequired && (
              <div style={{ marginTop: "0.5rem", padding: "0.75rem", borderRadius: 10, border: "1px solid #cfd8e3", backgroundColor: "#f7f9fc" }}>
                <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.85rem", color: "#37474f" }}>Tax IDs (optional)</p>
                <div className="form-grid-2col">
                  <div style={formGroup}>
                    <label style={label}>NTN</label>
                    <input type="text" name="ntn" value={formData.ntn} onChange={handleChange} style={input} placeholder="NTN (optional)" />
                  </div>
                  <div style={formGroup}>
                    <label style={label}>STRN</label>
                    <input type="text" name="strn" value={formData.strn} onChange={handleChange} style={input} placeholder="STRN (optional)" />
                  </div>
                </div>
              </div>
            )}

            <div style={formGroup}>
              <label style={label}>Sites</label>
              <input type="text" name="site" value={formData.site} onChange={handleChange} style={input} placeholder="e.g. Site-A ; Site-B ; Site-C" />
              <span style={{ fontSize: "0.75rem", color: "#5f6d7e", marginTop: "0.25rem", display: "block" }}>Separate multiple sites with semicolons (;). These will appear as dropdown options when creating a delivery challan.</span>
            </div>

          </div>

          <div style={footer}>
            <button type="button" style={{ ...button, ...cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...button, ...submit }}>{client ? "Update" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Multi-company picker styles. Kept inline (not in theme.js) because
// they're specific to this one form — chip-style toggles with a
// slightly different visual weight than the rest of the inputs.
const pickerStyles = {
  box: {
    background: "#f0f7ff",
    border: "1px solid #b7d4f0",
    borderRadius: 10,
    padding: "0.7rem 0.85rem",
    marginBottom: "0.9rem",
  },
  headerRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
    flexWrap: "wrap",
    marginBottom: "0.5rem",
  },
  title: {
    fontWeight: 700,
    fontSize: "0.88rem",
    color: "#0d47a1",
  },
  hint: {
    fontSize: "0.74rem",
    color: "#5f6d7e",
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.4rem",
  },
  chip: {
    fontFamily: "inherit",
    fontSize: "0.82rem",
    fontWeight: 600,
    padding: "0.35rem 0.85rem",
    borderRadius: 999,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
    boxShadow: "none",
    margin: 0,
  },
  chipOn: {
    background: "#0d47a1",
    color: "#fff",
    border: "1px solid #0d47a1",
  },
  chipOff: {
    background: "#fff",
    color: "#0d47a1",
    border: "1px solid #b7d4f0",
  },
};
