using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IMergeFieldRepository
    {
        Task<List<MergeField>> GetByTemplateTypeAsync(string templateType);
        Task<List<MergeField>> GetAllAsync();
        Task<MergeField?> GetByIdAsync(int id);
        Task<MergeField> CreateAsync(MergeField mergeField);
        Task<MergeField> UpdateAsync(MergeField mergeField);
        Task DeleteAsync(MergeField mergeField);
    }
}
