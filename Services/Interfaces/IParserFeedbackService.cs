using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Parser-feedback business logic — recording a verdict (and retaining the
    /// original PDF), listing incorrect imports, download/bulk-download, and
    /// accuracy statistics. This interface is identical across branches; only
    /// <see cref="Repositories.Interfaces.IParserFeedbackRepository"/> may differ.
    /// </summary>
    public interface IParserFeedbackService
    {
        Task<ParserFeedbackDto> RecordAsync(RecordParserFeedbackInput input);
        Task<ParserFeedbackPageDto> GetIncorrectAsync(ParserFeedbackQuery query);
        Task<ParserFeedbackStatisticsDto> GetStatisticsAsync();
        Task<ParserFeedbackPdf?> GetPdfAsync(int id);
        Task<byte[]?> GetBulkZipAsync(IReadOnlyCollection<int> ids);
    }

    /// <summary>Input for recording one feedback verdict from the Review screen.</summary>
    public class RecordParserFeedbackInput
    {
        public IFormFile? File { get; set; }
        public ParserFeedbackStatus Status { get; set; }
        public int? PurchaseOrderId { get; set; }
        public int? CompanyId { get; set; }
        public string? ParserVersion { get; set; }
        public string? OriginalFileName { get; set; }
        public string? CreatedBy { get; set; }
    }

    /// <summary>Filter/sort/paging for the incorrect-imports list.</summary>
    public class ParserFeedbackQuery
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        public string? ParserVersion { get; set; }
        public string? SortBy { get; set; }        // createddate | filename | parserversion
        public bool Descending { get; set; } = true;
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = 50;
    }

    /// <summary>Resolved PDF ready to stream: absolute path + download name.</summary>
    public class ParserFeedbackPdf
    {
        public string FilePath { get; set; } = "";
        public string FileName { get; set; } = "download.pdf";
    }
}
