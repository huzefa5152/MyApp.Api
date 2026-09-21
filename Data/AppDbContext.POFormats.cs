using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data;

public partial class AppDbContext
{
    private async Task ValidatePOFormatWritesAsync(CancellationToken ct)
    {
        foreach (var entry in ChangeTracker.Entries<POFormat>()
            .Where(e => e.State is EntityState.Added or EntityState.Modified))
        {
            var format = entry.Entity;
            if (format.CompanyId is not > 0 || format.ClientId is not > 0)
                throw new InvalidOperationException("A PO format requires a company and client.");
            if (entry.State == EntityState.Modified && entry.Property(f => f.CompanyId).IsModified)
                throw new InvalidOperationException("PO format ownership cannot be changed.");
            var client = await Clients.AsNoTracking().FirstOrDefaultAsync(c => c.Id == format.ClientId, ct);
            if (client == null || client.CompanyId != format.CompanyId)
                throw new InvalidOperationException("The PO format client must belong to its company.");
            format.ClientGroupId = client.ClientGroupId;
        }
    }
}
