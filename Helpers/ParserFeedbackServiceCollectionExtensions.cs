using Microsoft.Extensions.DependencyInjection;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// DI wiring for the parser-feedback feature in a single call, so the
    /// Program.cs footprint stays one line — keeping the cross-branch diff
    /// minimal and the cherry-pick clean.
    /// </summary>
    public static class ParserFeedbackServiceCollectionExtensions
    {
        public static IServiceCollection AddParserFeedback(this IServiceCollection services)
        {
            services.AddScoped<IParserFeedbackRepository, ParserFeedbackRepository>();
            services.AddScoped<IParserFeedbackService, ParserFeedbackService>();
            return services;
        }
    }
}
