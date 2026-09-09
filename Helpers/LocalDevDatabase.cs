using System.Text.Json;

namespace MyApp.Api.Helpers;

/// <summary>
/// Picks the LOCAL database from the checked-out git branch, so a developer
/// (or a coding agent) never edits a connection string to switch environment.
///
/// This repository carries THREE separate production installations on three
/// long-lived branches (see docs/ENVIRONMENTS.md). Each one has its own live
/// database, and locally each one has its own restored copy of that database.
/// Before this existed the only thing standing between "test a customize fix"
/// and "write into the master dataset" was remembering to edit
/// appsettings.Development.json — which is gitignored, so the wrong value
/// survived every branch switch silently.
///
/// The map lives in <c>local.databases.json</c> at the REPO ROOT (found by
/// walking up to the <c>.git</c> directory), not in the publish output:
///
///   • It is only consulted when the environment is Development.
///   • It is only found when a <c>.git</c> directory is present.
///
/// A published deploy satisfies neither, so production keeps whatever
/// appsettings.Production.json / the FTP host's environment gives it. The file
/// is also excluded from publish in MyApp.Api.csproj as a second line.
///
/// It holds no secret: every entry is Windows-authenticated against a local
/// SQL Server instance, which is why it can be tracked in git and therefore
/// read by anyone who clones the repo.
/// </summary>
public static class LocalDevDatabase
{
    public const string MapFileName = "local.databases.json";

    /// <summary>Per-machine override, gitignored — same shape, wins field by field.</summary>
    public const string LocalOverrideFileName = "local.databases.local.json";

    public sealed record Resolution(
        string? ConnectionString,
        string? Branch,
        string? Database,
        string? Server,
        string Reason);

    /// <summary>
    /// Resolves the connection string for the current branch, or null when
    /// nothing applies (not a git checkout, no map, branch not mapped).
    /// Never throws: a misconfigured local map must not stop the app booting,
    /// it just falls through to the ordinary appsettings chain.
    /// </summary>
    public static Resolution Resolve(string contentRootPath)
    {
        try
        {
            var repoRoot = FindRepoRoot(contentRootPath);
            if (repoRoot is null)
                return new Resolution(null, null, null, null, "no .git directory above the content root");

            var map = ReadMap(Path.Combine(repoRoot, MapFileName));
            if (map is null)
                return new Resolution(null, null, null, null, $"{MapFileName} not found at {repoRoot}");

            // Per-machine override: another developer's SQL instance is not
            // called what this machine's is, and they must not have to edit
            // (and accidentally commit) the shared map to say so.
            var overridePath = Path.Combine(repoRoot, LocalOverrideFileName);
            var overrides = ReadMap(overridePath);
            if (overrides is not null) map = Merge(map, overrides);

            if (map.Enabled == false)
                return new Resolution(null, null, null, null, $"{MapFileName} has \"enabled\": false");

            var branch = ReadCurrentBranch(repoRoot);
            if (branch is null)
                return new Resolution(null, null, null, null, "HEAD is detached — no branch to map");

            var database = Lookup(map.Branches, branch);
            if (database is null)
                return new Resolution(null, branch, null, null,
                    $"branch '{branch}' has no entry in {MapFileName}");

            var server = string.IsNullOrWhiteSpace(map.Server) ? "." : map.Server!;
            var template = string.IsNullOrWhiteSpace(map.ConnectionTemplate)
                ? "Server={server};Database={database};Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True;"
                : map.ConnectionTemplate!;

            var conn = template
                .Replace("{server}", server, StringComparison.Ordinal)
                .Replace("{database}", database, StringComparison.Ordinal);

            return new Resolution(conn, branch, database, server, "resolved from branch");
        }
        catch (Exception ex)
        {
            return new Resolution(null, null, null, null, $"local database map unreadable: {ex.GetType().Name}");
        }
    }

    // ── branch → database lookup ────────────────────────────────────────────
    // Exact match first, then a single-'*' wildcard, longest pattern winning,
    // so "feat/importer-*" can catch a throwaway branch cut off the importer
    // line without every temporary branch needing its own entry.
    private static string? Lookup(Dictionary<string, string>? branches, string branch)
    {
        if (branches is null || branches.Count == 0) return null;

        foreach (var kv in branches)
            if (string.Equals(kv.Key, branch, StringComparison.OrdinalIgnoreCase))
                return kv.Value;

        string? best = null;
        var bestLength = -1;
        foreach (var kv in branches)
        {
            if (!kv.Key.Contains('*', StringComparison.Ordinal)) continue;
            if (!WildcardMatch(kv.Key, branch)) continue;
            if (kv.Key.Length <= bestLength) continue;
            best = kv.Value;
            bestLength = kv.Key.Length;
        }
        return best;
    }

    private static bool WildcardMatch(string pattern, string value)
    {
        var star = pattern.IndexOf('*', StringComparison.Ordinal);
        var prefix = pattern[..star];
        var suffix = pattern[(star + 1)..];
        return value.Length >= prefix.Length + suffix.Length
            && value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            && value.EndsWith(suffix, StringComparison.OrdinalIgnoreCase);
    }

    // ── git plumbing, read directly rather than shelling out to git ─────────
    // Starting a process on every boot to learn one string is not worth it,
    // and `git` is not guaranteed to be on PATH of whatever runs the app.
    private static string? FindRepoRoot(string startPath)
    {
        var dir = new DirectoryInfo(startPath);
        while (dir is not null)
        {
            var dotGit = Path.Combine(dir.FullName, ".git");
            if (Directory.Exists(dotGit) || File.Exists(dotGit)) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    /// <summary>
    /// Reads the branch out of .git/HEAD. Handles a worktree, where .git is a
    /// FILE containing "gitdir: &lt;path&gt;" and HEAD lives there instead.
    /// </summary>
    public static string? ReadCurrentBranch(string repoRoot)
    {
        var dotGit = Path.Combine(repoRoot, ".git");
        string gitDir;

        if (File.Exists(dotGit))
        {
            var pointer = File.ReadAllText(dotGit).Trim();
            const string marker = "gitdir:";
            if (!pointer.StartsWith(marker, StringComparison.OrdinalIgnoreCase)) return null;
            gitDir = pointer[marker.Length..].Trim();
            if (!Path.IsPathRooted(gitDir)) gitDir = Path.GetFullPath(Path.Combine(repoRoot, gitDir));
        }
        else if (Directory.Exists(dotGit))
        {
            gitDir = dotGit;
        }
        else return null;

        var headPath = Path.Combine(gitDir, "HEAD");
        if (!File.Exists(headPath)) return null;

        var head = File.ReadAllText(headPath).Trim();
        const string refPrefix = "ref: refs/heads/";
        // Anything else is a detached HEAD (a bare 40-char sha) — there is no
        // branch, so there is nothing to map and we say so rather than guess.
        return head.StartsWith(refPrefix, StringComparison.Ordinal)
            ? head[refPrefix.Length..].Trim()
            : null;
    }

    // ── map file ────────────────────────────────────────────────────────────
    private sealed class Map
    {
        public bool? Enabled { get; set; }
        public string? Server { get; set; }
        public string? ConnectionTemplate { get; set; }
        public Dictionary<string, string>? Branches { get; set; }
    }

    private static Map? ReadMap(string path)
    {
        if (!File.Exists(path)) return null;
        return JsonSerializer.Deserialize<Map>(File.ReadAllText(path), new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true
        });
    }

    // The override replaces only the fields it states. Branch entries merge
    // per key, so a machine can redirect ONE branch without restating the map.
    private static Map Merge(Map baseMap, Map overrides)
    {
        var merged = new Map
        {
            Enabled = overrides.Enabled ?? baseMap.Enabled,
            Server = string.IsNullOrWhiteSpace(overrides.Server) ? baseMap.Server : overrides.Server,
            ConnectionTemplate = string.IsNullOrWhiteSpace(overrides.ConnectionTemplate)
                ? baseMap.ConnectionTemplate
                : overrides.ConnectionTemplate,
            Branches = new Dictionary<string, string>(
                baseMap.Branches ?? new Dictionary<string, string>(),
                StringComparer.OrdinalIgnoreCase)
        };

        if (overrides.Branches is not null)
            foreach (var kv in overrides.Branches) merged.Branches![kv.Key] = kv.Value;

        return merged;
    }
}
