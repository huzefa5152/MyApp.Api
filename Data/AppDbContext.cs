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

        public DbSet<Invoice> Invoices { get; set; }
        public DbSet<InvoiceItem> InvoiceItems { get; set; }
        public DbSet<ItemDescription> ItemDescriptions { get; set; }
        public DbSet<Unit> Units { get; set; }
        public DbSet<ItemType> ItemTypes { get; set; }
        public DbSet<User> Users { get; set; }
        public DbSet<PrintTemplate> PrintTemplates { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
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

            // Decimal precision for money columns
            modelBuilder.Entity<Invoice>().Property(i => i.Subtotal).HasPrecision(18, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GSTRate).HasPrecision(5, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GSTAmount).HasPrecision(18, 2);
            modelBuilder.Entity<Invoice>().Property(i => i.GrandTotal).HasPrecision(18, 2);
            modelBuilder.Entity<InvoiceItem>().Property(ii => ii.UnitPrice).HasPrecision(18, 2);
            modelBuilder.Entity<InvoiceItem>().Property(ii => ii.LineTotal).HasPrecision(18, 2);

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
        }

    }
}
