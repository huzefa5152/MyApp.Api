using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        public DbSet<Company> Companies { get; set; }
        public DbSet<DeliveryChallan> DeliveryChallans { get; set; }
        public DbSet<DeliveryItem> DeliveryItems { get; set; }

        public DbSet<Client> Clients { get; set; } // ✅ add this
        public DbSet<ClientGroup> ClientGroups { get; set; }

        public DbSet<Invoice> Invoices { get; set; }
        public DbSet<InvoiceItem> InvoiceItems { get; set; }
        public DbSet<ItemDescription> ItemDescriptions { get; set; }
        public DbSet<Unit> Units { get; set; }
        public DbSet<ItemType> ItemTypes { get; set; }
        public DbSet<User> Users { get; set; }
        public DbSet<PrintTemplate> PrintTemplates { get; set; }
        public DbSet<MergeField> MergeFields { get; set; }
        public DbSet<AuditLog> AuditLogs { get; set; }
        public DbSet<FbrLookup> FbrLookups { get; set; }
        public DbSet<POFormat> POFormats { get; set; }
        public DbSet<POFormatVersion> POFormatVersions { get; set; }
        public DbSet<POGoldenSample> POGoldenSamples { get; set; }

        // RBAC
        public DbSet<Permission> Permissions { get; set; }
        public DbSet<Role> Roles { get; set; }
        public DbSet<RolePermission> RolePermissions { get; set; }
        public DbSet<UserRole> UserRoles { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<AuditLog>()
                .HasIndex(a => a.Timestamp);

            // Unique index on Username
            modelBuilder.Entity<User>()
                .HasIndex(u => u.Username)
                .IsUnique();

            // Seed default admin user (password: admin123)
            // Pre-computed BCrypt hash to avoid dynamic value in HasData
            modelBuilder.Entity<User>().HasData(new User
            {
                Id = 1,
                Username = "admin",
                PasswordHash = "$2a$11$ITxobMb6Kk7r4cjBAN3tF.U2x5q/PpaueP/1dvUSr6V0N5z724cuu",
                FullName = "Administrator",
                Role = "Admin",
                CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc)
            });

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

            // DeliveryChallan -> Client (optional FK, restrict delete)
            modelBuilder.Entity<DeliveryChallan>()
                .HasOne(dc => dc.Client)
                .WithMany(c => c.DeliveryChallans)
                .HasForeignKey(dc => dc.ClientId)
                .OnDelete(DeleteBehavior.Restrict);

            // Performance indexes on frequently-queried foreign keys
            modelBuilder.Entity<Invoice>()
                .HasIndex(i => i.ClientId);

            modelBuilder.Entity<Invoice>()
                .HasIndex(i => i.CompanyId);

            // Composite index for paged invoice queries (WHERE CompanyId = X ORDER BY InvoiceNumber DESC)
            modelBuilder.Entity<Invoice>()
                .HasIndex(i => new { i.CompanyId, i.InvoiceNumber });

            modelBuilder.Entity<DeliveryChallan>()
                .HasIndex(dc => dc.ClientId);

            modelBuilder.Entity<DeliveryChallan>()
                .HasIndex(dc => dc.CompanyId);

            modelBuilder.Entity<DeliveryChallan>()
                .HasIndex(dc => dc.InvoiceId);

            modelBuilder.Entity<InvoiceItem>()
                .HasIndex(ii => ii.InvoiceId);

            modelBuilder.Entity<InvoiceItem>()
                .HasIndex(ii => ii.DeliveryItemId);

            // Decimal precision for money columns
            modelBuilder.Entity<Invoice>().Property(i => i.Subtotal).HasPrecision(18, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GSTRate).HasPrecision(5, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GSTAmount).HasPrecision(18, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GrandTotal).HasPrecision(18, 2);
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

            modelBuilder.Entity<ItemType>()
                .HasIndex(it => it.Name)
                .IsUnique();

            // PrintTemplate: unique per (CompanyId, TemplateType)
            modelBuilder.Entity<PrintTemplate>()
                .HasIndex(pt => new { pt.CompanyId, pt.TemplateType })
                .IsUnique();

            modelBuilder.Entity<PrintTemplate>()
                .HasOne(pt => pt.Company)
                .WithMany()
                .HasForeignKey(pt => pt.CompanyId)
                .OnDelete(DeleteBehavior.Cascade);

            // DeliveryItem -> ItemType (optional, restrict)
            modelBuilder.Entity<DeliveryItem>()
                .HasOne(di => di.ItemType)
                .WithMany()
                .HasForeignKey(di => di.ItemTypeId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

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
        }

    }
}
