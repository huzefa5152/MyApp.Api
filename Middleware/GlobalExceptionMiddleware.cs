using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware
{
    public class GlobalExceptionMiddleware
    {
        private readonly RequestDelegate _next;

        public GlobalExceptionMiddleware(RequestDelegate next) => _next = next;

        // Field names whose value should be replaced with "***" before
        // a request body is persisted to AuditLogs. The audit table is
        // not encrypted and is itself viewable via auditlogs.view, so
        // anything that looks like a credential / token must be scrubbed.
        // Match is case-insensitive and applies to JSON bodies — form
        // bodies are unusual on this API (JWT-bearer + JSON).
        private static readonly string[] SensitiveFieldNames = new[]
        {
            "password", "currentpassword", "newpassword", "oldpassword",
            "passwordhash", "confirmpassword",
            "fbrtoken", "token", "apikey", "api_key", "secret",
            "jwt", "authorization", "bearer",
            "connectionstring",
        };

        private static readonly Regex SensitiveJsonRegex = new(
            @"(""(?:" + string.Join("|", SensitiveFieldNames) + @")""\s*:\s*)(""(?:[^""\\]|\\.)*""|null)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static string? RedactSensitive(string? body)
        {
            if (string.IsNullOrEmpty(body)) return body;
            return SensitiveJsonRegex.Replace(body, "$1\"***\"");
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
                    requestBody = RedactSensitive(requestBody);
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

        private static async Task HandleExceptionAsync(HttpContext context, Exception ex)
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
                    requestBody = RedactSensitive(requestBody);
                }
            }
            catch { /* ignore body read failures */ }

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
            catch { /* logging must never crash the pipeline */ }

            // Return standardized JSON error response
            context.Response.ContentType = "application/json";
            context.Response.StatusCode = statusCode;

            var response = new
            {
                message = statusCode >= 500
                    ? "An unexpected error occurred. Please try again later."
                    : ex.Message,
                statusCode
            };

            await context.Response.WriteAsync(JsonSerializer.Serialize(response));
        }
    }
}
