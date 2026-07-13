import { useState, useEffect } from "react";
import { MdAccountTree, MdAdd, MdEdit, MdDelete, MdBusiness } from "react-icons/md";
import { getDivisionsByCompany, deleteDivision } from "../api/divisionApi";
import { notify } from "../utils/notify";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import DivisionForm from "../Components/DivisionForm";

/**
 * Configuration → Divisions. A division is a "sub-company": its own branding
 * (logo / brand / address / contact) plus its own Sales Quote numbering.
 * Managed here (company dropdown + create/edit/delete) instead of inside the
 * Company form. Gated by the dedicated divisions.manage.* permissions.
 */
export default function DivisionsPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canView = has("divisions.manage.view");
  const canCreate = has("divisions.manage.create");
  const canUpdate = has("divisions.manage.update");
  const canDelete = has("divisions.manage.delete");

  const [companyId, setCompanyId] = useState(selectedCompany?.id || "");
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editDiv, setEditDiv] = useState(null);

  const load = async (cid) => {
    if (!cid) { setDivisions([]); return; }
    setLoading(true);
    try {
      const { data } = await getDivisionsByCompany(cid);
      setDivisions(data || []);
    } catch {
      notify("Failed to load divisions.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(companyId); }, [companyId]);

  const handleDelete = async (d) => {
    const ok = await confirm({
      title: `Delete division "${d.name}"?`,
      message: "Any sales quotes or print templates tagged with this division will fall back to company-level. This cannot be undone.",
      variant: "danger",
      confirmText: "Delete division",
    });
    if (!ok) return;
    try {
      await deleteDivision(d.id);
      notify("Division deleted.", "success");
      load(companyId);
    } catch (e) {
      notify(e.response?.data?.error || "Failed to delete division.", "error");
    }
  };

  if (!canView) {
    return <div style={{ padding: 24, color: "#5f6d7e" }}>You don't have permission to view divisions.</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <MdAccountTree size={28} color="#0d47a1" />
        <div>
          <h2 style={{ margin: 0, color: "#1a2332" }}>Divisions</h2>
          <p style={{ margin: 0, color: "#5f6d7e", fontSize: "0.9rem" }}>
            Sub-brands within a company — each with its own logo, branding and Sales Quote numbering.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "18px 0" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <MdBusiness color="#5f6d7e" />
          <select
            value={companyId}
            onChange={(e) => setCompanyId(Number(e.target.value) || "")}
            style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid #d0d7e2", minWidth: 240, background: "#fff" }}
          >
            <option value="">Select a company…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </span>
        {canCreate && companyId && (
          <button
            onClick={() => { setEditDiv(null); setShowForm(true); }}
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", borderRadius: 8, border: "none", background: "#0d47a1", color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >
            <MdAdd /> New Division
          </button>
        )}
      </div>

      {!companyId ? (
        <div style={{ color: "#5f6d7e", padding: 32, textAlign: "center" }}>Pick a company to manage its divisions.</div>
      ) : loading ? (
        <div style={{ padding: 32, color: "#5f6d7e" }}>Loading…</div>
      ) : divisions.length === 0 ? (
        <div style={{ color: "#5f6d7e", padding: 32, textAlign: "center" }}>No divisions yet for this company.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12 }}>
          {divisions.map((d) => (
            <div key={d.id} style={{ border: "1px solid #e8edf3", borderRadius: 10, padding: 16, background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {d.logoPath ? (
                  <img src={d.logoPath} alt="" style={{ height: 38, width: 38, objectFit: "contain", borderRadius: 6 }} />
                ) : (
                  <div style={{ height: 38, width: 38, borderRadius: 6, background: "#eef2f7", display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa7b8" }}>
                    <MdAccountTree />
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "#1a2332" }}>{d.name}</div>
                  {d.brandName && <div style={{ fontSize: "0.8rem", color: "#5f6d7e" }}>{d.brandName}</div>}
                </div>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#5f6d7e", marginTop: 10, lineHeight: 1.5 }}>
                {d.fullAddress && (
                  <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{d.fullAddress}</div>
                )}
                {d.phone && <div>{d.phone}</div>}
                {(d.ntn || d.strn) && (
                  <div>{d.ntn ? `NTN: ${d.ntn}` : ""}{d.ntn && d.strn ? " · " : ""}{d.strn ? `STRN: ${d.strn}` : ""}</div>
                )}
                {/* Every per-division document-number sequence — Starting seed and
                    last-issued. A division numbers each document type separately. */}
                <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                  {[
                    ["Sales Quote", d.startingSalesQuoteNumber, d.currentSalesQuoteNumber],
                    ["Sales Order", d.startingSalesOrderNumber, d.currentSalesOrderNumber],
                    ["Challan", d.startingChallanNumber, d.currentChallanNumber],
                    ["Invoice", d.startingInvoiceNumber, d.currentInvoiceNumber],
                    ["Purchase Bill", d.startingPurchaseBillNumber, d.currentPurchaseBillNumber],
                    ["Goods Receipt", d.startingGoodsReceiptNumber, d.currentGoodsReceiptNumber],
                    ["Credit Note", d.startingCreditNoteNumber, d.currentCreditNoteNumber],
                    ["Debit Note", d.startingDebitNoteNumber, d.currentDebitNoteNumber],
                  ].map(([label, start, current]) => (
                    <div key={label}>
                      {label} # starts at <strong>{start || 1}</strong>
                      {current ? ` · last issued #${current}` : ""}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {canUpdate && (
                  <button onClick={() => { setEditDiv(d); setShowForm(true); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0.4rem 0.7rem", borderRadius: 6, border: "1px solid #ffcc80", background: "#fff3e0", color: "#e65100", cursor: "pointer" }}>
                    <MdEdit size={14} /> Edit
                  </button>
                )}
                {canDelete && (
                  <button onClick={() => handleDelete(d)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0.4rem 0.7rem", borderRadius: 6, border: "1px solid #ef9a9a", background: "#ffebee", color: "#c62828", cursor: "pointer" }}>
                    <MdDelete size={14} /> Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <DivisionForm
          companyId={companyId}
          division={editDiv}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(companyId); }}
        />
      )}
    </div>
  );
}
