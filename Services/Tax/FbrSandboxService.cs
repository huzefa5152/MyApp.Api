using System.Linq;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Tax
{
    /// <summary>
    /// Backend for the FBR Sandbox tab. Lets the operator click a button to
    /// auto-seed FBR scenario test bills for a company — without consuming
    /// the company's real bill / challan number range.
    ///
    /// Numbering isolation:
    ///   • Demo invoices use 900000 + (max-existing-demo + 1) per company.
    ///   • Demo challans use 900000 + (max-existing-demo + 1) per company.
    ///   • Company.CurrentInvoiceNumber / CurrentChallanNumber are NOT bumped
    ///     by demo creates. The regular Bills / Challans pages filter
    ///     IsDemo=true entirely (see InvoiceRepository / DeliveryChallanRepository).
    ///
    /// Scenario set is whatever TaxScenarios.GetApplicable returns for the
    /// company's BusinessActivity × Sector profile — so a wholesaler gets the
    /// 6-scenario set, a manufacturer-with-multiple-sectors gets more.
    /// </summary>
    public interface IFbrSandboxService
    {
        Task<List<SandboxBillDto>> ListAsync(int companyId);
        Task<SandboxSeedResult> SeedAsync(int companyId);
        Task<SandboxRunResult> ValidateAllAsync(int companyId);
        Task<SandboxRunResult> SubmitAllAsync(int companyId);
        Task<int> DeleteAllAsync(int companyId);
        Task<bool> DeleteOneAsync(int companyId, int billId);
    }

    public record SandboxBillDto(
        int Id,
        int InvoiceNumber,
        string ScenarioCode,
        string Description,
        decimal GrandTotal,
        string? FbrStatus,
        string? FbrIRN,
        string? FbrErrorMessage,
        string ClientName,
        DateTime CreatedAt
    );

    public record SandboxSeedResult(int Created, int Skipped, List<string> Notes);

    public record SandboxRunResult(int Passed, int Failed, List<SandboxRunRow> Rows);

    public record SandboxRunRow(string Scenario, int InvoiceNumber, bool Success, string? Message, string? IRN);

    public class FbrSandboxService : IFbrSandboxService
    {
        private readonly AppDbContext _db;
        private readonly IFbrService _fbr;
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly ITaxMappingEngine _taxEngine;

        // Legacy floor used when a company has tiny / unset starting numbers.
        // Companies that start lower than this still get demo bills in the
        // 900000+ range (visual cue that they're demo). Companies that
        // already use HIGHER numbering get a per-company adaptive floor —
        // see ComputeDemoFloor below.
        /// <summary>
        /// The commodity each scenario is ABOUT.
        ///
        /// A scenario fixes the SALE TYPE, and FBR cross-checks that against the
        /// HS code: it refuses a zero-rated line on goods that are not
        /// zero-rated [0052], and answers [0204] "sale type not match with
        /// provided scenario" when the two disagree. Seeding every scenario
        /// against one arbitrary catalog item — which this did, taking whatever
        /// <c>OrderBy(Id).First()</c> returned — therefore made nine of the
        /// eleven importer scenarios impossible to pass, whatever the company's
        /// configuration.
        ///
        /// A code that is absent from the tariff master falls back to the
        /// sample item's own, which is no worse than the old behaviour.
        /// </summary>
        /// <summary>
        /// The UoM FBR accepts for this HS code, from the local tariff master --
        /// via <c>TaxMappingEngine.GetValidUomsForHsCodeAsync</c>, the same
        /// resolver the Item Type form and the FBR pre-flight use, so the
        /// seeded fixture cannot disagree with the check that will judge it.
        ///
        /// Falls back to the sample item's UoM, then to pieces, so a code the
        /// master does not carry still seeds something.
        /// </summary>
        /// <summary>
        /// The demo item type for one scenario: its own HS code, its own FBR
        /// sale type, and the UoM that HS code accepts.
        ///
        /// Named "[DEMO] &lt;sale type&gt;" so it is recognisable in the catalog
        /// and reused across companies and reseeds rather than multiplying --
        /// ItemType is a global catalog (CLAUDE.md 5b-2b), so creating one per
        /// company per seed would pile up rows nobody can see afterwards.
        ///
        /// IsFavorite stays FALSE: these are fixtures, and a favourite would put
        /// them in every operator's document pickers.
        /// </summary>
        private async Task<ItemType?> GetOrCreateScenarioItemAsync(
            int companyId, TaxScenarios.Scenario sc, ItemType? sampleType)
        {
            var hsCode = ScenarioHsCodes.TryGetValue(sc.Code, out var scenarioHs)
                ? scenarioHs
                : (sampleType?.HSCode ?? "8481.8090");
            var (uom, fbrUom) = await ResolveUomAsync(
                companyId, hsCode, sampleType, ScenarioUoms.GetValueOrDefault(sc.Code));
            var name = $"[DEMO] {sc.SaleType}";

            var existing = await _db.ItemTypes
                .FirstOrDefaultAsync(t => t.Name == name && !t.IsDeleted);
            if (existing != null)
            {
                // A reseed after this fix must repair a fixture the old code
                // left with the wrong commodity or unit.
                existing.HSCode = hsCode;
                existing.UOM = uom;
                existing.FbrUOMId = fbrUom;
                existing.SaleType = sc.SaleType;
                await _db.SaveChangesAsync();
                return existing;
            }

            var created = new ItemType
            {
                Name = name,
                HSCode = hsCode,
                UOM = uom,
                FbrUOMId = fbrUom,
                SaleType = sc.SaleType,
                IsFavorite = false,
                CreatedAt = DateTime.UtcNow,
            };
            _db.ItemTypes.Add(created);
            await _db.SaveChangesAsync();
            return created;
        }

        private async Task<(string Uom, int? FbrUom)> ResolveUomAsync(
            int companyId, string hsCode, ItemType? sampleType, string? preferred = null)
        {
            // THE resolver (CLAUDE.md 5b-2: "There is exactly ONE place a UOM is
            // resolved") -- local master, then the company token, then the
            // installation reference token. Reading HsCode.Uom directly instead
            // was a second, worse path: 2829.1910 carries no unit in the local
            // master, so it fell back to pieces and FBR refused the line with
            // the pre-flight naming KG.
            var valid = await _taxEngine.GetValidUomsForHsCodeAsync(companyId, hsCode);
            var first = valid?.FirstOrDefault(u => preferred != null
                            && string.Equals(u.Description, preferred, StringComparison.OrdinalIgnoreCase))
                        ?? valid?.FirstOrDefault();
            if (first != null && !string.IsNullOrWhiteSpace(first.Description))
                return (first.Description, first.UOM_ID);

            // The valid list can come back EMPTY - one transient PRAL failure
            // while seeding is enough, and the pre-flight then answers the same
            // question successfully a moment later. Dropping the scenario's
            // STATED unit here is what seeds a bill FBR refuses: "Numbers,
            // pieces, units" is not valid for 2710.1942 (SN017) or 2829.1910
            // (SN022), both of which then had to be repaired by hand. A scenario
            // that states its unit knows it better than the generic default.
            //
            // The id is deliberately NULL, not 0: ResolveUomDesc prefers a set
            // FbrUOMId over the description, and null is its "unset" sentinel,
            // so submit-time resolution against the HS code fills it in.
            if (!string.IsNullOrWhiteSpace(preferred))
                return (preferred, null);

            return (sampleType?.UOM ?? "Numbers, pieces, units", sampleType?.FbrUOMId ?? 69);
        }

        /// <summary>
        /// The unit a scenario's rate is quoted in, where its rate is per-unit.
        ///
        /// FBR lists more than one valid UoM for some codes — 2710.1942 takes
        /// both KG and Liter — and taking the first is a coin flip on a scenario
        /// whose rate is "18% and Rs. 80 per Liter". Only stated where it
        /// matters; everything else keeps the first unit FBR names.
        /// </summary>
        private static readonly Dictionary<string, string> ScenarioUoms = new()
        {
            ["SN017"] = "Liter",
            ["SN022"] = "KG",
        };

        private static readonly Dictionary<string, string> ScenarioHsCodes = new()
        {
            ["SN001"] = "8481.8090",   // valves, standard rate
            ["SN002"] = "8481.8090",
            ["SN003"] = "7208.1000",   // steel
            ["SN004"] = "7208.1000",
            ["SN005"] = "8481.8090",   // reduced rate
            ["SN006"] = "1001.1900",   // wheat: genuinely exempt
            ["SN007"] = "1001.1900",   // and genuinely zero-rated
            ["SN008"] = "3401.1100",   // 3rd Schedule (soap)
            ["SN009"] = "5208.1100",   // textile
            ["SN010"] = "8517.1390",   // telecom
            ["SN011"] = "7208.1000",
            ["SN012"] = "2710.1210",   // petroleum
            ["SN013"] = "2716.0000",   // electricity
            ["SN015"] = "8517.1390",   // mobile phones
            ["SN016"] = "8481.8090",   // processing / conversion
            // NOT an ordinary FED good. "FED charged in ST mode" is the Federal
            // Excise Act's SECOND SCHEDULE, which holds three petroleum lines;
            // aerated waters, tobacco, ghee and cement are all refused [0052].
            ["SN017"] = "2710.1942",   // Petroleum Top Naphtha
            ["SN021"] = "2523.2100",   // white cement
            ["SN022"] = "2829.1910",   // potassium chlorates (national line)
            ["SN024"] = "8481.8090",   // SRO 297(I)/2023
            ["SN026"] = "8481.8090",
            ["SN027"] = "3401.1100",
            ["SN028"] = "0101.2100",
        };

        private const int DemoBaseNumber = 900000;

        // Buffer added on top of the company's StartingInvoiceNumber when
        // computing the demo floor. Keeps demo bills well above any
        // realistic growth in the real-bill range so they can never collide
        // even if the real counter slowly creeps up.
        private const int DemoStartBuffer = 900_000;

        // Buffer added on top of MAX(existing real bills) when computing
        // the demo floor — handles the case where a company started low
        // but has already accumulated many real bills.
        private const int DemoRealMaxBuffer = 100_000;

        public FbrSandboxService(
            AppDbContext db,
            IFbrService fbr,
            IInvoiceRepository invoiceRepo, ITaxMappingEngine taxEngine)
        {
            _db = db;
            _fbr = fbr;
            _invoiceRepo = invoiceRepo;
            _taxEngine = taxEngine;
        }

        // ── List ────────────────────────────────────────────────

        public async Task<List<SandboxBillDto>> ListAsync(int companyId)
        {
            var bills = await _db.Invoices
                .AsNoTracking()
                .Where(i => i.CompanyId == companyId && i.IsDemo)
                .Include(i => i.Client)
                .OrderByDescending(i => i.InvoiceNumber)
                .ToListAsync();

            return bills.Select(b =>
            {
                var sn = ExtractScenarioCode(b.PaymentTerms) ?? "";
                var desc = TaxScenarios.Find(sn)?.Description ?? "";
                return new SandboxBillDto(
                    Id: b.Id,
                    InvoiceNumber: b.InvoiceNumber,
                    ScenarioCode: sn,
                    Description: desc,
                    GrandTotal: b.GrandTotal,
                    FbrStatus: b.FbrStatus,
                    FbrIRN: b.FbrIRN,
                    FbrErrorMessage: b.FbrErrorMessage,
                    ClientName: b.Client?.Name ?? "",
                    CreatedAt: b.CreatedAt
                );
            }).ToList();
        }

        // ── Seed ────────────────────────────────────────────────

        public async Task<SandboxSeedResult> SeedAsync(int companyId)
        {
            var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId)
                ?? throw new KeyNotFoundException($"Company {companyId} not found.");

            var activities = TaxScenarios.SplitCsv(company.FbrBusinessActivity);
            var sectors    = TaxScenarios.SplitCsv(company.FbrSector);
            var applicable = TaxScenarios.GetApplicable(activities, sectors);

            // Existing demo bills for this company keyed by SN code.
            var existing = await _db.Invoices
                .Where(i => i.CompanyId == companyId && i.IsDemo)
                .Select(i => new { i.Id, i.PaymentTerms })
                .ToListAsync();
            var existingSns = new HashSet<string>(
                existing.Select(e => ExtractScenarioCode(e.PaymentTerms) ?? "")
                        .Where(s => !string.IsNullOrEmpty(s)),
                StringComparer.OrdinalIgnoreCase);

            // Each scenario expects a specific BuyerRegistrationType:
            //   • SN001 + most B2B scenarios  → Registered
            //   • SN002 (4 % further tax)     → Unregistered
            //   • SN026/SN027/SN028 retail    → Unregistered (end-consumer)
            // We DELIBERATELY don't reuse the company's real customer list
            // here — those are real customers and seeding scenarios against
            // them creates noise on their FBR record (and confuses operators
            // who scan the sandbox tab and see real names). Instead we
            // auto-provision two clearly-labelled demo clients with FBR-spec
            // sample NTNs, idempotent by name so re-seeds reuse them.
            const string DemoRegisteredName   = "[DEMO] FBR Sandbox Registered Buyer";
            const string DemoUnregisteredName = "[DEMO] FBR Sandbox Walk-in Customer";

            var demoClients = await _db.Clients
                .Where(c => c.CompanyId == companyId
                            && (c.Name == DemoRegisteredName || c.Name == DemoUnregisteredName))
                .ToListAsync();
            var registeredClient   = demoClients.FirstOrDefault(c => c.Name == DemoRegisteredName);
            var unregisteredClient = demoClients.FirstOrDefault(c => c.Name == DemoUnregisteredName);

            // PRAL's STATL check authoritatively determines the buyer's
            // RegistrationType from the NTN — a fake or placeholder NTN gets
            // classified Unregistered regardless of what we send in the
            // payload, producing 0053 / 0205 errors. So when provisioning
            // the demo clients, we copy NTN/STRN/Province from a REAL
            // Registered (or Unregistered) client on the company. The
            // demo client's NAME stays generic "[DEMO]…" so the operator
            // never sees a real customer name on a sandbox bill.
            var realRegistered = await _db.Clients
                .Where(c => c.CompanyId == companyId
                            && c.RegistrationType == "Registered"
                            && !c.Name.StartsWith("[DEMO]"))
                .OrderBy(c => c.Id)
                .FirstOrDefaultAsync();
            var realUnregistered = await _db.Clients
                .Where(c => c.CompanyId == companyId
                            && c.RegistrationType == "Unregistered"
                            && !c.Name.StartsWith("[DEMO]"))
                .OrderBy(c => c.Id)
                .FirstOrDefaultAsync();

            // PRAL's STATL decides the buyer's registration type from the
            // NUMBER, not from what we put in the payload, so the demo
            // registered buyer needs one STATL actually knows. A brand-new
            // company has no customers to borrow from, and the old fallback
            // then seeded FBR's spec sample number - which sanitises to the
            // perfectly well-formed but entirely fake 1000000, is classified
            // Unregistered, and fails EVERY registered scenario: [0053] on the
            // B2B ones and [0205] on SN001. That is not a per-company data
            // problem to fix by hand, so there is an installation-level
            // setting for it, the same pattern Fbr.ReferenceToken uses.
            var demoRegisteredNtn = await ResolveDemoRegisteredNtnAsync(realRegistered);

            if (registeredClient == null)
            {
                registeredClient = new Client
                {
                    CompanyId = companyId,
                    Name = DemoRegisteredName,
                    Address = realRegistered?.Address ?? "Karachi",
                    // A number STATL recognises as Registered, or the
                    // placeholder - which cannot file, and which the seed
                    // result says so about rather than leaving the operator
                    // to discover it one FBR rejection at a time.
                    NTN = demoRegisteredNtn ?? PlaceholderRegisteredNtn,
                    STRN = realRegistered?.STRN,
                    RegistrationType = "Registered",
                    FbrProvinceCode = realRegistered?.FbrProvinceCode
                                       ?? company.FbrProvinceCode ?? 8,
                };
                _db.Clients.Add(registeredClient);
                await _db.SaveChangesAsync();
            }
            else if (demoRegisteredNtn != null && !IsUsableRegisteredNtn(registeredClient.NTN))
            {
                // Self-heal: an earlier seed left an unfileable NTN on the demo
                // client. Tested on the VALUE rather than on the literal
                // placeholder, so a company seeded before this setting existed
                // is repaired by the next seed instead of staying broken.
                registeredClient.NTN = demoRegisteredNtn;
                registeredClient.STRN = realRegistered?.STRN ?? registeredClient.STRN;
                registeredClient.Address = realRegistered?.Address ?? registeredClient.Address;
                registeredClient.FbrProvinceCode = realRegistered?.FbrProvinceCode
                                                   ?? registeredClient.FbrProvinceCode;
                await _db.SaveChangesAsync();
            }

            if (unregisteredClient == null)
            {
                unregisteredClient = new Client
                {
                    CompanyId = companyId,
                    Name = DemoUnregisteredName,
                    Address = realUnregistered?.Address ?? "Karachi",
                    // Borrow a real Unregistered customer's CNIC when we
                    // have one — same STATL-mismatch reason as registered
                    // path. "9999999-1" + CNIC "4220199999991" is the
                    // historic fallback that has worked on PRAL sandbox
                    // for end-consumer scenarios (SN002 / SN026-028).
                    NTN = realUnregistered?.NTN ?? "9999999-1",
                    CNIC = realUnregistered?.CNIC ?? "4220199999991",
                    RegistrationType = "Unregistered",
                    FbrProvinceCode = realUnregistered?.FbrProvinceCode
                                       ?? company.FbrProvinceCode ?? 8,
                };
                _db.Clients.Add(unregisteredClient);
                await _db.SaveChangesAsync();
            }

            // Need an active demo ItemType so seeded items have HS Code + UOM.
            // Use any catalog item — the SN seeding overrides per-line as needed.
            var sampleItemType = await _db.ItemTypes
                .Where(t => t.HSCode != null && t.UOM != null && t.IsFavorite)
                .OrderBy(t => t.Id)
                .FirstOrDefaultAsync();

            int nextInvoiceNumber = await NextDemoInvoiceNumberAsync(companyId);
            int nextChallanNumber = await NextDemoChallanNumberAsync(companyId);

            var notes = new List<string>();
            if (demoRegisteredNtn == null)
            {
                notes.Add(
                    "WARNING: no NTN available for the demo registered buyer, so every " +
                    "Registered scenario will be refused by FBR ([0053], and [0205] on SN001). " +
                    "This company has no registered customer to borrow one from. Set the " +
                    $"installation setting {SandboxRegisteredBuyerNtnKey} to an NTN that FBR's " +
                    "STATL lists as Registered, then seed again - the demo buyer repairs itself.");
            }
            int created = 0, skipped = 0;
            int day = 0;

            foreach (var sc in applicable)
            {
                if (existingSns.Contains(sc.Code))
                {
                    skipped++;
                    continue;
                }

                // Pick the right buyer for the scenario's expected reg type.
                // "Any" defaults to Registered (the more common B2B case).
                var clientForScenario = sc.BuyerRegistrationType == "Unregistered"
                    ? unregisteredClient
                    : registeredClient;

                // An item type OF ITS OWN per scenario. The line's SaleType is
                // not enough: FbrService resolves a line's sale type through the
                // ITEM TYPE, so eleven bills sharing one standard-rate item all
                // filed as standard rate and FBR answered [0204] "sale type not
                // match with provided scenario" for the nine that are not.
                var scenarioItem = await GetOrCreateScenarioItemAsync(company.Id, sc, sampleItemType);

                var (challan, invoice) = await BuildScenarioPairAsync(
                    company, clientForScenario, scenarioItem ?? sampleItemType, sc,
                    nextChallanNumber++, nextInvoiceNumber++, day++);

                _db.DeliveryChallans.Add(challan);
                await _db.SaveChangesAsync();

                // Wire challan-id back into invoice-side delivery items
                foreach (var ii in invoice.Items)
                    ii.DeliveryItemId = challan.Items.FirstOrDefault()?.Id;

                _db.Invoices.Add(invoice);
                await _db.SaveChangesAsync();

                challan.InvoiceId = invoice.Id;
                challan.Status = "Invoiced";
                await _db.SaveChangesAsync();

                created++;
                notes.Add($"[{sc.Code}] Demo bill #{invoice.InvoiceNumber} created.");
            }

            return new SandboxSeedResult(created, skipped, notes);
        }

        // ── Run (validate / submit) ─────────────────────────────

        /// <summary>
        /// FBR's V1.12 sample buyer NTN. It sanitises to 1000000, which is
        /// well-formed and unknown to STATL - so it files, and is then refused.
        /// </summary>
        private const string PlaceholderRegisteredNtn = "1000000000000";

        /// <summary>
        /// Installation-wide NTN used for the seeded demo registered buyer when
        /// the company has no registered customer of its own. Installation
        /// scope, not tenant scope, on purpose: copying one tenant's customer
        /// number into another tenant's client list would be a cross-tenant
        /// leak, and this value is test configuration rather than anyone's data.
        /// </summary>
        public const string SandboxRegisteredBuyerNtnKey = "Fbr.SandboxRegisteredBuyerNtn";

        /// <summary>
        /// Whether this NTN can file as a Registered buyer. Cannot prove STATL
        /// knows it - only FBR can - but it rejects the two shapes that are
        /// certain to fail: an unusable number, and the spec placeholder.
        /// </summary>
        private static bool IsUsableRegisteredNtn(string? ntn)
        {
            if (string.IsNullOrWhiteSpace(ntn)) return false;
            if (FbrBuyerIdentity.Digits(ntn) == PlaceholderRegisteredNtn) return false;
            var (value, error) = FbrBuyerIdentity.Resolve(ntn, null, registered: true);
            return error == null && value.Length == 7;
        }

        /// <summary>
        /// The NTN to give the demo registered buyer: this company's own
        /// registered customer first, else the installation setting, else null
        /// (the caller warns rather than seeding a set that cannot pass).
        /// </summary>
        private async Task<string?> ResolveDemoRegisteredNtnAsync(Client? realRegistered)
        {
            if (IsUsableRegisteredNtn(realRegistered?.NTN)) return realRegistered!.NTN;

            var configured = (await _db.SystemSettings.AsNoTracking()
                .FirstOrDefaultAsync(x => x.Key == SandboxRegisteredBuyerNtnKey))?.Value;
            return IsUsableRegisteredNtn(configured) ? configured!.Trim() : null;
        }

        public Task<SandboxRunResult> ValidateAllAsync(int companyId)
            => RunAllAsync(companyId, isSubmit: false);

        public Task<SandboxRunResult> SubmitAllAsync(int companyId)
            => RunAllAsync(companyId, isSubmit: true);

        private async Task<SandboxRunResult> RunAllAsync(int companyId, bool isSubmit)
        {
            var bills = await _db.Invoices
                .AsNoTracking()
                .Where(i => i.CompanyId == companyId && i.IsDemo)
                .OrderBy(i => i.InvoiceNumber)
                .ToListAsync();

            var rows = new List<SandboxRunRow>();
            int passed = 0, failed = 0;
            foreach (var b in bills)
            {
                var sn = ExtractScenarioCode(b.PaymentTerms) ?? "";
                var result = isSubmit
                    ? await _fbr.SubmitInvoiceAsync(b.Id, sn)
                    : await _fbr.ValidateInvoiceAsync(b.Id, sn);
                if (result.Success) passed++; else failed++;
                rows.Add(new SandboxRunRow(
                    Scenario: sn,
                    InvoiceNumber: b.InvoiceNumber,
                    Success: result.Success,
                    Message: result.ErrorMessage,
                    IRN: result.IRN
                ));
            }
            return new SandboxRunResult(passed, failed, rows);
        }

        // ── Delete ──────────────────────────────────────────────

        public async Task<int> DeleteAllAsync(int companyId)
        {
            var demoBills = await _db.Invoices
                .Where(i => i.CompanyId == companyId && i.IsDemo)
                .Include(i => i.DeliveryChallans)
                    .ThenInclude(dc => dc.Items)
                .Include(i => i.Items)
                .ToListAsync();
            int dropped = 0;
            foreach (var b in demoBills)
            {
                if (await DeleteOneAsync(companyId, b.Id)) dropped++;
            }
            return dropped;
        }

        public async Task<bool> DeleteOneAsync(int companyId, int billId)
        {
            var bill = await _db.Invoices
                .Include(i => i.DeliveryChallans)
                    .ThenInclude(dc => dc.Items)
                .Include(i => i.Items)
                .FirstOrDefaultAsync(i => i.Id == billId && i.CompanyId == companyId && i.IsDemo);
            if (bill == null) return false;

            // Wipe items first, then bill, then any associated demo challans
            // (which only this bill referenced — demo challans are 1:1 with
            // their seeded bill, no shared usage).
            _db.InvoiceItems.RemoveRange(bill.Items);
            var demoChallans = bill.DeliveryChallans.Where(dc => dc.IsDemo).ToList();
            _db.Invoices.Remove(bill);
            foreach (var dc in demoChallans)
            {
                _db.DeliveryItems.RemoveRange(dc.Items);
                _db.DeliveryChallans.Remove(dc);
            }
            await _db.SaveChangesAsync();
            return true;
        }

        // ── Helpers ─────────────────────────────────────────────

        // Computes the demo-numbering floor for a company so demo bills are
        // guaranteed to land ABOVE any realistic real-bill number — even
        // for companies that start their real numbering at 950000 or higher.
        //
        // The floor is the max of three values:
        //   1. DemoBaseNumber              — legacy 900000 (visual cue for
        //                                    fresh / low-numbering companies)
        //   2. StartingInvoiceNumber + buf — protects companies whose real
        //                                    range starts in the 900000+
        //                                    zone (e.g. start = 950K → demo
        //                                    floor = 1.85M)
        //   3. MAX(real bills) + buf       — protects companies that started
        //                                    low but have grown into a high
        //                                    range (e.g. start = 10K with
        //                                    1.5M real bills → demo floor
        //                                    = 1.6M)
        // Demo bills then increment from there, never colliding with real
        // bill numbering regardless of what range the operator chose.
        private async Task<int> ComputeDemoInvoiceFloorAsync(int companyId)
        {
            var company = await _db.Companies.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == companyId);
            var startingFloor = (company?.StartingInvoiceNumber ?? 0) + DemoStartBuffer;

            var realMax = await _db.Invoices
                .AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo)
                .MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;
            var realMaxFloor = realMax + DemoRealMaxBuffer;

            return Math.Max(DemoBaseNumber, Math.Max(startingFloor, realMaxFloor));
        }

        private async Task<int> ComputeDemoChallanFloorAsync(int companyId)
        {
            var company = await _db.Companies.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == companyId);
            var startingFloor = (company?.StartingChallanNumber ?? 0) + DemoStartBuffer;

            var realMax = await _db.DeliveryChallans
                .AsNoTracking()
                .Where(dc => dc.CompanyId == companyId && !dc.IsDemo)
                .MaxAsync(dc => (int?)dc.ChallanNumber) ?? 0;
            var realMaxFloor = realMax + DemoRealMaxBuffer;

            return Math.Max(DemoBaseNumber, Math.Max(startingFloor, realMaxFloor));
        }

        private async Task<int> NextDemoInvoiceNumberAsync(int companyId)
        {
            var floor = await ComputeDemoInvoiceFloorAsync(companyId);
            var demoMax = await _db.Invoices
                .AsNoTracking()
                .Where(i => i.CompanyId == companyId && i.IsDemo)
                .MaxAsync(i => (int?)i.InvoiceNumber) ?? (floor - 1);
            return Math.Max(floor, demoMax + 1);
        }

        private async Task<int> NextDemoChallanNumberAsync(int companyId)
        {
            var floor = await ComputeDemoChallanFloorAsync(companyId);
            var demoMax = await _db.DeliveryChallans
                .AsNoTracking()
                .Where(dc => dc.CompanyId == companyId && dc.IsDemo)
                .MaxAsync(dc => (int?)dc.ChallanNumber) ?? (floor - 1);
            return Math.Max(floor, demoMax + 1);
        }

        private static string? ExtractScenarioCode(string? paymentTerms)
        {
            if (string.IsNullOrWhiteSpace(paymentTerms)) return null;
            var m = System.Text.RegularExpressions.Regex.Match(
                paymentTerms, @"\[\s*(SN\d{3})\s*\]",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return m.Success ? m.Groups[1].Value.ToUpperInvariant() : null;
        }

        // Not static any more: the UoM has to be resolved from the tariff master
        // per HS code (see ResolveUomAsync), which needs the DbContext.
        private async Task<(DeliveryChallan challan, Invoice invoice)> BuildScenarioPairAsync(
            Company company, Client client, ItemType? sampleType,
            TaxScenarios.Scenario sc,
            int challanNumber, int invoiceNumber, int dayOffset)
        {
            // The scenario fixes the sale type; the COMMODITY has to match it
            // or FBR refuses the pair (see ScenarioHsCodes). The UoM then has to
            // match the commodity -- 1001.1900 takes KG, 8481.8090 takes pieces
            // -- so it is resolved from the HS code rather than inherited from
            // whatever sample item happened to be picked.
            var hsCode = ScenarioHsCodes.TryGetValue(sc.Code, out var scenarioHs)
                ? scenarioHs
                : (sampleType?.HSCode ?? "8481.8090");
            var (uom, fbrUom) = await ResolveUomAsync(
                company.Id, hsCode, sampleType, ScenarioUoms.GetValueOrDefault(sc.Code));
            var qty    = 1;
            var unit   = sc.IsThirdSchedule ? 100m : 1000m;
            var lineTotal = qty * unit;

            // Per-scenario tweaks for FBR-correctness:
            //  • SN028 reduced rate: line uses retail-priced math the canonical
            //    sample documented (rate 1 %, MRP 100, line 99.01).
            //  • SN008 / SN027 3rd-Schedule: retail price = line total.
            decimal? retailPrice = null;
            if (sc.IsThirdSchedule) retailPrice = lineTotal;
            if (sc.Code == "SN028")
            {
                hsCode = "0101.2100";
                qty = 1; unit = 99.01m; lineTotal = 99.01m; retailPrice = 100m;
            }

            var challan = new DeliveryChallan
            {
                CompanyId = company.Id,
                ChallanNumber = challanNumber,
                ClientId = client.Id,
                PoNumber = $"{sc.Code}-DEMO-{DateTime.UtcNow:yyMMddHHmmss}",
                PoDate = DateTime.UtcNow.Date.AddDays(-dayOffset),
                DeliveryDate = DateTime.UtcNow.Date.AddDays(-dayOffset),
                Status = "Pending",
                IsDemo = true,
                Items = new List<DeliveryItem>
                {
                    new DeliveryItem
                    {
                        Description = $"[{sc.Code}] Demo line — {sc.Description}",
                        Quantity = qty,
                        Unit = uom,
                        ItemTypeId = sampleType?.Id,
                    }
                }
            };

            var subtotal = lineTotal;
            var gstAmount = Math.Round(subtotal * sc.DefaultRate / 100m, 2);
            var grandTotal = subtotal + gstAmount;

            var invoice = new Invoice
            {
                InvoiceNumber = invoiceNumber,
                Date = DateTime.UtcNow.Date,
                CompanyId = company.Id,
                ClientId = client.Id,
                Subtotal = subtotal,
                GSTRate = sc.DefaultRate,
                GSTAmount = gstAmount,
                GrandTotal = grandTotal,
                AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                PaymentTerms = $"[{sc.Code}] {sc.Description}",
                DocumentType = 4,                                  // Sale Invoice
                PaymentMode = sc.IsEndConsumerRetail ? "Cash" : "Credit",
                FbrInvoiceNumber = string.IsNullOrEmpty(company.InvoiceNumberPrefix)
                    ? invoiceNumber.ToString()
                    : $"{company.InvoiceNumberPrefix}{invoiceNumber}",
                IsDemo = true,
                Items = new List<InvoiceItem>
                {
                    new InvoiceItem
                    {
                        ItemTypeId = sampleType?.Id,
                        ItemTypeName = sampleType?.Name ?? "",
                        Description = $"[{sc.Code}] Demo line — {sc.Description}",
                        Quantity = qty,
                        UOM = uom,
                        UnitPrice = unit,
                        LineTotal = lineTotal,
                        HSCode = hsCode,
                        FbrUOMId = fbrUom,
                        SaleType = sc.SaleType,
                        FixedNotifiedValueOrRetailPrice = retailPrice,
                        SroScheduleNo = sc.DefaultSroScheduleNo,
                        SroItemSerialNo = sc.DefaultSroItemSerialNo,
                    }
                }
            };

            return (challan, invoice);
        }
    }
}
