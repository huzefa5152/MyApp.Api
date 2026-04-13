import { useState, useEffect } from "react";
import { createCompany, updateCompany, uploadCompanyLogo } from "../api/companyApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { formStyles } from "../theme";

const {
    backdrop,
    modal,
    header,
    title,
    closeButton,
    body,
    error: errorStyle,
    formGroup,
    label,
    input,
    footer,
    button,
    cancel,
    submit,
} = formStyles;

const INT32_MAX = 2147483647;

export default function CompanyForm({ company, onClose, onSaved }) {
    const [form, setForm] = useState({
        name: "",
        brandName: "",
        fullAddress: "",
        phone: "",
        ntn: "",
        strn: "",
        startingChallanNumber: 0,
        currentChallanNumber: 0,
        startingInvoiceNumber: 0,
        currentInvoiceNumber: 0,
        invoiceNumberPrefix: "",
        fbrProvinceCode: "",
        fbrBusinessActivity: "",
        fbrSector: "",
        fbrToken: "",
        fbrEnvironment: "sandbox",
    });
    const [logoFile, setLogoFile] = useState(null);
    const [error, setError] = useState("");
    const [provinces, setProvinces] = useState([]);
    const [activities, setActivities] = useState([]);
    const [sectors, setSectors] = useState([]);
    const [environments, setEnvironments] = useState([]);

    useEffect(() => {
        if (company) {
            setForm({
                name: company.name || "",
                brandName: company.brandName || "",
                fullAddress: company.fullAddress || "",
                phone: company.phone || "",
                ntn: company.ntn || "",
                strn: company.strn || "",
                startingChallanNumber: company.startingChallanNumber || 0,
                currentChallanNumber: company.currentChallanNumber || 0,
                startingInvoiceNumber: company.startingInvoiceNumber || 0,
                currentInvoiceNumber: company.currentInvoiceNumber || 0,
                invoiceNumberPrefix: company.invoiceNumberPrefix || "",
                fbrProvinceCode: company.fbrProvinceCode ?? "",
                fbrBusinessActivity: company.fbrBusinessActivity || "",
                fbrSector: company.fbrSector || "",
                fbrToken: "",
                fbrEnvironment: company.fbrEnvironment || "sandbox",
            });
        }
    }, [company]);

    useEffect(() => {
        const loadLookups = async () => {
            try {
                const [provRes, actRes, secRes, envRes] = await Promise.all([
                    getFbrLookupsByCategory("Province"),
                    getFbrLookupsByCategory("BusinessActivity"),
                    getFbrLookupsByCategory("Sector"),
                    getFbrLookupsByCategory("Environment"),
                ]);
                setProvinces(provRes.data);
                setActivities(actRes.data);
                setSectors(secRes.data);
                setEnvironments(envRes.data);
            } catch { /* ignore */ }
        };
        loadLookups();
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name === "fbrProvinceCode") {
            setForm({ ...form, [name]: value === "" ? "" : Number(value) });
            return;
        }
        if (["startingChallanNumber", "currentChallanNumber", "startingInvoiceNumber", "currentInvoiceNumber"].includes(name)) {
            const numberValue = Number(value);
            if (isNaN(numberValue) || numberValue < 0 || numberValue > INT32_MAX) return;
            setForm({ ...form, [name]: numberValue });
        } else {
            setForm({ ...form, [name]: value });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!form.name) return setError("Company name is required.");
        if (form.startingChallanNumber < 0)
            return setError("Starting challan number cannot be negative.");
        if (form.startingInvoiceNumber < 0)
            return setError("Starting invoice number cannot be negative.");

        try {
            const payload = {
                ...form,
                fbrProvinceCode: form.fbrProvinceCode === "" ? null : Number(form.fbrProvinceCode),
                fbrToken: form.fbrToken || null,
            };

            let savedCompany;
            if (company) {
                const res = await updateCompany(company.id, payload);
                savedCompany = res.data;
            } else {
                const res = await createCompany(payload);
                savedCompany = res.data;
            }

            if (logoFile && savedCompany?.id) {
                const fd = new FormData();
                fd.append("file", logoFile);
                await uploadCompanyLogo(savedCompany.id, fd);
            }

            onSaved();
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || "Something went wrong.");
        }
    };

    return (
        <div style={backdrop}>
            <div style={{ ...modal, maxWidth: "520px" }}>
                <div style={header}>
                    <h5 style={title}>{company ? "Edit Company" : "New Company"}</h5>
                    <button style={closeButton} onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div style={{ ...body, maxHeight: "65vh", overflowY: "auto" }}>
                        {error && <div style={errorStyle}>{error}</div>}

                        <div style={formGroup}>
                            <label style={label}>Company Name *</label>
                            <input type="text" name="name" value={form.name} onChange={handleChange} style={input} />
                        </div>

                        <div style={formGroup}>
                            <label style={label}>Brand Name (for print header)</label>
                            <input type="text" name="brandName" value={form.brandName} onChange={handleChange} style={input} placeholder="e.g. HAKIMI TRADERS" />
                        </div>

                        <div style={formGroup}>
                            <label style={label}>Full Address</label>
                            <input type="text" name="fullAddress" value={form.fullAddress} onChange={handleChange} style={input} />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                            <div style={formGroup}>
                                <label style={label}>Phone</label>
                                <input type="text" name="phone" value={form.phone} onChange={handleChange} style={input} />
                            </div>
                            <div style={formGroup}>
                                <label style={label}>NTN</label>
                                <input type="text" name="ntn" value={form.ntn} onChange={handleChange} style={input} />
                            </div>
                        </div>

                        <div style={formGroup}>
                            <label style={label}>STRN</label>
                            <input type="text" name="strn" value={form.strn} onChange={handleChange} style={input} />
                        </div>

                        <div style={formGroup}>
                            <label style={label}>Logo</label>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => setLogoFile(e.target.files[0])}
                                style={{ ...input, padding: "0.4rem" }}
                            />
                            {company?.logoPath && !logoFile && (
                                <img src={company.logoPath} alt="logo" style={{ marginTop: "0.5rem", height: "40px" }} />
                            )}
                        </div>

                        <div style={formGroup}>
                            <label style={label}>
                                Starting Challan Number
                                {company?.hasChallans && (
                                    <span style={{ fontSize: "0.75rem", color: "#5f6d7e", fontWeight: 400, marginLeft: "0.5rem" }}>
                                        (locked — challans exist)
                                    </span>
                                )}
                            </label>
                            <input
                                type="number"
                                name="startingChallanNumber"
                                value={form.startingChallanNumber}
                                onChange={handleChange}
                                style={{ ...input, ...(company?.hasChallans ? { backgroundColor: "#f0f0f0", color: "#999", cursor: "not-allowed" } : {}) }}
                                disabled={company?.hasChallans}
                            />
                            {company?.currentChallanNumber > 0 && (
                                <span style={{ fontSize: "0.78rem", color: "#5f6d7e", marginTop: "0.2rem", display: "block" }}>
                                    Current challan number: {company.currentChallanNumber}
                                </span>
                            )}
                        </div>

                        <div style={formGroup}>
                            <label style={label}>
                                Starting Invoice Number
                                {company?.hasInvoices && (
                                    <span style={{ fontSize: "0.75rem", color: "#5f6d7e", fontWeight: 400, marginLeft: "0.5rem" }}>
                                        (locked — invoices exist)
                                    </span>
                                )}
                            </label>
                            <input
                                type="number"
                                name="startingInvoiceNumber"
                                value={form.startingInvoiceNumber}
                                onChange={handleChange}
                                style={{ ...input, ...(company?.hasInvoices ? { backgroundColor: "#f0f0f0", color: "#999", cursor: "not-allowed" } : {}) }}
                                disabled={company?.hasInvoices}
                            />
                            {company?.currentInvoiceNumber > 0 && (
                                <span style={{ fontSize: "0.78rem", color: "#5f6d7e", marginTop: "0.2rem", display: "block" }}>
                                    Current invoice number: {company.currentInvoiceNumber}
                                </span>
                            )}
                        </div>

                        <div style={{ marginTop: "1rem", padding: "0.75rem", borderRadius: 10, border: "1px solid #0d47a130", backgroundColor: "#e3f2fd" }}>
                            <p style={{ margin: "0 0 0.6rem", fontWeight: 700, fontSize: "0.88rem", color: "#0d47a1" }}>FBR Digital Invoicing</p>

                            <div style={formGroup}>
                                <label style={label}>Invoice Number Prefix</label>
                                <input type="text" name="invoiceNumberPrefix" value={form.invoiceNumberPrefix} onChange={handleChange} style={input} placeholder="e.g. INV-" />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                                <div style={formGroup}>
                                    <label style={label}>Province</label>
                                    <select name="fbrProvinceCode" value={form.fbrProvinceCode} onChange={handleChange} style={input}>
                                        <option value="">Select...</option>
                                        {provinces.map((p) => (
                                            <option key={p.id} value={p.code}>{p.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={formGroup}>
                                    <label style={label}>Environment</label>
                                    <select name="fbrEnvironment" value={form.fbrEnvironment} onChange={handleChange} style={input}>
                                        {environments.length > 0 ? environments.map((e) => (
                                            <option key={e.id} value={e.code}>{e.label}</option>
                                        )) : (
                                            <>
                                                <option value="sandbox">Sandbox</option>
                                                <option value="production">Production</option>
                                            </>
                                        )}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                                <div style={formGroup}>
                                    <label style={label}>Business Activity</label>
                                    <select name="fbrBusinessActivity" value={form.fbrBusinessActivity} onChange={handleChange} style={input}>
                                        <option value="">Select...</option>
                                        {activities.map((a) => (
                                            <option key={a.id} value={a.code}>{a.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={formGroup}>
                                    <label style={label}>Sector</label>
                                    <select name="fbrSector" value={form.fbrSector} onChange={handleChange} style={input}>
                                        <option value="">Select...</option>
                                        {sectors.map((s) => (
                                            <option key={s.id} value={s.code}>{s.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div style={formGroup}>
                                <label style={label}>FBR Bearer Token {company?.hasFbrToken && <span style={{ color: "#28a745", fontSize: "0.75rem" }}>(set)</span>}</label>
                                <input type="password" name="fbrToken" value={form.fbrToken} onChange={handleChange} style={input} placeholder={company?.hasFbrToken ? "Leave blank to keep current" : "Paste token from IRIS portal"} />
                            </div>
                        </div>
                    </div>

                    <div style={footer}>
                        <button type="button" style={{ ...button, ...cancel }} onClick={onClose}>Cancel</button>
                        <button type="submit" style={{ ...button, ...submit }}>{company ? "Update" : "Create"}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
