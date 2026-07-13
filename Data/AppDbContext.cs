using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    public class AppDbContext : DbContext
    {
        private readonly IFbrTokenProtector? _fbrTokenProtector;

        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        // Audit C-1 (2026-05-13): preferred constructor — when DI can
        // supply IFbrTokenProtector, the Company.FbrToken column is
        // transparently encrypted on write / decrypted on read via the
        // value converter wired up in OnModelCreating. Falls back to the
        // parameterless constructor (plaintext) when called from tooling
        // (migrations / design-time) that doesn't have the protector.
        public AppDbContext(DbContextOptions<AppDbContext> options, IFbrTokenProtector fbrTokenProtector)
            : base(options)
        {
            _fbrTokenProtector = fbrTokenProtector;
        }

        public DbSet<Company> Companies { get; set; }
        public DbSet<Division> Divisions { get; set; }
        public DbSet<DeliveryChallan> DeliveryChallans { get; set; }
        public DbSet<DeliveryItem> DeliveryItems { get; set; }

        // ── Sales Quote + Sales Order module (additive, pre-sale documents) ──
        public DbSet<SalesQuote> SalesQuotes { get; set; }
        public DbSet<SalesQuoteItem> SalesQuoteItems { get; set; }
        public DbSet<SalesOrder> SalesOrders { get; set; }
        public DbSet<SalesOrderItem> SalesOrderItems { get; set; }

        // ── Withholding Tax Receipts (customer-issued tax certificates) ──
        // Single-amount sales-side document; per-customer sum feeds the
        // "Withholding tax receivable" column on the Customers screen.
        public DbSet<WithholdingTaxReceipt> WithholdingTaxReceipts { get; set; }

        // ── Payments / Receipts (AR/AP subledger — design §11.5, additive) ──
        // Receipt (money in) + Payment (money out) documents and their
        // allocation lines, which settle invoices/bills and drive balance-due +
        // payment status. No GL dependency in Phase A.
        public DbSet<MyApp.Api.Models.Accounting.Payment> Payments { get; set; }
        public DbSet<MyApp.Api.Models.Accounting.PaymentAllocation> PaymentAllocations { get; set; }

        // ── Chart of Accounts (design §4) — the account dimension postings land
        // on. AccountGroup = structural container (statement tree); Account =
        // postable / control account fed by a subledger.
        public DbSet<MyApp.Api.Models.Accounting.AccountGroup> AccountGroups { get; set; }
        public DbSet<MyApp.Api.Models.Accounting.Account> Accounts { get; set; }

        // ── General Ledger (Phase B posting engine — design §11.1, additive) ──
        // One balanced JournalEntry per source document (or manual journal),
        // Dr/Cr detail in JournalLines. All account balances are live queries
        // over these rows; nothing is denormalized.
        public DbSet<MyApp.Api.Models.Accounting.JournalEntry> JournalEntries { get; set; }
        public DbSet<MyApp.Api.Models.Accounting.JournalLine> JournalLines { get; set; }

        // ── Inter-account transfers (bank↔cash movement, no contact) ──
        public DbSet<MyApp.Api.Models.Accounting.AccountTransfer> AccountTransfers { get; set; }

        // ── Bank reconciliation snapshots (Phase 3) ──
        public DbSet<MyApp.Api.Models.Accounting.BankReconciliation> BankReconciliations { get; set; }

        // ── Bank statement import staging (Phase 2) ──
        public DbSet<MyApp.Api.Models.Accounting.BankStatementImport> BankStatementImports { get; set; }
        public DbSet<MyApp.Api.Models.Accounting.BankStatementLine> BankStatementLines { get; set; }

        // ── Unified attachments + document folders (additive) ──
        // One Attachment row per uploaded file (bytes on disk). A Folder is a
        // per-company named container; an attachment may also/instead be linked
        // to a business document via (EntityType, EntityId). Used by both the
        // Configuration → Folders library and the reusable attachment component.
        public DbSet<Folder> Folders { get; set; }
        public DbSet<Attachment> Attachments { get; set; }

        public DbSet<Client> Clients { get; set; } // ✅ add this
        public DbSet<ClientGroup> ClientGroups { get; set; }

        public DbSet<Invoice> Invoices { get; set; }
        public DbSet<InvoiceItem> InvoiceItems { get; set; }
        // 2026-05-11: dual-book overlay for invoice-mode tweaks. Keeps
        // the printed bill at real qty/price while the FBR-side claim
        // math reads the adjusted values. See InvoiceItemAdjustment.cs.
        public DbSet<InvoiceItemAdjustment> InvoiceItemAdjustments { get; set; }
        public DbSet<ItemDescription> ItemDescriptions { get; set; }
        public DbSet<Unit> Units { get; set; }
        public DbSet<ItemType> ItemTypes { get; set; }
        // Per-company GL-account shortcut line items (Freight, Discount, …) —
        // NOT stock, NOT FBR. Mirrors Manager.io's "Non-inventory Items".
        public DbSet<NonInventoryItem> NonInventoryItems { get; set; }
        // Per-(company, item-type) inventory policy overrides + reorder level
        // (2026-07 inventory V2 redesign). ItemType is a global catalog with no
        // CompanyId, so per-company tracking policy must live here.
        public DbSet<CompanyItemTypeSetting> CompanyItemTypeSettings { get; set; }
        public DbSet<User> Users { get; set; }
        public DbSet<PrintTemplate> PrintTemplates { get; set; }
        public DbSet<MergeField> MergeFields { get; set; }
        public DbSet<AuditLog> AuditLogs { get; set; }
        // Audit H-3 (2026-05-08): dedicated FBR communication log so the
        // FBR sync trail is queryable without sifting through general
        // audit noise. Wires up in OnModelCreating below.
        public DbSet<FbrCommunicationLog> FbrCommunicationLogs { get; set; }
        public DbSet<FbrLookup> FbrLookups { get; set; }
        public DbSet<POFormat> POFormats { get; set; }
        public DbSet<POFormatVersion> POFormatVersions { get; set; }
        public DbSet<POGoldenSample> POGoldenSamples { get; set; }
        // Audit / archive of every PO PDF the parser sees. Side-effect only;
        // the parser flow doesn't read this back. Stored bytes live on disk
        // under Data/uploads/po_imports — see PoImportArchive.StoredPath.
        public DbSet<PoImportArchive> PoImportArchives { get; set; }

        // RBAC
        public DbSet<Permission> Permissions { get; set; }
        public DbSet<Role> Roles { get; set; }
        public DbSet<RolePermission> RolePermissions { get; set; }
        public DbSet<UserRole> UserRoles { get; set; }
        public DbSet<UserCompany> UserCompanies { get; set; }
        public DbSet<UserDivision> UserDivisions { get; set; }

        // Purchase + Inventory module
        public DbSet<Supplier> Suppliers { get; set; }
        public DbSet<SupplierGroup> SupplierGroups { get; set; }
        public DbSet<PurchaseBill> PurchaseBills { get; set; }
        public DbSet<PurchaseItem> PurchaseItems { get; set; }
        public DbSet<PurchaseItemSourceLine> PurchaseItemSourceLines { get; set; }
        public DbSet<GoodsReceipt> GoodsReceipts { get; set; }
        public DbSet<GoodsReceiptItem> GoodsReceiptItems { get; set; }
        public DbSet<StockMovement> StockMovements { get; set; }
        public DbSet<OpeningStockBalance> OpeningStockBalances { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // Audit C-1 (2026-05-13): transparent encryption for the
            // PRAL bearer token. Reads decrypt the stored payload,
            // writes encrypt the operator-typed value. When DI didn't
            // hand us a protector (design-time / migrations / tests)
            // we skip the converter so EF can still inspect the model.
            if (_fbrTokenProtector != null)
            {
                var protector = _fbrTokenProtector;
                modelBuilder.Entity<Company>()
                    .Property(c => c.FbrToken)
                    .HasConversion(
                        plain => protector.Protect(plain),
                        stored => protector.Unprotect(stored));
            }

            modelBuilder.Entity<AuditLog>()
                .HasIndex(a => a.Timestamp);

            // Dedup lookup index — paired (Fingerprint, Timestamp DESC)
            // so AuditLogService.LogAsync can find recent matches in one
            // seek. Filtered to non-null fingerprints to keep the index
            // narrow on legacy rows that pre-date H-8.
            modelBuilder.Entity<AuditLog>()
                .HasIndex(a => new { a.Fingerprint, a.Timestamp })
                .HasFilter("[Fingerprint] IS NOT NULL");

            modelBuilder.Entity<AuditLog>()
                .HasIndex(a => a.CompanyId)
                .HasFilter("[CompanyId] IS NOT NULL");

            // FbrCommunicationLog — primary lookup paths:
            //   • Latest N for one company (monitor page top)
            //   • All for one invoice (drill-through from invoice list)
            //   • Status-filtered for the failed-queue retry view
            modelBuilder.Entity<FbrCommunicationLog>()
                .HasIndex(f => new { f.CompanyId, f.Timestamp })
                .IsDescending(false, true);
            modelBuilder.Entity<FbrCommunicationLog>()
                .HasIndex(f => f.InvoiceId)
                .HasFilter("[InvoiceId] IS NOT NULL");
            modelBuilder.Entity<FbrCommunicationLog>()
                .HasIndex(f => new { f.CompanyId, f.Status });

            // Unique index on Username
            modelBuilder.Entity<User>()
                .HasIndex(u => u.Username)
                .IsUnique();

            // Seed default admin user (password: admin123)
            // Pre-computed BCrypt hash to avoid dynamic value in HasData
            // SecurityStamp is seeded to a deterministic zeroed value;
            // first real login / password change rotates it.
            modelBuilder.Entity<User>().HasData(new User
            {
                Id = 1,
                Username = "admin",
                PasswordHash = "$2a$11$ITxobMb6Kk7r4cjBAN3tF.U2x5q/PpaueP/1dvUSr6V0N5z724cuu",
                FullName = "Administrator",
                Role = "Admin",
                CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                SecurityStamp = "00000000000000000000000000000000"
            });

            // SecurityStamp column type — 64 char max (32-char compact
            // hex stamp leaves headroom). Audit C-6 (2026-05-13).
            modelBuilder.Entity<User>()
                .Property(u => u.SecurityStamp)
                .HasMaxLength(64)
                .IsRequired();

            // Delete Items when a DeliveryChallan is deleted
            modelBuilder.Entity<DeliveryChallan>()
                .HasMany(dc => dc.Items)
                .WithOne(i => i.DeliveryChallan)
                .HasForeignKey(i => i.DeliveryChallanId)
                .OnDelete(DeleteBehavior.Cascade);

            // Delete DeliveryChallans when a Company is deleted
            modelBuilder.Entity<DeliveryChallan>()
                .HasOne(dc => dc.Company)
                .WithMany(c => c.DeliveryChallans)
                .HasForeignKey(dc => dc.CompanyId)
                .OnDelete(DeleteBehavior.Cascade);

            // Client belongs to Company (no cascade to avoid multiple cascade paths)
            modelBuilder.Entity<Client>()
                .HasOne(c => c.Company)
                .WithMany(co => co.Clients)
                .HasForeignKey(c => c.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);

            // ── Client → ClientGroup (Common Clients grouping) ──
            // Nullable FK so existing rows stay valid until the one-time
            // backfill assigns them. SetNull on group delete so removing
            // the group row doesn't orphan / cascade-delete clients —
            // they keep working as ungrouped per-company records.
            modelBuilder.Entity<Client>()
                .HasOne(c => c.ClientGroup)
                .WithMany(g => g.Clients)
                .HasForeignKey(c => c.ClientGroupId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<Client>()
                .HasIndex(c => c.ClientGroupId);

            // ── ClientGroup unique key + lookup indexes ──
            // GroupKey is the canonical "NTN:..." or "NAME:..." string —
            // unique because the service is the single writer and finds-
            // or-creates by this value.
            modelBuilder.Entity<ClientGroup>()
                .HasIndex(g => g.GroupKey)
                .IsUnique();
            // NormalizedNtn — used for "find group for this NTN" on every
            // Client save and PO match. Not unique (a name-only group has
            // null NTN; multiple null-NTN groups can coexist).
            modelBuilder.Entity<ClientGroup>()
                .HasIndex(g => g.NormalizedNtn);
            // NormalizedName — fallback lookup when NTN is missing.
            modelBuilder.Entity<ClientGroup>()
                .HasIndex(g => g.NormalizedName);

            // ── POFormat → ClientGroup ──
            // Group-bound formats — applies to every member of the group
            // regardless of which tenant the PDF arrived from. Nullable
            // because legacy formats use POFormat.ClientId only.
            modelBuilder.Entity<POFormat>()
                .HasOne(f => f.ClientGroup)
                .WithMany(g => g.POFormats)
                .HasForeignKey(f => f.ClientGroupId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<POFormat>()
                .HasIndex(f => f.ClientGroupId);

            // DeliveryChallan status default
            modelBuilder.Entity<DeliveryChallan>()
                .Property(dc => dc.Status)
                .HasDefaultValue("Pending");

            // DeliveryChallan -> Invoice (optional FK, restrict delete)
            modelBuilder.Entity<DeliveryChallan>()
                .HasOne(dc => dc.Invoice)
                .WithMany(i => i.DeliveryChallans)
                .HasForeignKey(dc => dc.InvoiceId)
                .OnDelete(DeleteBehavior.Restrict);

            // Invoice -> Company (restrict to avoid multiple cascade paths)
            modelBuilder.Entity<Invoice>()
                .HasOne(i => i.Company)
                .WithMany(c => c.Invoices)
                .HasForeignKey(i => i.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);

            // Invoice -> Client (restrict)
            modelBuilder.Entity<Invoice>()
                .HasOne(i => i.Client)
                .WithMany()
                .HasForeignKey(i => i.ClientId)
                .OnDelete(DeleteBehavior.Restrict);

            // Invoice -> OriginalInvoice (self-reference for Credit/Debit Notes).
            // NoAction: never cascade a delete from the original into its notes
            // (and notes are the trailing rows anyway). Optional FK.
            modelBuilder.Entity<Invoice>()
                .HasOne(i => i.OriginalInvoice)
                .WithMany()
                .HasForeignKey(i => i.OriginalInvoiceId)
                .OnDelete(DeleteBehavior.NoAction);

            // Invoice -> InvoiceItems (cascade)
            modelBuilder.Entity<InvoiceItem>()
                .HasOne(ii => ii.Invoice)
                .WithMany(i => i.Items)
                .HasForeignKey(ii => ii.InvoiceId)
                .OnDelete(DeleteBehavior.Cascade);

            // InvoiceItem -> DeliveryItem (optional, set null on delete)
            modelBuilder.Entity<InvoiceItem>()
                .HasOne(ii => ii.DeliveryItem)
                .WithMany()
                .HasForeignKey(ii => ii.DeliveryItemId)
                .OnDelete(DeleteBehavior.SetNull);

            // ── Sales Order lineage on the bill (2026-07 inventory redesign) ──
            // Header + line pointers to the Sales Order this bill fulfils.
            // Both nullable, NoAction (no cascade path — SalesOrder->Company is
            // Restrict, Invoice->Company is Restrict), keyless nav (query by the
            // scalar FK). Enables the derived read model's "to deliver =
            // ordered − delivered − directly-invoiced" and reservation release.
            modelBuilder.Entity<Invoice>()
                .HasOne<SalesOrder>()
                .WithMany()
                .HasForeignKey(i => i.SalesOrderId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<InvoiceItem>()
                .HasOne<SalesOrderItem>()
                .WithMany()
                .HasForeignKey(ii => ii.SalesOrderItemId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);

            // DeliveryChallan -> Client (optional FK, restrict delete)
            modelBuilder.Entity<DeliveryChallan>()
                .HasOne(dc => dc.Client)
                .WithMany(c => c.DeliveryChallans)
                .HasForeignKey(dc => dc.ClientId)
                .OnDelete(DeleteBehavior.Restrict);

            // DeliveryChallan -> DeliveryChallan (self-FK for "Duplicate")
            // Restrict delete so a parent isn't accidentally erased while
            // copies still exist; the parent stays in place if a copy is
            // removed.
            modelBuilder.Entity<DeliveryChallan>()
                .HasOne(dc => dc.DuplicatedFrom)
                .WithMany()
                .HasForeignKey(dc => dc.DuplicatedFromId)
                .OnDelete(DeleteBehavior.Restrict);

            // Performance indexes on frequently-queried foreign keys
            modelBuilder.Entity<Invoice>()
                .HasIndex(i => i.ClientId);

            modelBuilder.Entity<Invoice>()
                .HasIndex(i => i.CompanyId);

            // Credit Notes (10) and Debit Notes (9) each number from their
            // OWN sequence, separate from sale invoices and from each other.
            // NoteKind is a PERSISTED computed discriminator so the uniqueness
            // below can be scoped per kind without SQL Server's filtered-index
            // limitations (no IN/OR in filter predicates).
            modelBuilder.Entity<Invoice>()
                .Property(i => i.NoteKind)
                .HasComputedColumnSql(
                    "CASE WHEN [DocumentType] = 9 THEN CAST(1 AS tinyint) WHEN [DocumentType] = 10 THEN CAST(2 AS tinyint) ELSE CAST(0 AS tinyint) END",
                    stored: true);

            // Composite index for paged invoice queries (WHERE CompanyId = X ORDER BY InvoiceNumber DESC).
            // Audit C-8 (2026-05-13): unique so two concurrent creates can't
            // both land MAX+1 - the loser gets a SQL 2601 / 2627 which the
            // service catches and retries (next number is re-read in the
            // retry loop). MERGED 2026-07-03: numbering is scoped per
            // (company, division, document kind) - a division-tagged bill
            // draws from the division's own sequence ((X, NULL, 1) vs
            // (X, div5, 1)), and Credit Note #1 / Debit Note #1 / sale bill #1
            // coexist via NoteKind. HasFilter(null) keeps NULL-division rows
            // covered by the unique guard too. Mirrors SalesQuote.
            modelBuilder.Entity<Invoice>()
                .HasIndex(i => new { i.CompanyId, i.DivisionId, i.NoteKind, i.InvoiceNumber })
                .IsUnique()
                .HasFilter(null);

            // Invoice -> Division (optional).
            // NoAction (not SetNull): several documents reach a division by more
            // than one path (e.g. Division->Challan and Division->SalesOrder->Challan),
            // which SQL Server rejects as multiple cascade paths (error 1785).
            // DivisionService.DeleteAsync unlinks referencing documents in app code.
            modelBuilder.Entity<Invoice>()
                .HasOne(i => i.Division).WithMany()
                .HasForeignKey(i => i.DivisionId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);

            // One LIVE note PER TYPE per original invoice, enforced in the DB
            // (the service's AnyAsync guard alone is check-then-insert racy —
            // two concurrent Reverse clicks could both pass). A credit note
            // (return) and a debit note (upward correction) may legitimately
            // coexist on one invoice; two live credit notes may not (FBR 0064).
            // Filtered to non-cancelled rows so voiding a note frees the slot.
            modelBuilder.Entity<Invoice>()
                .HasIndex(i => new { i.OriginalInvoiceId, i.DocumentType })
                .IsUnique()
                .HasFilter("[OriginalInvoiceId] IS NOT NULL AND [IsCancelled] = 0");

            modelBuilder.Entity<DeliveryChallan>()
                .HasIndex(dc => dc.ClientId);
            modelBuilder.Entity<DeliveryChallan>()
                .HasOne(dc => dc.Division).WithMany()
                .HasForeignKey(dc => dc.DivisionId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);

            modelBuilder.Entity<DeliveryChallan>()
                .HasIndex(dc => dc.CompanyId);

            modelBuilder.Entity<DeliveryChallan>()
                .HasIndex(dc => dc.InvoiceId);

            // Composite index on (CompanyId, ChallanNumber) — kept NON-UNIQUE
            // intentionally so the "Duplicate Challan" feature can insert
            // multiple rows sharing the same number for a single company.
            // Uniqueness is no longer a hard invariant — the create/import
            // flows enforce "unique on create" in the service layer; the
            // duplicate flow bypasses that check by design.
            //
            // The old DB had a unique variant of this index (created out-of-
            // band, not from any source migration). The
            // 20260504*_DropLegacyUniqueChallanNumberIndex migration drops
            // that legacy index before this non-unique one is created.
            // Includes DivisionId so the per-division challan sequence groups
            // correctly. STILL NON-UNIQUE by design (Duplicate Challan emits
            // same-number rows).
            modelBuilder.Entity<DeliveryChallan>()
                .HasIndex(dc => new { dc.CompanyId, dc.DivisionId, dc.ChallanNumber });

            modelBuilder.Entity<InvoiceItem>()
                .HasIndex(ii => ii.InvoiceId);

            modelBuilder.Entity<InvoiceItem>()
                .HasIndex(ii => ii.DeliveryItemId);

            // ── InvoiceItemAdjustment — dual-book overlay (2026-05-11) ─
            // One-to-zero-or-one with InvoiceItem. Cascade on InvoiceItem
            // delete (overlay can't outlive its anchor). Unique on
            // InvoiceItemId so we never end up with two competing
            // overlays for the same line. InvoiceId is denormalized +
            // indexed so "all overlays for invoice X" is a single seek.
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .HasOne(a => a.InvoiceItem)
                .WithOne(ii => ii.Adjustment)
                .HasForeignKey<InvoiceItemAdjustment>(a => a.InvoiceItemId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .HasIndex(a => a.InvoiceItemId)
                .IsUnique();
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .HasIndex(a => a.InvoiceId);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.AdjustedQuantity).HasPrecision(18, 4);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.AdjustedUnitPrice).HasPrecision(18, 2);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.AdjustedLineTotal).HasPrecision(18, 2);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.AdjustedItemTypeName).HasMaxLength(300);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.AdjustedDescription).HasMaxLength(1000);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.AdjustedUOM).HasMaxLength(50);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.AdjustedHSCode).HasMaxLength(20);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.AdjustedSaleType).HasMaxLength(100);
            modelBuilder.Entity<InvoiceItemAdjustment>()
                .Property(a => a.Reason).HasMaxLength(64).HasDefaultValue("tax-claim-optimization");

            // Decimal precision for money columns
            modelBuilder.Entity<Invoice>().Property(i => i.Subtotal).HasPrecision(18, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GSTRate).HasPrecision(5, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GSTAmount).HasPrecision(18, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GrandTotal).HasPrecision(18, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.AmountPaid).HasPrecision(18, 2);
            modelBuilder.Entity<InvoiceItem>().Property(ii => ii.UnitPrice).HasPrecision(18, 2);
            modelBuilder.Entity<InvoiceItem>().Property(ii => ii.LineTotal).HasPrecision(18, 2);

            // Quantity columns — decimal(18,4) so fractional UOMs (KG, Liter,
            // Carat) carry up to 4 places. Money is 2 places; quantity gets
            // 2 extra so e.g. 0.0004 Carat survives the round-trip.
            modelBuilder.Entity<InvoiceItem>().Property(ii => ii.Quantity).HasPrecision(18, 4);
            modelBuilder.Entity<DeliveryItem>().Property(di => di.Quantity).HasPrecision(18, 4);

            // Optional: make ItemDescription.Name and Unit.Name unique
            modelBuilder.Entity<ItemDescription>()
                .HasIndex(i => i.Name)
                .IsUnique();

            modelBuilder.Entity<Unit>()
                .HasIndex(u => u.Name)
                .IsUnique();

            // Composite uniqueness on (Name, HSCode) — operators legitimately
            // want "Hardware Items" with HS X and "Hardware Items" with HS Y
            // as two separate catalog rows (each maps to a different FBR
            // line on bills). SQL Server treats NULL as equal-to-NULL for
            // unique purposes, so (Hardware Items, NULL) is still
            // single-instance — two rows with no HS code and the same name
            // remain blocked, matching the operator's expectation.
            //
            // Filtered to IsDeleted = 0 so a soft-deleted ItemType never
            // blocks re-creating the same (Name, HSCode) pair later.
            modelBuilder.Entity<ItemType>()
                .HasIndex(it => new { it.Name, it.HSCode })
                .IsUnique()
                .HasFilter("[IsDeleted] = 0");

            // ── Non-Inventory Items (per-company GL-account shortcut lines) ──
            // Company Restrict (a company's non-inv items can't cascade-wipe).
            // Both Account FKs are Restrict/NoAction: two SET NULL FKs from the
            // same table to Accounts trip SQL Server's multiple-cascade-paths
            // guard (1785). A mapped account therefore can't be deleted while a
            // non-inv item references it — consistent with accounts carrying
            // ledger history. Posting still falls back to Suspense when the FK is
            // null (unmapped) or the account is inactive.
            modelBuilder.Entity<NonInventoryItem>()
                .HasOne(n => n.Company).WithMany()
                .HasForeignKey(n => n.CompanyId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<NonInventoryItem>()
                .HasOne(n => n.SaleAccount).WithMany()
                .HasForeignKey(n => n.SaleAccountId).IsRequired(false).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<NonInventoryItem>()
                .HasOne(n => n.PurchaseAccount).WithMany()
                .HasForeignKey(n => n.PurchaseAccountId).IsRequired(false).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<NonInventoryItem>().Property(n => n.Name).HasMaxLength(150);
            modelBuilder.Entity<NonInventoryItem>().Property(n => n.Code).HasMaxLength(60);
            modelBuilder.Entity<NonInventoryItem>().Property(n => n.UnitName).HasMaxLength(50);
            modelBuilder.Entity<NonInventoryItem>().Property(n => n.DefaultLineDescription).HasMaxLength(1000);
            modelBuilder.Entity<NonInventoryItem>().Property(n => n.ExternalRef).HasMaxLength(80);
            modelBuilder.Entity<NonInventoryItem>().Property(n => n.DefaultSalePrice).HasPrecision(18, 2);
            modelBuilder.Entity<NonInventoryItem>().Property(n => n.DefaultPurchasePrice).HasPrecision(18, 2);
            // One item per (company, name). Names don't collide across companies.
            modelBuilder.Entity<NonInventoryItem>()
                .HasIndex(n => new { n.CompanyId, n.Name }).IsUnique();

            // Line → NonInventoryItem (optional, Restrict: a non-inv item with
            // historical lines can't be hard-deleted — the service soft-disables
            // via IsActive instead). Plus the "at most one of ItemType /
            // NonInventoryItem per line" guard as a DB CHECK — defence in depth
            // behind the service-layer validation.
            modelBuilder.Entity<InvoiceItem>()
                .HasOne(ii => ii.NonInventoryItem).WithMany()
                .HasForeignKey(ii => ii.NonInventoryItemId).IsRequired(false).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<InvoiceItem>().HasIndex(ii => ii.NonInventoryItemId);
            modelBuilder.Entity<InvoiceItem>()
                .ToTable(t => t.HasCheckConstraint("CK_InvoiceItem_OneItemRef",
                    "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL"));

            modelBuilder.Entity<PurchaseItem>()
                .HasOne(pi => pi.NonInventoryItem).WithMany()
                .HasForeignKey(pi => pi.NonInventoryItemId).IsRequired(false).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<PurchaseItem>().HasIndex(pi => pi.NonInventoryItemId);
            modelBuilder.Entity<PurchaseItem>()
                .ToTable(t => t.HasCheckConstraint("CK_PurchaseItem_OneItemRef",
                    "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL"));

            modelBuilder.Entity<SalesQuoteItem>()
                .HasOne(qi => qi.NonInventoryItem).WithMany()
                .HasForeignKey(qi => qi.NonInventoryItemId).IsRequired(false).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<SalesQuoteItem>().HasIndex(qi => qi.NonInventoryItemId);
            modelBuilder.Entity<SalesQuoteItem>()
                .ToTable(t => t.HasCheckConstraint("CK_SalesQuoteItem_OneItemRef",
                    "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL"));

            // Non-inventory refs on the remaining line entities (unified picker
            // everywhere). Same contract: Restrict FK, index, both-set CHECK.
            modelBuilder.Entity<SalesOrderItem>()
                .HasOne(oi => oi.NonInventoryItem).WithMany()
                .HasForeignKey(oi => oi.NonInventoryItemId).IsRequired(false).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<SalesOrderItem>().HasIndex(oi => oi.NonInventoryItemId);
            modelBuilder.Entity<SalesOrderItem>()
                .ToTable(t => t.HasCheckConstraint("CK_SalesOrderItem_OneItemRef",
                    "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL"));

            modelBuilder.Entity<DeliveryItem>()
                .HasOne(di => di.NonInventoryItem).WithMany()
                .HasForeignKey(di => di.NonInventoryItemId).IsRequired(false).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<DeliveryItem>().HasIndex(di => di.NonInventoryItemId);
            modelBuilder.Entity<DeliveryItem>()
                .ToTable(t => t.HasCheckConstraint("CK_DeliveryItem_OneItemRef",
                    "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL"));

            modelBuilder.Entity<GoodsReceiptItem>()
                .HasOne(gi => gi.NonInventoryItem).WithMany()
                .HasForeignKey(gi => gi.NonInventoryItemId).IsRequired(false).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<GoodsReceiptItem>().HasIndex(gi => gi.NonInventoryItemId);
            modelBuilder.Entity<GoodsReceiptItem>()
                .ToTable(t => t.HasCheckConstraint("CK_GoodsReceiptItem_OneItemRef",
                    "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL"));

            // PrintTemplate: multiple templates per (CompanyId, TemplateType), each
            // scoped to the company (DivisionId == null) or a division. Non-unique
            // lookup index drives scope-filtered reads.
            modelBuilder.Entity<PrintTemplate>()
                .HasIndex(pt => new { pt.CompanyId, pt.TemplateType, pt.DivisionId });

            // Exactly one default per (CompanyId, DivisionId, TemplateType) scope.
            // Filtered to IsDefault = 1. SQL Server treats NULL as equal-to-NULL for
            // unique purposes, so the company-level (DivisionId == null) scope is also
            // held to a single default — same pattern as the ItemType (Name, HSCode)
            // index above.
            modelBuilder.Entity<PrintTemplate>()
                .HasIndex(pt => new { pt.CompanyId, pt.DivisionId, pt.TemplateType })
                .IsUnique()
                .HasFilter("[IsDefault] = 1")
                .HasDatabaseName("UX_PrintTemplates_DefaultPerScope");

            modelBuilder.Entity<PrintTemplate>()
                .HasOne(pt => pt.Company)
                .WithMany()
                .HasForeignKey(pt => pt.CompanyId)
                .OnDelete(DeleteBehavior.Cascade);

            // Division scope FK. NoAction (not Cascade) is mandatory: Company->PrintTemplate
            // (Cascade) + Company->Division (Cascade) + a cascading Division->PrintTemplate
            // would be multiple cascade paths to PrintTemplates (SQL Server error 1785).
            // DivisionService.DeleteAsync removes a division's templates in app code instead.
            modelBuilder.Entity<PrintTemplate>()
                .HasOne(pt => pt.Division)
                .WithMany()
                .HasForeignKey(pt => pt.DivisionId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);

            modelBuilder.Entity<PrintTemplate>().Property(pt => pt.Name).HasMaxLength(200);

            // DeliveryItem -> ItemType (optional, restrict)
            modelBuilder.Entity<DeliveryItem>()
                .HasOne(di => di.ItemType)
                .WithMany()
                .HasForeignKey(di => di.ItemTypeId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            // ── Sales Quote + Sales Order module (additive) ──────────────────
            // Pre-sale documents. Quote is priced; Order is quantity-only.
            // Neither is an FBR document. Numbering is per-company (unique
            // index below) mirroring Invoice's (CompanyId, *Number) contract.

            // SalesQuote -> Company / Client (restrict — no cascade from masters)
            modelBuilder.Entity<SalesQuote>()
                .HasOne(q => q.Company).WithMany(c => c.SalesQuotes)
                .HasForeignKey(q => q.CompanyId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<SalesQuote>()
                .HasOne(q => q.Client).WithMany()
                .HasForeignKey(q => q.ClientId).OnDelete(DeleteBehavior.Restrict);
            // Optional Division tag. SetNull is safe here (unlike PrintTemplate)
            // because SalesQuote->Company is Restrict, so there's no second
            // cascade path to SalesQuotes — deleting a division just un-tags
            // its quotes (DivisionId -> null) rather than deleting them.
            modelBuilder.Entity<SalesQuote>()
                .HasOne(q => q.Division).WithMany()
                .HasForeignKey(q => q.DivisionId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<SalesQuoteItem>()
                .HasOne(i => i.SalesQuote).WithMany(q => q.Items)
                .HasForeignKey(i => i.SalesQuoteId).OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<SalesQuoteItem>()
                .HasOne(i => i.ItemType).WithMany()
                .HasForeignKey(i => i.ItemTypeId).IsRequired(false).OnDelete(DeleteBehavior.Restrict);

            // SalesOrder -> Company / Client (restrict)
            modelBuilder.Entity<SalesOrder>()
                .HasOne(o => o.Company).WithMany(c => c.SalesOrders)
                .HasForeignKey(o => o.CompanyId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<SalesOrder>()
                .HasOne(o => o.Client).WithMany()
                .HasForeignKey(o => o.ClientId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<SalesOrder>()
                .HasOne(o => o.Division).WithMany()
                .HasForeignKey(o => o.DivisionId).IsRequired(false).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<SalesOrderItem>()
                .HasOne(i => i.SalesOrder).WithMany(o => o.Items)
                .HasForeignKey(i => i.SalesOrderId).OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<SalesOrderItem>()
                .HasOne(i => i.ItemType).WithMany()
                .HasForeignKey(i => i.ItemTypeId).IsRequired(false).OnDelete(DeleteBehavior.Restrict);

            // Quote <-> Order cross-links: two independent nullable FKs between
            // the same pair of tables. Both NoAction to avoid a SET NULL /
            // cascade cycle (SQL Server error 1785). The service clears these
            // pointers before deleting either side.
            modelBuilder.Entity<SalesOrder>()
                .HasOne(o => o.SalesQuote).WithMany()
                .HasForeignKey(o => o.SalesQuoteId)
                .OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<SalesQuote>()
                .HasOne(q => q.ConvertedToSalesOrder).WithMany()
                .HasForeignKey(q => q.ConvertedToSalesOrderId)
                .OnDelete(DeleteBehavior.NoAction);

            // DeliveryChallan -> SalesOrder (optional; restrict so an order with
            // challans can't be deleted out from under them — the service guards
            // this explicitly with a clear message).
            modelBuilder.Entity<DeliveryChallan>()
                .HasOne(dc => dc.SalesOrder).WithMany(o => o.DeliveryChallans)
                .HasForeignKey(dc => dc.SalesOrderId)
                .OnDelete(DeleteBehavior.Restrict);
            // DeliveryItem -> SalesOrderItem (optional; restrict — a delivered
            // ordered line can't be removed while challan lines reference it).
            modelBuilder.Entity<DeliveryItem>()
                .HasOne(di => di.SalesOrderItem).WithMany(soi => soi.DeliveryItems)
                .HasForeignKey(di => di.SalesOrderItemId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            // Status defaults mirror DeliveryChallan's pattern.
            modelBuilder.Entity<SalesQuote>().Property(q => q.Status).HasDefaultValue("Draft");
            // MaxLength(50) so Status is indexable (see IX_SalesOrders_Co_Status).
            // Statuses are short code words ("Open", "Partially Delivered", …).
            modelBuilder.Entity<SalesOrder>().Property(o => o.Status).HasMaxLength(50).HasDefaultValue("Open");

            // Decimal precision — money (18,2), GST rate (5,2), quantity (18,4).
            modelBuilder.Entity<SalesQuote>().Property(q => q.Subtotal).HasPrecision(18, 2);
            modelBuilder.Entity<SalesQuote>().Property(q => q.GSTRate).HasPrecision(5, 2);
            modelBuilder.Entity<SalesQuote>().Property(q => q.GSTAmount).HasPrecision(18, 2);
            modelBuilder.Entity<SalesQuote>().Property(q => q.GrandTotal).HasPrecision(18, 2);
            modelBuilder.Entity<SalesQuoteItem>().Property(i => i.Quantity).HasPrecision(18, 4);
            modelBuilder.Entity<SalesQuoteItem>().Property(i => i.UnitPrice).HasPrecision(18, 2);
            modelBuilder.Entity<SalesQuoteItem>().Property(i => i.LineTotal).HasPrecision(18, 2);
            modelBuilder.Entity<SalesOrderItem>().Property(i => i.Quantity).HasPrecision(18, 4);

            // Unique numbering per (company, division). A division has its own
            // Sales Quote sequence, so two divisions (or a division and the
            // company-level scope) can legitimately reuse the same QuoteNumber —
            // uniqueness is therefore scoped by DivisionId. Company-level quotes
            // share DivisionId = NULL; SQL Server treats the tuple, so
            // (X, NULL, 1) and (X, NULL, 2) are distinct while (X, NULL, 1) twice
            // is blocked — exactly the per-scope numbering we want. Still guards
            // the concurrent-create race (loser retries on the unique violation).
            // HasFilter(null) overrides EF's default "WHERE [DivisionId] IS NOT
            // NULL" filter for unique indexes on nullable columns. We WANT the
            // index to cover company-level rows (DivisionId NULL) too, so that
            // scope keeps its (CompanyId, QuoteNumber) uniqueness + race guard.
            modelBuilder.Entity<SalesQuote>()
                .HasIndex(q => new { q.CompanyId, q.DivisionId, q.QuoteNumber }).IsUnique()
                .HasFilter(null);
            modelBuilder.Entity<SalesQuote>().HasIndex(q => q.ClientId);
            modelBuilder.Entity<SalesOrder>()
                .HasIndex(o => new { o.CompanyId, o.DivisionId, o.SalesOrderNumber }).IsUnique()
                .HasFilter(null);
            modelBuilder.Entity<SalesOrder>().HasIndex(o => o.ClientId);
            modelBuilder.Entity<DeliveryChallan>().HasIndex(dc => dc.SalesOrderId);
            modelBuilder.Entity<DeliveryItem>().HasIndex(di => di.SalesOrderItemId);

            // ── Withholding Tax Receipts ────────────────────────────────────
            // Company / Client restrict (a company or client with receipts
            // can't be silently deleted out from under them — the client
            // cascade unlinks them in app code). Division NoAction to avoid
            // multiple-cascade-path (SQL Server 1785), matching the other docs.
            modelBuilder.Entity<WithholdingTaxReceipt>()
                .HasOne(r => r.Company).WithMany()
                .HasForeignKey(r => r.CompanyId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<WithholdingTaxReceipt>()
                .HasOne(r => r.Client).WithMany()
                .HasForeignKey(r => r.ClientId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<WithholdingTaxReceipt>()
                .HasOne(r => r.Division).WithMany()
                .HasForeignKey(r => r.DivisionId).IsRequired(false).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<WithholdingTaxReceipt>().Property(r => r.Amount).HasPrecision(18, 2);
            // Unique numbering per (company, division) — a division has its own
            // receipt sequence; HasFilter(null) so NULL divisions collide too.
            modelBuilder.Entity<WithholdingTaxReceipt>()
                .HasIndex(r => new { r.CompanyId, r.DivisionId, r.ReceiptNumber }).IsUnique()
                .HasFilter(null);
            modelBuilder.Entity<WithholdingTaxReceipt>().HasIndex(r => r.ClientId);

            // ── Payments / Receipts (AR/AP subledger — design §11.5) ───────────
            // Payment header → Company (Restrict: a company's payment history
            // can't be cascade-wiped). Direction + ChequeStatus persist as int.
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .HasOne(p => p.Company).WithMany()
                .HasForeignKey(p => p.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .Property(p => p.Amount).HasPrecision(18, 2);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .Property(p => p.ContactType).HasMaxLength(20);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .Property(p => p.Method).HasMaxLength(30);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .Property(p => p.BankAccountName).HasMaxLength(120);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .Property(p => p.ChequeNumber).HasMaxLength(50);
            // Unique numbering per (company, direction): receipts and payments
            // each get their own gap-free sequence, and the loser of a concurrent
            // create retries on this violation (NumberAllocationRetry).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .HasIndex(p => new { p.CompanyId, p.Direction, p.Number }).IsUnique();
            // Optional Division tag. NoAction (not SetNull/Cascade): Company->Payment
            // is Restrict and Company->Division is Cascade, so a cascading
            // Division->Payment path would create multiple cascade paths. The app
            // (DivisionService.DeleteAsync) unlinks referencing rows instead.
            // Mirrors PurchaseBill/GoodsReceipt's Division FK.
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .HasOne(p => p.Division).WithMany()
                .HasForeignKey(p => p.DivisionId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);

            // Allocation line → Payment (Cascade: lines die with their document).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.PaymentAllocation>()
                .HasOne(a => a.Payment).WithMany(p => p.Allocations)
                .HasForeignKey(a => a.PaymentId)
                .OnDelete(DeleteBehavior.Cascade);
            // → Invoice / PurchaseBill (optional; Restrict so a settled document
            // can't be hard-deleted out from under its allocations — and to avoid
            // multiple cascade paths from Company. Deleting a payment unlinks via
            // the cascade above; the invoice/bill survives).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.PaymentAllocation>()
                .HasOne(a => a.Invoice).WithMany()
                .HasForeignKey(a => a.InvoiceId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.PaymentAllocation>()
                .HasOne(a => a.PurchaseBill).WithMany()
                .HasForeignKey(a => a.PurchaseBillId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.PaymentAllocation>()
                .Property(a => a.Amount).HasPrecision(18, 2);
            // AccountId (direct income/expense line) → Accounts, Restrict: an
            // account referenced by allocation lines can't be hard-deleted
            // (AccountService pre-checks and returns a friendly message). The
            // migration NULLs any dangling values before adding the constraint.
            modelBuilder.Entity<MyApp.Api.Models.Accounting.PaymentAllocation>()
                .HasOne<MyApp.Api.Models.Accounting.Account>().WithMany()
                .HasForeignKey(a => a.AccountId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);
            // Payment.BankAccountId → Accounts, Restrict (same rationale). The
            // migration backfills it from BankAccountName ↔ Account.Code (the
            // ETL stored the legacy GL code as the free-text name).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Payment>()
                .HasOne<MyApp.Api.Models.Accounting.Account>().WithMany()
                .HasForeignKey(p => p.BankAccountId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.PaymentAllocation>()
                .HasIndex(a => a.InvoiceId);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.PaymentAllocation>()
                .HasIndex(a => a.PurchaseBillId);

            // ── Chart of Accounts (design §4) ──────────────────────────────────
            // AccountGroup → Company (Restrict: a company's CoA can't be
            // cascade-wiped) and a self-FK for nesting (Restrict — a parent with
            // children is unlinked/emptied in app code, never cascade-deleted).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountGroup>()
                .HasOne(g => g.Company).WithMany()
                .HasForeignKey(g => g.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountGroup>()
                .HasOne(g => g.ParentGroup).WithMany()
                .HasForeignKey(g => g.ParentGroupId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountGroup>()
                .Property(g => g.Name).HasMaxLength(150);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountGroup>()
                .Property(g => g.ExternalRef).HasMaxLength(60);
            // Ordering scope: a company's groups by statement + position.
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountGroup>()
                .HasIndex(g => new { g.CompanyId, g.Statement, g.Position });

            // Account → Company (Restrict) and → AccountGroup (Restrict: can't
            // drop a group that still holds accounts; move them first).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Account>()
                .HasOne(a => a.Company).WithMany()
                .HasForeignKey(a => a.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Account>()
                .HasOne(a => a.AccountGroup).WithMany()
                .HasForeignKey(a => a.AccountGroupId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Account>()
                .Property(a => a.Name).HasMaxLength(150);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Account>()
                .Property(a => a.Code).HasMaxLength(40);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Account>()
                .Property(a => a.ExternalRef).HasMaxLength(60);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Account>()
                .Property(a => a.OpeningBalance).HasPrecision(19, 4);
            // Codes are optional but unique per company WHEN present (filtered
            // index). NO unique-name index — account names legitimately repeat.
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Account>()
                .HasIndex(a => new { a.CompanyId, a.Code })
                .IsUnique()
                .HasFilter("[Code] IS NOT NULL");
            modelBuilder.Entity<MyApp.Api.Models.Accounting.Account>()
                .HasIndex(a => a.AccountGroupId);

            // ── General Ledger (design §11.1) ──────────────────────────────────
            // Entry → Company Restrict (ledger history can't cascade away).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalEntry>()
                .HasOne(e => e.Company).WithMany()
                .HasForeignKey(e => e.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalEntry>()
                .Property(e => e.Narration).HasMaxLength(500);
            // JE-#### sequence per company (NumberAllocationRetry on collision).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalEntry>()
                .HasIndex(e => new { e.CompanyId, e.EntryNo }).IsUnique();
            // Idempotency: at most ONE entry per source document. Filtered so
            // manual journals (SourceDocId null) are exempt.
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalEntry>()
                .HasIndex(e => new { e.CompanyId, e.SourceDocType, e.SourceDocId })
                .IsUnique()
                .HasFilter("[SourceDocId] IS NOT NULL");
            // Balance queries filter (company, date-range) then group by account.
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalEntry>()
                .HasIndex(e => new { e.CompanyId, e.Date });

            // Line → Entry Cascade (detail dies with its entry); → Account
            // Restrict (an account with ledger history can't be hard-deleted —
            // AccountService pre-checks for a friendly message).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .HasOne(l => l.JournalEntry).WithMany(e => e.Lines)
                .HasForeignKey(l => l.JournalEntryId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .HasOne(l => l.Account).WithMany()
                .HasForeignKey(l => l.AccountId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .Property(l => l.Debit).HasPrecision(19, 4);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .Property(l => l.Credit).HasPrecision(19, 4);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .Property(l => l.PartyType).HasMaxLength(20);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .Property(l => l.Description).HasMaxLength(300);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .HasIndex(l => l.AccountId);
            // Party statements / control-account drill-down (soft refs, indexed).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .HasIndex(l => l.InvoiceId);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.JournalLine>()
                .HasIndex(l => l.PurchaseBillId);

            // ── Inter-account transfers ────────────────────────────────────────
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountTransfer>()
                .HasOne(t => t.Company).WithMany()
                .HasForeignKey(t => t.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            // Both account FKs Restrict + NO nav cascade: a bank/cash account
            // with transfer history can't be deleted (friendly pre-check in
            // AccountService).
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountTransfer>()
                .HasOne(t => t.FromAccount).WithMany()
                .HasForeignKey(t => t.FromAccountId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountTransfer>()
                .HasOne(t => t.ToAccount).WithMany()
                .HasForeignKey(t => t.ToAccountId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountTransfer>()
                .Property(t => t.Amount).HasPrecision(18, 2);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountTransfer>()
                .Property(t => t.Description).HasMaxLength(300);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.AccountTransfer>()
                .HasIndex(t => new { t.CompanyId, t.Number }).IsUnique();

            // ── Bank reconciliation snapshots ─────────────────────────────────
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankReconciliation>()
                .HasOne(r => r.Company).WithMany()
                .HasForeignKey(r => r.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankReconciliation>()
                .HasOne(r => r.BankAccount).WithMany()
                .HasForeignKey(r => r.BankAccountId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankReconciliation>()
                .Property(r => r.StatementBalance).HasPrecision(18, 2);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankReconciliation>()
                .Property(r => r.ClearedBalance).HasPrecision(18, 2);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankReconciliation>()
                .HasIndex(r => new { r.CompanyId, r.BankAccountId, r.StatementDate });

            // ── Bank statement import staging ─────────────────────────────────
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankStatementImport>()
                .HasOne(i => i.Company).WithMany()
                .HasForeignKey(i => i.CompanyId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankStatementImport>()
                .HasOne(i => i.BankAccount).WithMany()
                .HasForeignKey(i => i.BankAccountId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankStatementImport>()
                .Property(i => i.FileName).HasMaxLength(260);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankStatementLine>()
                .HasOne(l => l.Import).WithMany(i => i.Lines)
                .HasForeignKey(l => l.ImportId).OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankStatementLine>()
                .HasOne(l => l.BankAccount).WithMany()
                .HasForeignKey(l => l.BankAccountId).OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankStatementLine>()
                .Property(l => l.Amount).HasPrecision(18, 2);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankStatementLine>()
                .Property(l => l.Description).HasMaxLength(500);
            modelBuilder.Entity<MyApp.Api.Models.Accounting.BankStatementLine>()
                .HasIndex(l => new { l.CompanyId, l.BankAccountId, l.Status });

            // ── Data-migration traceability (design §13) ──────────────────────
            // ExternalRef carries the legacy source key on imported masters so the
            // ETL is idempotent (upsert/skip on re-run). Indexed per company.
            modelBuilder.Entity<Client>().Property(c => c.ExternalRef).HasMaxLength(60);
            modelBuilder.Entity<Client>().HasIndex(c => new { c.CompanyId, c.ExternalRef });
            modelBuilder.Entity<Supplier>().Property(s => s.ExternalRef).HasMaxLength(60);
            modelBuilder.Entity<Supplier>().HasIndex(s => new { s.CompanyId, s.ExternalRef });
            modelBuilder.Entity<Invoice>().Property(i => i.ExternalRef).HasMaxLength(60);
            modelBuilder.Entity<Invoice>().HasIndex(i => new { i.CompanyId, i.ExternalRef });
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.ExternalRef).HasMaxLength(60);
            modelBuilder.Entity<PurchaseBill>().HasIndex(pb => new { pb.CompanyId, pb.ExternalRef });

            // ── Unified attachments + document folders ──────────────────────
            // A Folder is a per-company named container. An Attachment is one
            // uploaded file (bytes on disk); it may belong to a folder and/or
            // be linked to a business document via (EntityType, EntityId).

            // Folder -> Company (cascade: a company's folders die with it).
            modelBuilder.Entity<Folder>()
                .HasOne(f => f.Company).WithMany()
                .HasForeignKey(f => f.CompanyId)
                .OnDelete(DeleteBehavior.Cascade);
            // Folder -> CreatedByUser (optional; NoAction so deleting a user
            // doesn't cascade-delete their folders).
            modelBuilder.Entity<Folder>()
                .HasOne(f => f.CreatedByUser).WithMany()
                .HasForeignKey(f => f.CreatedByUserId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<Folder>().Property(f => f.Name).HasMaxLength(200);
            modelBuilder.Entity<Folder>().Property(f => f.Description).HasMaxLength(1000);
            // Folder names unique within a company (case-insensitive via the
            // default SQL Server collation). Mirrors Division's (CompanyId, Name).
            modelBuilder.Entity<Folder>()
                .HasIndex(f => new { f.CompanyId, f.Name }).IsUnique();

            // Attachment -> Company (restrict — never cascade business files
            // away on a company delete; there's no other cascade path here so
            // this also keeps SQL Server clear of multiple-cascade-path errors).
            modelBuilder.Entity<Attachment>()
                .HasOne(a => a.Company).WithMany()
                .HasForeignKey(a => a.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            // Attachment -> Folder (optional; RESTRICT so FolderService.Delete
            // decides each file's fate — entity-linked ones are un-linked,
            // folder-only ones are deleted — rather than a blind DB cascade).
            modelBuilder.Entity<Attachment>()
                .HasOne(a => a.Folder).WithMany(f => f.Attachments)
                .HasForeignKey(a => a.FolderId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);
            // Attachment -> UploadedByUser (optional; NoAction).
            modelBuilder.Entity<Attachment>()
                .HasOne(a => a.UploadedByUser).WithMany()
                .HasForeignKey(a => a.UploadedByUserId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);
            // Attachment -> Division (optional; NoAction — SetNull/Cascade would
            // add a second cascade path from Company. DivisionService.DeleteAsync
            // unlinks in app code, same as the document DivisionId columns).
            modelBuilder.Entity<Attachment>()
                .HasOne(a => a.Division).WithMany()
                .HasForeignKey(a => a.DivisionId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);

            modelBuilder.Entity<Attachment>().Property(a => a.FileName).HasMaxLength(255);
            modelBuilder.Entity<Attachment>().Property(a => a.StoredFileName).HasMaxLength(100);
            modelBuilder.Entity<Attachment>().Property(a => a.StoragePath).HasMaxLength(500);
            modelBuilder.Entity<Attachment>().Property(a => a.ContentType).HasMaxLength(150);
            modelBuilder.Entity<Attachment>().Property(a => a.FileExtension).HasMaxLength(20);
            modelBuilder.Entity<Attachment>().Property(a => a.ContentSha256).HasMaxLength(64);
            modelBuilder.Entity<Attachment>().Property(a => a.EntityType).HasMaxLength(40);

            // Lookup paths: "all attachments in folder X" (tenant-scoped) and
            // "all attachments on SalesQuote 42".
            modelBuilder.Entity<Attachment>().HasIndex(a => new { a.CompanyId, a.FolderId });
            modelBuilder.Entity<Attachment>().HasIndex(a => new { a.EntityType, a.EntityId });

            // ── Company Divisions ──────────────────────────────────────────
            // Per-company named list (sub-brand / department). Cascade on
            // company delete; names unique within a company.
            modelBuilder.Entity<Division>()
                .HasOne(d => d.Company).WithMany()
                .HasForeignKey(d => d.CompanyId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<Division>().Property(d => d.Name).HasMaxLength(200);
            modelBuilder.Entity<Division>()
                .HasIndex(d => new { d.CompanyId, d.Name }).IsUnique();

            // MergeField: unique per (TemplateType, FieldExpression)
            modelBuilder.Entity<MergeField>()
                .HasIndex(mf => new { mf.TemplateType, mf.FieldExpression })
                .IsUnique();

            // POFormat: fingerprint hash is the primary routing key — indexed
            // for O(1) lookup. Not unique because different companies can
            // legitimately have different names for the same structural format.
            modelBuilder.Entity<POFormat>()
                .HasIndex(f => f.SignatureHash);
            modelBuilder.Entity<POFormat>()
                .HasIndex(f => new { f.CompanyId, f.IsActive });
            modelBuilder.Entity<POFormat>()
                .Property(f => f.RuleSetJson)
                .HasColumnType("nvarchar(max)");
            modelBuilder.Entity<POFormat>()
                .Property(f => f.KeywordSignature)
                .HasMaxLength(4000);
            modelBuilder.Entity<POFormat>()
                .Property(f => f.SignatureHash)
                .HasMaxLength(64);
            modelBuilder.Entity<POFormat>()
                .Property(f => f.Name)
                .HasMaxLength(200);
            modelBuilder.Entity<POFormat>()
                .HasOne(f => f.Company)
                .WithMany()
                .HasForeignKey(f => f.CompanyId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<POFormat>()
                .HasOne(f => f.Client)
                .WithMany()
                .HasForeignKey(f => f.ClientId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<POFormat>()
                .HasIndex(f => new { f.CompanyId, f.ClientId });

            modelBuilder.Entity<POFormatVersion>()
                .HasIndex(v => new { v.POFormatId, v.Version })
                .IsUnique();
            modelBuilder.Entity<POFormatVersion>()
                .Property(v => v.RuleSetJson)
                .HasColumnType("nvarchar(max)");
            modelBuilder.Entity<POFormatVersion>()
                .HasOne(v => v.POFormat)
                .WithMany()
                .HasForeignKey(v => v.POFormatId)
                .OnDelete(DeleteBehavior.Cascade);

            // ── PoImportArchive ────────────────────────────────────────────
            // No FKs on CompanyId / UploadedByUserId — the archive must
            // outlive the rows it references (a deleted user/company should
            // NOT prune their historical parse failures, that's the whole
            // point of the audit). Indexed for the common triage queries:
            //   "show me everything that didn't parse last week"
            //   "show me Hakimi's failures grouped by format"
            modelBuilder.Entity<PoImportArchive>()
                .Property(x => x.OriginalFileName).HasMaxLength(255);
            modelBuilder.Entity<PoImportArchive>()
                .Property(x => x.StoredPath).HasMaxLength(500);
            modelBuilder.Entity<PoImportArchive>()
                .Property(x => x.ContentSha256).HasMaxLength(64);
            modelBuilder.Entity<PoImportArchive>()
                .Property(x => x.ParseOutcome).HasMaxLength(32);
            modelBuilder.Entity<PoImportArchive>()
                .Property(x => x.ErrorMessage).HasMaxLength(1000);
            modelBuilder.Entity<PoImportArchive>()
                .Property(x => x.Notes).HasMaxLength(1000);
            modelBuilder.Entity<PoImportArchive>()
                .HasIndex(x => x.UploadedAt);
            modelBuilder.Entity<PoImportArchive>()
                .HasIndex(x => new { x.CompanyId, x.UploadedAt });
            modelBuilder.Entity<PoImportArchive>()
                .HasIndex(x => x.ParseOutcome);

            // POGoldenSample: replayed on every rule-set update to prevent regressions.
            modelBuilder.Entity<POGoldenSample>()
                .HasIndex(s => new { s.POFormatId, s.Status });
            modelBuilder.Entity<POGoldenSample>()
                .Property(s => s.RawText)
                .HasColumnType("nvarchar(max)");
            modelBuilder.Entity<POGoldenSample>()
                .Property(s => s.ExpectedJson)
                .HasColumnType("nvarchar(max)");
            modelBuilder.Entity<POGoldenSample>()
                .Property(s => s.Name)
                .HasMaxLength(300);
            modelBuilder.Entity<POGoldenSample>()
                .Property(s => s.Status)
                .HasMaxLength(32);
            modelBuilder.Entity<POGoldenSample>()
                .HasOne(s => s.POFormat)
                .WithMany()
                .HasForeignKey(s => s.POFormatId)
                .OnDelete(DeleteBehavior.Cascade);

            // Seed merge fields — all fields used in actual templates
            var id = 1;
            modelBuilder.Entity<MergeField>().HasData(
                // ── Challan: Company ──
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{companyBrandName}}", Label = "Company Brand Name", Category = "Company", SortOrder = 1 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{companyLogoPath}}", Label = "Company Logo URL", Category = "Company", SortOrder = 2 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{{nl2br companyAddress}}}", Label = "Company Address (with line breaks)", Category = "Company", SortOrder = 3 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{{nl2br companyPhone}}}", Label = "Company Phone (with line breaks)", Category = "Company", SortOrder = 4 },
                // ── Challan: Document ──
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{challanNumber}}", Label = "Challan Number", Category = "Document", SortOrder = 10 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{fmtDate deliveryDate}}", Label = "Delivery Date", Category = "Document", SortOrder = 11 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{poNumber}}", Label = "PO Number", Category = "Document", SortOrder = 12 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{fmtDate poDate}}", Label = "PO Date", Category = "Document", SortOrder = 13 },
                // ── Challan: Client ──
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{clientName}}", Label = "Client Name", Category = "Client", SortOrder = 20 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{clientAddress}}", Label = "Client Address", Category = "Client", SortOrder = 21 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{clientSite}}", Label = "Client Site", Category = "Client", SortOrder = 22 },
                // ── Challan: Items ──
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{items.length}}", Label = "Item Count", Category = "Items", SortOrder = 30 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{#each items}}", Label = "Loop: Items Start", Category = "Items", SortOrder = 31 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Items", SortOrder = 32 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{this.quantity}}", Label = "Item Quantity (in loop)", Category = "Items", SortOrder = 33 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{this.description}}", Label = "Item Description (in loop)", Category = "Items", SortOrder = 34 },
                // ── Challan: Conditionals ──
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{#if companyLogoPath}}", Label = "If: Has Logo", Category = "Conditionals", SortOrder = 40 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{#if companyAddress}}", Label = "If: Has Address", Category = "Conditionals", SortOrder = 41 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{#if companyPhone}}", Label = "If: Has Phone", Category = "Conditionals", SortOrder = 42 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{#if poNumber}}", Label = "If: Has PO Number", Category = "Conditionals", SortOrder = 43 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{#if poDate}}", Label = "If: Has PO Date", Category = "Conditionals", SortOrder = 44 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{#if clientSite}}", Label = "If: Has Client Site", Category = "Conditionals", SortOrder = 45 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{else}}", Label = "Else", Category = "Conditionals", SortOrder = 46 },
                new MergeField { Id = id++, TemplateType = "Challan", FieldExpression = "{{/if}}", Label = "End If", Category = "Conditionals", SortOrder = 47 },

                // ── Bill: Company ──
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{companyBrandName}}", Label = "Company Brand Name", Category = "Company", SortOrder = 1 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{companyLogoPath}}", Label = "Company Logo URL", Category = "Company", SortOrder = 2 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{{nl2br companyAddress}}}", Label = "Company Address (with line breaks)", Category = "Company", SortOrder = 3 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{{nl2br companyPhone}}}", Label = "Company Phone (with line breaks)", Category = "Company", SortOrder = 4 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{companyNTN}}", Label = "Company NTN", Category = "Company", SortOrder = 5 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{companySTRN}}", Label = "Company STRN", Category = "Company", SortOrder = 6 },
                // ── Bill: Document ──
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{invoiceNumber}}", Label = "Invoice/Bill Number", Category = "Document", SortOrder = 10 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{fmtDate date}}", Label = "Invoice Date", Category = "Document", SortOrder = 11 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{join challanNumbers}}", Label = "Challan Numbers (comma-separated)", Category = "Document", SortOrder = 12 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{joinDates challanDates}}", Label = "Challan Dates (comma-separated)", Category = "Document", SortOrder = 13 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{poNumber}}", Label = "PO Number", Category = "Document", SortOrder = 14 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{fmtDate poDate}}", Label = "PO Date", Category = "Document", SortOrder = 15 },
                // ── Bill: Client ──
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{clientName}}", Label = "Client Name", Category = "Client", SortOrder = 20 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{clientAddress}}", Label = "Client Address", Category = "Client", SortOrder = 21 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{concernDepartment}}", Label = "Concern Department", Category = "Client", SortOrder = 22 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{clientNTN}}", Label = "Client NTN", Category = "Client", SortOrder = 23 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{clientSTRN}}", Label = "Client STRN/GST", Category = "Client", SortOrder = 24 },
                // ── Bill: Totals ──
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{fmt subtotal}}", Label = "Subtotal (formatted)", Category = "Totals", SortOrder = 30 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{gstRate}}", Label = "GST Rate %", Category = "Totals", SortOrder = 31 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{fmt gstAmount}}", Label = "GST Amount (formatted)", Category = "Totals", SortOrder = 32 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{fmt grandTotal}}", Label = "Grand Total (formatted)", Category = "Totals", SortOrder = 33 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{amountInWords}}", Label = "Amount In Words", Category = "Totals", SortOrder = 34 },
                // ── Bill: Items ──
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{#each items}}", Label = "Loop: Items Start", Category = "Items", SortOrder = 40 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Items", SortOrder = 41 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{this.sNo}}", Label = "Item S# (in loop)", Category = "Items", SortOrder = 42 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{this.quantity}}", Label = "Item Quantity (in loop)", Category = "Items", SortOrder = 43 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{this.description}}", Label = "Item Description (in loop)", Category = "Items", SortOrder = 44 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{this.itemTypeName}}", Label = "Item Type Name (in loop)", Category = "Items", SortOrder = 45 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{fmt this.unitPrice}}", Label = "Unit Price (in loop)", Category = "Items", SortOrder = 46 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{fmt this.lineTotal}}", Label = "Line Total (in loop)", Category = "Items", SortOrder = 47 },
                // ── Bill: Conditionals ──
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{#if companyLogoPath}}", Label = "If: Has Logo", Category = "Conditionals", SortOrder = 50 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{#if clientNTN}}", Label = "If: Has Client NTN", Category = "Conditionals", SortOrder = 51 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{#if clientSTRN}}", Label = "If: Has Client STRN", Category = "Conditionals", SortOrder = 52 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{#if poNumber}}", Label = "If: Has PO Number", Category = "Conditionals", SortOrder = 53 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{#if poDate}}", Label = "If: Has PO Date", Category = "Conditionals", SortOrder = 54 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{else}}", Label = "Else", Category = "Conditionals", SortOrder = 55 },
                new MergeField { Id = id++, TemplateType = "Bill", FieldExpression = "{{/if}}", Label = "End If", Category = "Conditionals", SortOrder = 56 },

                // ── TaxInvoice: Supplier ──
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{supplierName}}", Label = "Supplier Name", Category = "Supplier", SortOrder = 1 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{{nl2br supplierAddress}}}", Label = "Supplier Address (with line breaks)", Category = "Supplier", SortOrder = 2 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{{nl2br supplierPhone}}}", Label = "Supplier Phone (with line breaks)", Category = "Supplier", SortOrder = 3 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{supplierNTN}}", Label = "Supplier NTN", Category = "Supplier", SortOrder = 4 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{supplierSTRN}}", Label = "Supplier STRN", Category = "Supplier", SortOrder = 5 },
                // ── TaxInvoice: Buyer ──
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{buyerName}}", Label = "Buyer Name", Category = "Buyer", SortOrder = 10 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{{nl2br buyerAddress}}}", Label = "Buyer Address (with line breaks)", Category = "Buyer", SortOrder = 11 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{buyerPhone}}", Label = "Buyer Phone", Category = "Buyer", SortOrder = 12 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{buyerNTN}}", Label = "Buyer NTN", Category = "Buyer", SortOrder = 13 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{buyerSTRN}}", Label = "Buyer STRN", Category = "Buyer", SortOrder = 14 },
                // ── TaxInvoice: Document ──
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{invoiceNumber}}", Label = "Invoice Number", Category = "Document", SortOrder = 20 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{fmtDate date}}", Label = "Invoice Date", Category = "Document", SortOrder = 21 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{join challanNumbers}}", Label = "Challan Numbers", Category = "Document", SortOrder = 22 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{poNumber}}", Label = "PO Number", Category = "Document", SortOrder = 23 },
                // ── TaxInvoice: Totals ──
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{gstRate}}", Label = "GST Rate %", Category = "Totals", SortOrder = 30 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{fmtDec subtotal}}", Label = "Subtotal (2 decimals)", Category = "Totals", SortOrder = 31 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{fmtDec gstAmount}}", Label = "GST Amount (2 decimals)", Category = "Totals", SortOrder = 32 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{fmtDec grandTotal}}", Label = "Grand Total (2 decimals)", Category = "Totals", SortOrder = 33 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{amountInWords}}", Label = "Amount In Words", Category = "Totals", SortOrder = 34 },
                // ── TaxInvoice: Items ──
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#each items}}", Label = "Loop: Items Start", Category = "Items", SortOrder = 40 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Items", SortOrder = 41 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{this.quantity}}", Label = "Item Quantity (in loop)", Category = "Items", SortOrder = 42 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{this.uom}}", Label = "Item UOM (in loop)", Category = "Items", SortOrder = 43 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{this.description}}", Label = "Item Description (in loop)", Category = "Items", SortOrder = 44 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{fmtDec this.valueExclTax}}", Label = "Value Excl Tax (in loop)", Category = "Items", SortOrder = 45 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{this.gstRate}}", Label = "GST Rate % (in loop)", Category = "Items", SortOrder = 46 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{fmtDec this.gstAmount}}", Label = "GST Amount (in loop)", Category = "Items", SortOrder = 47 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{fmtDec this.totalInclTax}}", Label = "Total Incl Tax (in loop)", Category = "Items", SortOrder = 48 },
                // ── TaxInvoice: Conditionals ──
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#if supplierAddress}}", Label = "If: Has Supplier Address", Category = "Conditionals", SortOrder = 50 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#if supplierPhone}}", Label = "If: Has Supplier Phone", Category = "Conditionals", SortOrder = 51 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#if supplierSTRN}}", Label = "If: Has Supplier STRN", Category = "Conditionals", SortOrder = 52 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#if supplierNTN}}", Label = "If: Has Supplier NTN", Category = "Conditionals", SortOrder = 53 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#if buyerAddress}}", Label = "If: Has Buyer Address", Category = "Conditionals", SortOrder = 54 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#if buyerPhone}}", Label = "If: Has Buyer Phone", Category = "Conditionals", SortOrder = 55 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#if buyerSTRN}}", Label = "If: Has Buyer STRN", Category = "Conditionals", SortOrder = 56 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{#if buyerNTN}}", Label = "If: Has Buyer NTN", Category = "Conditionals", SortOrder = 57 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{else}}", Label = "Else", Category = "Conditionals", SortOrder = 58 },
                new MergeField { Id = id++, TemplateType = "TaxInvoice", FieldExpression = "{{/if}}", Label = "End If", Category = "Conditionals", SortOrder = 59 }
                // NOTE: SalesQuote / SalesOrder merge fields are seeded at
                // RUNTIME (idempotent, keyed by TemplateType+FieldExpression)
                // by SalesMergeFieldSeeder — NOT via HasData. Hard-coded HasData
                // ids collide with operator-added merge-field rows on databases
                // where the identity counter has advanced past the seed range.
            );

            // Seed FBR Lookup values
            var fbrId = 1;
            modelBuilder.Entity<FbrLookup>().HasData(
                // ── Province ──
                new FbrLookup { Id = fbrId++, Category = "Province", Code = "7", Label = "Punjab", SortOrder = 1 },
                new FbrLookup { Id = fbrId++, Category = "Province", Code = "8", Label = "Sindh", SortOrder = 2 },
                new FbrLookup { Id = fbrId++, Category = "Province", Code = "9", Label = "KPK", SortOrder = 3 },
                new FbrLookup { Id = fbrId++, Category = "Province", Code = "10", Label = "Balochistan", SortOrder = 4 },
                new FbrLookup { Id = fbrId++, Category = "Province", Code = "11", Label = "Islamabad", SortOrder = 5 },
                new FbrLookup { Id = fbrId++, Category = "Province", Code = "12", Label = "AJK", SortOrder = 6 },
                new FbrLookup { Id = fbrId++, Category = "Province", Code = "13", Label = "GB", SortOrder = 7 },

                // ── BusinessActivity ──
                new FbrLookup { Id = fbrId++, Category = "BusinessActivity", Code = "Manufacturer", Label = "Manufacturer", SortOrder = 1 },
                new FbrLookup { Id = fbrId++, Category = "BusinessActivity", Code = "Importer", Label = "Importer", SortOrder = 2 },
                new FbrLookup { Id = fbrId++, Category = "BusinessActivity", Code = "Distributor", Label = "Distributor", SortOrder = 3 },
                new FbrLookup { Id = fbrId++, Category = "BusinessActivity", Code = "Wholesaler", Label = "Wholesaler", SortOrder = 4 },
                new FbrLookup { Id = fbrId++, Category = "BusinessActivity", Code = "Exporter", Label = "Exporter", SortOrder = 5 },
                new FbrLookup { Id = fbrId++, Category = "BusinessActivity", Code = "Retailer", Label = "Retailer", SortOrder = 6 },
                new FbrLookup { Id = fbrId++, Category = "BusinessActivity", Code = "Service Provider", Label = "Service Provider", SortOrder = 7 },
                new FbrLookup { Id = fbrId++, Category = "BusinessActivity", Code = "Other", Label = "Other", SortOrder = 8 },

                // ── Sector ──
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "All Other Sectors", Label = "All Other Sectors", SortOrder = 1 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Steel", Label = "Steel", SortOrder = 2 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "FMCG", Label = "FMCG", SortOrder = 3 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Textile", Label = "Textile", SortOrder = 4 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Telecom", Label = "Telecom", SortOrder = 5 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Petroleum", Label = "Petroleum", SortOrder = 6 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Electricity Distribution", Label = "Electricity Distribution", SortOrder = 7 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Gas Distribution", Label = "Gas Distribution", SortOrder = 8 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Services", Label = "Services", SortOrder = 9 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Automobile", Label = "Automobile", SortOrder = 10 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "CNG Stations", Label = "CNG Stations", SortOrder = 11 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Pharmaceuticals", Label = "Pharmaceuticals", SortOrder = 12 },
                new FbrLookup { Id = fbrId++, Category = "Sector", Code = "Wholesale / Retails", Label = "Wholesale / Retails", SortOrder = 13 },

                // ── RegistrationType ──
                new FbrLookup { Id = fbrId++, Category = "RegistrationType", Code = "Registered", Label = "Registered", SortOrder = 1 },
                new FbrLookup { Id = fbrId++, Category = "RegistrationType", Code = "Unregistered", Label = "Unregistered", SortOrder = 2 },
                new FbrLookup { Id = fbrId++, Category = "RegistrationType", Code = "FTN", Label = "FTN", SortOrder = 3 },
                new FbrLookup { Id = fbrId++, Category = "RegistrationType", Code = "CNIC", Label = "CNIC", SortOrder = 4 },

                // ── Environment ──
                new FbrLookup { Id = fbrId++, Category = "Environment", Code = "sandbox", Label = "Sandbox", SortOrder = 1 },
                new FbrLookup { Id = fbrId++, Category = "Environment", Code = "production", Label = "Production", SortOrder = 2 },

                // ── DocumentType ──
                new FbrLookup { Id = fbrId++, Category = "DocumentType", Code = "4", Label = "Sale Invoice", SortOrder = 1 },
                new FbrLookup { Id = fbrId++, Category = "DocumentType", Code = "9", Label = "Debit Note", SortOrder = 2 },
                new FbrLookup { Id = fbrId++, Category = "DocumentType", Code = "10", Label = "Credit Note", SortOrder = 3 },

                // ── PaymentMode ──
                new FbrLookup { Id = fbrId++, Category = "PaymentMode", Code = "Cash", Label = "Cash", SortOrder = 1 },
                new FbrLookup { Id = fbrId++, Category = "PaymentMode", Code = "Credit", Label = "Credit", SortOrder = 2 },
                new FbrLookup { Id = fbrId++, Category = "PaymentMode", Code = "Bank Transfer", Label = "Bank Transfer", SortOrder = 3 },
                new FbrLookup { Id = fbrId++, Category = "PaymentMode", Code = "Cheque", Label = "Cheque", SortOrder = 4 },
                new FbrLookup { Id = fbrId++, Category = "PaymentMode", Code = "Online", Label = "Online", SortOrder = 5 }
            );

            // ── RBAC ────────────────────────────────────────────────────────
            // Permission.Key is the application-facing identifier (e.g.
            // "users.manage.create"). Catalog is seeded from code at startup,
            // not HasData — see PermissionSeeder.
            modelBuilder.Entity<Permission>()
                .HasIndex(p => p.Key)
                .IsUnique();
            modelBuilder.Entity<Permission>().Property(p => p.Key).HasMaxLength(200);
            modelBuilder.Entity<Permission>().Property(p => p.Module).HasMaxLength(100);
            modelBuilder.Entity<Permission>().Property(p => p.Page).HasMaxLength(100);
            modelBuilder.Entity<Permission>().Property(p => p.Action).HasMaxLength(100);
            modelBuilder.Entity<Permission>().Property(p => p.Description).HasMaxLength(500);

            modelBuilder.Entity<Role>()
                .HasIndex(r => r.Name)
                .IsUnique();
            modelBuilder.Entity<Role>().Property(r => r.Name).HasMaxLength(100);
            modelBuilder.Entity<Role>().Property(r => r.Description).HasMaxLength(500);

            // Composite PK on join tables.
            modelBuilder.Entity<RolePermission>()
                .HasKey(rp => new { rp.RoleId, rp.PermissionId });
            modelBuilder.Entity<RolePermission>()
                .HasOne(rp => rp.Role)
                .WithMany(r => r.RolePermissions)
                .HasForeignKey(rp => rp.RoleId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<RolePermission>()
                .HasOne(rp => rp.Permission)
                .WithMany(p => p.RolePermissions)
                .HasForeignKey(rp => rp.PermissionId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<UserRole>()
                .HasKey(ur => new { ur.UserId, ur.RoleId });
            modelBuilder.Entity<UserRole>()
                .HasOne(ur => ur.User)
                .WithMany()
                .HasForeignKey(ur => ur.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<UserRole>()
                .HasOne(ur => ur.Role)
                .WithMany(r => r.UserRoles)
                .HasForeignKey(ur => ur.RoleId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<UserRole>()
                .HasIndex(ur => ur.RoleId);

            // ── Tenant isolation: UserCompany ──
            // Composite PK on (UserId, CompanyId). Both sides cascade so
            // deleting a user or a company cleans up its grants. The
            // CompanyAccessGuard reads this table when Company.IsTenantIsolated=true.
            modelBuilder.Entity<UserCompany>()
                .HasKey(uc => new { uc.UserId, uc.CompanyId });
            modelBuilder.Entity<UserCompany>()
                .HasOne(uc => uc.User)
                .WithMany()
                .HasForeignKey(uc => uc.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<UserCompany>()
                .HasOne(uc => uc.Company)
                .WithMany()
                .HasForeignKey(uc => uc.CompanyId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<UserCompany>()
                .HasIndex(uc => uc.CompanyId);

            // ── Division-level access: UserDivision ──
            // Composite PK on (UserId, DivisionId). Only consulted when the
            // user's UserCompany.RestrictToDivisions flag is set for the
            // division's company. Cascade from both sides is safe here (unlike
            // the NoAction document→Division FKs): the only cascade path into
            // this table from a Company delete is Company→Division→UserDivision.
            modelBuilder.Entity<UserDivision>()
                .HasKey(ud => new { ud.UserId, ud.DivisionId });
            modelBuilder.Entity<UserDivision>()
                .HasOne(ud => ud.User)
                .WithMany()
                .HasForeignKey(ud => ud.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<UserDivision>()
                .HasOne(ud => ud.Division)
                .WithMany()
                .HasForeignKey(ud => ud.DivisionId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<UserDivision>()
                .HasIndex(ud => ud.DivisionId);

            // ── Purchase + Inventory module ────────────────────────────────

            // Supplier — mirror of Client
            modelBuilder.Entity<Supplier>()
                .HasOne(s => s.Company)
                .WithMany(co => co.Suppliers)
                .HasForeignKey(s => s.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<Supplier>()
                .HasIndex(s => s.CompanyId);
            modelBuilder.Entity<Supplier>()
                .Property(s => s.Name).HasMaxLength(300);
            modelBuilder.Entity<Supplier>()
                .Property(s => s.NTN).HasMaxLength(20);
            modelBuilder.Entity<Supplier>()
                .Property(s => s.STRN).HasMaxLength(20);
            modelBuilder.Entity<Supplier>()
                .Property(s => s.RegistrationType).HasMaxLength(20);
            modelBuilder.Entity<Supplier>()
                .Property(s => s.CNIC).HasMaxLength(20);

            // ── Supplier → SupplierGroup (Common Suppliers grouping) ──
            // Mirrors Client → ClientGroup. Nullable FK so existing rows
            // stay valid until the one-time backfill assigns them. SetNull
            // on group delete so removing the group row doesn't orphan /
            // cascade-delete suppliers — they keep working as ungrouped
            // per-company records.
            modelBuilder.Entity<Supplier>()
                .HasOne(s => s.SupplierGroup)
                .WithMany(g => g.Suppliers)
                .HasForeignKey(s => s.SupplierGroupId)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<Supplier>()
                .HasIndex(s => s.SupplierGroupId);

            // ── SupplierGroup unique key + lookup indexes ──
            modelBuilder.Entity<SupplierGroup>()
                .HasIndex(g => g.GroupKey)
                .IsUnique();
            modelBuilder.Entity<SupplierGroup>()
                .HasIndex(g => g.NormalizedNtn);
            modelBuilder.Entity<SupplierGroup>()
                .HasIndex(g => g.NormalizedName);

            // PurchaseBill — mirror of Invoice
            modelBuilder.Entity<PurchaseBill>()
                .HasOne(pb => pb.Company)
                .WithMany(c => c.PurchaseBills)
                .HasForeignKey(pb => pb.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<PurchaseBill>()
                .HasOne(pb => pb.Supplier)
                .WithMany(s => s.PurchaseBills)
                .HasForeignKey(pb => pb.SupplierId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<PurchaseBill>()
                .HasOne(pb => pb.Division).WithMany()
                .HasForeignKey(pb => pb.DivisionId).IsRequired(false).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<PurchaseBill>()
                .HasIndex(pb => pb.CompanyId);
            // Audit C-8: unique numbering, now scoped per (company, division) so a
            // division-tagged bill draws its own sequence. HasFilter(null) covers
            // company-level rows (DivisionId NULL) too.
            modelBuilder.Entity<PurchaseBill>()
                .HasIndex(pb => new { pb.CompanyId, pb.DivisionId, pb.PurchaseBillNumber })
                .IsUnique()
                .HasFilter(null);
            modelBuilder.Entity<PurchaseBill>()
                .HasIndex(pb => pb.SupplierId);
            modelBuilder.Entity<PurchaseBill>()
                .HasIndex(pb => pb.SupplierIRN);
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.Subtotal).HasPrecision(18, 2);
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.GSTRate).HasPrecision(5, 2);
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.GSTAmount).HasPrecision(18, 2);
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.GrandTotal).HasPrecision(18, 2);
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.AmountPaid).HasPrecision(18, 2);
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.SupplierBillNumber).HasMaxLength(100);
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.SupplierIRN).HasMaxLength(64);
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.ReconciliationStatus).HasMaxLength(20).HasDefaultValue("Pending");

            // PurchaseItem — mirror of InvoiceItem
            modelBuilder.Entity<PurchaseItem>()
                .HasOne(pi => pi.PurchaseBill)
                .WithMany(pb => pb.Items)
                .HasForeignKey(pi => pi.PurchaseBillId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<PurchaseItem>()
                .HasOne(pi => pi.ItemType)
                .WithMany()
                .HasForeignKey(pi => pi.ItemTypeId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<PurchaseItem>()
                .HasOne(pi => pi.GoodsReceiptItem)
                .WithMany()
                .HasForeignKey(pi => pi.GoodsReceiptItemId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.SetNull);
            modelBuilder.Entity<PurchaseItem>()
                .HasIndex(pi => pi.PurchaseBillId);
            modelBuilder.Entity<PurchaseItem>()
                .HasIndex(pi => pi.ItemTypeId);

            // PurchaseItemSourceLine — join table for N:M between
            // PurchaseItems and InvoiceItems. Composite PK; both sides
            // cascade so cleanup is automatic when either parent is
            // removed.
            modelBuilder.Entity<PurchaseItemSourceLine>()
                .HasKey(x => new { x.PurchaseItemId, x.InvoiceItemId });
            modelBuilder.Entity<PurchaseItemSourceLine>()
                .HasOne(x => x.PurchaseItem)
                .WithMany(pi => pi.SourceLines)
                .HasForeignKey(x => x.PurchaseItemId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<PurchaseItemSourceLine>()
                .HasOne(x => x.InvoiceItem)
                .WithMany()
                .HasForeignKey(x => x.InvoiceItemId)
                .OnDelete(DeleteBehavior.NoAction); // avoid SQL Server "multiple cascade paths"
            modelBuilder.Entity<PurchaseItemSourceLine>()
                .HasIndex(x => x.InvoiceItemId);
            modelBuilder.Entity<PurchaseItem>().Property(pi => pi.UnitPrice).HasPrecision(18, 2);
            modelBuilder.Entity<PurchaseItem>().Property(pi => pi.LineTotal).HasPrecision(18, 2);
            modelBuilder.Entity<PurchaseItem>().Property(pi => pi.FixedNotifiedValueOrRetailPrice).HasPrecision(18, 2);
            // Decimal Quantity (was int) — matches DeliveryItem/InvoiceItem
            // precision so cross-module reports don't have a units mismatch.
            modelBuilder.Entity<PurchaseItem>().Property(pi => pi.Quantity).HasPrecision(18, 4);
            // FBR-source line taxes — both nullable, additive.
            modelBuilder.Entity<PurchaseItem>().Property(pi => pi.ExtraTax).HasPrecision(18, 2);
            modelBuilder.Entity<PurchaseItem>().Property(pi => pi.StWithheldAtSource).HasPrecision(18, 2);

            // PurchaseBill.Source — short string column tagging row lineage.
            modelBuilder.Entity<PurchaseBill>().Property(pb => pb.Source).HasMaxLength(20);

            // GoodsReceipt — mirror of DeliveryChallan
            modelBuilder.Entity<GoodsReceipt>()
                .HasOne(gr => gr.Company)
                .WithMany(c => c.GoodsReceipts)
                .HasForeignKey(gr => gr.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<GoodsReceipt>()
                .HasOne(gr => gr.Supplier)
                .WithMany(s => s.GoodsReceipts)
                .HasForeignKey(gr => gr.SupplierId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<GoodsReceipt>()
                .HasOne(gr => gr.PurchaseBill)
                .WithMany(pb => pb.GoodsReceipts)
                .HasForeignKey(gr => gr.PurchaseBillId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<GoodsReceipt>()
                .HasOne(gr => gr.Division).WithMany()
                .HasForeignKey(gr => gr.DivisionId).IsRequired(false).OnDelete(DeleteBehavior.NoAction);
            modelBuilder.Entity<GoodsReceipt>()
                .HasIndex(gr => gr.CompanyId);
            // Audit C-8: unique numbering scoped per (company, division).
            modelBuilder.Entity<GoodsReceipt>()
                .HasIndex(gr => new { gr.CompanyId, gr.DivisionId, gr.GoodsReceiptNumber })
                .IsUnique()
                .HasFilter(null);
            modelBuilder.Entity<GoodsReceipt>()
                .HasIndex(gr => gr.SupplierId);
            modelBuilder.Entity<GoodsReceipt>()
                .Property(gr => gr.Status).HasMaxLength(20).HasDefaultValue("Pending");

            // GoodsReceiptItem — mirror of DeliveryItem
            modelBuilder.Entity<GoodsReceiptItem>()
                .HasOne(gri => gri.GoodsReceipt)
                .WithMany(gr => gr.Items)
                .HasForeignKey(gri => gri.GoodsReceiptId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<GoodsReceiptItem>()
                .HasOne(gri => gri.ItemType)
                .WithMany()
                .HasForeignKey(gri => gri.ItemTypeId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<GoodsReceiptItem>()
                .HasIndex(gri => gri.GoodsReceiptId);

            // StockMovement — append-only event log
            modelBuilder.Entity<StockMovement>()
                .HasOne(sm => sm.Company)
                .WithMany()
                .HasForeignKey(sm => sm.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<StockMovement>()
                .HasOne(sm => sm.ItemType)
                .WithMany()
                .HasForeignKey(sm => sm.ItemTypeId)
                .OnDelete(DeleteBehavior.Restrict);
            // StockMovement -> Division (optional; NoAction — SetNull/Cascade
            // would add a second cascade path from Company). Unlinked in app
            // code by DivisionService.DeleteAsync, like the document columns.
            modelBuilder.Entity<StockMovement>()
                .HasOne(sm => sm.Division)
                .WithMany()
                .HasForeignKey(sm => sm.DivisionId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);
            // Composite index for the hot-path on-hand query:
            //   WHERE CompanyId = X AND ItemTypeId = Y
            //   then SUM(Direction == In ? Quantity : -Quantity)
            modelBuilder.Entity<StockMovement>()
                .HasIndex(sm => new { sm.CompanyId, sm.ItemTypeId });
            modelBuilder.Entity<StockMovement>()
                .HasIndex(sm => new { sm.SourceType, sm.SourceId });

            // OpeningStockBalance — at most one row per (Company, ItemType)
            modelBuilder.Entity<OpeningStockBalance>()
                .HasOne(osb => osb.Company)
                .WithMany()
                .HasForeignKey(osb => osb.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<OpeningStockBalance>()
                .HasOne(osb => osb.ItemType)
                .WithMany()
                .HasForeignKey(osb => osb.ItemTypeId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<OpeningStockBalance>()
                .HasIndex(osb => new { osb.CompanyId, osb.ItemTypeId })
                .IsUnique();

            // 2026-05-12: stock-quantity precision promotion. Both
            // StockMovement.Quantity and OpeningStockBalance.Quantity
            // were `int` originally — only worked for whole-unit
            // inventory. Sales of fractional UOMs (KG, Liter, Carat)
            // were truncated by SyncInvoiceStockMovementsAsync at the
            // boundary, drifting on-hand upward over time. Now both
            // mirror InvoiceItem / DeliveryItem / PurchaseItem at
            // decimal(18,4).
            modelBuilder.Entity<StockMovement>().Property(sm => sm.Quantity).HasPrecision(18, 4);
            modelBuilder.Entity<OpeningStockBalance>().Property(osb => osb.Quantity).HasPrecision(18, 4);

            // ── Inventory V2 foundation (2026-07 redesign) ─────────────────────
            // Per-(company, item-type) tracking policy override + reorder level.
            // Company delete cascades these away; ItemType (global catalog) is
            // Restrict — no multiple-cascade path since ItemType has no company.
            modelBuilder.Entity<CompanyItemTypeSetting>()
                .HasOne(s => s.Company).WithMany()
                .HasForeignKey(s => s.CompanyId)
                .OnDelete(DeleteBehavior.Cascade);
            modelBuilder.Entity<CompanyItemTypeSetting>()
                .HasOne(s => s.ItemType).WithMany()
                .HasForeignKey(s => s.ItemTypeId)
                .OnDelete(DeleteBehavior.Restrict);
            modelBuilder.Entity<CompanyItemTypeSetting>()
                .HasIndex(s => new { s.CompanyId, s.ItemTypeId }).IsUnique();
            modelBuilder.Entity<CompanyItemTypeSetting>()
                .Property(s => s.Mode).HasConversion<byte>();
            modelBuilder.Entity<CompanyItemTypeSetting>()
                .Property(s => s.ReorderLevel).HasPrecision(18, 4);

            // Movement-history + running-balance index: keyed on
            // (CompanyId, ItemTypeId, MovementDate, Id) so the dashboard feed
            // (ORDER BY MovementDate, Id) and the per-item running-balance
            // window function run index-ordered, with the signed-sum columns
            // carried as INCLUDEs to keep it a covering seek.
            modelBuilder.Entity<StockMovement>()
                .HasIndex(sm => new { sm.CompanyId, sm.ItemTypeId, sm.MovementDate, sm.Id })
                .IncludeProperties(sm => new { sm.Direction, sm.Quantity, sm.SourceType, sm.SourceId, sm.DivisionId })
                .HasDatabaseName("IX_StockMovements_Co_Item_Date");
            // Company-wide movement feed (no item filter), newest first.
            modelBuilder.Entity<StockMovement>()
                .HasIndex(sm => new { sm.CompanyId, sm.MovementDate })
                .HasDatabaseName("IX_StockMovements_Co_Date");

            // Derived read-model working-set indexes: the buckets scan only the
            // OPEN documents, so filter to un-fulfilled rows.
            //   • un-billed challans feed "Qty Delivered"
            //   • un-billed goods receipts feed "Incoming Qty"
            //   • open sales orders feed "Qty To Deliver" / "Committed"
            modelBuilder.Entity<DeliveryChallan>()
                .HasIndex(dc => new { dc.CompanyId, dc.SalesOrderId })
                .HasFilter("[InvoiceId] IS NULL")
                .HasDatabaseName("IX_DeliveryChallans_Open");
            // Named overload so this is a SEPARATE filtered index — it must not
            // clobber the existing unfiltered IX_GoodsReceipts_CompanyId (EF
            // treats same-column HasIndex calls as one index otherwise).
            modelBuilder.Entity<GoodsReceipt>()
                .HasIndex(new[] { nameof(GoodsReceipt.CompanyId) }, "IX_GoodsReceipts_Open")
                .HasFilter("[PurchaseBillId] IS NULL");
            modelBuilder.Entity<SalesOrder>()
                .HasIndex(o => new { o.CompanyId, o.Status })
                .HasDatabaseName("IX_SalesOrders_Co_Status");

            // Existing companies (and new ones) default to V1 legacy tracking.
            modelBuilder.Entity<Company>()
                .Property(c => c.InventoryFlowVersion)
                .HasDefaultValue((byte)1);
        }

    }
}
