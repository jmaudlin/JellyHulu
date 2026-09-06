using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;

namespace Jellyfin.Plugin.JellyHulu.Api;

/// <summary>
/// Reads the theme's assets out of the plugin assembly and caches them with
/// a strong ETag.
/// </summary>
/// <remarks>
/// The assets are embedded rather than copied to disk, so there is nothing to
/// go stale, nothing to clean up on uninstall, and nothing for a Jellyfin
/// upgrade to delete.
/// </remarks>
public static class AssetStore
{
    private const string Prefix = "Jellyfin.Plugin.JellyHulu.Assets.";

    private static readonly ConcurrentDictionary<string, Asset?> Cache = new(StringComparer.Ordinal);

    /// <summary>
    /// The font files the plugin will serve, by request name.
    /// </summary>
    /// <remarks>
    /// An explicit map rather than a path built from user input: the route
    /// takes a filename, and this is what stops it being able to name
    /// anything except these four resources.
    /// </remarks>
    private static readonly Dictionary<string, string> FontResources = new(StringComparer.OrdinalIgnoreCase)
    {
        ["figtree-latin.woff2"] = "fonts.figtree-latin.woff2",
        ["figtree-latin-ext.woff2"] = "fonts.figtree-latin-ext.woff2",
        ["figtree-italic-latin.woff2"] = "fonts.figtree-italic-latin.woff2",
        ["figtree-italic-latin-ext.woff2"] = "fonts.figtree-italic-latin-ext.woff2",
    };

    /// <summary>
    /// An embedded asset and its ETag.
    /// </summary>
    /// <param name="Bytes">The content.</param>
    /// <param name="ETag">A strong ETag over the content.</param>
    public readonly record struct Asset(byte[] Bytes, string ETag);

    /// <summary>
    /// Gets the theme stylesheet.
    /// </summary>
    /// <returns>The asset, or null when it is missing from the build.</returns>
    public static Asset? Stylesheet() => Load("jellyhulu.css");

    /// <summary>
    /// Gets the companion script.
    /// </summary>
    /// <returns>The asset, or null when it is missing from the build.</returns>
    public static Asset? Script() => Load("jellyhulu.js");

    /// <summary>
    /// Gets one of the bundled font files.
    /// </summary>
    /// <param name="fileName">The requested file name.</param>
    /// <returns>The asset, or null when the name is not one of the bundled fonts.</returns>
    public static Asset? Font(string fileName)
    {
        return FontResources.TryGetValue(fileName, out var resource) ? Load(resource) : null;
    }

    /// <summary>
    /// Builds an ETag over arbitrary generated content.
    /// </summary>
    /// <param name="content">The content.</param>
    /// <returns>A quoted strong ETag.</returns>
    public static string ETagFor(ReadOnlySpan<byte> content)
    {
        Span<byte> digest = stackalloc byte[32];
        SHA256.HashData(content, digest);
        return string.Create(
            CultureInfo.InvariantCulture,
            $"\"{Convert.ToHexString(digest[..16]).ToLowerInvariant()}\"");
    }

    private static Asset? Load(string suffix)
    {
        return Cache.GetOrAdd(suffix, static key =>
        {
            var assembly = typeof(AssetStore).GetTypeInfo().Assembly;
            using var stream = assembly.GetManifestResourceStream(Prefix + key);
            if (stream is null)
            {
                return null;
            }

            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            var bytes = memory.ToArray();
            return new Asset(bytes, ETagFor(bytes));
        });
    }
}
