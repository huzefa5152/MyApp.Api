using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MyApp.Api.Data;
using MyApp.Api.DTOs;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : LoggedControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IConfiguration _configuration;
        private readonly int _seedAdminUserId;
        private readonly new ILogger<AuthController> _logger;

        public AuthController(AppDbContext context, IConfiguration configuration, ILogger<AuthController> logger) : base(logger)
        {
            _context = context;
            _configuration = configuration;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
            _logger = logger;
        }

        [HttpPost("login")]
        [EnableRateLimiting("login")]
        public async Task<ActionResult<LoginResponseDto>> Login([FromBody] LoginDto dto)
        {
            var user = await _context.Users
                .FirstOrDefaultAsync(u => u.Username == dto.Username);

            if (user == null || !BCrypt.Net.BCrypt.Verify(dto.Password, user.PasswordHash))
            {
                _logger.LogWarning("Failed login attempt for username={Username} from {Ip}",
                    dto.Username, HttpContext.Connection.RemoteIpAddress);
                return Unauthorized(new { message = "Invalid username or password" });
            }

            var token = GenerateJwtToken(user);
            var expiration = DateTime.UtcNow.AddHours(
                double.Parse(_configuration["Jwt:ExpirationHours"] ?? "8"));

            _logger.LogInformation("User {UserId} ({Username}) signed in", user.Id, user.Username);

            return Ok(new LoginResponseDto
            {
                Token = token,
                Username = user.Username,
                FullName = user.FullName,
                Expiration = expiration
            });
        }

        [HttpGet("me")]
        [Authorize]
        public async Task<ActionResult> GetCurrentUser()
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users
                .FirstOrDefaultAsync(u => u.Username == username);

            if (user == null)
                return NotFound();

            return Ok(new
            {
                user.Id,
                user.Username,
                user.FullName,
                user.Role,
                user.AvatarPath,
                IsSeedAdmin = user.Id == _seedAdminUserId,
                SeedAdminUserId = _seedAdminUserId
            });
        }

        [HttpPut("profile")]
        [Authorize]
        public async Task<ActionResult> UpdateProfile([FromBody] UpdateProfileDto dto)
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null) return NotFound();

            // Check if new username is taken by another user
            if (!string.IsNullOrWhiteSpace(dto.Username) && dto.Username != user.Username)
            {
                var exists = await _context.Users.AnyAsync(u => u.Username == dto.Username);
                if (exists)
                    return BadRequest(new { message = "Username is already taken" });
                user.Username = dto.Username.Trim();
            }

            if (!string.IsNullOrWhiteSpace(dto.FullName))
                user.FullName = dto.FullName.Trim();

            await _context.SaveChangesAsync();

            // Return new token with updated claims
            var newToken = GenerateJwtToken(user);
            return Ok(new
            {
                token = newToken,
                user.Id,
                user.Username,
                user.FullName,
                user.Role,
                user.AvatarPath
            });
        }

        [HttpPut("password")]
        [Authorize]
        public async Task<ActionResult> ChangePassword([FromBody] ChangePasswordDto dto)
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null) return NotFound();

            if (!BCrypt.Net.BCrypt.Verify(dto.CurrentPassword, user.PasswordHash))
                return BadRequest(new { message = "Current password is incorrect" });

            if (string.IsNullOrWhiteSpace(dto.NewPassword) || dto.NewPassword.Length < 6)
                return BadRequest(new { message = "New password must be at least 6 characters" });

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
            await _context.SaveChangesAsync();

            return Ok(new { message = "Password changed successfully" });
        }

        [HttpPost("avatar")]
        [Authorize]
        public async Task<ActionResult> UploadAvatar(IFormFile file)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { message = "No file uploaded" });

            if (file.Length > 7 * 1024 * 1024)
                return BadRequest(new { message = "File size must be under 7 MB" });

            var allowed = new[] { ".jpg", ".jpeg", ".png", ".webp" };
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!allowed.Contains(ext))
                return BadRequest(new { message = "Only JPG, PNG and WebP images are allowed" });

            var username = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null) return NotFound();

            // Save to data/images/avatars/ (persistent, outside wwwroot)
            var avatarsDir = Path.Combine(Directory.GetCurrentDirectory(), "data", "images", "avatars");
            Directory.CreateDirectory(avatarsDir);

            var fileName = $"user-{user.Id}{ext}";
            var filePath = Path.Combine(avatarsDir, fileName);

            // Delete old avatar if different extension
            foreach (var oldExt in allowed)
            {
                var oldPath = Path.Combine(avatarsDir, $"user-{user.Id}{oldExt}");
                if (System.IO.File.Exists(oldPath)) System.IO.File.Delete(oldPath);
            }

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            user.AvatarPath = $"/data/images/avatars/{fileName}";
            await _context.SaveChangesAsync();

            return Ok(new { avatarPath = user.AvatarPath });
        }

        [HttpDelete("avatar")]
        [Authorize]
        public async Task<ActionResult> RemoveAvatar()
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null) return NotFound();

            if (!string.IsNullOrEmpty(user.AvatarPath))
            {
                var allowed = new[] { ".jpg", ".jpeg", ".png", ".webp" };
                var avatarsDir = Path.Combine(Directory.GetCurrentDirectory(), "data", "images", "avatars");
                foreach (var ext in allowed)
                {
                    var oldPath = Path.Combine(avatarsDir, $"user-{user.Id}{ext}");
                    if (System.IO.File.Exists(oldPath)) System.IO.File.Delete(oldPath);
                }

                user.AvatarPath = null;
                await _context.SaveChangesAsync();
            }

            return Ok(new { message = "Avatar removed" });
        }

        private string GenerateJwtToken(Models.User user)
        {
            var key = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(_configuration["Jwt:Key"]!));
            var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var claims = new[]
            {
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role),
                new Claim("fullName", user.FullName),
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
            };

            var token = new JwtSecurityToken(
                issuer: _configuration["Jwt:Issuer"],
                audience: _configuration["Jwt:Audience"],
                claims: claims,
                expires: DateTime.UtcNow.AddHours(
                    double.Parse(_configuration["Jwt:ExpirationHours"] ?? "8")),
                signingCredentials: credentials
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }
}
