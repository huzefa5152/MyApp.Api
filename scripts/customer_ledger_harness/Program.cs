using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using MyApp.Api.Controllers;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

// Offline: exercise the action and its actual authorization filters without
// starting the application or writing any database records.
var pass = 0;
void Check(string label, bool condition)
{
    if (!condition) throw new Exception(label);
    Console.WriteLine($"PASS: {label}");
    pass++;
}
var rows = new List<PrintTemplate>();
var repo = Proxy.For<IPrintTemplateRepository>((method, args) => method.Name == "GetByCompanyAsync"
    ? Task.FromResult(rows) : throw new Exception("Unexpected repository operation"));
var rejectedDivision = false;
var divisionChecks = 0;
var divisions = Proxy.For<IDivisionAccessGuard>((method, args) =>
{
    if (method.Name != "AssertAccessAsync") throw new Exception("Unexpected division operation");
    divisionChecks++;
    if (rejectedDivision) throw new UnauthorizedAccessException();
    return Task.CompletedTask;
});
var controller = new PrintTemplatesController(repo, null!, null!, divisions, null!, null!)
{
    ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
};
PrintTemplate Template(int id, int company, string type, int? division, bool isDefault = true) =>
    new() { Id = id, CompanyId = company, TemplateType = type, DivisionId = division,
        IsDefault = isDefault, HtmlContent = $"layout-{id}" };
async Task<string?> Layout(int? division = null)
{
    var result = await controller.GetCustomerLedgerInvoiceLayout(1, division);
    return result is OkObjectResult ok
        ? JsonSerializer.SerializeToElement(ok.Value).GetProperty("HtmlContent").GetString() : null;
}
rows.AddRange([Template(1, 2, "Bill", null), Template(3, 1, "Bill", 9), Template(4, 1, "TaxInvoice", null)]);
Check("another company's Bill cannot replace this company's Tax Invoice", await Layout() == "layout-4");
rows.Add(Template(5, 1, "Bill", null));
Check("company Bill supplies the ledger identity", await Layout() == "layout-5");
Check("explicit division supplies its own invoice layout", await Layout(9) == "layout-3");
Check("division access is asserted", divisionChecks == 1);
Check("missing division layout falls back to company", await Layout(10) == "layout-5");
rows.Add(Template(2, 1, "Bill", null, false));
Check("selected default wins over an older layout", await Layout() == "layout-5");
rejectedDivision = true;
try { await Layout(9); throw new Exception("Division was not rejected"); }
catch (UnauthorizedAccessException) { Check("inaccessible division is refused", true); }
rows.Clear();
Check("no saved invoice layout returns the built-in fallback signal", await controller.GetCustomerLedgerInvoiceLayout(1) is NoContentResult);

var tenantAllowed = true;
var reportAllowed = true;
var companyGuard = Proxy.For<ICompanyAccessGuard>((method, args) => method.Name == "HasAccessAsync"
    ? Task.FromResult(tenantAllowed) : throw new Exception("Unexpected tenant operation"));
var permission = Proxy.For<IPermissionService>((method, args) => method.Name == "HasPermissionAsync"
    ? Task.FromResult(reportAllowed && (string)args![1]! == "accounting.reports.view")
    : throw new Exception("Unexpected permission operation"));
using var services = new ServiceCollection().AddSingleton(companyGuard).AddSingleton(permission).BuildServiceProvider();
var action = typeof(PrintTemplatesController).GetMethod(nameof(controller.GetCustomerLedgerInvoiceLayout))!;
async Task<IActionResult?> Authorize<T>() where T : TypeFilterAttribute
{
    var context = new DefaultHttpContext { RequestServices = services,
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "2")], "test")) };
    var route = new RouteData(); route.Values["companyId"] = 1;
    var authorization = new AuthorizationFilterContext(new ActionContext(context, route, new ActionDescriptor()), []);
    var attribute = action.GetCustomAttribute<T>() ?? throw new Exception("Missing authorization attribute");
    await ((IAsyncAuthorizationFilter)attribute.CreateInstance(services)).OnAuthorizationAsync(authorization);
    return authorization.Result;
}
Check("report-only permission can read its layout", await Authorize<HasPermissionAttribute>() is null);
reportAllowed = false;
Check("missing report permission is refused", await Authorize<HasPermissionAttribute>() is ObjectResult { StatusCode: 403 });
Check("accessible tenant is allowed", await Authorize<AuthorizeCompanyAttribute>() is null);
tenantAllowed = false;
Check("inaccessible tenant is refused by the real route filter", await Authorize<AuthorizeCompanyAttribute>() is ObjectResult { StatusCode: 403 });
Console.WriteLine($"{pass} passed, 0 failed");

public class Proxy : DispatchProxy
{
    public Func<MethodInfo, object?[]?, object?> Handler = null!;
    protected override object? Invoke(MethodInfo? method, object?[]? args) => Handler(method!, args);
    public static T For<T>(Func<MethodInfo, object?[]?, object?> handler) where T : class
    {
        var instance = Create<T, Proxy>();
        ((Proxy)(object)instance).Handler = handler;
        return instance;
    }
}
