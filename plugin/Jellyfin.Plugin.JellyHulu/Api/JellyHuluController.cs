using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Net.Mime;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.JellyHulu.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.JellyHulu.Api;

/// <summary>
/// Serves the theme's assets to the web client.
/// </summary>
/// <remarks>
/// These endpoints are anonymous on purpose. A &lt;link&gt; or &lt;script&gt;
/// tag in index.html carries no Jellyfin access token, so requiring
/// authentication here would mean the theme never loads — including on the
/// login page, which is one of the pages it themes. Nothing served here is
/// user data: it is the same stylesheet, script and font files that ship in
/// the public repository.
/// </remarks>
[ApiController]
[Route("JellyHulu")]
public class JellyHuluController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
    };

    /// <summary>
    /// Gets the theme stylesheet, with any administrator overrides appended.
    /// </summary>
    /// <response code="200">The stylesheet.</response>
    /// <response code="304">The cached copy is current.</response>
    /// <response code="404">The plugin was built without the stylesheet.</response>
    /// <returns>The stylesheet.</returns>
    [HttpGet("jellyhulu.css")]
    [AllowAnonymous]
    [Produces("text/css")]
    public ActionResult Stylesheet()
    {
        var asset = AssetStore.Stylesheet();
        if (asset is null)
        {
            return NotFound();
        }

        var extra = Plugin.Instance?.Configuration.CustomCss;
        if (string.IsNullOrWhiteSpace(extra))
        {
            return IsFresh(asset.Value.ETag)
                ? StatusCode(StatusCodes.Status304NotModified)
                : Send(asset.Value.Bytes, asset.Value.ETag, "text/css; charset=utf-8", immutable: true);
        }

        // Overrides go last so they win on source order, which is how the
        // theme is designed to be customised.
        var builder = new StringBuilder(asset.Value.Bytes.Length + extra.Length + 64);
        builder.Append(Encoding.UTF8.GetString(asset.Value.Bytes));
        builder.AppendLine();
        builder.AppendLine("/* ── Overrides from the JellyHulu plugin configuration ── */");
        builder.AppendLine(extra);

        var bytes = Encoding.UTF8.GetBytes(builder.ToString());
        var etag = AssetStore.ETagFor(bytes);
        return IsFresh(etag)
            ? StatusCode(StatusCodes.Status304NotModified)
            : Send(bytes, etag, "text/css; charset=utf-8", immutable: false);
    }

    /// <summary>
    /// Gets the companion script.
    /// </summary>
    /// <response code="200">The script.</response>
    /// <response code="304">The cached copy is current.</response>
    /// <response code="404">The plugin was built without the script.</response>
    /// <returns>The script.</returns>
    [HttpGet("jellyhulu.js")]
    [AllowAnonymous]
    [Produces("text/javascript")]
    public ActionResult Script()
    {
        var asset = AssetStore.Script();
        if (asset is null)
        {
            return NotFound();
        }

        return IsFresh(asset.Value.ETag)
            ? StatusCode(StatusCodes.Status304NotModified)
            : Send(asset.Value.Bytes, asset.Value.ETag, "text/javascript; charset=utf-8", immutable: true);
    }

    /// <summary>
    /// Gets the server-wide defaults for the companion script.
    /// </summary>
    /// <remarks>
    /// These are defaults, not policy: a user's own choices in the theme's
    /// settings panel are stored per user and still take precedence.
    /// </remarks>
    /// <response code="200">The defaults, as a script.</response>
    /// <response code="304">The cached copy is current.</response>
    /// <returns>The defaults.</returns>
    [HttpGet("defaults.js")]
    [AllowAnonymous]
    [Produces("text/javascript")]
    public ActionResult Defaults()
    {
        var config = Plugin.Instance?.Configuration;

        var defaults = new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["accent"] = config?.DefaultAccent ?? "#1CE783",
            ["density"] = config?.DefaultDensity ?? "comfortable",
            ["motion"] = config?.DefaultMotion ?? "full",
            ["hero"] = (config?.DefaultHero ?? true) ? "on" : "off",
            ["previews"] = (config?.DefaultPreviews ?? true) ? "on" : "off",
            ["badges"] = (config?.DefaultBadges ?? true) ? "on" : "off",
            ["heroDwell"] = Math.Clamp(config?.HeroDwellSeconds ?? 9, 3, 60),
        };

        var json = JsonSerializer.Serialize(defaults, JsonOptions);
        var script = string.Create(
            CultureInfo.InvariantCulture,
            $"/* JellyHulu server defaults */\nwindow.JELLYHULU_DEFAULTS={json};\n");

        var bytes = Encoding.UTF8.GetBytes(script);
        var etag = AssetStore.ETagFor(bytes);
        return IsFresh(etag)
            ? StatusCode(StatusCodes.Status304NotModified)
            : Send(bytes, etag, "text/javascript; charset=utf-8", immutable: false);
    }

    /// <summary>
    /// Gets one of the bundled font files.
    /// </summary>
    /// <param name="fileName">The font file name.</param>
    /// <response code="200">The font.</response>
    /// <response code="304">The cached copy is current.</response>
    /// <response code="404">Not one of the bundled fonts.</response>
    /// <returns>The font file.</returns>
    [HttpGet("fonts/{fileName}")]
    [AllowAnonymous]
    public ActionResult Font([FromRoute] string fileName)
    {
        var asset = AssetStore.Font(fileName);
        if (asset is null)
        {
            return NotFound();
        }

        return IsFresh(asset.Value.ETag)
            ? StatusCode(StatusCodes.Status304NotModified)
            : Send(asset.Value.Bytes, asset.Value.ETag, "font/woff2", immutable: true);
    }

    /// <summary>
    /// Gets the current injection status, for the configuration page.
    /// </summary>
    /// <response code="200">The status.</response>
    /// <returns>The status.</returns>
    [HttpGet("Status")]
    [Authorize(Policy = "RequiresElevation")]
    [Produces(MediaTypeNames.Application.Json)]
    [SuppressMessage(
        "Performance",
        "CA1822:Mark members as static",
        Justification = "ASP.NET Core will not route a static action method.")]
    public ActionResult<InjectionStatusResponse> Status()
    {
        var result = ThemeInjectionService.LastResult;
        var config = Plugin.Instance?.Configuration;

        return new InjectionStatusResponse
        {
            Status = result.Status.ToString(),
            Detail = result.Detail,
            IndexPath = result.IndexPath,
            Enabled = config?.Enabled ?? false,
            Version = Plugin.Instance?.AssetVersion ?? "0.0.0",
            StylesheetAvailable = AssetStore.Stylesheet() is not null,
            ScriptAvailable = AssetStore.Script() is not null,
        };
    }

    /// <summary>
    /// Re-applies the configuration to the web client.
    /// </summary>
    /// <param name="injection">The injection service.</param>
    /// <response code="200">Re-applied; the response carries the new status.</response>
    /// <returns>The status after re-applying.</returns>
    [HttpPost("Reapply")]
    [Authorize(Policy = "RequiresElevation")]
    [Produces(MediaTypeNames.Application.Json)]
    public ActionResult<InjectionStatusResponse> Reapply(
        [FromServices] ThemeInjectionService injection)
    {
        ArgumentNullException.ThrowIfNull(injection);
        injection.Apply();
        return Status();
    }

    /// <summary>
    /// Whether the client already holds this exact content.
    /// </summary>
    private bool IsFresh(string etag)
    {
        var known = Request.Headers[HeaderNames.IfNoneMatch].ToString();
        return !string.IsNullOrEmpty(known)
            && known.Contains(etag, StringComparison.Ordinal);
    }

    private FileContentResult Send(byte[] bytes, string etag, string contentType, bool immutable)
    {
        Response.Headers[HeaderNames.ETag] = etag;
        Response.Headers[HeaderNames.CacheControl] = immutable
            // The injected URLs carry a version query, so a changed asset is a
            // changed URL and this can be cached hard.
            ? "public, max-age=604800, immutable"
            // Generated from configuration: revalidate, and let the ETag turn
            // the usual case into a 304.
            : "public, no-cache";

        return File(bytes, contentType);
    }
}

/// <summary>
/// The plugin's view of whether the web client is themed.
/// </summary>
public class InjectionStatusResponse
{
    /// <summary>Gets or sets the status name.</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>Gets or sets a sentence an administrator can act on.</summary>
    public string Detail { get; set; } = string.Empty;

    /// <summary>Gets or sets the index.html that was targeted.</summary>
    public string? IndexPath { get; set; }

    /// <summary>Gets or sets a value indicating whether the plugin is enabled.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the plugin version.</summary>
    public string Version { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether the stylesheet is embedded.</summary>
    public bool StylesheetAvailable { get; set; }

    /// <summary>Gets or sets a value indicating whether the script is embedded.</summary>
    public bool ScriptAvailable { get; set; }
}
