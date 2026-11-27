namespace MyApp.Api.Services.Interfaces;

/// <summary>
/// A site typed on a customer document (challan, sales order, standalone bill)
/// joins the customer's own site list, so every site picker offers it next
/// time. Editing the customer is its own permission: without
/// <c>clients.manage.update</c> the document keeps the site and the customer is
/// left as it is. Callers pass the document's STORED client and company, never
/// the request's.
/// </summary>
public interface ICustomerSiteMemory
{
    Task RememberAsync(int userId, int clientId, int companyId, string? site);
}
