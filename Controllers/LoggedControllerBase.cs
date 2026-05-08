using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Drop-in replacement for ControllerBase that injects an ILogger
    /// scoped to the concrete controller type. Audit H-5 (2026-05-08):
    /// pre-fix, only 3 of 30 controllers had a logger; the rest leaned
    /// entirely on GlobalExceptionMiddleware for crash logging and emitted
    /// no operational trail.
    ///
    /// Usage in concrete controllers:
    ///   public class FooController : LoggedControllerBase {
    ///       public FooController(ILogger&lt;FooController&gt; logger) : base(logger) {}
    ///       ...
    ///       _logger.LogInformation("Something happened {ItemId}", id);
    ///   }
    ///
    /// The base does NOT inject anything by activator-magic; controllers
    /// still declare ILogger&lt;T&gt; in their constructor and pass it through.
    /// That keeps ASP.NET's DI lifetime story intact and lets each
    /// controller use the right Logger&lt;T&gt; for category-based filtering
    /// in appsettings.
    /// </summary>
    public abstract class LoggedControllerBase : ControllerBase
    {
        protected readonly ILogger _logger;

        protected LoggedControllerBase(ILogger logger) => _logger = logger;
    }
}
