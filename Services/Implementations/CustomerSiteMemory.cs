using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations;

public class CustomerSiteMemory : ICustomerSiteMemory
{
    private readonly IPermissionService _permissions;
    private readonly IClientService _clients;

    public CustomerSiteMemory(IPermissionService permissions, IClientService clients)
    {
        _permissions = permissions;
        _clients = clients;
    }

    public async Task RememberAsync(int userId, int clientId, int companyId, string? site)
    {
        if (string.IsNullOrWhiteSpace(site) || clientId <= 0) return;
        if (!await _permissions.HasPermissionAsync(userId, "clients.manage.update")) return;
        await _clients.AddSiteAsync(clientId, companyId, site);
    }
}
