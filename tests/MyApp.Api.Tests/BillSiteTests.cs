using MyApp.Api.Helpers;
using MyApp.Api.Models;
using Xunit;

public class BillSiteTests
{
    [Fact]
    public void ChallanSitesWinInChallanOrder()
    {
        var bill = new Invoice
        {
            Site = "Own site",
            DeliveryChallans = new List<DeliveryChallan>
            {
                new() { ChallanNumber = 9, Site = " Plant B " },
                new() { ChallanNumber = 3, Site = "Plant A" },
                new() { ChallanNumber = 5, Site = "plant a" },
                new() { ChallanNumber = 7, Site = " " },
            },
        };
        Assert.Equal("Plant A, Plant B", BillSite.Of(bill, ", "));
    }

    [Fact]
    public void AStandaloneBillShowsItsOwnSite()
    {
        Assert.Equal("Head Office", BillSite.Of(new Invoice { Site = " Head Office " }, ", "));
        Assert.Equal("", BillSite.Of(new Invoice(), ", "));
        Assert.Equal("Own", BillSite.Of(new Invoice { Site = "Own", DeliveryChallans = new List<DeliveryChallan> { new() { Site = "" } } }, ", "));
    }

    [Fact]
    public void CleanTrimsAndTreatsBlankAsNone()
    {
        Assert.Null(BillSite.Clean("   "));
        Assert.Null(BillSite.Clean(null));
        Assert.Equal("Plant", BillSite.Clean(" Plant "));
        Assert.Equal(BillSite.MaxLength, BillSite.Clean(new string('x', 300))!.Length);
    }
}
