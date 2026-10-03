import { useState } from "react";
import { MdBusiness, MdAdd } from "react-icons/md";
import CompanyList from "../Components/CompanyList";
import CompanyForm from "../Components/CompanyForm";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { PageHeader, Button, Toolbar, SearchBox, EmptyState } from "../ui/Kit";

export default function CompanyPage() {
  const { companies, refreshCompanies } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("companies.manage.create");
  const canUpdate = has("companies.manage.update");
  const canDelete = has("companies.manage.delete");
  const [editingCompany, setEditingCompany] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");

  const handleEdit = (company) => {
    setEditingCompany(company);
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditingCompany(null);
    setShowModal(true);
  };

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        icon={MdBusiness}
        tone="blue"
        title="Companies"
        subtitle={`${companies.length} registered ${companies.length === 1 ? "company" : "companies"}`}
        actions={canCreate && <Button variant="primary" icon={MdAdd} onClick={handleAdd}>New Company</Button>}
      />

      {companies.length > 2 && (
        <Toolbar>
          <SearchBox value={search} onChange={setSearch} placeholder="Search companies..." />
        </Toolbar>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={MdBusiness}>
          {companies.length === 0 ? "No companies added yet. Click \"New Company\" to get started." : "No companies match your search."}
        </EmptyState>
      ) : (
        <CompanyList
          companies={filtered}
          onEdit={handleEdit}
          fetchCompanies={refreshCompanies}
        />
      )}

      {showModal && (
        <CompanyForm
          company={editingCompany}
          onClose={() => setShowModal(false)}
          onSaved={refreshCompanies}
        />
      )}
    </div>
  );
}
