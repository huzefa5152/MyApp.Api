import { useState, useEffect } from "react";
import { createCompany, updateCompany } from "../api/companyApi";
import { formStyles } from "../theme";

// Destructure directly during import
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
        startingChallanNumber: 0,
        currentChallanNumber: 0,
    });
    const [error, setError] = useState("");

    useEffect(() => {
        if (company) {
            setForm({
                name: company.name,
                startingChallanNumber: company.startingChallanNumber,
                currentChallanNumber: company.currentChallanNumber,
            });
        }
    }, [company]);

    const handleChange = (e) => {
        const { name, value } = e.target;

        if (name === "startingChallanNumber" || name === "currentChallanNumber") {
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

        try {
            if (company) await updateCompany(company.id, form);
            else await createCompany(form);

            onSaved();
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || "Something went wrong.");
        }
    };

    return (
        <div style={backdrop}>
            <div style={modal}>
                <div style={header}>
                    <h5 style={title}>{company ? "Edit Company" : "New Company"}</h5>
                    <button style={closeButton} onClick={onClose}>
                        &times;
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div style={body}>
                        {error && <div style={errorStyle}>{error}</div>}

                        <div style={formGroup}>
                            <label style={label}>Name</label>
                            <input type="text" name="name" value={form.name} onChange={handleChange} style={input} />
                        </div>

                        <div style={formGroup}>
                            <label style={label}>Starting Challan Number</label>
                            <input
                                type="number"
                                name="startingChallanNumber"
                                value={form.startingChallanNumber}
                                onChange={handleChange}
                                style={input}
                            />
                        </div>
                    </div>

                    <div style={footer}>
                        <button type="button" style={{ ...button, ...cancel }} onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" style={{ ...button, ...submit }}>
                            {company ? "Update" : "Create"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
