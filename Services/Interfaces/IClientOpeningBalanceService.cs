using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>A customer's hand-entered opening balance. See
    /// <see cref="Implementations.ClientOpeningBalanceService"/>. Both methods
    /// throw <see cref="KeyNotFoundException"/> for a client outside the company.</summary>
    public interface IClientOpeningBalanceService
    {
        Task<ClientOpeningBalanceDto> GetAsync(int companyId, int clientId);
        Task<ClientOpeningBalanceDto> SetAsync(int companyId, int clientId, SetClientOpeningBalanceDto dto);
    }
}
