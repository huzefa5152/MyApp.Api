namespace MyApp.Api.DTOs
{
    /// <summary>
    /// "Common Client" view for the ClientsPage panel — one row per
    /// multi-company group. The list endpoint applies a server-side
    /// HAVING COUNT(DISTINCT CompanyId) >= 2 filter so single-company
    /// groups are NOT included here (the existing per-company list
    /// continues to show those).
    /// </summary>
    public class CommonClientDto
    {
        public int GroupId { get; set; }
        public string DisplayName { get; set; } = "";
        public string? NTN { get; set; }
        public int CompanyCount { get; set; }

        /// <summary>
        /// Names of every Company that has a member in this group —
        /// surfaces "this client exists in Hakimi + Roshan" right on
        /// the card without an extra round-trip.
        /// </summary>
        public List<string> CompanyNames { get; set; } = new();

        /// <summary>
        /// Convenience: the Client.Id belonging to the importing
        /// company, if any. Null when the importing company has no
        /// member in the group (cross-tenant peek). Lets the UI
        /// "Edit as common client" button pre-fill from the right row.
        /// </summary>
        public int? ThisCompanyClientId { get; set; }
    }

    /// <summary>
    /// Detail view for a single common client — used by the edit form.
    /// All master fields propagate to every member (including Site,
    /// because operators repeatedly hit the "I added sites under one
    /// company but the other tenant's record was empty" papercut and
    /// expected sites to follow the legal entity, not the tenant).
    /// </summary>
    public class CommonClientDetailDto
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

        /// <summary>
        /// Master site list — semicolon-separated. Pre-filled from
        /// whichever member's Site is the longest at load time so the
        /// operator never starts with a blank list when at least one
        /// tenant has sites configured. On save propagates to every
        /// member, overwriting per-tenant variations (the Members
        /// section below shows the per-tenant "before" state so they
        /// can sanity-check what's about to change).
        /// </summary>
        public string? Site { get; set; }

        /// <summary>
        /// Per-company member breakdown — read-only "before" view of
        /// each tenant's site list, so the operator can confirm what
        /// the cascade is about to overwrite.
        /// </summary>
        public List<CommonClientMemberDto> Members { get; set; } = new();
    }

    public class CommonClientMemberDto
    {
        public int ClientId { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public string? Site { get; set; }
        public bool HasInvoices { get; set; }
    }

    /// <summary>
    /// Update payload from the Common Client edit form. Every field
    /// here propagates to every member Client across all companies.
    /// Site is included on purpose — operators kept hitting the
    /// "I configured sites under one tenant and they didn't show up
    /// for the other" papercut, and sites are master data of the
    /// BUYER (their physical departments), not of the seller tenant.
    /// </summary>
    public class CommonClientUpdateDto
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
    /// Response after a Common Client update — surfaces the cascade
    /// summary so the UI can show "X clients in Y companies updated".
    /// </summary>
    public class CommonClientUpdateResultDto
    {
        public int GroupId { get; set; }
        public int ClientsUpdated { get; set; }
        public List<string> AffectedCompanyNames { get; set; } = new();
    }

    /// <summary>
    /// Multi-company create payload. The "New Client" form sends one of
    /// these instead of a single ClientDto so that one form submission
    /// can populate the same client under multiple companies in a single
    /// transaction. Every created row inherits the same <see cref="ClientDto"/>
    /// fields and is auto-linked to the same <see cref="ClientGroup"/>
    /// via the runtime EnsureGroup path — so the new client appears in the
    /// Common Clients panel immediately if the operator picked 2+ companies.
    /// </summary>
    public class CreateClientBatchDto
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

        /// <summary>
        /// One or more CompanyIds — one Client row is created per id.
        /// Empty list is rejected by the controller. Duplicate-name
        /// collisions (a client with this name already exists in one
        /// of the target companies) are surfaced via
        /// <see cref="CreateClientBatchResultDto.SkippedReasons"/>.
        /// </summary>
        public List<int> CompanyIds { get; set; } = new();
    }

    /// <summary>
    /// Result of a multi-company create. Reports which Client rows were
    /// created, which companies were skipped (and why), and the shared
    /// <see cref="ClientGroup"/> id so the UI can deep-link straight
    /// into the Common Client edit form.
    /// </summary>
    public class CreateClientBatchResultDto
    {
        public List<ClientDto> Created { get; set; } = new();
        public List<string> SkippedReasons { get; set; } = new();
        public int? ClientGroupId { get; set; }
    }
}
