using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Models;
namespace MyApp.Api.Data;
public partial class AppDbContext
{
    public DbSet<AccountTransfer> AccountTransfers => Set<AccountTransfer>();
    public DbSet<BankReconciliation> BankReconciliations => Set<BankReconciliation>();
    public DbSet<BankStatementImport> BankStatementImports => Set<BankStatementImport>();
    public DbSet<BankStatementLine> BankStatementLines => Set<BankStatementLine>();
    public DbSet<PurchaseDebitNote> PurchaseDebitNotes => Set<PurchaseDebitNote>();
    public DbSet<PurchaseDebitNoteItem> PurchaseDebitNoteItems => Set<PurchaseDebitNoteItem>();
    private static void ConfigureAccountingExpansion(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PurchaseDebitNote>(e => {
            e.HasOne(n => n.Company).WithMany().HasForeignKey(n => n.CompanyId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(n => n.Supplier).WithMany().HasForeignKey(n => n.SupplierId).OnDelete(DeleteBehavior.NoAction);
            e.HasIndex(n => new { n.CompanyId, n.DebitNoteNumber }).IsUnique();
            e.Property(n => n.Subtotal).HasPrecision(18, 2);
            e.Property(n => n.GSTAmount).HasPrecision(18, 2);
            e.Property(n => n.GSTRate).HasPrecision(5, 2);
            e.Property(n => n.GrandTotal).HasPrecision(18, 2);
        });
        modelBuilder.Entity<PurchaseDebitNoteItem>(e => {
            e.HasOne(n => n.PurchaseDebitNote).WithMany(n => n.Items).HasForeignKey(n => n.PurchaseDebitNoteId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(n => n.ItemType).WithMany().HasForeignKey(n => n.ItemTypeId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne(n => n.Account).WithMany().HasForeignKey(n => n.AccountId).OnDelete(DeleteBehavior.NoAction);
            e.Property(n => n.Quantity).HasPrecision(18, 4);
            e.Property(n => n.UnitPrice).HasPrecision(18, 4);
            e.Property(n => n.LineTotal).HasPrecision(18, 2);
        });
        modelBuilder.Entity<PaymentAllocation>().Property(t => t.TaxRate).HasPrecision(5, 2);
        modelBuilder.Entity<PaymentAllocation>().Property(t => t.TaxAmount).HasPrecision(18, 2);
        modelBuilder.Entity<PaymentAllocation>().Property(t => t.AdjustmentAmount).HasPrecision(18, 2);
        modelBuilder.Entity<PaymentAllocation>().HasOne(t => t.Account).WithMany().HasForeignKey(t => t.AccountId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<PaymentAllocation>().HasOne(t => t.AdjustmentAccount).WithMany().HasForeignKey(t => t.AdjustmentAccountId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<AccountTransfer>().HasOne(t => t.Company).WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<AccountTransfer>().HasOne(t => t.FromAccount).WithMany().HasForeignKey(t => t.FromAccountId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<AccountTransfer>().HasOne(t => t.ToAccount).WithMany().HasForeignKey(t => t.ToAccountId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<AccountTransfer>().HasIndex(t => new { t.CompanyId, t.Number }).IsUnique();
        modelBuilder.Entity<AccountTransfer>().Property(t => t.Amount).HasPrecision(18, 2);
        modelBuilder.Entity<AccountTransfer>().Property(t => t.Description).HasMaxLength(2000);
        modelBuilder.Entity<BankReconciliation>().HasOne(t => t.Company).WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<BankReconciliation>().HasOne(t => t.BankAccount).WithMany().HasForeignKey(t => t.BankAccountId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<BankReconciliation>().HasIndex(t => new { t.BankAccountId, t.StatementDate }).IsUnique();
        modelBuilder.Entity<BankReconciliation>().Property(t => t.StatementBalance).HasPrecision(18, 2);
        modelBuilder.Entity<BankReconciliation>().Property(t => t.ClearedBalance).HasPrecision(18, 2);
        modelBuilder.Entity<BankStatementImport>().HasOne(t => t.Company).WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<BankStatementImport>().HasOne(t => t.BankAccount).WithMany().HasForeignKey(t => t.BankAccountId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<BankStatementLine>().HasOne(t => t.Import).WithMany(t => t.Lines).HasForeignKey(t => t.ImportId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<BankStatementLine>().HasOne(t => t.BankAccount).WithMany().HasForeignKey(t => t.BankAccountId).OnDelete(DeleteBehavior.NoAction);
        modelBuilder.Entity<BankStatementLine>().Property(t => t.Amount).HasPrecision(18, 2);
        modelBuilder.Entity<BankStatementLine>().HasIndex(t => new { t.CompanyId, t.BankAccountId, t.Status });
    }
}
