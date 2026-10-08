using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;
using NPOI.XSSF.UserModel;
using Xunit;

namespace MyApp.Api.Tests;

public class EmailAssistanceTests
{
    private static EmailAttachmentPreview Csv(string text) => EmailAttachmentReader.Read("Request", new("csv", "request.csv", "text/csv", 100), Encoding.UTF8.GetBytes(text));
    [Fact]
    public void CsvUsesHeadingsQuotedDescriptionsAndEmbeddedUnitsWithoutImportingPrices()
    {
        var result = Csv("Unit Price,Quantity,Item Description,Unit\n9999,2,\"Valve, 12 mm\",Nos\n8888,3 Kg,Steel wire,\n");
        Assert.Equal(2, result.Items.Count); Assert.Equal("Valve, 12 mm", result.Items[0].Description);
        Assert.Equal(2, result.Items[0].Quantity); Assert.Equal("Kg", result.Items[1].Unit);
        Assert.All(result.Items, item => { Assert.Null(item.UnitPrice); Assert.Equal(item.Description, item.SourceDescription); });
    }
    [Fact]
    public void TextTablesPreserveDrawingAndBrandRequirementsAndRejectAmbiguousQuantities()
    {
        var result = EmailAttachmentReader.FromText("Request", "Brand required for every item. As per drawing.\nDescription  Qty  Unit\nSteel bolt  22  Nos\nUnknown row  twenty  Nos");
        Assert.Single(result.Items); Assert.True(result.RequiresBrand); Assert.True(result.RequiresSpecifications);
        Assert.Contains(result.Warnings, w => w.Contains("unreadable quantity"));
    }
    [Fact]
    public void WorkbookRepeatedHeadingsCanChangeColumnOrderAndFormulasAreNeverEvaluated()
    {
        using var workbook = new XSSFWorkbook();
        var first = workbook.CreateSheet("One");
        first.CreateRow(0).CreateCell(0).SetCellValue("Description"); first.GetRow(0).CreateCell(1).SetCellValue("Qty");
        first.CreateRow(1).CreateCell(0).SetCellValue("Bolt"); first.GetRow(1).CreateCell(1).SetCellValue(2);
        var second = workbook.CreateSheet("Two");
        second.CreateRow(0).CreateCell(0).SetCellValue("Qty"); second.GetRow(0).CreateCell(1).SetCellValue("Description");
        second.CreateRow(1).CreateCell(0).SetCellValue(3); second.GetRow(1).CreateCell(1).SetCellValue("Valve");
        second.CreateRow(2).CreateCell(0).SetCellFormula("1+1"); second.GetRow(2).CreateCell(1).SetCellValue("Formula row");
        using var stream = new MemoryStream(); workbook.Write(stream, true);
        var result = EmailAttachmentReader.Read("RFQ", new("x", "sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 100), stream.ToArray());
        Assert.Equal(new[] { "Bolt", "Valve" }, result.Items.Select(i => i.Description));
        Assert.Equal(new decimal[] { 2, 3 }, result.Items.Select(i => i.Quantity));
        Assert.Contains(result.Warnings, w => w.Contains("Formula cells were skipped"));
    }
    [Fact]
    public void PdfTextLayerExtractsPositionedColumnsAndScansRequestOcr()
    {
        var builder = new UglyToad.PdfPig.Writer.PdfDocumentBuilder();
        var font = builder.AddStandard14Font(UglyToad.PdfPig.Fonts.Standard14Fonts.Standard14Font.Helvetica);
        var page = builder.AddPage(500, 500);
        void Text(string value, int x, int y) => page.AddText(value, 12, new UglyToad.PdfPig.Core.PdfPoint(x, y), font);
        Text("Description", 30, 450); Text("Unit", 300, 450); Text("Qty", 400, 450);
        Text("Steel bolt M12", 30, 420); Text("Nos", 300, 420); Text("22", 400, 420);
        var result = EmailAttachmentReader.Read("RFQ", new("pdf", "sample.pdf", "application/pdf", 100), builder.Build());
        Assert.False(result.RequiresOcr); Assert.Equal("Steel bolt M12", Assert.Single(result.Items).Description); Assert.Equal(22, result.Items[0].Quantity);
        var empty = new UglyToad.PdfPig.Writer.PdfDocumentBuilder(); empty.AddPage(500, 500);
        Assert.True(EmailAttachmentReader.Read("RFQ", new("pdf", "scan.pdf", "application/pdf", 100), empty.Build()).RequiresOcr);
    }
    [Fact]
    public void ReaderRejectsSpoofedFormatsAndExcessiveText()
    {
        Assert.Throws<ArgumentException>(() => EmailAttachmentReader.Read("RFQ", new("x", "fake.pdf", "application/pdf", 3), [1, 2, 3]));
        Assert.Throws<ArgumentException>(() => EmailAttachmentReader.Read("RFQ", new("x", "fake.png", "image/png", 3), [1, 2, 3]));
        Assert.Throws<ArgumentException>(() => EmailAttachmentReader.Read("RFQ", new("x", "fake.xlsx", "application/zip", 3), [1, 2, 3]));
        Assert.Throws<ArgumentException>(() => EmailAttachmentReader.FromText("RFQ", new string('x', 250_001)));
        var image = EmailAttachmentReader.Read("RFQ", new("x", "sample.png", "image/png", 8), [137, 80, 78, 71, 13, 10, 26, 10]);
        Assert.True(image.RequiresOcr); Assert.Empty(image.Items);
    }
    [Theory]
    [InlineData("Bolt M12 50 mm", "Bolt M13 50 mm", 0)]
    [InlineData("bolt M12", "  BOLT M12  ", 100)]
    [InlineData("", "Bolt", 0)]
    public void MatchingPreservesModelNumbers(string requested, string candidate, int expected) => Assert.Equal(expected, EmailItemMatching.Score(requested, candidate));

    [Fact, Trait("Category", "LocalSql")]
    public async Task SqlAttachmentAndPricingAssistanceRemainReviewedScopedAndPermissionBound()
    {
        var raw = Environment.GetEnvironmentVariable("EMAIL_TEST_CONNECTION") ?? throw new InvalidOperationException("Set EMAIL_TEST_CONNECTION to an approved disposable local database.");
        DevelopmentSqlGuard.AssertLocal(raw, Environment.MachineName, false);
        var connection = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(raw);
        Assert.StartsWith("MyApp_EmailWorkspace_Test_", connection.InitialCatalog); connection.InitialCatalog += "_Assistance";
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection.ConnectionString).Options);
        await db.Database.EnsureCreatedAsync();
        await using var tx = await db.Database.BeginTransactionAsync();
        var company = new Company { Name = "Sample Assistance Company" }; var other = new Company { Name = "Other Assistance Company" };
        var user = new User { Username = "assistance-" + Guid.NewGuid().ToString("N"), FullName = "Sample User" };
        db.AddRange(company, other, user); await db.SaveChangesAsync();
        var customer = new Client { CompanyId = company.Id, Name = "Sample Buyer" };
        var otherCustomer = new Client { CompanyId = company.Id, Name = "Different Buyer" };
        var foreign = new Client { CompanyId = other.Id, Name = "Foreign Buyer" };
        var supplier = new Supplier { CompanyId = company.Id, Name = "Sample Supplier" };
        var foreignSupplier = new Supplier { CompanyId = other.Id, Name = "Foreign Supplier" };
        db.AddRange(customer, otherCustomer, foreign, supplier, foreignSupplier); await db.SaveChangesAsync();
        var guard = new Guard { Allowed = [company.Id] }; var grants = new Grants(); var provider = new Provider();
        var service = new EmailWorkspaceService(db, guard, grants, provider, new EphemeralDataProtectionProvider(), null!);
        var mailbox = new GmailConnection { OwnerUserId = user.Id, GoogleSubject = "sample-subject", EmailAddress = "owner@example.com", ProtectedRefreshToken = service.Protect("sample-refresh") };
        db.Add(mailbox); await db.SaveChangesAsync();
        db.GmailCompanyLinks.Add(new() { CompanyId = company.Id, ConnectionId = mailbox.Id });
        var message = new GmailMessage { ConnectionId = mailbox.Id, ProviderMessageId = "sample-message", ThreadId = "sample-thread", Sender = "buyer@example.com", Subject = "Quotation", ReceivedAt = DateTime.UtcNow,
            ProtectedContent = service.Protect(new EmailContent("Please quote", "", [new("csv", "request.csv", "text/csv", 100), new("image", "scan.png", "image/png", 100)])) };
        db.Add(message); await db.SaveChangesAsync();
        var draft = new EmailDraftDto { ClientId = customer.Id, Reviewed = true, Items = [new() { Description = "Existing item", Quantity = 1, Unit = "Nos", UnitPrice = 10 }] };
        var enquiry = new EmailEnquiry { CompanyId = company.Id, MessageId = message.Id, DecidedByUserId = user.Id, ProtectedDraft = service.Protect(draft) };
        db.Add(enquiry); await db.SaveChangesAsync(); draft.Revision = enquiry.Revision;
        var request = new EmailAttachmentRequest { AttachmentId = "csv", Revision = enquiry.Revision };
        var before = enquiry.ProtectedDraft;
        var preview = await service.PreviewAttachmentAsync(user.Id, company.Id, message.Id, request, default);
        Assert.Single(preview.Items); Assert.Equal(before, enquiry.ProtectedDraft); Assert.Empty(await db.SalesQuotes.ToListAsync());
        request.Mode = "Append";
        var appended = await service.ApplyAttachmentAsync(user.Id, company.Id, message.Id, request, default);
        Assert.Equal(2, appended.Items.Count); Assert.False(appended.Reviewed); Assert.True(appended.RequiresBrand);
        Assert.Null(appended.Items[1].UnitPrice); Assert.Equal("Existing item", appended.Items[0].Description);
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.ApplyAttachmentAsync(user.Id, company.Id, message.Id, request, default));
        request.Revision = appended.Revision; request.Mode = "Replace";
        var replaced = await service.ApplyAttachmentAsync(user.Id, company.Id, message.Id, request, default);
        Assert.Single(replaced.Items); Assert.Equal("Steel bolt M12", replaced.Items[0].Description);
        Assert.NotEmpty(EmailWorkspaceRules.ValidateDraft(replaced, replaced.RequiresBrand, replaced.RequiresSpecifications));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.PreviewAttachmentAsync(user.Id, other.Id, message.Id, request, default));
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.PreviewAttachmentAsync(user.Id, company.Id, message.Id, new() { AttachmentId = "unknown", Revision = replaced.Revision }, default));
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.PreviewAttachmentAsync(user.Id, company.Id, message.Id, new() { AttachmentId = "image", Revision = replaced.Revision, Pages = [[new() { Text = "x", Left = -1 }]] }, default));
        OcrWordDto Word(string text, int left, int top) => new() { Text = text, Left = left, Right = left + text.Length * 6, Top = top, Bottom = top + 10, Confidence = 99 };
        var ocr = await service.PreviewAttachmentAsync(user.Id, company.Id, message.Id, new() { AttachmentId = "image", Revision = replaced.Revision,
            Pages = [[Word("Description", 0, 0), Word("Unit", 200, 0), Word("Qty", 300, 0), Word("Washer", 0, 30), Word("Nos", 200, 30), Word("4", 300, 30)]] }, default);
        Assert.Equal("Washer", Assert.Single(ocr.Items).Description); Assert.Equal(4, ocr.Items[0].Quantity);
        SalesQuote Quote(int owner, int client, int number, decimal price, string unit = "Nos") => new() { CompanyId = owner, ClientId = client, QuoteNumber = number, Date = DateTime.UtcNow,
            Items = [new() { Description = "Steel bolt M12", Quantity = 1, Unit = unit, UnitPrice = price }] };
        var previous = Quote(company.Id, customer.Id, 1, 75);
        db.AddRange(previous, Quote(company.Id, otherCustomer.Id, 2, 999), Quote(other.Id, foreign.Id, 1, 888), Quote(company.Id, customer.Id, 3, 777, "Kg"));
        db.ItemDescriptions.AddRange(new() { CompanyId = company.Id, Name = "Steel bolt M12", UOM = "Nos" }, new() { CompanyId = other.Id, Name = "Foreign secret product", UOM = "Nos" });
        db.PurchaseBills.AddRange(new() { CompanyId = company.Id, SupplierId = supplier.Id, PurchaseBillNumber = 1, Date = DateTime.UtcNow, Items = [new() { Description = "Steel bolt M12", UOM = "Nos", Quantity = 1, UnitPrice = 30 }] },
            new() { CompanyId = other.Id, SupplierId = foreignSupplier.Id, PurchaseBillNumber = 1, Date = DateTime.UtcNow, Items = [new() { Description = "Steel bolt M12", UOM = "Nos", Quantity = 1, UnitPrice = 999 }] });
        await db.SaveChangesAsync();
        var assistance = new EmailAssistanceRequest { Revision = replaced.Revision, ClientId = customer.Id, Items = replaced.Items };
        var result = await service.AssistItemsAsync(user.Id, company.Id, message.Id, assistance, default);
        var exact = Assert.Single(Assert.Single(result).Candidates);
        Assert.Equal(75, exact.LastQuote!.UnitPrice); Assert.Equal(30, exact.LastPurchase!.UnitPrice);
        Assert.Null(replaced.Items[0].UnitPrice);
        grants.Denied.Add("purchasebills.list.view");
        Assert.Null(Assert.Single((await service.AssistItemsAsync(user.Id, company.Id, message.Id, assistance, default))[0].Candidates).LastPurchase);
        grants.Denied.Add("salesquotes.list.view");
        Assert.Null(Assert.Single((await service.AssistItemsAsync(user.Id, company.Id, message.Id, assistance, default))[0].Candidates).LastQuote);
        grants.Denied.Clear(); assistance.ClientId = foreign.Id;
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.AssistItemsAsync(user.Id, company.Id, message.Id, assistance, default)); assistance.ClientId = customer.Id;
        var pastMessage = new GmailMessage { ConnectionId = mailbox.Id, ProviderMessageId = "prior-message", Sender = "buyer@example.com", Subject = "Prior enquiry", ProtectedContent = service.Protect(new EmailContent("", "", [])) };
        db.Add(pastMessage); await db.SaveChangesAsync();
        db.EmailEnquiries.Add(new() { CompanyId = company.Id, MessageId = pastMessage.Id, DecidedByUserId = user.Id, SalesQuoteId = previous.Id,
            ProtectedDraft = service.Protect(new EmailDraftDto { ClientId = customer.Id, Reviewed = true, Items = [new() { SourceDescription = "Customer fastener code A", Description = "Steel bolt M12", Unit = "Nos" }] }) });
        await db.SaveChangesAsync();
        assistance.Items = [new() { Description = "Customer fastener code A", Unit = "Nos" }];
        var remembered = Assert.Single((await service.AssistItemsAsync(user.Id, company.Id, message.Id, assistance, default))[0].Candidates);
        Assert.Equal("Previously approved for this customer", remembered.Reason); Assert.Equal("Steel bolt M12", remembered.Description);
        assistance.ClientId = otherCustomer.Id;
        Assert.Empty((await service.AssistItemsAsync(user.Id, company.Id, message.Id, assistance, default))[0].Candidates);
        provider.AfterDownload = () => grants.Denied.Add("email.workspace.use");
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.PreviewAttachmentAsync(user.Id, company.Id, message.Id, new() { AttachmentId = "csv", Revision = replaced.Revision }, default));
        grants.Denied.Clear(); provider.AfterDownload = null; guard.Allowed.Clear();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.AssistItemsAsync(user.Id, company.Id, message.Id, assistance, default));
        await tx.RollbackAsync();
    }
    private sealed class Guard : ICompanyAccessGuard
    {
        public HashSet<int> Allowed = [];
        public Task<bool> HasAccessAsync(int user, int company) => Task.FromResult(Allowed.Contains(company));
        public Task AssertAccessAsync(int user, int company) => Allowed.Contains(company) ? Task.CompletedTask : throw new UnauthorizedAccessException();
        public Task<HashSet<int>> GetAccessibleCompanyIdsAsync(int user) => Task.FromResult(Allowed);
        public void InvalidateUser(int user) { } public void InvalidateAll() { }
    }
    private sealed class Grants : IPermissionService
    {
        public HashSet<string> Denied = [];
        public Task<bool> HasPermissionAsync(int user, string key) => Task.FromResult(!Denied.Contains(key));
        public Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int user) => Task.FromResult<IReadOnlyCollection<string>>([]);
        public void InvalidateUser(int user) { } public void InvalidateAll() { }
        public bool IsSeedAdmin(int user) => false;
        public Task<bool> HasMcpToolAccessAsync(int user, string name) => Task.FromResult(false);
    }
    private sealed class Provider : IGmailProvider
    {
        public Action? AfterDownload;
        public bool IsConfigured => true; public string RedirectUri => "http://localhost/email-workspace";
        public string AuthorizationUrl(string state, string challenge) => throw new NotSupportedException();
        public Task<GmailIdentity> ExchangeAsync(string code, string verifier, CancellationToken ct) => throw new NotSupportedException();
        public Task<string> RefreshAsync(string refresh, CancellationToken ct) => Task.FromResult("sample-access");
        public Task<string> GetHistoryIdAsync(string access, CancellationToken ct) => throw new NotSupportedException();
        public Task<GmailBatch> ListAsync(string access, DateTime since, string? page, CancellationToken ct) => throw new NotSupportedException();
        public Task<GmailBatch> HistoryAsync(string access, string history, string? page, CancellationToken ct) => throw new NotSupportedException();
        public Task<GmailFetchedMessage?> ReadAsync(string access, string id, CancellationToken ct) => throw new NotSupportedException();
        public Task<byte[]> AttachmentAsync(string access, string message, string attachment, CancellationToken ct)
        {
            AfterDownload?.Invoke();
            return Task.FromResult(attachment == "image" ? new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 } : Encoding.UTF8.GetBytes("Brand required for every item\nDescription,Qty,Unit,Price\nSteel bolt M12,2,Nos,999\n"));
        }
    }
}
