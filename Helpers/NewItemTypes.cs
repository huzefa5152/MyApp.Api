using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Turns an invoice line's <see cref="NewItemTypeDto"/> into a catalog item
    /// of the invoice's company (importer, 2026-10-28). Runs inside the
    /// invoice's transaction, so a failed invoice leaves no item behind.
    ///
    /// Every tariff code is already a shared placeholder row (HS import,
    /// CLAUDE.md 5b-2). The name decides what happens:
    ///  - unchanged from the placeholder: register that row to the company and
    ///    use it. Its shared IsFavorite is never touched -- adopting it would
    ///    hide the code from every other tenant's picker.
    ///  - edited (or no placeholder): make the company's own item through
    ///    ItemTypeService.CreateAsync, so duplicate, HS and unit rules are the
    ///    catalog's own. A row of that name and code the company can already
    ///    see is reused instead of failing.
    /// The company is always the invoice's asserted company, never the body's.
    /// The same code on several lines resolves once.
    /// </summary>
    public static class NewItemTypes
    {
        public static bool Any(IEnumerable<INewItemTypeLine>? lines) => lines?.Any(l => l.NewItemType != null) == true;

        public static async Task ResolveAsync(AppDbContext db, IItemTypeService itemTypes, int companyId,
            IEnumerable<INewItemTypeLine> lines)
        {
            var done = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var scope = new[] { companyId };
            foreach (var line in lines.Where(l => l.NewItemType != null))
            {
                var n = line.NewItemType!;
                var name = (n.Name ?? "").Trim();
                var hs = (n.HsCode ?? "").Trim();
                if (name.Length == 0 || hs.Length == 0)
                    throw new InvalidOperationException("A new item needs a name and an HS code.");
                var key = $"{hs}|{name}|{n.PlaceholderId}";
                if (!done.TryGetValue(key, out var id))
                {
                    id = await ResolveOneAsync(db, itemTypes, companyId, scope, n, name, hs);
                    done[key] = id;
                }
                line.ItemTypeId = id;
                line.NewItemType = null;
            }
        }

        private static async Task<int> ResolveOneAsync(AppDbContext db, IItemTypeService itemTypes, int companyId,
            int[] scope, NewItemTypeDto n, string name, string hs)
        {
            if (n.PlaceholderId is int pid)
            {
                var p = await db.ItemTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == pid && !t.IsDeleted);
                if (p != null
                    && string.Equals((p.HSCode ?? "").Trim(), hs, StringComparison.OrdinalIgnoreCase)
                    && string.Equals((p.Name ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase)
                    && await ItemTypeMembership.IsVisibleAsync(db, p.Id, scope))
                {
                    await RegisterAsync(db, companyId, p.Id);
                    return p.Id;
                }
            }

            var existing = await db.ItemTypes.AsNoTracking()
                .Where(t => !t.IsDeleted && t.HSCode == hs && t.Name.Trim() == name)
                .Select(t => t.Id).FirstOrDefaultAsync();
            if (existing != 0)
            {
                if (!await ItemTypeMembership.IsVisibleAsync(db, existing, scope))
                    throw new InvalidOperationException(
                        $"An item named \"{name}\" with HS code {hs} already exists. Choose a different name.");
                await RegisterAsync(db, companyId, existing);
                return existing;
            }

            var created = await itemTypes.CreateAsync(new ItemTypeDto
            {
                Name = name,
                HSCode = hs,
                UOM = string.IsNullOrWhiteSpace(n.Uom) ? null : n.Uom.Trim(),
                FbrUOMId = n.FbrUOMId,
                SaleType = string.IsNullOrWhiteSpace(n.SaleType) ? null : n.SaleType.Trim(),
                // The catalog form's default, and the near-duplicate guard's
                // "yes, I mean a separate item" signal.
                IsFavorite = true,
            }, companyId);
            return created.Id;
        }

        private static async Task RegisterAsync(AppDbContext db, int companyId, int itemTypeId)
        {
            if (await db.CompanyItemTypeSettings.AnyAsync(s => s.CompanyId == companyId && s.ItemTypeId == itemTypeId))
                return;
            db.CompanyItemTypeSettings.Add(new CompanyItemTypeSetting
            {
                CompanyId = companyId,
                ItemTypeId = itemTypeId,
                UpdatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
    }
}
