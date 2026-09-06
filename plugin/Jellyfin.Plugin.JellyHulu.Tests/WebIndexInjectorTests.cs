using Jellyfin.Plugin.JellyHulu.Services;
using Xunit;

namespace Jellyfin.Plugin.JellyHulu.Tests;

/// <summary>
/// Tests for the index.html rewriting.
/// </summary>
/// <remarks>
/// This is the one part of the plugin that edits a file the user depends on,
/// so the properties that matter are: a round trip leaves the file exactly as
/// it was, and repeated application never stacks up duplicates.
/// </remarks>
public class WebIndexInjectorTests
{
    private const string Index =
        "<!DOCTYPE html>\n<html>\n<head><title>Jellyfin</title></head>\n<body>\n"
        + "  <div id=\"reactRoot\"></div>\n  <script src=\"main.jellyfin.bundle.js\"></script>\n"
        + "</body>\n</html>\n";

    private static string Block() =>
        WebIndexInjector.BuildBlock(true, true, "1.0.0", "abcd1234");

    [Fact]
    public void BuildBlock_IsDelimitedByMarkers()
    {
        var block = Block();

        Assert.Contains(WebIndexInjector.BeginMarker, block, StringComparison.Ordinal);
        Assert.Contains(WebIndexInjector.EndMarker, block, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildBlock_UsesRelativeUrls()
    {
        // Absolute URLs would break every reverse-proxy subpath install.
        var block = Block();

        Assert.Contains("../JellyHulu/jellyhulu.css", block, StringComparison.Ordinal);
        Assert.Contains("../JellyHulu/jellyhulu.js", block, StringComparison.Ordinal);
        Assert.DoesNotContain("\"/JellyHulu/", block, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildBlock_CarriesACacheBustingQuery()
    {
        Assert.Contains("?v=1.0.0.abcd1234", Block(), StringComparison.Ordinal);
    }

    [Fact]
    public void BuildBlock_LoadsDefaultsBeforeTheBundle()
    {
        // The bundle reads window.JELLYHULU_DEFAULTS at boot, so the defaults
        // script must not be deferred behind it.
        var block = Block();
        var defaultsAt = block.IndexOf("defaults.js", StringComparison.Ordinal);
        var bundleAt = block.IndexOf("jellyhulu.js", StringComparison.Ordinal);

        Assert.True(defaultsAt >= 0 && bundleAt > defaultsAt);
        Assert.DoesNotContain("<script defer src=\"../JellyHulu/defaults.js", block, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(true, false, "jellyhulu.css", "jellyhulu.js")]
    [InlineData(false, true, "jellyhulu.js", "jellyhulu.css")]
    public void BuildBlock_HonoursTheFlags(bool css, bool js, string present, string absent)
    {
        var block = WebIndexInjector.BuildBlock(css, js, "1.0.0", "t");

        Assert.Contains(present, block, StringComparison.Ordinal);
        Assert.DoesNotContain(absent, block, StringComparison.Ordinal);
    }

    [Fact]
    public void RoundTrip_LeavesTheDocumentByteIdentical()
    {
        var injected = WebIndexInjector.InjectBlock(Index, Block());

        Assert.NotNull(injected);
        Assert.NotEqual(Index, injected);
        Assert.Equal(Index, WebIndexInjector.RemoveBlock(injected!));
    }

    [Fact]
    public void InjectBlock_IsIdempotent()
    {
        var once = WebIndexInjector.InjectBlock(Index, Block())!;
        var twice = WebIndexInjector.InjectBlock(once, Block())!;

        Assert.Equal(once, twice);
        Assert.Equal(1, Occurrences(twice, WebIndexInjector.BeginMarker));
    }

    [Fact]
    public void InjectBlock_GoesBeforeTheClosingBodyTag()
    {
        var injected = WebIndexInjector.InjectBlock(Index, Block())!;

        var blockAt = injected.IndexOf(WebIndexInjector.BeginMarker, StringComparison.Ordinal);
        var bodyAt = injected.LastIndexOf("</body>", StringComparison.Ordinal);

        Assert.True(blockAt < bodyAt);
    }

    [Fact]
    public void InjectBlock_UsesTheLastClosingBodyTag()
    {
        // A </body> inside an inline string must not capture the insertion.
        var tricky = "<html><body><script>var x = \"</body>\";</script>\n</body></html>";
        var injected = WebIndexInjector.InjectBlock(tricky, Block())!;

        var blockAt = injected.IndexOf(WebIndexInjector.BeginMarker, StringComparison.Ordinal);
        var scriptAt = injected.IndexOf("</script>", StringComparison.Ordinal);

        Assert.True(blockAt > scriptAt);
    }

    [Fact]
    public void InjectBlock_ReturnsNullWithNowhereToGo()
    {
        Assert.Null(WebIndexInjector.InjectBlock("<html><head></head></html>", Block()));
    }

    [Fact]
    public void RemoveBlock_ClearsEveryCopy()
    {
        // A file left in a bad state by an interrupted write, or by an older
        // version, may carry more than one block.
        var doubled = WebIndexInjector.InjectBlock(Index, Block())!;
        doubled = doubled.Replace(
            "</body>",
            Block() + "\n</body>",
            StringComparison.Ordinal);

        var cleaned = WebIndexInjector.RemoveBlock(doubled);

        Assert.Equal(0, Occurrences(cleaned, WebIndexInjector.BeginMarker));
        Assert.DoesNotContain("JellyHulu", cleaned, StringComparison.Ordinal);
    }

    [Fact]
    public void RemoveBlock_SurvivesAnOrphanedBeginMarker()
    {
        var damaged = Index.Replace(
            "</body>",
            "  " + WebIndexInjector.BeginMarker + "\n</body>",
            StringComparison.Ordinal);

        var cleaned = WebIndexInjector.RemoveBlock(damaged);

        Assert.DoesNotContain(WebIndexInjector.BeginMarker, cleaned, StringComparison.Ordinal);
    }

    [Fact]
    public void RemoveBlock_LeavesAnUntouchedDocumentAlone()
    {
        Assert.Equal(Index, WebIndexInjector.RemoveBlock(Index));
    }

    [Fact]
    public void Apply_InjectsThenRemovesCleanly()
    {
        using var web = new TempWeb(Index);

        var injected = WebIndexInjector.Apply(web.Path, Block());
        Assert.Equal(InjectionStatus.Injected, injected.Status);
        Assert.True(WebIndexInjector.IsInjected(web.Path));

        var removed = WebIndexInjector.Apply(web.Path, null);
        Assert.Equal(InjectionStatus.Removed, removed.Status);
        Assert.False(WebIndexInjector.IsInjected(web.Path));
        Assert.Equal(Index, File.ReadAllText(web.IndexPath));
    }

    [Fact]
    public void Apply_DoesNotRewriteWhenAlreadyCorrect()
    {
        using var web = new TempWeb(Index);

        WebIndexInjector.Apply(web.Path, Block());
        var stamp = File.GetLastWriteTimeUtc(web.IndexPath);

        var again = WebIndexInjector.Apply(web.Path, Block());

        Assert.Equal(InjectionStatus.Injected, again.Status);
        Assert.Equal("Already up to date.", again.Detail);

        // Not just an optimisation: on a read-only web root, skipping the
        // write is the difference between working and failing every restart.
        Assert.Equal(stamp, File.GetLastWriteTimeUtc(web.IndexPath));
    }

    [Fact]
    public void Apply_ReportsAMissingIndex()
    {
        using var web = new TempWeb(null);

        var result = WebIndexInjector.Apply(web.Path, Block());

        Assert.Equal(InjectionStatus.IndexMissing, result.Status);
    }

    [Fact]
    public void Apply_ReportsNowhereToInject()
    {
        using var web = new TempWeb("<html><head></head></html>");

        var result = WebIndexInjector.Apply(web.Path, Block());

        Assert.Equal(InjectionStatus.NoInsertionPoint, result.Status);
    }

    [Fact]
    public void Apply_LeavesNoTemporaryFileBehind()
    {
        using var web = new TempWeb(Index);

        WebIndexInjector.Apply(web.Path, Block());

        Assert.Empty(Directory.GetFiles(web.Path, "*.jellyhulu-tmp"));
    }

    [Fact]
    public void Apply_ReportsAnEmptyWebPath()
    {
        var result = WebIndexInjector.Apply(string.Empty, Block());

        Assert.Equal(InjectionStatus.IndexMissing, result.Status);
    }

    private static int Occurrences(string haystack, string needle)
    {
        var count = 0;
        var at = 0;
        while ((at = haystack.IndexOf(needle, at, StringComparison.Ordinal)) >= 0)
        {
            count++;
            at += needle.Length;
        }

        return count;
    }

    private sealed class TempWeb : IDisposable
    {
        public TempWeb(string? index)
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "jellyhulu-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);

            if (index is not null)
            {
                File.WriteAllText(IndexPath, index);
            }
        }

        public string Path { get; }

        public string IndexPath => System.IO.Path.Combine(Path, "index.html");

        public void Dispose()
        {
            try
            {
                Directory.Delete(Path, recursive: true);
            }
            catch (IOException)
            {
                // A leftover temp directory is not worth failing a test over.
            }
        }
    }
}
