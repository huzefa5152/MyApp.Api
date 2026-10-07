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
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
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

        // Account lockout policy: 10 consecutive failures → 2-hour lock.
        // State is persisted on the Users row (never cached) so a manual
        // SQL unlock (FailedLoginAttempts = 0, LockoutUntil = NULL) takes
        // effect on the very next attempt.
        private const int MaxFailedLoginAttempts = 10;
        private static readonly TimeSpan LockoutDuration = TimeSpan.FromHours(2);

        private sealed class UnknownLoginState
        {
            public int Failures { get; set; }
            public DateTime? LockoutUntil { get; set; }
        }
        private static readonly object UnknownLoginGate = new();

        private UnauthorizedObjectResult LoginFailure(int? remaining, DateTime? until = null) =>
            Unauthorized(new
            {
                message = until.HasValue
                    ? $"Sign-in temporarily locked. Try again after {until.Value:yyyy-MM-dd HH:mm} UTC, or ask your administrator to unlock your account."
                    : remaining.HasValue
                        ? $"Invalid username or password. {remaining.Value} {(remaining.Value == 1 ? "attempt" : "attempts")} remaining before a temporary lock."
                        : "Invalid username or password. This account is exempt from automatic lockout.",
                attemptsRemaining = remaining,
                lockoutUntil = until.HasValue ? DateTime.SpecifyKind(until.Value, DateTimeKind.Utc) : (DateTime?)null
            });

        private UnauthorizedObjectResult UnknownLoginFailure(string username)
        {
            // Count an unknown login name per caller, without creating a user record.
            var key = "unknown-login:" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                Encoding.UTF8.GetBytes((HttpContext.Connection.RemoteIpAddress?.ToString() ?? "") + "|" + username.ToUpperInvariant())));
            lock (UnknownLoginGate)
            {
                var now = DateTime.UtcNow;
                var state = _cache.Get<UnknownLoginState>(key) ?? new UnknownLoginState();
                if (state.LockoutUntil > now) return LoginFailure(0, state.LockoutUntil);
                if (state.LockoutUntil.HasValue) state = new UnknownLoginState();
                state.Failures++;
                if (state.Failures >= MaxFailedLoginAttempts) state.LockoutUntil = now.Add(LockoutDuration);
                _cache.Set(key, state, LockoutDuration);
                return LoginFailure(Math.Max(0, MaxFailedLoginAttempts - state.Failures), state.LockoutUntil);
            }
        }

        public AuthController(AppDbContext context, IConfiguration configuration, IMemoryCache cache, ILogger<AuthController> logger) : base(logger)
        {
            _context = context;
            _configuration = configuration;
            _cache = cache;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
            _logger = logger;
        }

        private int CurrentUserId => int.TryParse(
            User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub),
            out var id) ? id : 0;

        private Task<Models.User?> CurrentUserAsync() => _context.Users.FirstOrDefaultAsync(u =>
            u.Id == CurrentUserId && u.SecurityStamp == User.FindFirstValue("stamp"));

        private async Task<Models.UserSession?> CurrentSessionAsync(Models.User user)
        {
            var sid = User.FindFirstValue("sid");
            var jti = User.FindFirstValue(JwtRegisteredClaimNames.Jti);
            if (sid == null && string.IsNullOrWhiteSpace(jti)) return null;
            var id = sid ?? "legacy:" + jti;
            var session = await _context.UserSessions.FirstOrDefaultAsync(s => s.Id == id);
            if (session == null && sid == null)
            {
                var now = DateTime.UtcNow;
                session = new Models.UserSession {
                    Id = id, UserId = user.Id, SecurityStamp = user.SecurityStamp,
                    CreatedAt = now, LastSeenAt = now, ExpiresAt = now.AddDays(30),
                    TokenExpiresAt = now.AddHours(_configuration.GetValue<double>("Jwt:SessionExpirationHours", 168)),
                    UserAgent = Request.Headers.UserAgent.ToString()[..Math.Min(Request.Headers.UserAgent.ToString().Length, 512)],
                    IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString() ?? ""
                };
                _context.UserSessions.Add(session);
                try { await _context.SaveChangesAsync(); }
                catch (DbUpdateException ex) when (ex.InnerException is Microsoft.Data.SqlClient.SqlException sql && sql.Number is 2601 or 2627)
                {
                    // Concurrent tabs upgrading one legacy token share its durable session.
                    _context.Entry(session).State = EntityState.Detached;
                    session = await _context.UserSessions.FirstOrDefaultAsync(s => s.Id == id);
                }
            }
            return session is { IsRevoked: false } && session.UserId == user.Id
                && session.SecurityStamp == user.SecurityStamp && session.ExpiresAt > DateTime.UtcNow ? session : null;
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
                return UnknownLoginFailure(dto.Username ?? string.Empty);
            }

            var now = DateTime.UtcNow;

            // Locked account — reject before verifying the password. The
            // check reads LockoutUntil straight off the row, so an expired
            // lock (or a manual SQL unlock) is honoured immediately.
            var isSeedAdmin = user.Id == _seedAdminUserId;
            if (isSeedAdmin && (user.FailedLoginAttempts != 0 || user.LockoutUntil.HasValue))
            {
                user.FailedLoginAttempts = 0;
                user.LockoutUntil = null;
                user.LastFailedLogin = null;
                await _context.SaveChangesAsync();
            }
            if (!isSeedAdmin && user.LockoutUntil.HasValue && user.LockoutUntil.Value > now)
            {
                // Burn the same CPU as a real verify (M-12) so the locked
                // path doesn't stand out by timing.
                _ = BCrypt.Net.BCrypt.Verify(dto.Password ?? string.Empty, _dummyBcryptHash);
                _logger.LogWarning("Login attempt for locked account UserId={UserId} from {Ip} (locked until {LockoutUntil:u})",
                    user.Id, HttpContext.Connection.RemoteIpAddress, user.LockoutUntil.Value);
                return LoginFailure(0, user.LockoutUntil);
            }

            if (!BCrypt.Net.BCrypt.Verify(dto.Password ?? string.Empty, user.PasswordHash))
            {
                if (!isSeedAdmin)
                {
                    // Increment in SQL so concurrent failures cannot lose an attempt.
                    await _context.Users.Where(u => u.Id == user.Id
                        && (!u.LockoutUntil.HasValue || u.LockoutUntil <= now))
                        .ExecuteUpdateAsync(set => set
                            .SetProperty(u => u.FailedLoginAttempts, u => u.LockoutUntil.HasValue ? 1 : u.FailedLoginAttempts + 1)
                            .SetProperty(u => u.LastFailedLogin, now)
                            .SetProperty(u => u.LockoutUntil, u =>
                                (u.LockoutUntil.HasValue ? 1 : u.FailedLoginAttempts + 1) >= MaxFailedLoginAttempts
                                    ? (DateTime?)now.Add(LockoutDuration) : null));
                    await _context.Entry(user).ReloadAsync();
                }
                _logger.LogWarning("Failed login attempt for UserId={UserId} from {Ip}",
                    user.Id, HttpContext.Connection.RemoteIpAddress);
                return LoginFailure(isSeedAdmin ? null : Math.Max(0, MaxFailedLoginAttempts - user.FailedLoginAttempts), user.LockoutUntil);
            }

            // Clear failures only while the verified credentials and lock state still match.
            // A concurrent password reset or newly activated lock cannot issue a fresh session.
            var cleared = await _context.Users.Where(u => u.Id == user.Id && u.SecurityStamp == user.SecurityStamp
                && u.PasswordHash == user.PasswordHash && (isSeedAdmin || !u.LockoutUntil.HasValue || u.LockoutUntil <= now))
                .ExecuteUpdateAsync(update => update.SetProperty(u => u.FailedLoginAttempts, 0)
                    .SetProperty(u => u.LockoutUntil, (DateTime?)null).SetProperty(u => u.LastFailedLogin, (DateTime?)null));
            if (cleared == 0) return Unauthorized(new { message = "Sign-in could not be completed. Please try again." });

            var session = new Models.UserSession
            {
                Id = Guid.NewGuid().ToString("N"), UserId = user.Id, SecurityStamp = user.SecurityStamp ?? "",
                ExpiresAt = DateTime.UtcNow.AddDays(30), CreatedAt = now, LastSeenAt = now,
                TokenExpiresAt = now.AddHours(_configuration.GetValue<double>("Jwt:SessionExpirationHours", 168)),
                UserAgent = Request.Headers.UserAgent.ToString()[..Math.Min(Request.Headers.UserAgent.ToString().Length, 512)],
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString() ?? ""
            };
            _context.UserSessions.Add(session);
            await _context.SaveChangesAsync();
            var token = GenerateJwtToken(user, session.Id);
            var expiration = DateTime.UtcNow.AddHours(
                _configuration.GetValue<double>("Jwt:SessionExpirationHours", 168));
            SetImageSession(token, expiration);

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
            var user = await CurrentUserAsync();

            if (user == null)
                return Unauthorized();

            // Existing signed-in tabs gain image access without another login.
            var bearer = Request.Headers.Authorization.ToString();
            if (bearer.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                SetImageSession(bearer[7..], DateTime.UtcNow.AddHours(
                    _configuration.GetValue<double>("Jwt:SessionExpirationHours", 168)));

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
                    NarrowEditTolerancePkr = _configuration.GetValue<int>("Invoice:NarrowEditTotalTolerancePkr", 10),
                }
            });
        }

        [HttpPut("profile")]
        [Authorize]
        public async Task<ActionResult> UpdateProfile([FromBody] UpdateProfileDto dto)
        {
            var user = await CurrentUserAsync();
            if (user == null) return Unauthorized();

            // Check if new username is taken by another user
            if (!string.IsNullOrWhiteSpace(dto.Username) && dto.Username.Trim() != user.Username)
            {
                var exists = await _context.Users.AnyAsync(u => u.Id != user.Id && u.Username == dto.Username.Trim());
                if (exists)
                    return BadRequest(new { message = "Username is already taken" });
                user.Username = dto.Username.Trim();
            }

            if (!string.IsNullOrWhiteSpace(dto.FullName))
                user.FullName = dto.FullName.Trim();

            var session = await CurrentSessionAsync(user);
            if (session == null) return Unauthorized();
            await _context.SaveChangesAsync();

            // Return new token with updated claims, preserving this device identity.
            var sessionId = session.Id;
            var newToken = GenerateJwtToken(user, sessionId);
            if (sessionId != null)
                await _context.UserSessions.Where(s => s.Id == sessionId && !s.IsRevoked)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.TokenExpiresAt,
                        DateTime.UtcNow.AddHours(_configuration.GetValue<double>("Jwt:SessionExpirationHours", 168))));
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
            var user = await CurrentUserAsync();
            if (user == null) return Unauthorized();

            if (!BCrypt.Net.BCrypt.Verify(dto.CurrentPassword, user.PasswordHash))
                return BadRequest(new { message = "Current password is incorrect" });

            // Audit H-12 (2026-05-13): bump minimum to 8 chars and
            // require at least one letter + one digit so the most-trivial
            // passwords (12345678) are rejected.
            var policyError = ValidatePasswordPolicy(dto.NewPassword);
            if (policyError != null)
                return BadRequest(new { message = policyError });

            var newHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
            var newStamp = Guid.NewGuid().ToString("N");
            // A concurrent password reset must not be overwritten using the old credentials.
            var changed = await _context.Users.Where(u => u.Id == user.Id && u.SecurityStamp == user.SecurityStamp
                && u.PasswordHash == user.PasswordHash).ExecuteUpdateAsync(update =>
                    update.SetProperty(u => u.PasswordHash, newHash).SetProperty(u => u.SecurityStamp, newStamp));
            if (changed == 0) return Unauthorized();
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

            var user = await CurrentUserAsync();
            if (user == null) return Unauthorized();

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
            var user = await CurrentUserAsync();
            if (user == null) return Unauthorized();

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

        private string GenerateJwtToken(Models.User user, string? sessionId = null)
        {
            var key = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(_configuration["Jwt:Key"]!));
            var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role),
                new Claim("fullName", user.FullName),
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                // Token-revocation marker. Audit C-6 (2026-05-13).
                new Claim("stamp", user.SecurityStamp ?? "")
            };

            if (sessionId != null) claims.Add(new Claim("sid", sessionId));

            var token = new JwtSecurityToken(
                issuer: _configuration["Jwt:Issuer"],
                audience: _configuration["Jwt:Audience"],
                claims: claims,
                expires: DateTime.UtcNow.AddHours(
                    _configuration.GetValue<double>("Jwt:SessionExpirationHours", 168)),
                signingCredentials: credentials
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        private void SetImageSession(string token, DateTime expires) =>
            Response.Cookies.Append(MyApp.Api.Middleware.PrivateDataFilesMiddleware.CookieName, token,
                new CookieOptions { HttpOnly = true, Secure = Request.IsHttps
                    || !HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment(),
                    SameSite = SameSiteMode.Strict, Path = "/data", Expires = expires });

        [HttpPost("refresh")]
        [Authorize]
        public async Task<IActionResult> Refresh()
        {
            var user = await CurrentUserAsync();
            if (user == null) return Unauthorized();
            var session = await CurrentSessionAsync(user);
            if (session == null) return Unauthorized();
            var id = session.Id;
            var token = GenerateJwtToken(user, id);
            var expiration = DateTime.UtcNow.AddHours(_configuration.GetValue<double>("Jwt:SessionExpirationHours", 168));
            await _context.UserSessions.Where(s => s.Id == id && !s.IsRevoked)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.TokenExpiresAt, expiration));
            SetImageSession(token, expiration);
            return Ok(new { token, expiration });
        }

        [HttpPost("logout")]
        [Authorize]
        public async Task<IActionResult> Logout()
        {
            Response.Cookies.Delete(MyApp.Api.Middleware.PrivateDataFilesMiddleware.CookieName,
                new CookieOptions { Path = "/data" });
            var user = await CurrentUserAsync();
            if (user == null) return Unauthorized();
            var session = await CurrentSessionAsync(user);
            if (session == null) return Unauthorized();
            await _context.UserSessions.Where(s => s.Id == session.Id && s.UserId == CurrentUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsRevoked, true).SetProperty(x => x.RevokedAt, DateTime.UtcNow));
            return Ok(new { message = "Signed out" });
        }
    }
}
