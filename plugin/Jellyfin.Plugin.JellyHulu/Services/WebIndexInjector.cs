using System.Globalization;
using System.Text;

namespace Jellyfin.Plugin.JellyHulu.Services;

/// <summary>
/// The outcome of an attempt to inject into the web client's index.html.
/// </summary>
public enum InjectionStatus
{
    /// <summary>The tags are present and current.</summary>
    Injected,

    /// <summary>The tags are absent, as requested.</summary>
    Removed,

    /// <summary>index.html could not be found.</summary>
    IndexMissing,

    /// <summary>index.html was found but cannot be written to.</summary>
    NotWritable,

    /// <summary>index.html has no closing body tag to inject before.</summary>
    NoInsertionPoint,

    /// <summary>Something else went wrong; see the log.</summary>
    Failed,
}

/// <summary>
/// The result of an injection attempt.
/// </summary>
/// <param name="Status">What happened.</param>
/// <param name="Detail">A sentence an administrator can act on.</param>
/// <param name="IndexPath">The index.html that was targeted, if it was found.</param>
public readonly record struct InjectionResult(
    InjectionStatus Status,
    string Detail,
    string? IndexPath);

/// <summary>
/// Rewrites jellyfin-web's index.html to reference the theme.
/// </summary>
/// <remarks>
/// The edit is delimited by comment markers so it can be found again and
/// removed exactly, and every write goes to a temporary file first and is
/// then moved into place — an interrupted write must never leave the web
/// client with a truncated index.html.
/// </remarks>
public static class WebIndexInjector
{
    /// <summary>Opening marker for the injected block.</summary>
    public const string BeginMarker = "<!-- JellyHulu:begin -->";

    /// <summary>Closing marker for the injected block.</summary>
    public const string EndMarker = "<!-- JellyHulu:end -->";

    private const string BodyClose = "</body>";

    /// <summary>
    /// Builds the block of tags to insert.
    /// </summary>
    /// <param name="includeStylesheet">Whether to link the stylesheet.</param>
    /// <param name="includeScript">Whether to load the companion script.</param>
    /// <param name="version">Plugin version, for cache busting.</param>
    /// <param name="configToken">Configuration hash, for cache busting.</param>
    /// <returns>The markup to insert, markers included.</returns>
    public static string BuildBlock(
        bool includeStylesheet,
        bool includeScript,
        string version,
        string configToken)
    {
        // Relative URLs, deliberately. index.html is served from <base>/web/,
        // so "../JellyHulu/x" resolves to <base>/JellyHulu/x whatever base
        // path Jellyfin is mounted under — an absolute "/JellyHulu/x" would
        // break every reverse-proxy subpath install.
        var query = string.Create(
            CultureInfo.InvariantCulture,
            $"?v={version}.{configToken}");

        var builder = new StringBuilder();
        builder.Append("    ").AppendLine(BeginMarker);

        if (includeStylesheet)
        {
            builder.Append("    <link rel=\"stylesheet\" href=\"../JellyHulu/jellyhulu.css")
                   .Append(query)
                   .AppendLine("\">");
        }

        if (includeScript)
        {
            // Defaults must be defined before the bundle reads them, so this
            // one is not deferred.
            builder.Append("    <script src=\"../JellyHulu/defaults.js")
                   .Append(query)
                   .AppendLine("\"></script>");
            builder.Append("    <script defer src=\"../JellyHulu/jellyhulu.js")
                   .Append(query)
                   .AppendLine("\"></script>");
        }

        builder.Append("    ").Append(EndMarker);
        return builder.ToString();
    }

    /// <summary>
    /// Removes any previously injected block from a document.
    /// </summary>
    /// <param name="html">The document.</param>
    /// <returns>The document without the block.</returns>
    public static string RemoveBlock(string html)
    {
        ArgumentNullException.ThrowIfNull(html);

        while (true)
        {
            var start = html.IndexOf(BeginMarker, StringComparison.Ordinal);
            if (start < 0)
            {
                return html;
            }

            var end = html.IndexOf(EndMarker, start, StringComparison.Ordinal);
            if (end < 0)
            {
                // A begin marker with no end: remove just the marker rather
                // than guessing where the block was meant to stop.
                html = html.Remove(start, BeginMarker.Length);
                continue;
            }

            end += EndMarker.Length;

            // Take the whitespace and newline around the block with it, so
            // repeated add/remove cycles don't accumulate blank lines.
            while (start > 0 && (html[start - 1] == ' ' || html[start - 1] == '\t'))
            {
                start--;
            }

            if (end < html.Length && html[end] == '\r')
            {
                end++;
            }

            if (end < html.Length && html[end] == '\n')
            {
                end++;
            }

            html = html.Remove(start, end - start);
        }
    }

    /// <summary>
    /// Produces the document with the block injected before the closing body tag.
    /// </summary>
    /// <param name="html">The document.</param>
    /// <param name="block">The block to insert.</param>
    /// <returns>The new document, or null if there is nowhere to insert it.</returns>
    public static string? InjectBlock(string html, string block)
    {
        ArgumentNullException.ThrowIfNull(html);
        ArgumentNullException.ThrowIfNull(block);

        var clean = RemoveBlock(html);

        // The last closing body tag, so a stray one inside an inline script
        // can't capture the insertion.
        var at = clean.LastIndexOf(BodyClose, StringComparison.OrdinalIgnoreCase);
        if (at < 0)
        {
            return null;
        }

        var newline = clean.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        return clean.Insert(at, block + newline);
    }

    /// <summary>
    /// Applies the desired state to the web client's index.html.
    /// </summary>
    /// <param name="webPath">The jellyfin-web directory.</param>
    /// <param name="block">The block to inject, or null to remove it.</param>
    /// <returns>What happened, and why.</returns>
    public static InjectionResult Apply(string webPath, string? block)
    {
        if (string.IsNullOrWhiteSpace(webPath))
        {
            return new InjectionResult(
                InjectionStatus.IndexMissing,
                "The server did not report a web client directory.",
                null);
        }

        var indexPath = Path.Combine(webPath, "index.html");
        if (!File.Exists(indexPath))
        {
            return new InjectionResult(
                InjectionStatus.IndexMissing,
                $"No index.html at {indexPath}. If this server runs headless (no web client), "
                + "there is nothing for the plugin to theme.",
                null);
        }

        string original;
        try
        {
            original = File.ReadAllText(indexPath);
        }
        catch (IOException ex)
        {
            return new InjectionResult(InjectionStatus.Failed, ex.Message, indexPath);
        }
        catch (UnauthorizedAccessException ex)
        {
            return new InjectionResult(InjectionStatus.NotWritable, ex.Message, indexPath);
        }

        string updated;
        InjectionStatus success;

        if (block is null)
        {
            updated = RemoveBlock(original);
            success = InjectionStatus.Removed;
        }
        else
        {
            var injected = InjectBlock(original, block);
            if (injected is null)
            {
                return new InjectionResult(
                    InjectionStatus.NoInsertionPoint,
                    "index.html has no </body> tag, so there is nowhere to add the theme.",
                    indexPath);
            }

            updated = injected;
            success = InjectionStatus.Injected;
        }

        if (string.Equals(updated, original, StringComparison.Ordinal))
        {
            // Already in the desired state. Not writing is not just an
            // optimisation: on a read-only web root this is the difference
            // between working and reporting a failure on every restart.
            return new InjectionResult(success, "Already up to date.", indexPath);
        }

        try
        {
            WriteAtomic(indexPath, updated);
        }
        catch (UnauthorizedAccessException)
        {
            return new InjectionResult(
                InjectionStatus.NotWritable,
                $"{indexPath} is not writable by the Jellyfin service account. "
                + "Either grant it write access to the web client directory, or install the "
                + "companion script another way — see the plugin's documentation.",
                indexPath);
        }
        catch (IOException ex)
        {
            return new InjectionResult(InjectionStatus.Failed, ex.Message, indexPath);
        }

        return new InjectionResult(success, "Updated index.html.", indexPath);
    }

    /// <summary>
    /// Reports whether a web client currently carries the injected block.
    /// </summary>
    /// <param name="webPath">The jellyfin-web directory.</param>
    /// <returns>True when the markers are present.</returns>
    public static bool IsInjected(string webPath)
    {
        if (string.IsNullOrWhiteSpace(webPath))
        {
            return false;
        }

        var indexPath = Path.Combine(webPath, "index.html");
        try
        {
            return File.Exists(indexPath)
                && File.ReadAllText(indexPath).Contains(BeginMarker, StringComparison.Ordinal);
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static void WriteAtomic(string path, string contents)
    {
        // Same directory, so the move is a rename rather than a copy.
        var temp = path + ".jellyhulu-tmp";
        File.WriteAllText(temp, contents);

        try
        {
            File.Move(temp, path, overwrite: true);
        }
        catch
        {
            TryDelete(temp);
            throw;
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
            // Nothing useful to do; the caller is already reporting a failure.
        }
        catch (UnauthorizedAccessException)
        {
            // As above.
        }
    }
}
