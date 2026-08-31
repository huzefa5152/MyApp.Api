namespace MyApp.Api.Models
{
    /// <summary>
    /// Append-only history of every mapping revision for an
    /// <see cref="ImportProfile"/>. Rollback is copying an old
    /// <see cref="MappingJson"/> back onto the parent (which itself records a
    /// new version, so the history stays a straight line rather than a tree).
    ///
    /// Mirrors <see cref="POFormatVersion"/>. It matters more here than it looks:
    /// a mapping edit silently changes which column an amount is read from, and
    /// the only way to explain a wrong import after the fact is to see what the
    /// mapping said at the time.
    /// </summary>
    public class ImportProfileVersion
    {
        public int Id { get; set; }

        public int ImportProfileId { get; set; }
        public ImportProfile? ImportProfile { get; set; }

        public int Version { get; set; }

        public string MappingJson { get; set; } = "{}";

        /// <summary>Layout at the time of this revision — a profile can be
        /// re-pointed at a different strategy, and the mapping only makes sense
        /// alongside the layout that read it.</summary>
        public string Layout { get; set; } = "";

        public string? ChangeNote { get; set; }

        /// <summary>Username snapshot — cheaper than an FK and survives a user
        /// being deleted, same convention as <see cref="POFormatVersion.CreatedBy"/>.</summary>
        public string? CreatedBy { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
