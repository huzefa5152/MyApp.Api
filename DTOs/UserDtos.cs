using System.ComponentModel.DataAnnotations;

namespace MyApp.Api.DTOs
{
    public class CreateUserDto
    {
        [Required]
        public string Username { get; set; } = string.Empty;

        [Required]
        [MinLength(6)]
        public string Password { get; set; } = string.Empty;

        [Required]
        public string FullName { get; set; } = string.Empty;

        public string Role { get; set; } = "Admin";
    }

    public class UpdateUserDto
    {
        public string? Username { get; set; }
        public string? FullName { get; set; }
        public string? Role { get; set; }

        [MinLength(6)]
        public string? Password { get; set; }
    }
}
