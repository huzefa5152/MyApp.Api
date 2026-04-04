using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Admin")]
    public class UsersController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly int _seedAdminUserId;

        public UsersController(AppDbContext context, IConfiguration configuration)
        {
            _context = context;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        private async Task<bool> IsSeedAdmin()
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var currentUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            return currentUser?.Id == _seedAdminUserId;
        }

        // GET /api/users
        [HttpGet]
        public async Task<ActionResult> GetUsers()
        {
            var users = await _context.Users
                .OrderByDescending(u => u.CreatedAt)
                .Select(u => new
                {
                    u.Id,
                    u.Username,
                    u.FullName,
                    u.Role,
                    u.AvatarPath,
                    u.CreatedAt
                })
                .ToListAsync();

            return Ok(users);
        }

        // GET /api/users/{id}
        [HttpGet("{id}")]
        public async Task<ActionResult> GetUser(int id)
        {
            var user = await _context.Users
                .Where(u => u.Id == id)
                .Select(u => new
                {
                    u.Id,
                    u.Username,
                    u.FullName,
                    u.Role,
                    u.AvatarPath,
                    u.CreatedAt
                })
                .FirstOrDefaultAsync();

            if (user == null) return NotFound(new { message = "User not found" });
            return Ok(user);
        }

        // POST /api/users
        [HttpPost]
        public async Task<ActionResult> CreateUser([FromBody] CreateUserDto dto)
        {
            if (!await IsSeedAdmin())
                return Forbid();

            if (string.IsNullOrWhiteSpace(dto.Username) || string.IsNullOrWhiteSpace(dto.Password))
                return BadRequest(new { message = "Username and password are required" });

            if (dto.Password.Length < 6)
                return BadRequest(new { message = "Password must be at least 6 characters" });

            if (string.IsNullOrWhiteSpace(dto.FullName))
                return BadRequest(new { message = "Full name is required" });

            var exists = await _context.Users.AnyAsync(u => u.Username == dto.Username);
            if (exists)
                return Conflict(new { message = "Username already exists" });

            var allowedRoles = new[] { "Admin" };
            var role = allowedRoles.Contains(dto.Role) ? dto.Role : "Admin";

            var user = new Models.User
            {
                Username = dto.Username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password),
                FullName = dto.FullName,
                Role = role,
                CreatedAt = DateTime.UtcNow
            };

            _context.Users.Add(user);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetUser), new { id = user.Id }, new
            {
                user.Id,
                user.Username,
                user.FullName,
                user.Role,
                user.CreatedAt
            });
        }

        // PUT /api/users/{id}
        [HttpPut("{id}")]
        public async Task<ActionResult> UpdateUser(int id, [FromBody] UpdateUserDto dto)
        {
            if (!await IsSeedAdmin())
                return Forbid();

            if (id == _seedAdminUserId)
                return BadRequest(new { message = "The primary admin account cannot be modified" });

            var user = await _context.Users.FindAsync(id);
            if (user == null) return NotFound(new { message = "User not found" });

            if (!string.IsNullOrWhiteSpace(dto.Username) && dto.Username != user.Username)
            {
                var exists = await _context.Users.AnyAsync(u => u.Username == dto.Username && u.Id != id);
                if (exists) return Conflict(new { message = "Username already exists" });
                user.Username = dto.Username;
            }

            if (!string.IsNullOrWhiteSpace(dto.FullName))
                user.FullName = dto.FullName;

            if (!string.IsNullOrWhiteSpace(dto.Role))
            {
                var allowedRoles = new[] { "Admin" };
                if (allowedRoles.Contains(dto.Role))
                    user.Role = dto.Role;
            }

            if (!string.IsNullOrWhiteSpace(dto.Password))
            {
                if (dto.Password.Length < 6)
                    return BadRequest(new { message = "Password must be at least 6 characters" });
                user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password);
            }

            await _context.SaveChangesAsync();

            return Ok(new
            {
                user.Id,
                user.Username,
                user.FullName,
                user.Role,
                user.CreatedAt
            });
        }

        // DELETE /api/users/{id}
        [HttpDelete("{id}")]
        public async Task<ActionResult> DeleteUser(int id)
        {
            if (!await IsSeedAdmin())
                return Forbid();

            if (id == _seedAdminUserId)
                return BadRequest(new { message = "The primary admin account cannot be deleted" });

            // Prevent self-deletion
            var currentUsername = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FindAsync(id);
            if (user == null) return NotFound(new { message = "User not found" });

            if (user.Username == currentUsername)
                return BadRequest(new { message = "You cannot delete your own account" });

            _context.Users.Remove(user);
            await _context.SaveChangesAsync();

            return Ok(new { message = "User deleted" });
        }
    }
}
