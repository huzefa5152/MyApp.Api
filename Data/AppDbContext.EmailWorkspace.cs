using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;
namespace MyApp.Api.Data;
public partial class AppDbContext
{
    public DbSet<GmailConnection> GmailConnections => Set<GmailConnection>();
    public DbSet<GmailCompanyLink> GmailCompanyLinks => Set<GmailCompanyLink>();
    public DbSet<GmailMessage> GmailMessages => Set<GmailMessage>();
    public DbSet<EmailEnquiry> EmailEnquiries => Set<EmailEnquiry>();
    public DbSet<GmailOAuthRequest> GmailOAuthRequests => Set<GmailOAuthRequest>();
    public DbSet<EmailWorkspaceEvent> EmailWorkspaceEvents => Set<EmailWorkspaceEvent>();

    private static void ConfigureEmailWorkspace(ModelBuilder b)
    {
        b.Entity<GmailConnection>().HasIndex(x => new { x.OwnerUserId, x.GoogleSubject }).IsUnique();
        b.Entity<GmailConnection>().HasIndex(x => new { x.Status, x.NextSyncAt });
        b.Entity<GmailCompanyLink>().HasIndex(x => new { x.ConnectionId, x.CompanyId }).IsUnique();
        b.Entity<GmailCompanyLink>().HasOne(x => x.Connection).WithMany().HasForeignKey(x => x.ConnectionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GmailMessage>().HasIndex(x => new { x.ConnectionId, x.ProviderMessageId }).IsUnique();
        b.Entity<GmailMessage>().HasIndex(x => new { x.ConnectionId, x.ReceivedAt });
        b.Entity<GmailMessage>().HasOne(x => x.Connection).WithMany().HasForeignKey(x => x.ConnectionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<EmailEnquiry>().HasIndex(x => new { x.CompanyId, x.MessageId }).IsUnique();
        b.Entity<EmailEnquiry>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<EmailEnquiry>().HasOne(x => x.Message).WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GmailOAuthRequest>().HasKey(x => x.StateHash);
        b.Entity<EmailWorkspaceEvent>().HasIndex(x => new { x.CompanyId, x.Timestamp });
        // Owner/company identifiers intentionally have no cascading foreign keys.
        // Company deletion purges its records; user deletion disconnects owned mailboxes.
    }
}
