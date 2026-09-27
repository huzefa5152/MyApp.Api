using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// A company's own names for catalog items (CompanyItemTypeSetting.DisplayName).
    ///
    /// ItemType is ONE catalog shared by every company, so renaming a row to
    /// follow one company's stock sheet would rename another company's item on
    /// its dashboard, invoices and prints. A company that names an item
    /// differently records it here, and every screen that shows that company's
    /// items asks this first.
    /// </summary>
    public static class CompanyItemNames
    {
        /// <summary>itemTypeId -> the company's name, for the ids that have one.</summary>
        public static async Task<Dictionary<int, string>> ForCompanyAsync(
            AppDbContext db, int companyId, IEnumerable<int>? itemTypeIds = null)
        {
            var q = db.CompanyItemTypeSettings.AsNoTracking()
                .Where(s => s.CompanyId == companyId && s.DisplayName != null && s.DisplayName != "");
            if (itemTypeIds != null)
            {
                var ids = itemTypeIds.Distinct().ToList();
                if (ids.Count == 0) return new Dictionary<int, string>();
                q = q.Where(s => ids.Contains(s.ItemTypeId));
            }
            return await q.ToDictionaryAsync(s => s.ItemTypeId, s => s.DisplayName!);
        }

        /// <summary>The company's name when it has one, else the catalog name.</summary>
        public static string Pick(Dictionary<int, string> names, int itemTypeId, string catalogName) =>
            names.TryGetValue(itemTypeId, out var n) ? n : catalogName;
    }
}
