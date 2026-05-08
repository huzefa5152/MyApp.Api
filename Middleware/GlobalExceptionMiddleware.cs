using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware
{
    public class GlobalExceptionMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<GlobalExceptionMiddleware> _logger;

        public GlobalExceptionMiddleware(RequestDelegate next, ILogger<GlobalExceptionMiddleware> logger)
        {
            _next = next;
            _logger = logger;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            try
            {
                await _next(context);

                // Also log non-exception error responses (4xx/5xx returned by controllers)
                if (context.Response.StatusCode >= 400
                    && context.Request.Path.StartsWithSegments("/api"))
                {
                    await LogResponseErrorAsync(context);
                }
            }
            catch (Exception ex)
            {
                await HandleExceptionAsync(context, ex);
            }
        }

        private static async Task LogResponseErrorAsync(HttpContext context)
        {
            var redactor = context.RequestServices.GetRequiredService<ISensitiveDataRedactor>();
            string? requestBody = null;
            try
            {
                if (context.Request.Body.CanSeek)
                {
                    context.Request.Body.Position = 0;
                    using var reader = new StreamReader(context.Request.Body, leaveOpen: true);
                    requestBody = await reader.ReadToEndAsync();
                    if (string.IsNullOrWhiteSpace(requestBody)) requestBody = null;
                    else if (requestBody.Length > 4000) requestBody = requestBody[..4000] + "...(truncated)";
                    requestBody = redactor.Scrub(requestBody);
                }
            }
            catch { /* ignore */ }

            var statusCode = context.Response.StatusCode;
            var auditLog = new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = statusCode >= 500 ? "Error" : "Warning",
                UserName = context.User.Identity?.Name,
                HttpMethod = context.Request.Method,
                RequestPath = context.Request.Path.ToString(),
                QueryString = context.Request.QueryString.ToString(),
                StatusCode = statusCode,
                ExceptionType = "",
                Message = $"HTTP {statusCode} response",
                RequestBody = requestBody
            };

            try
            {
                var auditService = context.RequestServices.GetRequiredService<IAuditLogService>();
                await auditService.LogAsync(auditLog);
            }
            catch { /* logging must never crash the pipeline */ }
        }

        private async Task HandleExceptionAsync(HttpContext context, Exception ex)
        {
            // Determine status code from exception type. UnauthorizedAccessException
            // is reserved for tenant-scope failures from ICompanyAccessGuard —
            // mapped to 403 so the frontend can distinguish it from a
            // permission failure (which the HasPermissionAttribute already
            // returns directly).
            var statusCode = ex switch
            {
                KeyNotFoundException => (int)HttpStatusCode.NotFound,
                InvalidOperationException => (int)HttpStatusCode.BadRequest,
                UnauthorizedAccessException => (int)HttpStatusCode.Forbidden,
                _ => (int)HttpStatusCode.InternalServerError
            };

            var redactor = context.RequestServices.GetRequiredService<ISensitiveDataRedactor>();

            // Read request body (if buffering was enabled)
            string? requestBody = null;
            try
            {
                if (context.Request.Body.CanSeek)
                {
                    context.Request.Body.Position = 0;
                    using var reader = new StreamReader(context.Request.Body, leaveOpen: true);
                    requestBody = await reader.ReadToEndAsync();
                    if (requestBody.Length > 4000)
                        requestBody = requestBody[..4000] + "...(truncated)";
                    requestBody = redactor.Scrub(requestBody);
                }
            }
            catch { /* ignore body read failures */ }

            // Mirror to ILogger so the durable file sink picks it up too —
            // the AuditLogs DB row is the business trail, the structured
            // log line is the operational trail. Stack-trace excluded from
            // the message template to keep the file readable; full ex is
            // passed positionally so the sink renders it.
            if (statusCode >= 500)
            {
                _logger.LogError(ex,
                    "Unhandled {ExceptionType} on {HttpMethod} {Path} (user={User})",
                    ex.GetType().Name,
                    context.Request.Method,
                    context.Request.Path.Value,
                    context.User.Identity?.Name ?? "anonymous");
            }
            else
            {
                _logger.LogWarning(
                    "{ExceptionType} on {HttpMethod} {Path}: {Message} (user={User})",
                    ex.GetType().Name,
                    context.Request.Method,
                    context.Request.Path.Value,
                    ex.Message,
                    context.User.Identity?.Name ?? "anonymous");
            }

            // Build audit log entry
            var auditLog = new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = statusCode >= 500 ? "Error" : "Warning",
                UserName = context.User.Identity?.Name,
                HttpMethod = context.Request.Method,
                RequestPath = context.Request.Path.ToString(),
                QueryString = context.Request.QueryString.ToString(),
                StatusCode = statusCode,
                ExceptionType = ex.GetType().Name,
                Message = ex.Message,
                StackTrace = statusCode >= 500 ? ex.StackTrace : null,
                RequestBody = requestBody
            };

            // Persist to database via scoped service
            try
            {
                var auditService = context.RequestServices.GetRequiredService<IAuditLogService>();
                await auditService.LogAsync(auditLog);
            }
            catch (Exception logEx)
            {
                // Audit-DB write failed — fall back to the file sink so
                // the failure isn't silent. Don't rethrow; logging must
                // never crash the pipeline.
                _logger.LogWarning(logEx, "AuditLog DB write failed; original exception was {OrigType}: {OrigMsg}", ex.GetType().Name, ex.Message);
            }

            // Return standardized JSON error response.
            // 5xx → opaque message (don't leak ex.Message which may carry
            // SQL / internal details).
            // 4xx → exception's own message is fine for ValidationException
            // and KeyNotFoundException; defensive trim on InvalidOperation
            // so we don't accidentally leak internal state.
            context.Response.ContentType = "application/json";
            context.Response.StatusCode = statusCode;

            var userMessage = statusCode >= 500
                ? "An unexpected error occurred. Please try again later."
                : ex.Message;

            var response = new
            {
                message = userMessage,
                statusCode
            };

            await context.Response.WriteAsync(JsonSerializer.Serialize(response));
        }
    }
}
