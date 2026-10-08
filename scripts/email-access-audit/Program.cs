using Microsoft.Extensions.DependencyInjection;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.AspNetCore.Http;
using MyApp.Api.Data;
using MyApp.Api.Services.Implementations;

var connection = Environment.GetEnvironmentVariable("EMAIL_AUDIT_CONNECTION") ?? throw new Exception("Set EMAIL_AUDIT_CONNECTION to an explicitly approved local SQL database.");
var sql = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
if (!System.Text.RegularExpressions.Regex.IsMatch(sql.DataSource, @"^(?:\.|localhost|127\.0\.0\.1)(?:\\[^\\,;]+)?(?:,\d+)?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) throw new Exception("Local SQL only.");
await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options);
var users = await db.Users.AsNoTracking().Select(x => x.Id).ToListAsync();
var companies = await db.Companies.AsNoTracking().Select(x => x.Id).ToListAsync();
var originalRoles = await db.UserRoles.AsNoTracking().Select(x=>new {x.UserId,x.RoleId}).ToListAsync();
var assignments = await db.UserCompanies.AsNoTracking().Select(x => new { x.UserId, x.CompanyId }).ToListAsync();
Console.WriteLine($"Inventory: {users.Count} users, {companies.Count} companies, {assignments.Count} assignments.");
var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["AppSettings:SeedAdminUserId"] = "1" }).Build();
using var cache = new MemoryCache(new MemoryCacheOptions());
var guard = new CompanyAccessGuard(db, cache, config, new HttpContextAccessor());
int allowed=0, denied=0;
foreach (var user in users) {
 var expected = user == 1 ? companies.ToHashSet() : assignments.Where(x=>x.UserId==user).Select(x=>x.CompanyId).ToHashSet();
 if (!(await guard.GetAccessibleCompanyIdsAsync(user)).SetEquals(expected)) throw new Exception($"Company list mismatch for user ID {user}");
 foreach(var company in companies) {
  if(await guard.HasAccessAsync(user,company) != expected.Contains(company)) throw new Exception($"Access mismatch user ID {user}, company ID {company}");
  if(expected.Contains(company)) allowed++; else denied++;
 }
}
Console.WriteLine($"PASS actual company guard: {allowed+denied} pairs, {allowed} permitted, {denied} denied; seed administrator follows existing bypass policy.");
var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
Console.WriteLine($"Pending migrations: {pending.Count}; feature pending: {pending.Contains("20261008090229_AddEmailWorkspace")}");

// All writes, including feature DDL, are rolled back. No application startup or Google client runs.
await using var transaction = await db.Database.BeginTransactionAsync();
try {
 if(pending.Contains("20261008090229_AddEmailWorkspace")) {
  var assembly = db.GetService<IMigrationsAssembly>();
  var migration = assembly.CreateMigration(assembly.Migrations["20261008090229_AddEmailWorkspace"], db.Database.ProviderName!);
  var commands = db.GetService<IMigrationsSqlGenerator>().Generate(migration.UpOperations, db.Model);
  foreach(var command in commands) {
   if(command.TransactionSuppressed) throw new Exception("Nontransactional migration refused.");
   await db.Database.ExecuteSqlRawAsync(command.CommandText);
  }
 }
 var permissions = new PermissionService(db,cache,config,new ManagementScopeService(db,cache,guard,config));
 var gmail = System.Reflection.DispatchProxy.Create<MyApp.Api.Services.Interfaces.IGmailProvider, NoExternalCalls>();
 var service = new EmailWorkspaceService(db,guard,permissions,gmail,new Microsoft.AspNetCore.DataProtection.EphemeralDataProtectionProvider(),null!);
 // Install only the optional module role inside this rollback transaction.
 foreach(var def in MyApp.Api.Helpers.PermissionCatalog.All.Where(MyApp.Api.Helpers.EditionCatalog.IsOptionalModule))
  if(!await db.Permissions.AnyAsync(p=>p.Key==def.Key)) db.Permissions.Add(new MyApp.Api.Models.Permission {Key=def.Key,Module=def.Module,Page=def.Page,Action=def.Action,Description=def.Description});
 await db.SaveChangesAsync();
 var role=new MyApp.Api.Models.Role {Name="audit-email-"+Guid.NewGuid().ToString("N"),IsSystemRole=true,CreatedByUserId=1};
 db.Roles.Add(role); await db.SaveChangesAsync();
 var emailIds=await db.Permissions.Where(p=>MyApp.Api.Helpers.EditionCatalog.EmailWorkspaceKeys.Contains(p.Key)).Select(p=>p.Id).ToListAsync();
 foreach(var id in emailIds) db.RolePermissions.Add(new MyApp.Api.Models.RolePermission {RoleId=role.Id,PermissionId=id});
 await db.SaveChangesAsync();
 var scope=new ManagementScopeService(db,cache,guard,config);
 var roleController=new MyApp.Api.Controllers.UserRolesController(db,permissions,scope,config) {
  ControllerContext=new Microsoft.AspNetCore.Mvc.ControllerContext {HttpContext=new DefaultHttpContext {User=new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(new[]{new System.Security.Claims.Claim("sub","1")},"audit"))}}
 };
 int moduleChecks=0;
 foreach(var user in users.Where(x=>x!=1)) {
  var company=assignments.FirstOrDefault(x=>x.UserId==user)?.CompanyId;
  if(company.HasValue && !await permissions.HasPermissionAsync(user,"email.workspace.use")) {
   try {await service.ListAsync(user,company.Value,null,null,1,20,default);throw new Exception("Unassigned module allowed inbox access.");}
   catch(UnauthorizedAccessException) {moduleChecks++;}
  }
  var ids=originalRoles.Where(x=>x.UserId==user).Select(x=>x.RoleId).Append(role.Id).ToList();
  var assigned=await roleController.Assign(user,new MyApp.Api.DTOs.AssignUserRolesDto {RoleIds=ids});
  if(assigned.Result is not Microsoft.AspNetCore.Mvc.OkObjectResult || !await permissions.HasPermissionAsync(user,"email.workspace.use")) throw new Exception("Module assignment through existing controller failed.");
  moduleChecks++;
 }
 foreach(var manager in users.Where(x=>x!=1)) {
  if(!await permissions.HasPermissionAsync(manager,"rbac.userroles.assign")) continue;
  var managerController=new MyApp.Api.Controllers.UserRolesController(db,permissions,scope,config) {
   ControllerContext=new Microsoft.AspNetCore.Mvc.ControllerContext {HttpContext=new DefaultHttpContext {User=new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(new[]{new System.Security.Claims.Claim("sub",manager.ToString())},"audit"))}}
  };
  foreach(var target in users.Where(x=>x!=1 && x!=manager)) {
   var targetIds=originalRoles.Where(x=>x.UserId==target).Select(x=>x.RoleId).Append(role.Id).ToList();
   if(!await scope.CanManageUserAsync(manager,target)) {
    if((await managerController.Assign(target,new MyApp.Api.DTOs.AssignUserRolesDto {RoleIds=targetIds})).Result is not Microsoft.AspNetCore.Mvc.NotFoundObjectResult) throw new Exception("Out-of-scope user role assignment allowed.");
    moduleChecks++; continue;
   }
   var managerIds=originalRoles.Where(x=>x.UserId==manager).Select(x=>x.RoleId).ToList();
   await roleController.Assign(manager,new MyApp.Api.DTOs.AssignUserRolesDto {RoleIds=managerIds});
   var missingModule=await managerController.Assign(target,new MyApp.Api.DTOs.AssignUserRolesDto {RoleIds=targetIds});
   if(missingModule.Result is not Microsoft.AspNetCore.Mvc.BadRequestObjectResult) throw new Exception("Administrator delegated an unassigned optional module.");
   await roleController.Assign(manager,new MyApp.Api.DTOs.AssignUserRolesDto {RoleIds=managerIds.Append(role.Id).ToList()});
   // Preserving a role outside the manager's own permissions can legitimately fail.
   var grantable=(await permissions.GetUserPermissionsAsync(manager)).ToHashSet();
   var targetKeys=await db.RolePermissions.Where(p=>targetIds.Contains(p.RoleId)).Select(p=>p.Permission!.Key).ToListAsync();
   if(targetKeys.All(grantable.Contains)) {
    if((await managerController.Assign(target,new MyApp.Api.DTOs.AssignUserRolesDto {RoleIds=targetIds})).Result is not Microsoft.AspNetCore.Mvc.OkObjectResult) throw new Exception("Enabled administrator could not delegate module to managed user.");
    moduleChecks++;
   }
   moduleChecks++;
  }
 }
 Console.WriteLine($"PASS module opt-in and assignment to existing users: {moduleChecks} assertions; temporary role only.");
 var marker = "audit-"+Guid.NewGuid().ToString("N");
 var fixtures = new Dictionary<int,(int connection,int link,int shared,int secret)>();
 if(!users.Contains(1)) throw new Exception("Expected seed administrator absent; refuse assumed fixture owner.");
 foreach(var company in companies) {
  var account=new MyApp.Api.Models.GmailConnection {OwnerUserId=1,GoogleSubject=marker+company,EmailAddress="audit@example.com",ProtectedRefreshToken="unused"};
  db.GmailConnections.Add(account); await db.SaveChangesAsync();
  var link=new MyApp.Api.Models.GmailCompanyLink {CompanyId=company,ConnectionId=account.Id,ShareMatchingEmails=true,RulesJson="[{\"Sender\":\"buyer@example.com\"}]"};
  var shared=new MyApp.Api.Models.GmailMessage {ConnectionId=account.Id,ProviderMessageId="shared",Sender="buyer@example.com",Subject=marker+" quotation",ReceivedAt=DateTime.UtcNow,ProtectedContent=service.Protect(new MyApp.Api.DTOs.EmailContent("Synthetic test email", "", []))};
  var secret=new MyApp.Api.Models.GmailMessage {ConnectionId=account.Id,ProviderMessageId="private",Sender="private@example.com",Subject=marker+" personal",ReceivedAt=DateTime.UtcNow,ProtectedContent=service.Protect(new MyApp.Api.DTOs.EmailContent("Synthetic private email", "", []))};
  db.AddRange(link,shared,secret); await db.SaveChangesAsync();
  fixtures.Add(company,(account.Id,link.Id,shared.Id,secret.Id));
 }
 int checks=0;
 async Task Deny(Func<Task> operation, int status=403) {
  try {await operation();} catch(UnauthorizedAccessException) when(status==403) {checks++;return;}
  catch(EmailWorkspaceException e) when(e.Status==status) {checks++;return;}
  throw new Exception($"Expected denial {status} did not occur.");
 }
 foreach(var user in users) foreach(var company in companies) {
  var assigned=user==1 || assignments.Any(x=>x.UserId==user && x.CompanyId==company);
  var f=fixtures[company]; var other=fixtures.First(x=>x.Key!=company).Value;
  if(!assigned) {
   await Deny(async()=>{await service.StatusAsync(user,company);});
   await Deny(async()=>{await service.CustomersAsync(user,company);});
   await Deny(async()=>{await service.ListAsync(user,company,null,null,1,20,default);});
   await Deny(async()=>{await service.ReadAsync(user,company,f.shared,default);});
   await Deny(async()=>{await service.StartAsync(user,company,default);});
   await Deny(()=>service.LinkAsync(user,company,f.connection,default));
   await Deny(()=>service.SettingsAsync(user,company,f.link,new(),default));
   await Deny(()=>service.UnlinkAsync(user,company,f.link,default));
   await Deny(()=>service.SyncForUserAsync(user,company,f.connection,default));
   await Deny(async()=>{await service.DecideAsync(user,company,f.shared,new("Kept",null),default);});
   await Deny(async()=>{await service.PrepareAsync(user,company,f.shared,null,default);});
   await Deny(async()=>{await service.SaveDraftAsync(user,company,f.shared,new(),default);});
   await Deny(async()=>{await service.ConvertAsync(user,company,f.shared,new(),default);});
   await Deny(async()=>{await service.AttachmentAsync(user,company,f.shared,"forged",default);});
  } else {
   var list=System.Text.Json.JsonSerializer.SerializeToElement(await service.ListAsync(user,company,null,marker,1,100,default));
   var actual=list.GetProperty("Items").EnumerateArray().Select(x=>x.GetProperty("Id").GetInt32()).ToHashSet();
   var expected=user==1 ? new HashSet<int>{f.shared,f.secret} : new HashSet<int>{f.shared};
   if(!actual.SetEquals(expected)) throw new Exception("Inbox includes unexpected or missing messages."); checks++;
   await service.ReadAsync(user,company,f.shared,default); checks++;
   await Deny(async()=>{await service.ReadAsync(user,company,other.shared,default);},404);
   await Deny(async()=>{await service.DecideAsync(user,company,other.shared,new("Kept",null),default);},404);
   await Deny(async()=>{await service.PrepareAsync(user,company,other.shared,null,default);},404);
   await Deny(async()=>{await service.SaveDraftAsync(user,company,other.shared,new(),default);},404);
   await Deny(async()=>{await service.ConvertAsync(user,company,other.shared,new(),default);},404);
   await Deny(async()=>{await service.AttachmentAsync(user,company,other.shared,"forged",default);},404);
   await Deny(()=>service.SettingsAsync(user,company,other.link,new(),default),404);
   await Deny(()=>service.UnlinkAsync(user,company,other.link,default),404);
   await Deny(()=>service.SyncForUserAsync(user,company,other.connection,default),404);
   if(user!=1) {
    await Deny(async()=>{await service.ReadAsync(user,company,f.secret,default);},404);
    await Deny(()=>service.LinkAsync(user,company,f.connection,default),404);
    await Deny(()=>service.SettingsAsync(user,company,f.link,new(),default),404);
    await Deny(()=>service.UnlinkAsync(user,company,f.link,default),404);
    await Deny(()=>service.SyncForUserAsync(user,company,f.connection,default),404);
   }
  }
 }
 Console.WriteLine($"PASS inbox/resource isolation: {checks} assertions across every existing user/company pair.");
 foreach(var company in companies) {
  var f=fixtures[company];
  await service.DecideAsync(1,company,f.secret,new("Kept",null),default);
  foreach(var user in users.Where(x=>x!=1)) {
   if(assignments.Any(x=>x.UserId==user && x.CompanyId==company)) {await service.ReadAsync(user,company,f.secret,default);checks++;}
   else await Deny(async()=>{await service.ReadAsync(user,company,f.secret,default);});
  }
 }
 Console.WriteLine($"PASS explicit Keep sharing remains company-scoped; cumulative {checks} assertions.");
 var grant=assignments.FirstOrDefault(x=>x.UserId!=1);
 if(grant!=null) {
  await db.UserCompanies.Where(x=>x.UserId==grant.UserId && x.CompanyId==grant.CompanyId).ExecuteDeleteAsync();
  guard.InvalidateUser(grant.UserId);
  await Deny(async()=>{await service.ListAsync(grant.UserId,grant.CompanyId,null,marker,1,20,default);});
  await Deny(async()=>{await service.ReadAsync(grant.UserId,grant.CompanyId,fixtures[grant.CompanyId].secret,default);});
  Console.WriteLine("PASS revoked assignment immediately blocks list and previously kept message.");
 }
 int filterChecks=0;
 using var services = new ServiceCollection().AddSingleton<MyApp.Api.Services.Interfaces.IPermissionService>(permissions).AddSingleton<MyApp.Api.Services.Interfaces.ICompanyAccessGuard>(guard).BuildServiceProvider();
 var actions=typeof(MyApp.Api.Controllers.EmailWorkspaceController).GetMethods().Where(m=>m.GetCustomAttributes<Microsoft.AspNetCore.Mvc.Routing.HttpMethodAttribute>().Any()).ToList();
 foreach(var action in actions) {
  var attributes=action.GetCustomAttributes<Microsoft.AspNetCore.Mvc.TypeFilterAttribute>().Concat(typeof(MyApp.Api.Controllers.EmailWorkspaceController).GetCustomAttributes<Microsoft.AspNetCore.Mvc.TypeFilterAttribute>()).ToList();
  if(!attributes.Any(a=>a is MyApp.Api.Middleware.HasPermissionAttribute)) throw new Exception("Missing permission attribute.");
  if(action.Name!="Complete" && !attributes.Any(a=>a is MyApp.Api.Middleware.AuthorizeCompanyAttribute)) throw new Exception("Missing company attribute.");
  foreach(var attribute in attributes) foreach(var user in users.Prepend(0)) foreach(var filterCompany in companies) {
   var http=new DefaultHttpContext {RequestServices=services};
   if(user!=0) http.User=new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(new[]{new System.Security.Claims.Claim("sub",user.ToString())},"audit"));
   var route=new Microsoft.AspNetCore.Routing.RouteData(); route.Values["companyId"]=filterCompany;
   var ctx=new Microsoft.AspNetCore.Mvc.Filters.AuthorizationFilterContext(new Microsoft.AspNetCore.Mvc.ActionContext(http,route,new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor()),new List<Microsoft.AspNetCore.Mvc.Filters.IFilterMetadata>());
   await ((Microsoft.AspNetCore.Mvc.Filters.IAsyncAuthorizationFilter)attribute.CreateInstance(services)).OnAuthorizationAsync(ctx);
   bool permitted=false;
   if(user!=0) {
    if(attribute is MyApp.Api.Middleware.AuthorizeCompanyAttribute) permitted=await guard.HasAccessAsync(user,filterCompany);
    else if(attribute is MyApp.Api.Middleware.HasPermissionAttribute) permitted=await permissions.HasPermissionAsync(user,(string)attribute.Arguments![0]);
    else if(attribute is MyApp.Api.Middleware.HasAnyPermissionAttribute) {
     foreach(var key in (string[])attribute.Arguments![0]) permitted |= await permissions.HasPermissionAsync(user,key);
    }
   }
   if((ctx.Result==null)!=permitted) throw new Exception("Endpoint authorization filter mismatch.");
   if(user==0 && ctx.Result is not Microsoft.AspNetCore.Mvc.UnauthorizedResult) throw new Exception("Anonymous request did not return 401.");
   filterChecks++;
  }
 }
 Console.WriteLine($"PASS actual authorization filters: {filterChecks} assertions across {actions.Count} endpoints and anonymous/existing users.");
 foreach(var user in users.Where(x=>x!=1)) {
  var revoked=await roleController.Assign(user,new MyApp.Api.DTOs.AssignUserRolesDto {RoleIds=originalRoles.Where(x=>x.UserId==user).Select(x=>x.RoleId).ToList()});
  if(revoked.Result is not Microsoft.AspNetCore.Mvc.OkObjectResult) throw new Exception("Module revocation failed.");
  var company=assignments.FirstOrDefault(x=>x.UserId==user && (grant==null || x.UserId!=grant.UserId || x.CompanyId!=grant.CompanyId))?.CompanyId;
  if(company.HasValue && !await permissions.HasPermissionAsync(user,"email.workspace.use")) {
   await Deny(async()=>{await service.ListAsync(user,company.Value,null,null,1,20,default);});
   await Deny(async()=>{await service.StartAsync(user,company.Value,default);});
  }
 }
 Console.WriteLine("PASS removing module role blocks inbox and Gmail authorization while retaining original roles.");
 int inboxPermitted=0;
 foreach(var user in users) if(await permissions.HasPermissionAsync(user,"email.inbox.view")) inboxPermitted++;
 Console.WriteLine($"Actual role policy: {inboxPermitted}/{users.Count} users currently have email.inbox.view (includes seed administrator). No existing grants changed.");
} finally {await transaction.RollbackAsync(); db.ChangeTracker.Clear();}
var restored=await db.UserCompanies.AsNoTracking().Select(x=>new {x.UserId,x.CompanyId}).ToListAsync();
if(!restored.Select(x=>(x.UserId,x.CompanyId)).ToHashSet().SetEquals(assignments.Select(x=>(x.UserId,x.CompanyId)))) throw new Exception("Assignment rollback mismatch.");
var rolesAfter=await db.UserRoles.AsNoTracking().Select(x=>new {x.UserId,x.RoleId}).ToListAsync();
if(!rolesAfter.Select(x=>(x.UserId,x.RoleId)).ToHashSet().SetEquals(originalRoles.Select(x=>(x.UserId,x.RoleId)))) throw new Exception("Role rollback mismatch.");
if(!(await db.Database.GetPendingMigrationsAsync()).ToHashSet().SetEquals(pending)) throw new Exception("Migration state changed.");
Console.WriteLine("PASS rollback verification: original assignments and migration state restored.");
Console.WriteLine("ROLLBACK complete: synthetic mail and feature DDL removed; no Google requests made.");

public class NoExternalCalls : System.Reflection.DispatchProxy {
 protected override object? Invoke(System.Reflection.MethodInfo? method,object?[]? args) {
  if(method?.Name=="get_IsConfigured") return false;
  throw new Exception("External Gmail call forbidden by audit harness.");
 }
}
