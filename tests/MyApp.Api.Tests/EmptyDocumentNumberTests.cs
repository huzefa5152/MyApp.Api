using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using Xunit;

namespace MyApp.Api.Tests;

public class EmptyDocumentNumberTests
{
    [Fact]
    public async Task EmptySeriesRestartAndThenAdvanceWithoutAffectingOtherCompaniesOrCustomNumbers()
    {
        var connection = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder
        {
            DataSource = Environment.GetEnvironmentVariable("PRINT_MCP_TEST_SERVER") ?? @".\MSSQLSERVER02",
            InitialCatalog = "MyApp_Numbering_Test_" + Guid.NewGuid().ToString("N"), IntegratedSecurity = true, TrustServerCertificate = true
        }.ConnectionString;
        DevelopmentSqlGuard.AssertLocal(connection, Environment.MachineName, false);
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options);
        try
        {
            await db.Database.EnsureCreatedAsync();
            var a = new Company { Name = "Numbering sample", StartingSalesQuoteNumber = 1, CurrentSalesQuoteNumber = 900,
                StartingChallanNumber = 1, CurrentChallanNumber = 900, StartingPurchaseBillNumber = 1, CurrentPurchaseBillNumber = 900,
                StartingGoodsReceiptNumber = 1, CurrentGoodsReceiptNumber = 900 };
            var b = new Company { Name = "Other numbering sample", StartingSalesQuoteNumber = 75, CurrentSalesQuoteNumber = 700 };
            db.AddRange(a, b); await db.SaveChangesAsync();
            var client = new Client { CompanyId = a.Id, Name = "Sample customer" };
            var supplier = new Supplier { CompanyId = a.Id, Name = "Sample supplier" };
            db.AddRange(client, supplier); await db.SaveChangesAsync();
            object Document(string kind, int number) => kind switch
            {
                "quote" => new SalesQuote { CompanyId = a.Id, ClientId = client.Id, QuoteNumber = number },
                "challan" => new DeliveryChallan { CompanyId = a.Id, ClientId = client.Id, ChallanNumber = number },
                "purchase-bill" => new PurchaseBill { CompanyId = a.Id, SupplierId = supplier.Id, PurchaseBillNumber = number },
                "goods-receipt" => new GoodsReceipt { CompanyId = a.Id, SupplierId = supplier.Id, GoodsReceiptNumber = number },
                _ => throw new ArgumentException(kind)
            };
            async Task<int> Next(string kind) => System.Text.Json.JsonSerializer.SerializeToElement(
                await CompanyDocumentNumbers.PreviewAsync(db, a.Id, kind, null)).GetProperty("nextNumber").GetInt32();
            async Task<object> Save(string kind, int expected, int? custom = null)
            {
                await using var tx = await db.Database.BeginTransactionAsync();
                var next = await CompanyDocumentNumbers.AllocateAsync(db, a.Id, kind, custom);
                Assert.Equal(expected, next);
                var row = Document(kind, next); db.Add(row); await db.SaveChangesAsync(); await tx.CommitAsync(); return row;
            }
            foreach (var kind in new[] { "quote", "challan", "purchase-bill", "goods-receipt" })
            {
                Assert.Equal(1, await Next(kind)); // Stale 900 cursor with zero documents.
                var initialCustom = await Save(kind, 50, 50);
                Assert.Equal(1, await Next(kind)); // Custom first must not resurrect the stale 900 cursor.
                db.Remove(initialCustom); await db.SaveChangesAsync();
                var first = await Save(kind, 1);
                Assert.Equal(2, await Next(kind)); // Saving reset the cursor too.
                var custom = await Save(kind, 50, 50);
                Assert.Equal(2, await Next(kind)); // Custom does not move Auto.
                var second = await Save(kind, 2);
                db.Remove(first); await db.SaveChangesAsync();
                Assert.Equal(3, await Next(kind)); // No filling gaps in a nonempty series.
                db.Remove(second); db.Remove(custom); await db.SaveChangesAsync();
                Assert.Equal(1, await Next(kind)); // Last deletion restores the start.
                first = await Save(kind, 1); Assert.Equal(2, await Next(kind));
                db.Remove(first); await db.SaveChangesAsync();
            }
            var other = await db.Companies.AsNoTracking().SingleAsync(c => c.Id == b.Id);
            Assert.Equal(700, other.CurrentSalesQuoteNumber);
            var numbers = db.SalesQuotes.Where(q => q.CompanyId == a.Id).Select(q => q.QuoteNumber);
            Assert.Equal(75, await CompanyDocumentNumbers.NextAvailableAsync(numbers, 75, 700, int.MaxValue));
            Assert.Equal(1, await CompanyDocumentNumbers.NextAvailableAsync(numbers, 0, 700, int.MaxValue));
            Assert.Equal(1, await CompanyDocumentNumbers.NextAvailableAsync(numbers, 1, int.MaxValue, int.MaxValue));
            db.SalesQuotes.Add(new SalesQuote { CompanyId = a.Id, ClientId = client.Id, QuoteNumber = 5 }); await db.SaveChangesAsync();
            Assert.Equal(6, await CompanyDocumentNumbers.NextAvailableAsync(numbers, 1, 4, int.MaxValue));
            // Bills use this same helper over normal, non-demo, non-note invoices.
            var invoices = db.Invoices.Where(i => i.CompanyId == a.Id && !i.IsDemo && i.NoteKind == 0).Select(i => i.InvoiceNumber);
            db.Invoices.Add(new Invoice { CompanyId = a.Id, ClientId = client.Id, InvoiceNumber = 900001, IsDemo = true });
            db.Invoices.Add(new Invoice { CompanyId = a.Id, ClientId = client.Id, InvoiceNumber = 1, DocumentType = 9 });
            await db.SaveChangesAsync();
            Assert.Equal(1, await CompanyDocumentNumbers.NextAvailableAsync(invoices, 1, 250, 899999));
            db.Invoices.Add(new Invoice { CompanyId = a.Id, ClientId = client.Id, InvoiceNumber = 1 }); await db.SaveChangesAsync();
            Assert.Equal(2, await CompanyDocumentNumbers.NextAvailableAsync(invoices, 1, 1, 899999));
        }
        finally
        {
            Assert.StartsWith("MyApp_Numbering_Test_", new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection).InitialCatalog);
            await db.Database.EnsureDeletedAsync();
        }
    }
}
