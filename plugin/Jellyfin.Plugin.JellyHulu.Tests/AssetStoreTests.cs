using System.Text;
using Jellyfin.Plugin.JellyHulu.Api;
using Xunit;

namespace Jellyfin.Plugin.JellyHulu.Tests;

/// <summary>
/// Tests that the theme's assets are actually inside the built assembly.
/// </summary>
/// <remarks>
/// The assets are embedded through explicit resource paths in the csproj that
/// reach out of the project directory into dist/ and fonts/. Get one of those
/// paths or logical names wrong and everything still compiles — the plugin
/// just serves 404s at runtime. These tests are what turn that into a build
/// failure.
/// </remarks>
public class AssetStoreTests
{
    [Fact]
    public void Stylesheet_IsEmbedded()
    {
        var asset = AssetStore.Stylesheet();

        Assert.NotNull(asset);
        Assert.True(asset!.Value.Bytes.Length > 50_000, "the stylesheet looks truncated");

        var text = Encoding.UTF8.GetString(asset.Value.Bytes);
        Assert.Contains("--jh-accent", text, StringComparison.Ordinal);
        Assert.Contains("@font-face", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Stylesheet_ReferencesFontsRelatively()
    {
        // The plugin serves this from <base>/JellyHulu/jellyhulu.css, so the
        // font URLs must resolve against the stylesheet rather than the site
        // root — otherwise a reverse-proxy subpath install loses the font.
        var text = Encoding.UTF8.GetString(AssetStore.Stylesheet()!.Value.Bytes);

        Assert.Contains("url(fonts/figtree-latin.woff2)", text, StringComparison.Ordinal);
        Assert.DoesNotContain("url(/web/", text, StringComparison.Ordinal);
        Assert.DoesNotContain("data:font/woff2", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Script_IsEmbedded()
    {
        var asset = AssetStore.Script();

        Assert.NotNull(asset);

        var text = Encoding.UTF8.GetString(asset!.Value.Bytes);
        Assert.Contains("JellyHulu", text, StringComparison.Ordinal);
        Assert.Contains("JELLYHULU_DEFAULTS", text, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("figtree-latin.woff2")]
    [InlineData("figtree-latin-ext.woff2")]
    [InlineData("figtree-italic-latin.woff2")]
    [InlineData("figtree-italic-latin-ext.woff2")]
    public void Font_IsEmbedded(string fileName)
    {
        var asset = AssetStore.Font(fileName);

        Assert.NotNull(asset);

        // wOF2 magic — proves it is a font and not, say, an error page.
        var bytes = asset!.Value.Bytes;
        Assert.Equal((byte)'w', bytes[0]);
        Assert.Equal((byte)'O', bytes[1]);
        Assert.Equal((byte)'F', bytes[2]);
        Assert.Equal((byte)'2', bytes[3]);
    }

    [Theory]
    [InlineData("nope.woff2")]
    [InlineData("../../../etc/passwd")]
    [InlineData("..\\..\\web.config")]
    [InlineData("")]
    public void Font_RefusesAnythingNotBundled(string fileName)
    {
        // The route takes a filename, so this is the boundary that keeps it
        // from naming anything except the four bundled fonts.
        Assert.Null(AssetStore.Font(fileName));
    }

    [Fact]
    public void ETags_AreStableAndDistinct()
    {
        var css = AssetStore.Stylesheet()!.Value;
        var js = AssetStore.Script()!.Value;

        Assert.Equal(css.ETag, AssetStore.Stylesheet()!.Value.ETag);
        Assert.NotEqual(css.ETag, js.ETag);
        Assert.StartsWith("\"", css.ETag, StringComparison.Ordinal);
        Assert.EndsWith("\"", css.ETag, StringComparison.Ordinal);
    }

    [Fact]
    public void ETagFor_ChangesWithContent()
    {
        var a = AssetStore.ETagFor("body{}"u8);
        var b = AssetStore.ETagFor("body{ }"u8);

        Assert.NotEqual(a, b);
        Assert.Equal(a, AssetStore.ETagFor("body{}"u8));
    }
}
