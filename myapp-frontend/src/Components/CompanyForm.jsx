import { useState, useEffect, useMemo } from "react";
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


// Small grey qualifier beside a field label ("(13 digits)").
const hintSpan = { fontWeight: 400, color: "#5f6d7e", fontSize: "0.72rem" };
const INT32_MAX = 2147483647;

// Tabbed sections — keeps a big single-screen form digestible without
// changing any of the form state, validation, or submit payload.
const TABS = [
    { id: "general", label: "General" },
    { id: "numbering", label: "Document Numbers" },
    { id: "fbr", label: "FBR Integration" },
    { id: "inventory", label: "Inventory" },
    { id: "accounting", label: "Accounting" },
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
        fbrSellerNtnCnic: "",
        strn: "",
        // Company-wide default withholding-tax rate (%). Prefills the WHT
        // control on new sales + purchase bills. Empty string / null = no
        // default (operator turns WHT on per-bill).
        defaultWithholdingTaxRate: "",
        startingChallanNumber: 0,
        currentChallanNumber: 0,
        startingInvoiceNumber: 0,
        currentInvoiceNumber: 0,
        startingSalesQuoteNumber: 0,
        startingSalesOrderNumber: 0,
        startingDebitNoteNumber: 1,
        currentDebitNoteNumber: 0,
        startingCreditNoteNumber: 1,
        currentCreditNoteNumber: 0,
        invoiceNumberPrefix: "",
        // FBR master switch. Default OFF for new companies (non-FBR wholesalers
        // are onboarded first); operator turns it ON in the FBR tab when the
        // company files digital invoices.
        fbrEnabled: false,
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
        // Inventory module — ON by default for new companies so stock is
        // tracked from day one. Operator can turn it off in the Inventory tab.
        inventoryTrackingEnabled: true,
        // Hard-block over-commit/oversell (409) when tracking is on (Q4).
        stockGuardHardBlock: false,

        inventoryOverlayEnabled: false,
        // General Ledger — ON by default for new companies (seeds the Chart of
        // Accounts + turns posting on at create). Create-only; existing
        // companies manage GL from the Accounting page. Ignored on edit.
        enableGl: true,
        // Billing workflow — off by default so existing tenants bill as before.
        // ON forces every bill to come from a Sales Order.
        requireSalesOrderForBilling: false,
        startingPurchaseBillNumber: 0,
        startingGoodsReceiptNumber: 0,
        // Tenant isolation — "Restrict to assigned users only". Informational
        // metadata only: access is already fail-closed for every non-seed-admin
        // via an explicit UserCompany row regardless of this flag (see
        // CompanyAccessGuard). Defaulted true so the create form reflects that
        // reality.
        isTenantIsolated: true,
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
                fbrSellerNtnCnic: freshCompany.fbrSellerNtnCnic || "",
                strn: freshCompany.strn || "",
                defaultWithholdingTaxRate: freshCompany.defaultWithholdingTaxRate ?? "",
                startingChallanNumber: freshCompany.startingChallanNumber || 0,
                currentChallanNumber: freshCompany.currentChallanNumber || 0,
                startingInvoiceNumber: freshCompany.startingInvoiceNumber || 0,
                currentInvoiceNumber: freshCompany.currentInvoiceNumber || 0,
                startingSalesQuoteNumber: freshCompany.startingSalesQuoteNumber || 0,
                startingSalesOrderNumber: freshCompany.startingSalesOrderNumber || 0,
                startingDebitNoteNumber: freshCompany.startingDebitNoteNumber || 1,
                currentDebitNoteNumber: freshCompany.currentDebitNoteNumber || 0,
                startingCreditNoteNumber: freshCompany.startingCreditNoteNumber || 1,
                currentCreditNoteNumber: freshCompany.currentCreditNoteNumber || 0,
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
                stockGuardHardBlock: !!freshCompany.stockGuardHardBlock,

                inventoryOverlayEnabled: !!freshCompany.inventoryOverlayEnabled,
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
        if (["startingChallanNumber", "currentChallanNumber", "startingInvoiceNumber", "currentInvoiceNumber", "startingSalesQuoteNumber", "startingSalesOrderNumber", "startingDebitNoteNumber", "startingCreditNoteNumber", "startingPurchaseBillNumber", "startingGoodsReceiptNumber"].includes(name)) {
            const numberValue = Number(value);
            if (isNaN(numberValue) || numberValue < 0 || numberValue > INT32_MAX) return;
            setForm({ ...form, [name]: numberValue });
        } else {
            setForm({ ...form, [name]: value });
        }
    };

    const handleCsvChange = (name, csv) => setForm((prev) => ({ ...prev, [name]: csv }));

    // Narrow mirror of Helpers/FbrSellerIdentity, for the label and the save
    // guard only. The SERVER resolves what is actually sent; this exists so the
    // form can say which value that will be instead of leaving it a mystery,
    // and so Save fails here rather than at submit time.
    const sellerId = useMemo(() => {
        // An explicit value on the FBR tab wins, exactly as
        // Helpers/FbrSellerIdentity does server-side.
        const stated = (form.fbrSellerNtnCnic || "").trim();
        if (stated) {
            const d = stated.replace(/\D/g, "");
            if (d.length === 13) return { value: d, source: "CNIC you entered", error: null };
            const core = stated.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
            if (core.length === 7) return { value: core, source: "NTN you entered", error: null };
            return {
                value: "", source: "",
                error: `The FBR seller NTN/CNIC "${stated}" is ${core.length} character(s). FBR files a 7-character NTN (no check digit) or a 13-digit CNIC.`,
            };
        }

        const cnicDigits = (form.cnic || "").replace(/\D/g, "");
        if (cnicDigits.length === 13) return { value: cnicDigits, source: "CNIC", error: null };

        const raw = (form.ntn || "").trim();
        const core = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
        // A letter-prefixed NTN keeps its letter and drops the check digit
        // (A113680-1 -> A113680); a numeric one files as its first 7 digits.
        const ntnValue = /[A-Z]/.test(core)
            ? (core.length >= 7 ? core.slice(0, 7) : "")
            : ((raw.replace(/\D/g, "").length >= 7) ? raw.replace(/\D/g, "").slice(0, 7) : "");
        if (ntnValue) return { value: ntnValue, source: "NTN", error: null };

        if (cnicDigits.length > 0) {
            return { value: "", source: "", error: `CNIC has ${cnicDigits.length} digits; a CNIC is 13. Correct it, or set a 7-character NTN instead.` };
        }
        if (core.length > 0) {
            return { value: "", source: "", error: `NTN "${raw}" is too short; FBR files a 7-character NTN. Correct it, or set a 13-digit CNIC instead.` };
        }
        return { value: "", source: "", error: "FBR needs a seller registration number. Enter \"Seller NTN / CNIC\" here, or an NTN or CNIC on the General tab." };
    }, [form.ntn, form.cnic, form.fbrSellerNtnCnic]);

    // Is the choice actually ambiguous? Only when the company carries BOTH a
    // usable NTN and a 13-digit CNIC does the system genuinely not know which
    // one IRIS files under, and only then must the operator state it.
    //
    // Demanding it unconditionally blocked companies holding exactly one of the
    // two -- there is nothing to infer there, and the save was refused for a
    // company whose NTN resolved perfectly well (reported 2026-09-18).
    const sellerIdAmbiguous = useMemo(() => {
        const cnicOk = (form.cnic || "").replace(/\D/g, "").length === 13;
        const raw = (form.ntn || "").trim();
        const core = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
        const ntnOk = /[A-Z]/.test(core)
            ? core.length >= 7
            : raw.replace(/\D/g, "").length >= 7;
        return cnicOk && ntnOk;
    }, [form.ntn, form.cnic]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        // Every check states the TAB that owns the field, and the first failure
        // switches to it. A modal with six tabs and one error line at the top is
        // otherwise a guessing game -- the field being complained about can be
        // two tabs away from the one on screen.
        //
        // Only two tabs carry anything mandatory: General (the company's own
        // name) and FBR Integration (everything FBR refuses a submission
        // without). Document Numbers, Inventory, Accounting and Access are all
        // optional and can be filled in later.
        const problems = [
            // ── General ──────────────────────────────────────────────────
            [!form.name?.trim(), "general",
             "Company name is required."],

            // ── FBR Integration: only when the flag is on ────────────────
            // Each of these is something FBR itself refuses the submission
            // without, so a company saved without them would look configured
            // and fail at the first bill.
            // Required only when the company holds BOTH an NTN and a CNIC (so
            // which one it files under cannot be inferred), or when neither
            // resolves to anything FBR would accept.
            [form.fbrEnabled && !(form.fbrSellerNtnCnic || "").trim() && sellerIdAmbiguous, "fbr",
             "This company has both an NTN and a CNIC, so FBR cannot tell which it files under. Enter the one it uses as \"Seller NTN / CNIC\"."],
            [form.fbrEnabled && !(form.fbrSellerNtnCnic || "").trim() && !sellerIdAmbiguous && !sellerId.value, "fbr",
             sellerId.error || "Enter the Seller NTN / CNIC for FBR — the 7-character NTN or 13-digit CNIC this company files under."],
            [form.fbrEnabled && (form.fbrSellerNtnCnic || "").trim() && !sellerId.value, "fbr",
             sellerId.error],
            [form.fbrEnabled && !form.fbrProvinceCode, "fbr",
             "Choose the seller Province — FBR requires it on every invoice."],
            [form.fbrEnabled && !(form.fbrEnvironment || "").trim(), "fbr",
             "Choose the FBR Environment (Sandbox or Production)."],
            [form.fbrEnabled && !(form.fbrBusinessActivity || "").trim(), "fbr",
             "Choose at least one Business Activity — it decides which FBR scenarios apply to this company."],
            [form.fbrEnabled && !(form.fbrSector || "").trim(), "fbr",
             "Choose at least one Sector — it decides which FBR scenarios apply to this company."],
            // Address lives on General but is only mandatory because FBR sends
            // it as sellerAddress, so say why and send them to the right tab.
            [form.fbrEnabled && !(form.fullAddress || "").trim(), "general",
             "Enter the company Address on the General tab — FBR sends it as the seller address on every invoice."],

            // ── Document Numbers: not required, but must be sane ─────────
            [form.startingChallanNumber < 0, "numbering",
             "Starting challan number cannot be negative."],
            [form.startingInvoiceNumber < 0, "numbering",
             "Starting invoice number cannot be negative."],
        ];

        const failed = problems.find(([bad]) => bad);
        if (failed) {
            setActiveTab(failed[1]);
            return setError(failed[2]);
        }

        try {
            const payload = {
                ...form,
                fbrProvinceCode: form.fbrProvinceCode === "" ? null : Number(form.fbrProvinceCode),
                fbrToken: form.fbrToken || null,
                // Blank means "derive it" (Helpers/FbrSellerIdentity), so send null
                // rather than an empty string the server would treat as stated.
                fbrSellerNtnCnic: (form.fbrSellerNtnCnic || "").trim() || null,
                fbrDefaultSaleType: form.fbrDefaultSaleType || null,
                fbrDefaultUOM: form.fbrDefaultUOM || null,
                fbrDefaultPaymentModeRegistered: form.fbrDefaultPaymentModeRegistered || null,
                fbrDefaultPaymentModeUnregistered: form.fbrDefaultPaymentModeUnregistered || null,
                // Empty input => null (no company default); otherwise the numeric %.
                defaultWithholdingTaxRate:
                    form.defaultWithholdingTaxRate === "" || form.defaultWithholdingTaxRate == null
                        ? null
                        : Number(form.defaultWithholdingTaxRate),
            };

            let savedCompany;
            if (company) {
                const res = await updateCompany(company.id, payload);
                savedCompany = res.data;
            } else {
                const res = await createCompany(payload);
                savedCompany = res.data;
            }

            // The logo goes up only after the company itself saved, because it
            // needs the id. That means a rejected save silently takes the logo
            // with it -- which read as "I cannot save the logo" rather than
            // "the company did not save" (reported 2026-09-18). The catch below
            // now says so.
            if (logoFile && savedCompany?.id) {
                try {
                    const fd = new FormData();
                    fd.append("file", logoFile);
                    await uploadCompanyLogo(savedCompany.id, fd);
                } catch (logoErr) {
                    // The company DID save; only the image failed. Saying
                    // "something went wrong" here would send the operator back
                    // to re-enter fields that are already stored.
                    setError(
                        "The company was saved, but the logo could not be uploaded: "
                        + (logoErr.response?.data?.message || "upload failed")
                        + ". Reopen the company and try the logo on its own.");
                    onSaved();
                    return;
                }
            }

            onSaved();
            onClose();
        } catch (err) {
            const message = err.response?.data?.message || "Something went wrong.";
            // A server-side rejection names a field that may live on a tab the
            // operator cannot see. Switch to the one that owns it, the same way
            // the client-side checks above do -- otherwise the message talks
            // about a field two tabs away.
            if (/seller\s*ntn|sellerNTNCNIC|FBR Integration/i.test(message)) setActiveTab("fbr");
            else if (/address|company name/i.test(message)) setActiveTab("general");
            setError(
                logoFile
                    ? message + " (The logo was not uploaded either — it only uploads once the company saves.)"
                    : message);
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
                                        <label style={label}>NTN <span style={hintSpan}>(as IRIS issues it, e.g. 5326972-8 or A113680-1)</span></label>
                                        <input type="text" name="ntn" value={form.ntn} onChange={handleChange} style={input} placeholder="5326972-8" />
                                    </div>
                                    <div style={formGroup}>
                                        <label style={label}>CNIC <span style={hintSpan}>(13 digits)</span></label>
                                        <input type="text" name="cnic" value={form.cnic} onChange={handleChange} style={input} maxLength={15} placeholder="13-digit CNIC" />
                                    </div>
                                </div>
                                <div style={{ fontSize: "0.76rem", color: "#5f6d7e", marginTop: "-0.4rem", marginBottom: "0.8rem", lineHeight: 1.5 }}>
                                    Optional — these appear on printed documents, so enter them as issued
                                    (the NTN keeps its check digit and any leading letter). What FBR
                                    receives is a separate, required field on the
                                    {" "}<strong>FBR Integration</strong> tab, because a business files under
                                    whichever it is registered with in IRIS.
                                </div>
                                <div style={formGroup}>
                                    <label style={label}>STRN</label>
                                    <input type="text" name="strn" value={form.strn} onChange={handleChange} style={input} />
                                </div>
                                <div style={formGroup}>
                                    <label style={label}>
                                        Default Withholding Tax Rate (%)
                                        <span style={{ fontWeight: 400, color: "#5f6d7e", fontSize: "0.72rem", marginLeft: "0.4rem" }}>
                                            prefills new sales &amp; purchase bills — leave blank for none
                                        </span>
                                    </label>
                                    <input
                                        type="number"
                                        name="defaultWithholdingTaxRate"
                                        min={0}
                                        step={0.01}
                                        value={form.defaultWithholdingTaxRate}
                                        onChange={handleChange}
                                        style={input}
                                        placeholder="e.g. 0.5"
                                    />
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
                                {/* Credit/Debit Notes run their own sequences — reversing
                                    bill #3821 creates Credit Note #1, not bill #3822.
                                    Locked once a note of that type exists. */}
                                {numberField("startingCreditNoteNumber", "Starting Credit Note Number", (company?.currentCreditNoteNumber || 0) > 0, "credit notes exist", company?.currentCreditNoteNumber)}
                                {numberField("startingDebitNoteNumber", "Starting Debit Note Number", (company?.currentDebitNoteNumber || 0) > 0, "debit notes exist", company?.currentDebitNoteNumber)}
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
                                            <label style={label}>
                                                Seller NTN / CNIC for FBR
                                                <span style={{ color: "#c62828", marginLeft: 3 }} aria-hidden="true">*</span>
                                                <span style={hintSpan}> — 7-character NTN or 13-digit CNIC, exactly as filed</span>
                                            </label>
                                            <input
                                                type="text" name="fbrSellerNtnCnic"
                                                value={form.fbrSellerNtnCnic || ""} onChange={handleChange}
                                                style={input} maxLength={20}
                                                placeholder={`e.g. ${(form.ntn || "5326972").replace(/[^0-9A-Za-z]/g, "").slice(0, 7) || "5326972"} or a 13-digit CNIC`}
                                            />
                                            <div style={{ fontSize: "0.74rem", color: "#5f6d7e", marginTop: 3, lineHeight: 1.5 }}>
                                                This is what goes out as <code>sellerNTNCNIC</code>. Use whichever
                                                this business logs into IRIS with — the NTN <strong>without</strong>
                                                {" "}its check digit (5326972-8 → 5326972), or the CNIC's 13 digits.
                                                <strong> Required while FBR Digital Invoicing is on.</strong>
                                            </div>
                                        </div>

                                        <div style={{
                                            marginBottom: "0.9rem", padding: "0.6rem 0.75rem", borderRadius: 8,
                                            border: `1px solid ${sellerId.value ? "#2e7d3230" : "#c6282830"}`,
                                            backgroundColor: sellerId.value ? "#f1f8f2" : "#fdf3f3",
                                            fontSize: "0.8rem", lineHeight: 1.55,
                                        }}>
                                            {sellerId.value ? (
                                                <>
                                                    Submissions will be filed as <code>sellerNTNCNIC</code>{" "}
                                                    <strong>{sellerId.value}</strong>, from this company's{" "}
                                                    <strong>{sellerId.source}</strong>.
                                                    <div style={{ color: "#5f6d7e", marginTop: 3 }}>
                                                        FBR accepts a 7-character NTN or a 13-digit CNIC — a CNIC is
                                                        not required.
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <strong>{sellerId.error}</strong> Enter it above, or fill the NTN
                                                    or CNIC on the <strong>General</strong> tab and leave this blank.
                                                </>
                                            )}
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
                            <>
                                {!company && (
                                    <p style={{ margin: "0 0 0.5rem", padding: "0.6rem 0.7rem", borderRadius: 8, border: "1px solid #d6e4f5", backgroundColor: "#f2f8ff", fontSize: "0.78rem", color: "#33475b", lineHeight: 1.4 }}>
                                        New companies start on <strong>V2 inventory</strong> — every item type is stock-tracked (HS code is FBR metadata only). This is permanent: a company on V2 cannot be moved back to V1, because its stock positions on non-HS items would be hidden rather than removed.
                                    </p>
                                )}
                                <label style={{ ...toggleCard, marginTop: 0 }}>
                                    <input type="checkbox" name="inventoryTrackingEnabled" checked={!!form.inventoryTrackingEnabled} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                    <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                        <strong style={{ display: "block" }}>Enable inventory tracking</strong>
                                        <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                            Stock IN moves on Purchase Bill save, Stock OUT on invoice/bill save. Leave OFF until you've recorded opening balances.
                                        </span>
                                    </span>
                                </label>
                                <label style={toggleCard}>
                                    <input type="checkbox" name="stockGuardHardBlock" checked={!!form.stockGuardHardBlock} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                    <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                        <strong style={{ display: "block" }}>Hard-block over-commit / oversell</strong>
                                        <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                            ON — refuse a sales order or bill (409) when there isn't enough available stock. OFF — allow it with a soft warning. Enabled automatically when a company is switched to V2 inventory.
                                        </span>
                                    </span>
                                </label>
                                <label style={toggleCard}>
                                    <input type="checkbox" name="inventoryOverlayEnabled" checked={!!form.inventoryOverlayEnabled} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                    <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                        <strong style={{ display: "block" }}>Enable Inventory Overlay Behaviour</strong>
                                        <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                            ON — a sale keeps two books that share one total: the <strong>bill</strong> the customer signs (item types with no HS code, quantity and unit price typed by hand) and the <strong>invoice</strong> filed to FBR (HS-coded item types, quantity and price adjusted for the filing). Adjusting the invoice never changes the bill. OFF — one book, exactly as today: the bill line is the filing and prices itself from stock.
                                        </span>
                                    </span>
                                </label>
                            </>
                        )}

                        {/* ── ACCOUNTING (General Ledger) ─────────────────── */}
                        {activeTab === "accounting" && (
                            company ? (
                                <p style={{ marginTop: 0, padding: "0.85rem", borderRadius: 10, border: "1px dashed #d0d7e2", backgroundColor: "#fafbfc", fontSize: "0.82rem", color: "#5f6d7e" }}>
                                    General Ledger status, backfill and the period lock date are managed from <strong>Accounting → General Ledger</strong> for an existing company. This create-time toggle only applies while a company is being created.
                                </p>
                            ) : (
                                <label style={{ ...toggleCard, marginTop: 0 }}>
                                    <input type="checkbox" name="enableGl" checked={!!form.enableGl} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                    <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                        <strong style={{ display: "block" }}>Enable General Ledger (Chart of Accounts)</strong>
                                        <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                            ON (default) — seed a wholesale Chart of Accounts and post invoices/bills/payments to journals from day one. OFF — create with GL off and enable it later from the Accounting page.
                                        </span>
                                    </span>
                                </label>
                            )
                        )}

                        {/* ── ACCESS ──────────────────────────────────────── */}
                        {activeTab === "access" && (
                            <label style={{ ...toggleCard, marginTop: 0 }}>
                                <input type="checkbox" name="isTenantIsolated" checked={!!form.isTenantIsolated} onChange={handleChange} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                                <span style={{ fontSize: "0.86rem", color: "#1a2332", lineHeight: 1.4 }}>
                                    <strong style={{ display: "block" }}>Restrict to assigned users only</strong>
                                    <span style={{ fontSize: "0.76rem", color: "#5f6d7e" }}>
                                        Informational metadata only — access is already fail-closed for every non-seed-admin: a user reaches this company only via an explicit grant in <em>Configuration → Tenant Access</em>, regardless of this flag. Checked by default on new companies so the box reflects that reality; the seed admin always bypasses.
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
