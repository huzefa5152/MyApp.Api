using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Controllers;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Implementations;

static class PoFormatAccessChecks
{
    public static async Task Run(AppDbContext db, Action<bool,string> check)
    {
        // Production startup adds this legacy column outside EF migrations.
        await db.Database.ExecuteSqlRawAsync("IF COL_LENGTH('Users','SecurityStamp') IS NULL ALTER TABLE Users ADD SecurityStamp nvarchar(64) NOT NULL DEFAULT('test-stamp')");
        var a = new Company { Name="PO Access A" }; var b = new Company { Name="PO Access B" };
        var admin = new User { Username="po_seed" }; var restricted = new User { Username="po_restricted" };
        var viewer = new User { Username="po_viewer" }; var empty = new User { Username="po_empty" };
        db.AddRange(a,b,admin,restricted,viewer,empty); await db.SaveChangesAsync();
        var group = new ClientGroup { DisplayName="Shared legal entity", GroupKey="PO_TEST" };
        db.Add(group); await db.SaveChangesAsync();
        var ca = new Client {CompanyId=a.Id,Name="Client A",ClientGroupId=group.Id};
        var cb = new Client {CompanyId=b.Id,Name="Client B",ClientGroupId=group.Id};
        var ca2 = new Client {CompanyId=a.Id,Name="Other A"};
        db.AddRange(ca,cb,ca2); await db.SaveChangesAsync();
        db.UserCompanies.AddRange(new UserCompany{UserId=restricted.Id,CompanyId=a.Id},new UserCompany{UserId=viewer.Id,CompanyId=a.Id});
        var keys = new[]{"view","create","update","delete"};
        var editRole=new Role{Name="PO-only editor"}; var viewRole=new Role{Name="PO-only reader"};
        foreach(var action in keys)
        {
            var permission = new Permission{Key="poformats.manage."+action,Module="poformats",Page="manage",Action=action};
            editRole.RolePermissions.Add(new RolePermission{Permission=permission});
            if(action=="view")viewRole.RolePermissions.Add(new RolePermission{Permission=permission});
        }
        db.AddRange(editRole,viewRole); await db.SaveChangesAsync();
        db.UserRoles.AddRange(new UserRole{UserId=restricted.Id,RoleId=editRole.Id},new UserRole{UserId=viewer.Id,RoleId=viewRole.Id});
        await db.SaveChangesAsync();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"AppSettings:SeedAdminUserId",admin.Id.ToString()}}).Build();
        using var cache=new MemoryCache(new MemoryCacheOptions());
        var accessor=new HttpContextAccessor();
        var guard=new CompanyAccessGuard(db,cache,config,accessor);
        var permissions=new PermissionService(db,cache,config);
        var fp=new POFormatFingerprintService();
        var registry=new POFormatRegistry(db,fp,null!,NullLogger<POFormatRegistry>.Instance);
        using var provider=new ServiceCollection().AddSingleton<IPermissionService>(permissions).BuildServiceProvider();
        POFormatsController Controller(int uid)
        {
            var context=new DefaultHttpContext { RequestServices=provider, User=new ClaimsPrincipal(new ClaimsIdentity(new[]{new Claim(ClaimTypes.NameIdentifier,uid.ToString())},"Test")) };
            accessor.HttpContext=context;
            return new POFormatsController(registry,fp,new TextParser(),db,guard){ControllerContext=new ControllerContext{HttpContext=context}};
        }
        async Task<bool> Authorized(string method,int uid)
        {
            var context=Controller(uid).HttpContext;
            var auth=new AuthorizationFilterContext(new ActionContext(context,new RouteData(),new ActionDescriptor()),new List<IFilterMetadata>());
            foreach(var attr in typeof(POFormatsController).GetMethod(method)!.GetCustomAttributes(true).OfType<TypeFilterAttribute>())
                if(attr.CreateInstance(provider) is IAsyncAuthorizationFilter filter) await filter.OnAuthorizationAsync(auth);
            return auth.Result==null;
        }
        foreach(var method in new[]{"List","Get","Clients","Create","CreateSimple","UpdateSimple","Delete","FingerprintPdf"})
        {
            check(await Authorized(method,admin.Id),"seed admin authorized for PO "+method);
            check(await Authorized(method,restricted.Id),"PO-only editor authorized for "+method);
            check(await Authorized(method,viewer.Id)==(method is "List" or "Get"),"read-only permission enforced for PO "+method);
            check(!await Authorized(method,empty.Id),"empty role denied PO "+method);
        }
        check(!await permissions.HasPermissionAsync(restricted.Id,"clients.manage.view"),"PO editor has no client administration permission");
        async Task Denied(Func<Task> action,string name)
        {
            try {await action();check(false,name);} catch(UnauthorizedAccessException){check(true,name);} catch(InvalidOperationException){check(true,name);} catch(KeyNotFoundException){check(true,name);}
        }
        POFormatSimpleCreateDto Payload(int cid,int client,string name)=>new(){CompanyId=cid,ClientId=client,Name=name,RawText=TextParser.Text,DescriptionHeader="Description",QuantityHeader="Quantity"};
        var createdA=(POFormatDto)((CreatedAtActionResult)(await Controller(restricted.Id).CreateSimple(Payload(a.Id,ca.Id,"Private A"))).Result!).Value!;
        var createdB=(POFormatDto)((CreatedAtActionResult)(await Controller(admin.Id).CreateSimple(Payload(b.Id,cb.Id,"Private B"))).Result!).Value!;
        check(createdA.Id!=createdB.Id,"same common client can have independent formats in two companies");
        foreach(var uid in new[]{admin.Id,restricted.Id,empty.Id})
        {
            var list=(List<POFormatListItemDto>)((OkObjectResult)(await Controller(uid).List(null,null)).Result!).Value!;
            check(uid==admin.Id?list.Any(f=>f.Id==createdA.Id)&&list.Any(f=>f.Id==createdB.Id):uid==restricted.Id?list.Count==1&&list[0].Id==createdA.Id:list.Count==0,"unfiltered PO list uses caller company grants "+uid);
        }
        check((await Controller(restricted.Id).Clients(a.Id)) is OkObjectResult,"PO-only client picker works without clients permission");
        await Denied(async()=>{await Controller(restricted.Id).Clients(b.Id);},"foreign client picker denied");
        await Denied(async()=>{await Controller(restricted.Id).List(b.Id,null);},"foreign PO list denied");
        await Denied(async()=>{await Controller(restricted.Id).Get(createdB.Id);},"foreign PO detail denied");
        await Denied(async()=>{await Controller(restricted.Id).Delete(createdB.Id);},"foreign PO delete denied");
        await Denied(async()=>{await Controller(restricted.Id).CreateSimple(Payload(b.Id,cb.Id,"Forged"));},"foreign PO create denied");
        await Denied(async()=>{await Controller(admin.Id).CreateSimple(Payload(a.Id,cb.Id,"Mixed"));},"admin cannot mix company and client");
        await Denied(async()=>{await Controller(restricted.Id).Create(new POFormatCreateDto{Name="Raw",RawText=TextParser.Text,CompanyId=a.Id,ClientId=cb.Id,ClientGroupId=group.Id});},"raw create cannot forge common-client ownership");
        var update=new POFormatSimpleUpdateDto{Name="Changed",ClientId=cb.Id,DescriptionHeader="Description",QuantityHeader="Quantity"};
        await Denied(async()=>{await Controller(restricted.Id).UpdateSimple(createdB.Id,update);},"foreign PO update denied");
        await Denied(async()=>{await Controller(admin.Id).UpdateSimple(createdA.Id,update);},"admin cannot reassign PO to foreign client");
        await Denied(async()=>{await Controller(restricted.Id).CreateSimple(Payload(a.Id,ca.Id,"Duplicate"));},"duplicate client rejected at API");
        var missing=Payload(a.Id,ca2.Id,"Missing");missing.CompanyId=null;
        await Denied(async()=>{await Controller(restricted.Id).CreateSimple(missing);},"missing company create denied");
        missing.CompanyId=a.Id;missing.ClientId=null;
        await Denied(async()=>{await Controller(restricted.Id).CreateSimple(missing);},"missing client create denied");
        using var bytes=new MemoryStream(new byte[]{1});var file=new FormFile(bytes,0,1,"file","sample.pdf");
        var match=(FingerprintPdfResponseDto)((OkObjectResult)(await Controller(restricted.Id).FingerprintPdf(file,a.Id)).Result!).Value!;
        check(match.MatchedFormat?.Id==createdA.Id,"fingerprint response returns only own-company format");
        await Denied(async()=>{await Controller(restricted.Id).FingerprintPdf(file,b.Id);},"foreign fingerprint rejected before extraction");
        check((await Controller(restricted.Id).FingerprintPdf(file,null)).Result is BadRequestObjectResult,"missing-company fingerprint returns 400");
        update.ClientId=ca2.Id;
        check((await Controller(restricted.Id).UpdateSimple(createdA.Id,update)).Result is OkObjectResult,"own-company client reassignment succeeds");
        check((await Controller(admin.Id).Get(createdB.Id)).Result is OkObjectResult,"seed admin can read every company format");
        check(await Controller(restricted.Id).Delete(createdA.Id) is NoContentResult,"own-company deletion succeeds");
        check(await db.POFormats.AnyAsync(f=>f.Id==createdB.Id),"own deletion preserves other company format");
    }
    sealed class TextParser:IPOParserService
    {
        public const string Text="Purchase Order Supplier Description Quantity Unit Delivery Address";
        public string ExtractTextFromPdf(Stream stream)=>Text;
        public ParsedPODto ParsePO(string text)=>throw new NotSupportedException();
        public ParsedPODto ParsePdf(Stream stream)=>throw new NotSupportedException();
    }
}
