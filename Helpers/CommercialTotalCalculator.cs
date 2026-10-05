namespace MyApp.Api.Helpers;

public static class CommercialTotalCalculator
{
    public static decimal Total(decimal taxTotal, decimal freightCharges) => taxTotal + freightCharges;
    public static decimal Collectible(decimal taxTotal, decimal withholding, decimal freightCharges) =>
        Math.Max(0m, Total(taxTotal, freightCharges) - withholding);
    public static decimal Validate(decimal amount)
    {
        if (amount < 0m || amount > 9999999999999999.99m || Math.Round(amount, 2) != amount)
            throw new InvalidOperationException("Freight / cartage charges must be a non-negative amount with at most two decimal places.");
        return amount;
    }
}
