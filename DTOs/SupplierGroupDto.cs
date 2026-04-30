namespace MyApp.Api.DTOs
{
    /// <summary>
    /// "Common Supplier" view — mirror of <see cref="CommonClientDto"/>.
    /// One row per multi-company supplier group; single-company groups
    /// are excluded from the list endpoint (they remain in the per-
    /// company supplier list).
    /// </summary>
    public class CommonSupplierDto
    {
        public int GroupId { get; set; }
        public string DisplayName { get; set; } = "";
        public string? NTN { get; set; }
        public int CompanyCount { get; set; }
        public List<string> CompanyNames { get; set; } = new();
        public int? ThisCompanyClientId { get; set; }  // NB: kept "Client" naming for cross-cutting frontend reuse — see GetAllGroups
    }

    /// <summary>
    /// Detail view for a single common supplier — used by the edit form.
    /// All master fields propagate to every member (including Site,
    /// because operators repeatedly hit the "I added sites under one
    /// company but the other tenant's record was empty" papercut and
    /// expected sites to follow the legal entity, not the tenant).
    /// </summary>
    public class CommonSupplierDetailDto
    {
        public int GroupId { get; set; }
        public string DisplayName { get; set; } = "";
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? CNIC { get; set; }
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? RegistrationType { get; set; }
        public int? FbrProvinceCode { get; set; }
        public string? Site { get; set; }
        public List<CommonSupplierMemberDto> Members { get; set; } = new();
    }

    public class CommonSupplierMemberDto
    {
        public int SupplierId { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public string? Site { get; set; }
        public bool HasPurchaseBills { get; set; }
    }

    /// <summary>
    /// Update payload from the Common Supplier edit form. Every field
    /// here propagates to every member <see cref="Supplier"/> across
    /// all companies. Site is included on purpose — same buyer-side
    /// master-data argument as Common Clients.
    /// </summary>
    public class CommonSupplierUpdateDto
    {
        public string Name { get; set; } = "";
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? CNIC { get; set; }
        public string? Site { get; set; }
        public string? RegistrationType { get; set; }
        public int? FbrProvinceCode { get; set; }
    }

    /// <summary>
    /// Response after a Common Supplier update or delete — surfaces the
    /// cascade summary so the UI can show "X suppliers in Y companies
    /// updated/deleted".
    /// </summary>
    public class CommonSupplierUpdateResultDto
    {
        public int GroupId { get; set; }
        public int SuppliersUpdated { get; set; }
        public List<string> AffectedCompanyNames { get; set; } = new();
    }

    /// <summary>
    /// Multi-company create payload — mirror of <see cref="CreateClientBatchDto"/>.
    /// One form submission, N <see cref="Supplier"/> rows (one per
    /// selected CompanyId), all auto-grouped via EnsureGroup.
    /// </summary>
    public class CreateSupplierBatchDto
    {
        public string Name { get; set; } = "";
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? Site { get; set; }
        public string? RegistrationType { get; set; }
        public string? CNIC { get; set; }
        public int? FbrProvinceCode { get; set; }
        public List<int> CompanyIds { get; set; } = new();
    }

    public class CreateSupplierBatchResultDto
    {
        public List<SupplierDto> Created { get; set; } = new();
        public List<string> SkippedReasons { get; set; } = new();
        public int? SupplierGroupId { get; set; }
    }
}
