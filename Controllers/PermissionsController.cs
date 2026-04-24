using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class PermissionsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IPermissionService _permissions;

        public PermissionsController(AppDbContext context, IPermissionService permissions)
        {
            _context = context;
            _permissions = permissions;
        }

        /// <summary>Flat list of every permission in the catalog.</summary>
        [HttpGet]
        [HasPermission("rbac.permissions.view")]
        public async Task<ActionResult<List<PermissionDto>>> GetAll()
        {
            var perms = await _context.Permissions
                .OrderBy(p => p.Module).ThenBy(p => p.Page).ThenBy(p => p.Action)
                .Select(p => new PermissionDto
                {
                    Id = p.Id,
                    Key = p.Key,
                    Module = p.Module,
                    Page = p.Page,
                    Action = p.Action,
                    Description = p.Description
                })
                .ToListAsync();
            return Ok(perms);
        }

        /// <summary>
        /// Module → Page → Permissions tree. Convenient for rendering the
        /// checkbox editor in the role-management UI.
        /// </summary>
        [HttpGet("tree")]
        [HasPermission("rbac.permissions.view")]
        public async Task<ActionResult<List<PermissionTreeDto>>> GetTree()
        {
            var perms = await _context.Permissions
                .OrderBy(p => p.Module).ThenBy(p => p.Page).ThenBy(p => p.Action)
                .ToListAsync();

            var tree = perms
                .GroupBy(p => p.Module)
                .Select(moduleGroup => new PermissionTreeDto
                {
                    Module = moduleGroup.Key,
                    Pages = moduleGroup
                        .GroupBy(p => p.Page)
                        .Select(pageGroup => new PermissionTreePageDto
                        {
                            Page = pageGroup.Key,
                            Permissions = pageGroup.Select(p => new PermissionDto
                            {
                                Id = p.Id,
                                Key = p.Key,
                                Module = p.Module,
                                Page = p.Page,
                                Action = p.Action,
                                Description = p.Description
                            }).ToList()
                        })
                        .ToList()
                })
                .ToList();

            return Ok(tree);
        }

        /// <summary>Returns the permission keys granted to the currently-authenticated user.</summary>
        [HttpGet("me")]
        public async Task<ActionResult> GetMyPermissions()
        {
            var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub)
                      ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!int.TryParse(sub, out var userId))
                return Unauthorized();

            var keys = await _permissions.GetUserPermissionsAsync(userId);
            return Ok(new
            {
                userId,
                isSeedAdmin = _permissions.IsSeedAdmin(userId),
                permissions = keys
            });
        }
    }
}
