import { useState, useRef, useEffect } from "react";
import LookupAutocomplete from "./LookupAutocomplete";
import "bootstrap/dist/css/bootstrap.min.css";

export default function ChallanForm({ onClose, onSaved, companyId }) {
    const [clientName, setClientName] = useState("");
    const [poNumber, setPoNumber] = useState("");
    const [deliveryDate, setDeliveryDate] = useState("");
    const [items, setItems] = useState([{ description: "", quantity: 1, unit: "" }]);
    const [error, setError] = useState("");
    const itemsContainerRef = useRef(null);

    useEffect(() => {
        if (itemsContainerRef.current) {
            itemsContainerRef.current.scrollTop = itemsContainerRef.current.scrollHeight;
        }
    }, [items]);

    const handleItemChange = (index, field, value) => {
        const newItems = [...items];
        newItems[index][field] = value;
        setItems(newItems);
    };

    const addItem = () => {
        const lastItem = items[items.length - 1];
        if (!lastItem.description.trim()) {
            setError("Please fill the description of the current item before adding a new one.");
            return;
        }
        setError("");
        setItems([...items, { description: "", quantity: 1, unit: "" }]);
    };

    const removeItem = (index) => setItems(items.filter((_, i) => i !== index));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        const validItems = items.filter(item => item.description.trim());
        if (validItems.length === 0) {
            setError("Please add at least one item with a description.");
            return;
        }

        try {
            await onSaved({
                clientName: clientName.trim(),
                poNumber: poNumber.trim(),
                deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
                items: validItems
            });
            onClose();
        } catch (err) {
            if (err.response?.data?.error) setError(err.response.data.error);
            else if (err.message) setError(err.message);
            else setError("Something went wrong.");
        }
    };

    return (
        <div className="modal fade show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
            <div className="modal-dialog modal-lg modal-dialog-scrollable">
                <div className="modal-content">
                    <div className="modal-header bg-primary text-white">
                        <h5 className="modal-title">Create Delivery Challan</h5>
                        <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
                    </div>

                    <form onSubmit={handleSubmit}>
                        <div className="modal-body">
                            {error && <div className="alert alert-danger">{error}</div>}

                            {/* Client Info */}
                            <div className="row mb-3">
                                <div className="col-md-6">
                                    <label className="form-label">Client Name</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={clientName}
                                        onChange={(e) => setClientName(e.target.value)}
                                        placeholder="Enter client name"
                                    />
                                </div>
                                <div className="col-md-6">
                                    <label className="form-label">PO Number</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={poNumber}
                                        onChange={(e) => setPoNumber(e.target.value)}
                                        placeholder="Enter PO number"
                                    />
                                </div>
                            </div>

                            {/* Delivery Date */}
                            <div className="row mb-3">
                                <div className="col-md-6">
                                    <label className="form-label">Delivery Date</label>
                                    <input
                                        type="date"
                                        className="form-control"
                                        value={deliveryDate}
                                        onChange={(e) => setDeliveryDate(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Items */}
                            <div className="mb-3">
                                <label className="form-label">Items</label>

                                {/* Scrollable list */}
                                <div
                                    ref={itemsContainerRef}   // 👈 attach ref here
                                    className="d-flex flex-column gap-2 overflow-auto custom-scrollbar"
                                    style={{ maxHeight: "200px" }}
                                >
                                    {items.map((item, idx) => (
                                        <div
                                            key={idx}
                                            className="d-flex gap-2 align-items-start border rounded p-2"
                                        >
                                            {/* Index */}
                                            <div className="pt-2" style={{ width: "30px" }}>{idx + 1}</div>

                                            {/* Description */}
                                            <div className="flex-grow-1">
                                                <LookupAutocomplete
                                                    label="Description"
                                                    endpoint="/lookup/items"
                                                    value={item.description}
                                                    onChange={(val) => handleItemChange(idx, "description", val)}
                                                />
                                            </div>

                                            {/* Quantity */}
                                            <div style={{ width: "100px" }}>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    className="form-control"
                                                    value={item.quantity}
                                                    onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                                                />
                                            </div>

                                            {/* Unit */}
                                            <div style={{ width: "150px" }}>
                                                <LookupAutocomplete
                                                    label="Unit"
                                                    endpoint="/lookup/units"
                                                    value={item.unit}
                                                    onChange={(val) => handleItemChange(idx, "unit", val)}
                                                />
                                            </div>

                                            {/* Remove */}
                                            <div className="pt-2">
                                                {idx !== 0 && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-danger btn-sm"
                                                        onClick={() => removeItem(idx)}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Keep Add Item outside scroll */}
                                <button
                                    type="button"
                                    className="btn btn-success btn-sm mt-2"
                                    onClick={addItem}
                                >
                                    + Add Item
                                </button>
                            </div>

                        </div>

                        {/* Footer */}
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={items.some(item => !item.description.trim())}
                            >
                                Save
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
