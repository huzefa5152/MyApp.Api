using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
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
        private readonly IMemoryCache _cache;
        private readonly int _seedAdminUserId;
        private readonly new ILogger<AuthController> _logger;

        // Pre-computed bcrypt hash used ONLY to burn equivalent CPU on
        // the unknown-username login path so timing doesn't leak whether
        // an account exists. Generated once at type-load; the actual
        // password value is irrelevant — only the hash matters.
        // Audit M-12 (2026-05-13).
        private static readonly string _dummyBcryptHash =
            BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N"));

        public AuthController(AppDbContext context, IConfiguration configuration, IMemoryCache cache, ILogger<AuthController> logger) : base(logger)
        {
            _context = context;
            _configuration = configuration;
            _cache = cache;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
            _logger = logger;
        }

        [HttpPost("login")]
        [EnableRateLimiting("login")]
        public async Task<ActionResult<LoginResponseDto>> Login([FromBody] LoginDto dto)
        {
            var user = await _context.Users
                .FirstOrDefaultAsync(u => u.Username == dto.Username);

            if (user == null)
            {
                // Audit M-12 (2026-05-13): burn equivalent CPU so the
                // response timing doesn't distinguish "user does not exist"
                // from "wrong password". The result is discarded.
                _ = BCrypt.Net.BCrypt.Verify(dto.Password ?? string.Empty, _dummyBcryptHash);
                _logger.LogWarning("Failed login attempt for username={Username} from {Ip}",
                    dto.Username, HttpContext.Connection.RemoteIpAddress);
                return Unauthorized(new { message = "Invalid username or password" });
            }

            if (!BCrypt.Net.BCrypt.Verify(dto.Password ?? string.Empty, user.PasswordHash))
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
                SeedAdminUserId = _seedAdminUserId,
                // 2026-05-09: app-wide config the frontend needs to render
                // accurate UI hints. Pre-fix the EditBillForm hardcoded
                // NARROW_EDIT_TOLERANCE_PKR = 2, but production has the
                // value at 10 — operators saw "±Rs. 2" while the server
                // happily accepted ±Rs. 10. Surface the live value so the
                // running diff and toast match what's actually enforced.
                AppConfig = new
                {
                    NarrowEditTolerancePkr = _configuration.GetValue<int>("Invoice:NarrowEditTotalTolerancePkr", 2),
                }
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
        [EnableRateLimiting("passwordChange")]
        public async Task<ActionResult> ChangePassword([FromBody] ChangePasswordDto dto)
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null) return NotFound();

            if (!BCrypt.Net.BCrypt.Verify(dto.CurrentPassword, user.PasswordHash))
                return BadRequest(new { message = "Current password is incorrect" });

            // Audit H-12 (2026-05-13): bump minimum to 8 chars and
            // require at least one letter + one digit so the most-trivial
            // passwords (12345678) are rejected.
            var policyError = ValidatePasswordPolicy(dto.NewPassword);
            if (policyError != null)
                return BadRequest(new { message = policyError });

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
            // Bump the security stamp so every JWT issued under the old
            // password (including the one used to authenticate THIS
            // request) stops working on the next request. Audit C-6.
            user.SecurityStamp = Guid.NewGuid().ToString("N");
            await _context.SaveChangesAsync();
            _cache.Remove($"user-stamp:{user.Id}");

            return Ok(new { message = "Password changed successfully" });
        }

        /// <summary>
        /// Shared password-policy check used by ChangePassword and the
        /// admin user-management create/update endpoints. Returns null
        /// when the password is acceptable; otherwise a user-facing error
        /// message. Audit H-12 (2026-05-13).
        /// </summary>
        internal static string? ValidatePasswordPolicy(string? candidate)
        {
            if (string.IsNullOrWhiteSpace(candidate))
                return "Password is required.";
            if (candidate.Length < 8)
                return "Password must be at least 8 characters.";
            if (candidate.Length > 128)
                return "Password must be 128 characters or fewer.";
            if (!candidate.Any(char.IsLetter))
                return "Password must contain at least one letter.";
            if (!candidate.Any(char.IsDigit))
                return "Password must contain at least one digit.";
            return null;
        }

        [HttpPost("avatar")]
        [Authorize]
        public async Task<ActionResult> UploadAvatar(IFormFile file)
        {
            // Audit M-7 (2026-05-13): magic-bytes + extension + size cap.
            // Pre-fix extension-only check + 7 MB cap let polyglot images
            // (e.g. .png with HTML appended) through; the helper now
            // sniffs the first 12 bytes against known image signatures.
            var validation = MyApp.Api.Helpers.ImageUploadValidator.Validate(file);
            if (validation != null)
                return BadRequest(new { message = validation });

            var ext = Path.GetExtension(Path.GetFileName(file.FileName ?? "")).ToLowerInvariant();

            var username = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null) return NotFound();

            // Save to data/images/avatars/ (persistent, outside wwwroot)
            var avatarsDir = Path.Combine(Directory.GetCurrentDirectory(), "data", "images", "avatars");
            Directory.CreateDirectory(avatarsDir);

            var fileName = $"user-{user.Id}{ext}";
            var filePath = Path.Combine(avatarsDir, fileName);

            // Delete old avatar if different extension
            foreach (var oldExt in MyApp.Api.Helpers.ImageUploadValidator.AllowedExtensions)
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
                var avatarsDir = Path.Combine(Directory.GetCurrentDirectory(), "data", "images", "avatars");
                foreach (var ext in MyApp.Api.Helpers.ImageUploadValidator.AllowedExtensions)
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
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                // Token-revocation marker. Audit C-6 (2026-05-13).
                new Claim("stamp", user.SecurityStamp ?? "")
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

        /// <summary>
        /// Server-side logout — bumps the SecurityStamp so every token
        /// previously issued for this user (including the one used to
        /// hit this endpoint) stops authenticating on the next request.
        /// Audit C-6 (2026-05-13).
        /// </summary>
        [HttpPost("logout")]
        [Authorize]
        public async Task<IActionResult> Logout()
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user != null)
            {
                user.SecurityStamp = Guid.NewGuid().ToString("N");
                await _context.SaveChangesAsync();
                _cache.Remove($"user-stamp:{user.Id}");
                _logger.LogInformation("User {UserId} signed out — security stamp rotated", user.Id);
            }
            return Ok(new { message = "Signed out" });
        }
    }
}
