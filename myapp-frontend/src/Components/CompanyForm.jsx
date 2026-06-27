import { useState, useEffect } from "react";
import { createCompany, updateCompany, uploadCompanyLogo, getCompanyById } from "../api/companyApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { formStyles, modalSizes } from "../theme";

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

// Tabbed sections — keeps a big single-screen form digestible without
// changing any of the form state, validation, or submit payload.
const TABS = [
    { id: "general", label: "General" },
    { id: "numbering", label: "Document Numbers" },
    { id: "fbr", label: "FBR Integration" },
    { id: "inventory", label: "Inventory" },
    { id: "access", label: "Access" },
];

export default function CompanyForm({ company, onClose, onSaved }) {
    const [activeTab, setActiveTab] = useState("general");
    const [form, setForm] = useState({
        name: "",
        brandName: "",
        fullAddress: "",
        phone: "",
        ntn: "",
        cnic: "",
        strn: "",
        startingChallanNumber: 0,
        currentChallanNumber: 0,
        startingInvoiceNumber: 0,
        currentInvoiceNumber: 0,
        startingSalesQuoteNumber: 0,
        startingSalesOrderNumber: 0,
        invoiceNumberPrefix: "",
        // FBR master switch. Default ON for new companies (consistent with the
        // existing tenants); operator turns it OFF for non-FBR companies.
        fbrEnabled: true,
        fbrProvinceCode: "",
        fbrBusinessActivity: "",
        fbrSector: "",
        fbrToken: "",
        fbrEnvironment: "sandbox",
        // Per-company FBR defaults applied when a new bill is created without
        // these fields set on the line/header. Null/empty means "use built-in
        // fallback" in InvoiceService.
        fbrDefaultSaleType: "",
        fbrDefaultUOM: "",
        fbrDefaultPaymentModeRegistered: "",
        fbrDefaultPaymentModeUnregistered: "",
        // Inventory module — off by default. Operator turns it on once
        // they've recorded opening balances and are ready to track stock.
        inventoryTrackingEnabled: false,
        // Billing workflow — off by default so existing tenants bill as before.
        // ON forces every bill to come from a Sales Order.
        requireSalesOrderForBilling: false,
        startingPurchaseBillNumber: 0,
        startingGoodsReceiptNumber: 0,
        // Tenant isolation — off by default to preserve "any user with the
        // right RBAC permission can reach this company" behaviour.
        isTenantIsolated: false,
    });
    const [logoFile, setLogoFile] = useState(null);
    const [error, setError] = useState("");
    const [provinces, setProvinces] = useState([]);
    const [activities, setActivities] = useState([]);
    const [sectors, setSectors] = useState([]);
    const [environments, setEnvironments] = useState([]);
    const [saleTypeOptions, setSaleTypeOptions] = useState([]);
    const [uomOptions, setUomOptions] = useState([]);
    const [paymentModeOptions, setPaymentModeOptions] = useState([]);

    // Fresh company snapshot — guaranteed to reflect hasInvoices / hasChallans /
    // hasSalesQuotes / hasSalesOrders / fbrEnabled as-of RIGHT NOW.
    const [freshCompany, setFreshCompany] = useState(company);

    useEffect(() => {
        let cancelled = false;
        if (company?.id) {
            getCompanyById(company.id)
                .then(({ data }) => { if (!cancelled) setFreshCompany(data); })
                .catch(() => { if (!cancelled) setFreshCompany(company); });
        } else {
            setFreshCompany(company);
        }
        return () => { cancelled = true; };
    }, [company?.id]);

    useEffect(() => {
        if (freshCompany) {
            setForm({
                name: freshCompany.name || "",
                brandName: freshCompany.brandName || "",
                fullAddress: freshCompany.fullAddress || "",
                phone: freshCompany.phone || "",
                ntn: freshCompany.ntn || "",
                cnic: freshCompany.cnic || "",
                strn: freshCompany.strn || "",
                startingChallanNumber: freshCompany.startingChallanNumber || 0,
                currentChallanNumber: freshCompany.currentChallanNumber || 0,
                startingInvoiceNumber: freshCompany.startingInvoiceNumber || 0,
                currentInvoiceNumber: freshCompany.currentInvoiceNumber || 0,
                startingSalesQuoteNumber: freshCompany.startingSalesQuoteNumber || 0,
                startingSalesOrderNumber: freshCompany.startingSalesOrderNumber || 0,
                invoiceNumberPrefix: freshCompany.invoiceNumberPrefix || "",
                // Treat undefined as enabled (backwards-compat before the field loads).
                fbrEnabled: freshCompany.fbrEnabled !== false,
                fbrProvinceCode: freshCompany.fbrProvinceCode ?? "",
                fbrBusinessActivity: freshCompany.fbrBusinessActivity || "",
                fbrSector: freshCompany.fbrSector || "",
                fbrToken: "",
                fbrEnvironment: freshCompany.fbrEnvironment || "sandbox",
                fbrDefaultSaleType: freshCompany.fbrDefaultSaleType || "",
                fbrDefaultUOM: freshCompany.fbrDefaultUOM || "",
                fbrDefaultPaymentModeRegistered: freshCompany.fbrDefaultPaymentModeRegistered || "",
                fbrDefaultPaymentModeUnregistered: freshCompany.fbrDefaultPaymentModeUnregistered || "",
                inventoryTrackingEnabled: !!freshCompany.inventoryTrackingEnabled,
                requireSalesOrderForBilling: !!freshCompany.requireSalesOrderForBilling,
                startingPurchaseBillNumber: freshCompany.startingPurchaseBillNumber || 0,
                startingGoodsReceiptNumber: freshCompany.startingGoodsReceiptNumber || 0,
                isTenantIsolated: !!freshCompany.isTenantIsolated,
            });
        }
    }, [freshCompany]);

    useEffect(() => {
        const loadLookups = async () => {
            try {
                const [provRes, actRes, secRes, envRes, saleRes, uomRes, pmRes] = await Promise.all([
                    getFbrLookupsByCategory("Province"),
                    getFbrLookupsByCategory("BusinessActivity"),
                    getFbrLookupsByCategory("Sector"),
                    getFbrLookupsByCategory("Environment"),
                    getFbrLookupsByCategory("SaleType").catch(() => ({ data: [] })),
                    getFbrLookupsByCategory("UOM").catch(() => ({ data: [] })),
                    getFbrLookupsByCategory("PaymentMode").catch(() => ({ data: [] })),
                ]);
                setProvinces(provRes.data);
                setActivities(actRes.data);
                setSectors(secRes.data);
                setEnvironments(envRes.data);
                setSaleTypeOptions(saleRes.data || []);
                setUomOptions(uomRes.data || []);
                setPaymentModeOptions(pmRes.data || []);
            } catch { /* ignore */ }
        };
        loadLookups();
    }, []);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (type === "checkbox") {
            setForm({ ...form, [name]: checked });
            return;
        }
        if (name === "fbrProvinceCode") {
            setForm({ ...form, [name]: value === "" ? "" : Number(value) });
            return;
        }
        if (["startingChallanNumber", "currentChallanNumber", "startingInvoiceNumber", "currentInvoiceNumber", "startingSalesQuoteNumber", "startingSalesOrderNumber", "startingPurchaseBillNumber", "startingGoodsReceiptNumber"].includes(name)) {
            const numberValue = Number(value);
            if (isNaN(numberValue) || numberValue < 0 || numberValue > INT32_MAX) return;
            setForm({ ...form, [name]: numberValue });
        } else {
            setForm({ ...form, [name]: value });
        }
    };

    const handleCsvChange = (name, csv) => setForm((prev) => ({ ...prev, [name]: csv }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!form.name) { setActiveTab("general"); return setError("Company name is required."); }
        // CNIC is only required when FBR is enabled (used as SellerNTNCNIC on
        // FBR submissions). Non-FBR companies can leave it blank.
        if (form.fbrEnabled) {
            const cnicDigits = (form.cnic || "").replace(/\D/g, "");
            if (!cnicDigits) { setActiveTab("fbr"); return setError("CNIC is required when FBR is enabled — it's used as SellerNTNCNIC on FBR submissions."); }
            if (cnicDigits.length !== 13) { setActiveTab("fbr"); return setError(`CNIC must be exactly 13 digits (current: ${cnicDigits.length}).`); }
        }
        if (form.startingChallanNumber < 0) { setActiveTab("numbering"); return setError("Starting challan number cannot be negative."); }
        if (form.startingInvoiceNumber < 0) { setActiveTab("numbering"); return setError("Starting invoice number cannot be negative."); }

        try {
            const payload = {
                ...form,
                fbrProvinceCode: form.fbrProvinceCode === "" ? null : Number(form.fbrProvinceCode),
                fbrToken: form.fbrToken || null,
                fbrDefaultSaleType: form.fbrDefaultSaleType || null,
                fbrDefaultUOM: form.fbrDefaultUOM || null,
                fbrDefaultPaymentModeRegistered: form.fbrDefaultPaymentModeRegistered || null,
                fbrDefaultPaymentModeUnregistered: form.fbrDefaultPaymentModeUnregistered || null,
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

    // Small helper for the locked Starting-number fields.
    const numberField = (name, labelText, locked, lockReason, current) => (
        <div style={formGroup}>
            <label style={label}>
                {labelText}
                {locked && (
                    <span style={{ fontSize: "0.75rem", color: "#5f6d7e", fontWeight: 400, marginLeft: "0.5rem" }}>
                        (locked — {lockReason})
                    </span>
                )}
            </label>
            <input
                type="number"
                name={name}
                min={0}
                value={form[name]}
                onChange={handleChange}
                style={{ ...input, ...(locked ? { backgroundColor: "#f0f0f0", color: "#999", cursor: "not-allowed" } : {}) }}
                disabled={locked}
            />
            {current > 0 && (
                <span style={{ fontSize: "0.78rem", color: "#5f6d7e", marginTop: "0.2rem", display: "block" }}>
                    Current: {current}
                </span>
            )}
        </div>
    );

    return (
        <div style={backdrop}>
            <div style={{ ...modal, maxWidth: `${modalSizes.md}px` }}>
                <div style={header}>
                    <h5 style={title}>{company ? "Edit Company" : "New Company"}</h5>
                    <button style={closeButton} onClick={onClose}>&times;</button>
                </div>

                <div style={tabBar}>
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setActiveTab(t.id)}
                            style={{ ...tabBtn, ...(activeTab === t.id ? tabBtnActive : {}) }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSubmit}>
                    <div style={{ ...body, maxHeight: "58vh", overflowY: "auto" }}>
                        {error && <div style={errorStyle}>{error}</div>}

                        {/* ── GENERAL ─────────────────────────────────────── */}
                        {activeTab === "general" && (
                            <>
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
                                <div className="form-grid-2col">
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
                                    <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files[0])} style={{ ...input, padding: "0.4rem" }} />
                                    {company?.logoPath && !logoFile && (
                                        <img src={company.logoPath} alt="logo" style={{ marginTop: "0.5rem", height: "40px" }} />
                                    )}
                                </div>
                            </>
                        )}

                        {/* ── DOCUMENT NUMBERS ────────────────────────────── */}
                        {activeTab === "numbering" && (
                            <>
                                <p style={sectionHint}>Starting numbers seed each document sequence. Each one locks once a document of that type exists, to keep numbering gap-free.</p>
                                {numberField("startingChallanNumber", "Starting Challan Number", freshCompany?.hasChallans, "challans exist", company?.currentChallanNumber)}
                                <div style={formGroup}>
                                    <label style={label}>Invoice Number Prefix</label>
                                    <input type="text" name="invoiceNumberPrefix" value={form.invoiceNumberPrefix} onChange={handleChange} style={input} placeholder="e.g. INV-" />
                                </div>
                                {numberField("startingInvoiceNumber", "Starting Invoice / Bill Number", freshCompany?.hasInvoices, "invoices exist", company?.currentInvoiceNumber)}
                                {numberField("startingSalesQuoteNumber", "Starting Sales Quote Number", freshCompany?.hasSalesQuotes, "quotes exist", company?.currentSalesQuoteNumber)}
                                {numberField("startingSalesOrderNumber", "Starting Sales Order Number", freshCompany?.hasSalesOrders, "orders exist", company?.currentSalesOrderNumber)}
                                {numberField("startingPurchaseBillNumber", "Starting Purchase Bill Number", false, "", company?.currentPurchaseBillNumber)}
                                {numberField("startingGoodsReceiptNumber", "Starting Goods Receipt Number", false, "", company?.currentGoodsReceiptNumber)}
                                <label style={{ ...toggleCard, marginTop: "1rem" }}>
                                    <input type="checkbox" name="requireSalesOrderForBilling" checked={!!form.requireSalesOrderForBilling} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                    <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                        <strong style={{ display: "block" }}>Require a Sales Order for billing</strong>
                                        <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                            When ON, every bill must come from a Sales Order — bills are generated from an order's delivery challans, and standalone bills (or bills from challans not linked to an order) are blocked. Leave OFF to bill directly from any challan or standalone.
                                        </span>
                                    </span>
                                </label>
                            </>
                        )}

                        {/* ── FBR INTEGRATION ─────────────────────────────── */}
                        {activeTab === "fbr" && (
                            <>
                                <label style={toggleCard}>
                                    <input type="checkbox" name="fbrEnabled" checked={!!form.fbrEnabled} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                    <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                        <strong style={{ display: "block" }}>Enable FBR Digital Invoicing for this company</strong>
                                        <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                            When ON, bills show the Validate / Submit-to-FBR buttons and challans require complete company + client FBR details. When OFF, the whole FBR flow is hidden for this company.
                                        </span>
                                    </span>
                                </label>

                                {form.fbrEnabled ? (
                                    <div style={{ marginTop: "0.9rem", padding: "0.85rem", borderRadius: 10, border: "1px solid #0d47a130", backgroundColor: "#f5f9ff" }}>
                                        <div style={formGroup}>
                                            <label style={label}>CNIC * <span style={{ fontWeight: 400, color: "#5f6d7e", fontSize: "0.72rem" }}>(required for FBR — used as SellerNTNCNIC on submissions)</span></label>
                                            <input type="text" name="cnic" value={form.cnic} onChange={handleChange} style={input} maxLength={15} placeholder="13-digit CNIC" />
                                        </div>
                                        <div className="form-grid-2col">
                                            <div style={formGroup}>
                                                <label style={label}>Province</label>
                                                <select name="fbrProvinceCode" value={form.fbrProvinceCode} onChange={handleChange} style={input}>
                                                    <option value="">Select...</option>
                                                    {provinces.map((p) => (<option key={p.id} value={p.code}>{p.label}</option>))}
                                                </select>
                                            </div>
                                            <div style={formGroup}>
                                                <label style={label}>Environment</label>
                                                <select name="fbrEnvironment" value={form.fbrEnvironment} onChange={handleChange} style={input}>
                                                    {environments.length > 0 ? environments.map((e) => (<option key={e.id} value={e.code}>{e.label}</option>)) : (<><option value="sandbox">Sandbox</option><option value="production">Production</option></>)}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="form-grid-2col">
                                            <div style={formGroup}>
                                                <label style={label}>Business Activity <span style={{ fontWeight: 400, color: "#5f6d7e", fontSize: "0.72rem" }}>(multiple — drives applicable FBR scenarios)</span></label>
                                                <MultiSelectChips name="fbrBusinessActivity" valueCsv={form.fbrBusinessActivity} options={activities} onChange={handleCsvChange} />
                                            </div>
                                            <div style={formGroup}>
                                                <label style={label}>Sector <span style={{ fontWeight: 400, color: "#5f6d7e", fontSize: "0.72rem" }}>(multiple)</span></label>
                                                <MultiSelectChips name="fbrSector" valueCsv={form.fbrSector} options={sectors} onChange={handleCsvChange} />
                                            </div>
                                        </div>
                                        <div style={formGroup}>
                                            <label style={label}>FBR Bearer Token {company?.hasFbrToken && <span style={{ color: "#28a745", fontSize: "0.75rem" }}>(set)</span>}</label>
                                            <input type="password" name="fbrToken" value={form.fbrToken} onChange={handleChange} style={input} placeholder={company?.hasFbrToken ? "Leave blank to keep current" : "Paste token from IRIS portal"} />
                                        </div>

                                        <div style={{ marginTop: "1rem", paddingTop: "0.9rem", borderTop: "1px dashed #d0d7e2" }}>
                                            <h6 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", fontWeight: 700, color: "#455a64", letterSpacing: "0.03em", textTransform: "uppercase" }}>Default values for new bills</h6>
                                            <p style={{ margin: "0 0 0.75rem", fontSize: "0.76rem", color: "#5f6d7e" }}>Used when creating a bill if the line/header didn't specify. Leave blank to use the built-in fallback.</p>
                                            <div className="form-grid-2col">
                                                <div style={formGroup}>
                                                    <label style={label}>Default Sale Type</label>
                                                    {saleTypeOptions.length > 0 ? (
                                                        <select name="fbrDefaultSaleType" value={form.fbrDefaultSaleType} onChange={handleChange} style={input}>
                                                            <option value="">(Use fallback: Goods at Standard Rate)</option>
                                                            {saleTypeOptions.map((s) => (<option key={s.id} value={s.code}>{s.label}</option>))}
                                                        </select>
                                                    ) : (<input type="text" name="fbrDefaultSaleType" value={form.fbrDefaultSaleType} onChange={handleChange} style={input} placeholder="e.g. Goods at Standard Rate (default)" />)}
                                                </div>
                                                <div style={formGroup}>
                                                    <label style={label}>Default UOM</label>
                                                    {uomOptions.length > 0 ? (
                                                        <select name="fbrDefaultUOM" value={form.fbrDefaultUOM} onChange={handleChange} style={input}>
                                                            <option value="">(Use fallback: Numbers, pieces, units)</option>
                                                            {uomOptions.map((u) => (<option key={u.id} value={u.code}>{u.label}</option>))}
                                                        </select>
                                                    ) : (<input type="text" name="fbrDefaultUOM" value={form.fbrDefaultUOM} onChange={handleChange} style={input} placeholder="e.g. Numbers, pieces, units" />)}
                                                </div>
                                            </div>
                                            <div className="form-grid-2col">
                                                <div style={formGroup}>
                                                    <label style={label}>Default Payment Mode — Registered buyers</label>
                                                    {paymentModeOptions.length > 0 ? (
                                                        <select name="fbrDefaultPaymentModeRegistered" value={form.fbrDefaultPaymentModeRegistered} onChange={handleChange} style={input}>
                                                            <option value="">(Use fallback: Credit)</option>
                                                            {paymentModeOptions.map((p) => (<option key={p.id} value={p.code}>{p.label}</option>))}
                                                        </select>
                                                    ) : (<input type="text" name="fbrDefaultPaymentModeRegistered" value={form.fbrDefaultPaymentModeRegistered} onChange={handleChange} style={input} placeholder="Credit / Bank Transfer / …" />)}
                                                </div>
                                                <div style={formGroup}>
                                                    <label style={label}>Default Payment Mode — Unregistered buyers</label>
                                                    {paymentModeOptions.length > 0 ? (
                                                        <select name="fbrDefaultPaymentModeUnregistered" value={form.fbrDefaultPaymentModeUnregistered} onChange={handleChange} style={input}>
                                                            <option value="">(Use fallback: Cash)</option>
                                                            {paymentModeOptions.map((p) => (<option key={p.id} value={p.code}>{p.label}</option>))}
                                                        </select>
                                                    ) : (<input type="text" name="fbrDefaultPaymentModeUnregistered" value={form.fbrDefaultPaymentModeUnregistered} onChange={handleChange} style={input} placeholder="Cash / Online / …" />)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <p style={{ marginTop: "1rem", padding: "0.85rem", borderRadius: 10, border: "1px dashed #d0d7e2", backgroundColor: "#fafbfc", fontSize: "0.82rem", color: "#5f6d7e" }}>
                                        FBR Digital Invoicing is <strong>off</strong> for this company. Bills won't show Validate / Submit-to-FBR actions and challans skip the FBR-readiness check. Turn it on above to configure PRAL credentials and scenarios.
                                    </p>
                                )}
                            </>
                        )}

                        {/* ── INVENTORY ───────────────────────────────────── */}
                        {activeTab === "inventory" && (
                            <label style={{ ...toggleCard, marginTop: 0 }}>
                                <input type="checkbox" name="inventoryTrackingEnabled" checked={!!form.inventoryTrackingEnabled} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                    <strong style={{ display: "block" }}>Enable inventory tracking</strong>
                                    <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                        Stock IN moves on Purchase Bill save, Stock OUT moves on FBR submission. Pre-check blocks FBR submit when oversold. Leave OFF until you've recorded opening balances.
                                    </span>
                                </span>
                            </label>
                        )}

                        {/* ── ACCESS ──────────────────────────────────────── */}
                        {activeTab === "access" && (
                            <label style={{ ...toggleCard, marginTop: 0 }}>
                                <input type="checkbox" name="isTenantIsolated" checked={!!form.isTenantIsolated} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                    <strong style={{ display: "block" }}>Restrict to assigned users only</strong>
                                    <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                        OFF (default) — any authenticated user with the right RBAC permission can reach this company. ON — only users with an explicit grant in <em>Configuration → Tenant Access</em> see this company. The seed admin always bypasses.
                                    </span>
                                </span>
                            </label>
                        )}
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

const tabBar = { display: "flex", gap: "0.15rem", padding: "0 1rem", borderBottom: "1px solid #e8edf3", flexWrap: "wrap", backgroundColor: "#fff" };
const tabBtn = { padding: "0.6rem 0.85rem", border: "none", borderBottom: "2px solid transparent", background: "transparent", color: "#5f6d7e", fontSize: "0.84rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const tabBtnActive = { color: "#0d47a1", borderBottom: "2px solid #0d47a1" };
const sectionHint = { margin: "0 0 0.9rem", fontSize: "0.8rem", color: "#5f6d7e" };
const toggleCard = { display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.7rem", borderRadius: 8, backgroundColor: "#fff", border: "1px solid #d0d7e2", cursor: "pointer", marginTop: "0.25rem" };
const divRow = { display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.45rem 0.6rem", borderRadius: 8, border: "1px solid #e8edf3", backgroundColor: "#fafbfc" };
const divActBtn = { padding: "0.35rem 0.7rem", borderRadius: 6, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const divActEdit = { ...divActBtn, border: "1px solid #d0d7e2", background: "#fff", color: "#0d47a1" };
const divActRemove = { ...divActBtn, border: "1px solid #f1c4c9", background: "#fff5f6", color: "#dc3545" };
const divActSave = { ...divActBtn, border: "none", background: "#0d47a1", color: "#fff" };
const divActCancel = { ...divActBtn, border: "1px solid #d0d7e2", background: "#fff", color: "#5f6d7e" };

// ── MultiSelectChips ────────────────────────────────────────
function MultiSelectChips({ name, valueCsv, options, onChange }) {
    const selected = (valueCsv || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const remaining = (options || []).filter((o) => !selected.includes(o.code));

    const add = (code) => {
        if (!code || selected.includes(code)) return;
        onChange(name, [...selected, code].join(", "));
    };
    const remove = (code) => {
        onChange(name, selected.filter((s) => s !== code).join(", "));
    };
    const labelFor = (code) => (options || []).find((o) => o.code === code)?.label || code;

    return (
        <div>
            <div style={chipStyles.row}>
                {selected.length === 0 && (<span style={chipStyles.empty}>None — add one or more below</span>)}
                {selected.map((code) => (
                    <span key={code} style={chipStyles.chip}>
                        {labelFor(code)}
                        <button type="button" onClick={() => remove(code)} style={chipStyles.x} aria-label={`Remove ${labelFor(code)}`}>×</button>
                    </span>
                ))}
            </div>
            <select value="" onChange={(e) => { add(e.target.value); e.target.value = ""; }} style={{ ...input, marginTop: "0.4rem" }} disabled={remaining.length === 0}>
                <option value="">{remaining.length === 0 ? "All options selected" : "+ Add another…"}</option>
                {remaining.map((o) => (<option key={o.id} value={o.code}>{o.label}</option>))}
            </select>
        </div>
    );
}

const chipStyles = {
    row: { display: "flex", flexWrap: "wrap", gap: "0.35rem", minHeight: "1.8rem", padding: "0.3rem", border: "1px solid #d0d7e2", borderRadius: 6, backgroundColor: "#f8f9fb" },
    empty: { fontSize: "0.78rem", color: "#9ca3af", fontStyle: "italic", padding: "0.15rem 0.3rem" },
    chip: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.55rem", backgroundColor: "#0d47a1", color: "#fff", borderRadius: 14, fontSize: "0.74rem", fontWeight: 600 },
    x: { background: "transparent", color: "#fff", border: "none", cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: 0, marginLeft: "0.15rem" },
};
