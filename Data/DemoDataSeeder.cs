using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Populates a freshly-migrated DeliveryChallanDemo database with ~6
    /// months of believable activity (one company, 8 clients, 5 suppliers,
    /// challans, bills, purchases, FBR-submitted invoices with fake-but-
    /// formatted IRNs). Triggered ONLY when ASPNETCORE_ENVIRONMENT=Demo so
    /// dev / production databases are never touched.
    ///
    /// Idempotent: marks success via an AuditLog row keyed by
    /// <see cref="MarkerKey"/>; subsequent boots short-circuit. Same
    /// one-shot pattern <see cref="ItemTypeSeeder"/> uses for the auto-
    /// seed guard.
    ///
    /// Determinism: the random distribution is seeded with a fixed value
    /// so the dataset shape is reproducible across machines. The marker
    /// makes that moot in practice (we never re-seed an existing demo DB)
    /// but it removes a "why did demo X look different from demo Y"
    /// surprise if anyone ever resets the marker.
    /// </summary>
    public static class DemoDataSeeder
    {
        private const string MarkerKey = "DEMO_SEED_V1";

        public static async Task SeedAsync(AppDbContext ctx)
        {
            var alreadyDone = await ctx.AuditLogs
                .AsNoTracking()
                .AnyAsync(a => a.ExceptionType == MarkerKey);
            if (alreadyDone) return;

            // Fixed seed → reproducible demo data shape across machines.
            var rng = new Random(42);

            // Wrap the whole seed in a transaction so a failure mid-way
            // leaves an empty DB rather than a half-seeded one that
            // re-runs would skip (because the marker is the LAST write).
            await using var tx = await ctx.Database.BeginTransactionAsync();
            try
            {
                var company = await SeedCompanyAsync(ctx);
                var clients = await SeedClientsAsync(ctx, company.Id);
                var suppliers = await SeedSuppliersAsync(ctx, company.Id);
                var itemTypes = await ResolveItemTypesAsync(ctx);
                if (itemTypes.Count == 0)
                {
                    // ItemTypeSeeder didn't run yet for some reason — abort.
                    // The marker is NOT written so next boot retries.
                    await tx.RollbackAsync();
                    return;
                }

                await SeedOpeningStockAsync(ctx, company.Id, itemTypes);
                await SeedPurchaseBillsAsync(ctx, company, suppliers, itemTypes, rng);
                var challans = await SeedChallansAsync(ctx, company, clients, itemTypes, rng);
                await SeedInvoicesAsync(ctx, company, challans, rng);

                // Mark complete LAST — if any of the above threw, the catch
                // rolls back and the marker is not present, so a fixed
                // build can re-attempt cleanly.
                ctx.AuditLogs.Add(new AuditLog
                {
                    Level = "Info",
                    ExceptionType = MarkerKey,
                    Message = $"Demo data seeded for company {company.Id} ({company.Name}).",
                    HttpMethod = "STARTUP",
                    RequestPath = "/seed/demo",
                    StatusCode = 200,
                });
                await ctx.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                // Surface a failure trail in AuditLogs so the operator can
                // see what blew up. Done OUTSIDE the rolled-back tx so the
                // row survives.
                try
                {
                    ctx.ChangeTracker.Clear();
                    ctx.AuditLogs.Add(new AuditLog
                    {
                        Level = "Error",
                        ExceptionType = "DEMO_SEED_FAILED",
                        Message = "Demo data seed failed; see Serilog file sink for stack.",
                        HttpMethod = "STARTUP",
                        RequestPath = "/seed/demo",
                        StatusCode = 500,
                    });
                    await ctx.SaveChangesAsync();
                }
                catch { /* swallow */ }
                throw;
            }
        }

        // ─── Company ─────────────────────────────────────────────────
        private static async Task<Company> SeedCompanyAsync(AppDbContext ctx)
        {
            var existing = await ctx.Companies.FirstOrDefaultAsync(c => c.Name == "Demo Trading Co.");
            if (existing != null) return existing;

            var company = new Company
            {
                Name = "Demo Trading Co.",
                BrandName = "DEMO TRADING",
                FullAddress = "Plot 14, Sector 7-B, Korangi Industrial Area\nKarachi 74900, Pakistan",
                Phone = "+92-21-35067788",
                // Hakimi's sandbox-registered seller NTN. PRAL's sandbox
                // FBR token (set via Company Settings → FBR Token) is bound
                // to this NTN, so a synthetic NTN like "9999999-9" would
                // trip auth (0401). Display name still reads "Demo Trading
                // Co." everywhere — only the regulatory identifier matches
                // the working sandbox tenant.
                NTN = "4228937-8",
                STRN = "3277876175852",
                CNIC = null,
                StartingChallanNumber = 1000,
                CurrentChallanNumber = 1000,
                StartingInvoiceNumber = 2000,
                CurrentInvoiceNumber = 2000,
                InvoiceNumberPrefix = "DEMO-",
                StartingPurchaseBillNumber = 500,
                CurrentPurchaseBillNumber = 500,
                StartingGoodsReceiptNumber = 100,
                CurrentGoodsReceiptNumber = 100,
                FbrProvinceCode = 8,                                 // Sindh — per FBR /api/fbr/provinces
                // Activity + Sector MUST be exact tokens from
                // Services/Tax/TaxScenarios.cs (the constants ActWholesaler /
                // SecWholesale). Free-text like "Wholesale" / "Industrial
                // Supplies" doesn't match the (Activity × Sector) matrix
                // and every bill's scenario picker comes up empty —
                // operators then can't validate or submit on the demo.
                // Matches Hakimi's production setup verbatim.
                FbrBusinessActivity = "Wholesaler",
                FbrSector = "Wholesale / Retails",
                FbrEnvironment = "sandbox",
                FbrDefaultSaleType = "Goods at Standard Rate (default)",
                FbrDefaultUOM = "Numbers, pieces, units",
                FbrDefaultPaymentModeRegistered = "Credit",
                FbrDefaultPaymentModeUnregistered = "Cash",
                InventoryTrackingEnabled = true,
                StockGuardHardBlock = false,
                IsTenantIsolated = false,
            };
            ctx.Companies.Add(company);
            await ctx.SaveChangesAsync();
            return company;
        }

        // ─── Clients ─────────────────────────────────────────────────
        private record ClientSeed(string Name, string Address, string Phone, string? Ntn, string? Strn, string? Cnic, string RegistrationType);

        // NTNs / STRNs are real PRAL-sandbox-registered identifiers from the
        // operator's verified list (scripts/seed_fbr_scenarios.py). Display
        // names are intentionally fake/generic so the demo doesn't reveal
        // real customer relationships, but PRAL's STATL lookup needs an NTN
        // that's actually in its database — fake NTNs like "1234567-8"
        // would always fail [0205] / [0007] regardless of scenario.
        private static readonly ClientSeed[] ClientCatalog = new[]
        {
            // Registered buyers — map to verified NTNs from seed_fbr_scenarios.py
            new ClientSeed("ALPHA TEXTILES (Pvt) Ltd.",  "Plot 2-A, Site, Karachi",                 "+92-21-32569878", "0710818-04",      "02-03-2100-001-82", null,            "Registered"),
            new ClientSeed("BETA POLYMERS Industries",   "Plot 11, North Karachi Industrial Area",  "+92-21-36901234", "13-02-0676470-3", "02-16-6114-001-55", null,            "Registered"),
            new ClientSeed("EAGLE PACKAGING Co.",        "S.I.T.E. Phase II Extension",             "+92-21-32567845", "8655568-8",       "3277876354879",     null,            "Registered"),
            new ClientSeed("FALCON GARMENTS Ltd.",       "Korangi Creek Industrial Park",           "+92-21-35067123", "0676893-8",       "11-00-6001-010-73", null,            "Registered"),
            new ClientSeed("PIONEER STEEL Mills",        "Port Qasim Authority",                    "+92-21-34782211", "8826050-2",       "327787622231-3",    null,            "Registered"),
            new ClientSeed("ROYAL CONSTRUCTION Co.",     "Defence Phase 6, Karachi",                "+92-302-7778899", "36066672",        "1700360666711",     null,            "Registered"),
            // Unregistered buyers — for SN002 / SN026-028 (Unregistered scenarios
            // require buyerRegistrationType=Unregistered AND a buyer-side CNIC).
            new ClientSeed("CITY ENGINEERING Works",     "Shop 4, Korangi Road",                    "+92-300-2200345", "9999999-1",        null,                "4220199999991", "Unregistered"),
            new ClientSeed("ZENITH AUTO Parts",          "M.A. Jinnah Road",                        "+92-301-4445566", "8888888-1",        null,                "4220188888881", "Unregistered"),
        };

        private static async Task<List<Client>> SeedClientsAsync(AppDbContext ctx, int companyId)
        {
            var existing = await ctx.Clients.Where(c => c.CompanyId == companyId).ToListAsync();
            if (existing.Count >= ClientCatalog.Length) return existing;

            var existingNames = existing.Select(c => c.Name).ToHashSet();
            var toAdd = new List<Client>();
            foreach (var seed in ClientCatalog)
            {
                if (existingNames.Contains(seed.Name)) continue;
                toAdd.Add(new Client
                {
                    CompanyId = companyId,
                    Name = seed.Name,
                    Address = seed.Address,
                    Phone = seed.Phone,
                    NTN = seed.Ntn,
                    STRN = seed.Strn,
                    CNIC = seed.Cnic,                                 // required for SN002 / SN026-028 buyers
                    RegistrationType = seed.RegistrationType,
                    FbrProvinceCode = 8,                              // Sindh (matches FBR /api/fbr/provinces)
                });
            }
            if (toAdd.Count > 0)
            {
                ctx.Clients.AddRange(toAdd);
                await ctx.SaveChangesAsync();
            }
            return await ctx.Clients.Where(c => c.CompanyId == companyId).OrderBy(c => c.Id).ToListAsync();
        }

        // ─── Suppliers ───────────────────────────────────────────────
        private record SupplierSeed(string Name, string Address, string Phone, string Ntn, string Strn);

        private static readonly SupplierSeed[] SupplierCatalog = new[]
        {
            new SupplierSeed("NOMAN TRADERS",                "Shop 7, Bohri Bazaar, Karachi",      "+92-21-32314455", "7890123-4", "6789012345566"),
            new SupplierSeed("KARACHI HARDWARE House",       "M.A. Jinnah Road, Karachi",          "+92-21-32551122", "8901234-5", "7890123456677"),
            new SupplierSeed("SHAH BROS Industrial",         "Plot 88, S.I.T.E., Karachi",          "+92-21-32569988", "9012345-6", "8901234567788"),
            new SupplierSeed("BOLAN INDUSTRIAL Suppliers",   "F.B. Industrial Area",                "+92-21-36802233", "0123456-7", "9012345678899"),
            new SupplierSeed("NATIONAL FITTINGS",            "Korangi Road, Karachi",               "+92-21-35067766", "1112223-3", "1011121314151"),
        };

        private static async Task<List<Supplier>> SeedSuppliersAsync(AppDbContext ctx, int companyId)
        {
            var existing = await ctx.Suppliers.Where(s => s.CompanyId == companyId).ToListAsync();
            if (existing.Count >= SupplierCatalog.Length) return existing;

            var existingNames = existing.Select(s => s.Name).ToHashSet();
            var toAdd = new List<Supplier>();
            foreach (var seed in SupplierCatalog)
            {
                if (existingNames.Contains(seed.Name)) continue;
                toAdd.Add(new Supplier
                {
                    CompanyId = companyId,
                    Name = seed.Name,
                    Address = seed.Address,
                    Phone = seed.Phone,
                    NTN = seed.Ntn,
                    STRN = seed.Strn,
                    RegistrationType = "Registered",
                    FbrProvinceCode = 7,
                });
            }
            if (toAdd.Count > 0)
            {
                ctx.Suppliers.AddRange(toAdd);
                await ctx.SaveChangesAsync();
            }
            return await ctx.Suppliers.Where(s => s.CompanyId == companyId).OrderBy(s => s.Id).ToListAsync();
        }

        // ─── Item types (reference the ItemTypeSeeder rows; we don't add new ones) ───
        private static async Task<List<ItemType>> ResolveItemTypesAsync(AppDbContext ctx)
        {
            // Pull every non-deleted item type. The starter catalog from
            // ItemTypeSeeder (14 industrial / B2B rows) is what we want to
            // drive demo bills against; if it ever changes the demo just
            // picks up the new shape.
            return await ctx.ItemTypes
                .Where(it => !it.IsDeleted && it.HSCode != null && it.HSCode != "")
                .OrderBy(it => it.Id)
                .ToListAsync();
        }

        // ─── Opening stock (so dashboard isn't all-zero on first open) ───
        private static async Task SeedOpeningStockAsync(AppDbContext ctx, int companyId, List<ItemType> itemTypes)
        {
            var asOf = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            var toAdd = new List<OpeningStockBalance>();
            // 200 units of each integer-uom item, 100kg of each weight-uom item.
            // Generous opening balances so the operator doesn't trip the
            // stock-guard during a demo walk-through.
            foreach (var it in itemTypes)
            {
                var qty = string.Equals(it.UOM, "KG", StringComparison.OrdinalIgnoreCase) ? 100m
                        : string.Equals(it.UOM, "Meter", StringComparison.OrdinalIgnoreCase) ? 500m
                        : 200m;
                toAdd.Add(new OpeningStockBalance
                {
                    CompanyId = companyId,
                    ItemTypeId = it.Id,
                    Quantity = qty,
                    AsOfDate = asOf,
                    Notes = "Demo opening balance",
                });
            }
            ctx.OpeningStockBalances.AddRange(toAdd);
            await ctx.SaveChangesAsync();
        }

        // ─── Purchase bills (~15 over Jan-May 2026, with fake supplier IRNs) ───
        private static async Task SeedPurchaseBillsAsync(
            AppDbContext ctx, Company company, List<Supplier> suppliers,
            List<ItemType> itemTypes, Random rng)
        {
            var bills = new List<PurchaseBill>();
            var startDate = new DateTime(2026, 1, 5, 0, 0, 0, DateTimeKind.Utc);
            const int totalBills = 15;
            for (int i = 0; i < totalBills; i++)
            {
                var supplier = suppliers[i % suppliers.Count];
                var date = startDate.AddDays(i * 9 + rng.Next(0, 3));     // ~every 9-12 days
                var lineCount = 1 + rng.Next(0, 3);                       // 1-3 lines
                var items = new List<PurchaseItem>();
                decimal subtotal = 0m;
                for (int li = 0; li < lineCount; li++)
                {
                    var it = itemTypes[rng.Next(itemTypes.Count)];
                    var qty = string.Equals(it.UOM, "KG", StringComparison.OrdinalIgnoreCase) ? 5m + rng.Next(5, 30)
                            : string.Equals(it.UOM, "Meter", StringComparison.OrdinalIgnoreCase) ? 25m + rng.Next(0, 75)
                            : 10m + rng.Next(0, 90);
                    var unitPrice = 50m + (decimal)rng.Next(50, 950);
                    var lineTotal = Math.Round(qty * unitPrice, 2);
                    subtotal += lineTotal;
                    items.Add(new PurchaseItem
                    {
                        ItemTypeId = it.Id,
                        ItemTypeName = it.Name,
                        Description = it.Name,
                        Quantity = qty,
                        UOM = it.UOM ?? "Numbers, pieces, units",
                        UnitPrice = unitPrice,
                        LineTotal = lineTotal,
                        HSCode = it.HSCode,
                        SaleType = it.SaleType,
                    });
                }
                var gst = Math.Round(subtotal * 0.18m, 2);
                var grand = subtotal + gst;

                company.CurrentPurchaseBillNumber++;
                bills.Add(new PurchaseBill
                {
                    PurchaseBillNumber = company.CurrentPurchaseBillNumber,
                    Date = date,
                    CompanyId = company.Id,
                    SupplierId = supplier.Id,
                    SupplierBillNumber = $"INV-{2026000 + i:D4}",
                    SupplierIRN = FakeIrn(rng),
                    Subtotal = subtotal,
                    GSTRate = 18m,
                    GSTAmount = gst,
                    GrandTotal = grand,
                    AmountInWords = "",
                    DocumentType = 4,
                    PaymentMode = "Credit",
                    ReconciliationStatus = i % 5 == 0 ? "Pending" : "Matched",
                    Source = "manual",
                    Items = items,
                });
            }
            ctx.PurchaseBills.AddRange(bills);
            await ctx.SaveChangesAsync();
        }

        // ─── Challans (~40 over Jan-May 2026, varied status mix) ───
        private static async Task<List<DeliveryChallan>> SeedChallansAsync(
            AppDbContext ctx, Company company, List<Client> clients,
            List<ItemType> itemTypes, Random rng)
        {
            var challans = new List<DeliveryChallan>();
            var startDate = new DateTime(2026, 1, 10, 0, 0, 0, DateTimeKind.Utc);
            const int totalChallans = 40;
            for (int i = 0; i < totalChallans; i++)
            {
                var client = clients[rng.Next(clients.Count)];
                var date = startDate.AddDays(i * 3 + rng.Next(0, 3));   // ~every 3-5 days
                var lineCount = 1 + rng.Next(0, 5);                     // 1-5 lines
                var items = new List<DeliveryItem>();
                for (int li = 0; li < lineCount; li++)
                {
                    var it = itemTypes[rng.Next(itemTypes.Count)];
                    var qty = string.Equals(it.UOM, "KG", StringComparison.OrdinalIgnoreCase) ? 2m + rng.Next(1, 15)
                            : string.Equals(it.UOM, "Meter", StringComparison.OrdinalIgnoreCase) ? 10m + rng.Next(5, 30)
                            : 5m + rng.Next(0, 40);
                    items.Add(new DeliveryItem
                    {
                        ItemTypeId = it.Id,
                        Description = it.Name,
                        Quantity = qty,
                        Unit = it.UOM ?? "Numbers, pieces, units",
                    });
                }

                // Status mix: ~60% Pending (free to bill), ~5% Cancelled,
                // remainder marked Invoiced later when we attach an Invoice.
                // Setup Required happens automatically for clients without
                // a complete FBR profile but our seed clients all have NTN
                // so we manually inject a few to keep that screen non-empty.
                string status = "Pending";
                int dice = rng.Next(100);
                if (dice < 5) status = "Cancelled";
                else if (dice < 12) status = "Setup Required";
                // Else "Pending" — leaves it billable. Invoice attachment
                // below converts a slice of these to "Invoiced".

                company.CurrentChallanNumber++;
                challans.Add(new DeliveryChallan
                {
                    CompanyId = company.Id,
                    ChallanNumber = company.CurrentChallanNumber,
                    ClientId = client.Id,
                    PoNumber = $"PO-{260000 + i}",
                    PoDate = date.AddDays(-2),
                    DeliveryDate = date,
                    Site = client.Address?.Split('\n').FirstOrDefault(),
                    Status = status,
                    Items = items,
                });
            }
            ctx.DeliveryChallans.AddRange(challans);
            await ctx.SaveChangesAsync();
            return challans;
        }

        // ─── Invoices (~25, attached to a slice of the Pending challans) ───
        private static async Task SeedInvoicesAsync(
            AppDbContext ctx, Company company, List<DeliveryChallan> challans, Random rng)
        {
            // Bill 25 of the pending challans (out of ~33 pending). Walk
            // them in DeliveryDate order so invoice dates line up neatly.
            var billable = challans
                .Where(c => c.Status == "Pending")
                .OrderBy(c => c.DeliveryDate)
                .Take(25)
                .ToList();

            foreach (var dc in billable)
            {
                decimal subtotal = 0m;
                var invoiceItems = new List<InvoiceItem>();
                foreach (var di in dc.Items)
                {
                    var unitPrice = 75m + (decimal)rng.Next(100, 1500);
                    var lineTotal = Math.Round(di.Quantity * unitPrice, 2);
                    subtotal += lineTotal;
                    invoiceItems.Add(new InvoiceItem
                    {
                        DeliveryItemId = di.Id,
                        ItemTypeId = di.ItemTypeId,
                        ItemTypeName = di.Description,
                        Description = di.Description,
                        Quantity = di.Quantity,
                        UOM = di.Unit,
                        UnitPrice = unitPrice,
                        LineTotal = lineTotal,
                        HSCode = di.ItemType?.HSCode,
                        SaleType = "Goods at Standard Rate (default)",
                    });
                }
                var gst = Math.Round(subtotal * 0.18m, 2);
                var grand = subtotal + gst;

                company.CurrentInvoiceNumber++;
                var inv = new Invoice
                {
                    InvoiceNumber = company.CurrentInvoiceNumber,
                    Date = dc.DeliveryDate ?? DateTime.UtcNow,
                    CompanyId = company.Id,
                    ClientId = dc.ClientId,
                    Subtotal = subtotal,
                    GSTRate = 18m,
                    GSTAmount = gst,
                    GrandTotal = grand,
                    AmountInWords = "",
                    DocumentType = 4,
                    PaymentMode = "Credit",
                    FbrInvoiceNumber = $"DEMO-{company.CurrentInvoiceNumber}",
                    Items = invoiceItems,
                };

                // FBR status distribution: roughly half submitted with
                // believable IRNs, the rest in earlier funnel states.
                var fbrDice = rng.Next(100);
                if (fbrDice < 50)
                {
                    inv.FbrStatus = "Submitted";
                    inv.FbrIRN = FakeIrn(rng);
                    inv.FbrSubmittedAt = inv.Date.AddHours(2 + rng.Next(0, 18));
                }
                else if (fbrDice < 65)
                {
                    inv.FbrStatus = "Validated";
                }
                else if (fbrDice < 75)
                {
                    inv.FbrStatus = "Failed";
                    inv.FbrErrorMessage = "0099: invalid UoM for HS code (simulated).";
                }
                // else FbrStatus stays null → Draft on the UI

                // Link the challan via the invoice's navigation collection.
                // Setting dc.InvoiceId pre-save (or worse, dc.InvoiceId = 0)
                // triggers an UPDATE on the DC row with a non-existent FK
                // target and the SaveChanges blows up on FK_DeliveryChallans_
                // Invoices_InvoiceId. We use the navigation so EF infers the
                // FK from the saved invoice's identity post-insert.
                dc.Status = "Invoiced";
                inv.DeliveryChallans.Add(dc);

                ctx.Invoices.Add(inv);
                await ctx.SaveChangesAsync();   // populates inv.Id and dc.InvoiceId in one round-trip
            }
        }

        // ─── Helpers ─────────────────────────────────────────────────
        // FBR IRNs are 25-char alphanumeric tokens that begin with the
        // taxpayer's NTN. We use the demo company's NTN as the prefix so
        // the shape looks right but it's clearly synthetic.
        private static string FakeIrn(Random rng)
        {
            const string alphanum = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            var tail = new char[12];
            for (int i = 0; i < tail.Length; i++)
                tail[i] = alphanum[rng.Next(alphanum.Length)];
            return $"9999999DEMOIRN{new string(tail)}";
        }
    }
}
