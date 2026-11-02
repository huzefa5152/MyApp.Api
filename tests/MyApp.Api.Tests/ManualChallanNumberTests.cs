using System.Text.Json;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using Xunit;

public class ManualChallanNumberTests
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    [Fact]
    public void StandaloneReferenceUsesExistingJsonAndExcelMergeFields()
    {
        var bill = new PrintBillDto { ManualChallanNumber = "DC-0212" };
        var tax = new PrintTaxInvoiceDto { ManualChallanNumber = "DC-0212" };
        Assert.Equal("DC-0212", JsonSerializer.SerializeToElement(bill, Options).GetProperty("challanNumbers")[0].GetString());
        Assert.Equal("DC-0212", JsonSerializer.SerializeToElement(tax, Options).GetProperty("challanNumbers")[0].GetString());
        Assert.Equal("DC-0212", Assert.IsType<List<object?>>(ExcelTemplateEngine.BillToDict(bill)["challanNumbers"])[0]);
        Assert.Equal("DC-0212", Assert.IsType<List<object?>>(ExcelTemplateEngine.TaxInvoiceToDict(tax)["challanNumbers"])[0]);
        Assert.Empty(bill.ChallanNumbers);
    }
    [Fact]
    public void LinkedChallansKeepTheirNumericJsonContractAndTakePrecedence()
    {
        var bill = new PrintBillDto { ManualChallanNumber = "DC-0212", ChallanNumbers = new() { 12, 13 } };
        var json = JsonSerializer.SerializeToElement(bill, Options);
        Assert.Equal(12, json.GetProperty("challanNumbers")[0].GetInt32());
        Assert.Equal(13, json.GetProperty("challanNumbers")[1].GetInt32());
        Assert.Empty(new PrintBillDto().PrintableChallanNumbers);
        Assert.Empty(new PrintTaxInvoiceDto { ManualChallanNumber = " " }.PrintableChallanNumbers);
    }
}
