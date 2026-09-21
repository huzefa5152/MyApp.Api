using Microsoft.EntityFrameworkCore;
namespace MyApp.Api.Data;

public static class CompanyCatalogSeeder
{
    public static async Task SeedUnitsAsync(AppDbContext db, int companyId)
    {
        string[] names = { "MT", "Bill of lading", "SET", "KWH", "40KG", "Liter", "SqY", "Bag", "KG", "MMBTU", "Meter", "Pcs", "Carat", "Cubic Metre", "Dozen", "Gram", "Gallon", "Kilogram", "Pound", "Timber Logs", "Numbers, pieces, units", "Packs", "Pair", "Square Foot", "Square Metre", "Thousand Unit", "Mega Watt", "Foot", "Barrels", "NO", "Others", "1000 kWh" };
        var decimals = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "KG", "Kilogram", "Gram", "Pound", "Liter", "Litre", "Gallon", "MT", "Carat",
            "Square Foot", "Square Metre", "SqY", "Cubic Metre", "Meter", "Foot", "MMBTU", "KWH", "1000 kWh", "Mega Watt" };
        foreach (var name in names)
        {
            var allowsDecimal = decimals.Contains(name);
            await db.Database.ExecuteSqlInterpolatedAsync($@"
                INSERT INTO Units (CompanyId, Name, AllowsDecimalQuantity)
                SELECT {companyId}, {name}, {allowsDecimal}
                WHERE NOT EXISTS (SELECT 1 FROM Units WHERE CompanyId={companyId} AND Name={name})");
        }
    }
}
