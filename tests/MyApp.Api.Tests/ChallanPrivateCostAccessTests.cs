using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Controllers;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;
using Xunit;

namespace MyApp.Api.Tests;

public class ChallanPrivateCostAccessTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CostWritesCheckStoredCompanyBeforeUpdating(bool allowed)
    {
        var service = DispatchProxy.Create<IDeliveryChallanService, Proxy>();
        var proxy = (Proxy)(object)service;
        var updated = false;
        proxy.Call = (method, args) => method.Name switch
        {
            "GetByIdAsync" => Task.FromResult<DeliveryChallanDto?>(new() { Id = 17, CompanyId = 9, InvoiceId = 22, InvoiceFbrStatus = "Submitted" }),
            "UpdatePrivateCostsAsync" => Update(),
            _ => throw new Exception("Unexpected service call")
        };
        Task<DeliveryChallanDto?> Update() { updated = true; return Task.FromResult<DeliveryChallanDto?>(new() { Id = 17 }); }
        var guard = DispatchProxy.Create<ICompanyAccessGuard, Proxy>();
        ((Proxy)(object)guard).Call = (method, args) =>
        {
            Assert.Equal("AssertAccessAsync", method.Name);
            Assert.Equal(9, args![1]);
            return allowed ? Task.CompletedTask : Task.FromException(new UnauthorizedAccessException());
        };
        var controller = new DeliveryChallansController(service, guard, null!, new ConfigurationBuilder().Build(), NullLogger<DeliveryChallansController>.Instance)
        {
            ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, "4") })) } }
        };
        if (allowed)
        {
            Assert.IsType<OkObjectResult>((await controller.UpdatePrivateCosts(17, new())).Result);
            Assert.True(updated);
        }
        else
        {
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.UpdatePrivateCosts(17, new()));
            Assert.False(updated);
        }
    }

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }
}
