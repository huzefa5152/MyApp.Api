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

        public DbSet<ItemDescription> ItemDescriptions { get; set; }
        public DbSet<Unit> Units { get; set; }
        public DbSet<User> Users { get; set; }

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

            // Optional: make ItemDescription.Name and Unit.Name unique
            modelBuilder.Entity<ItemDescription>()
                .HasIndex(i => i.Name)
                .IsUnique();

            modelBuilder.Entity<Unit>()
                .HasIndex(u => u.Name)
                .IsUnique();
        }

    }
}
