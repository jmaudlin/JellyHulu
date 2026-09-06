using System.Globalization;
using Jellyfin.Plugin.JellyHulu.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.JellyHulu;

/// <summary>
/// The JellyHulu plugin: serves the theme's assets from the server and keeps
/// the web client's index.html pointing at them.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Server paths.</param>
    /// <param name="xmlSerializer">Configuration serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <summary>
    /// Gets the current plugin instance.
    /// </summary>
    /// <remarks>
    /// Jellyfin constructs plugins itself rather than through the service
    /// container, so this static is the supported way for the controller and
    /// the hosted service to reach the configuration.
    /// </remarks>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "JellyHulu";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("a5af0330-baf3-4ba3-9e2b-097e98f13273");

    /// <inheritdoc />
    public override string Description =>
        "A Hulu-inspired theme for the Jellyfin web client. Serves the stylesheet, "
        + "the companion script and its fonts from the server, and keeps the web "
        + "client pointing at them across upgrades.";

    /// <summary>
    /// Gets the plugin version as a cache-busting string.
    /// </summary>
    public string AssetVersion =>
        Version?.ToString(3) ?? "0.0.0";

    /// <summary>
    /// Gets a token that changes whenever the configuration changes, so a
    /// browser holding a cached stylesheet picks up an admin's edits.
    /// </summary>
    public string ConfigurationToken
    {
        get
        {
            var config = Configuration;
            var hash = HashCode.Combine(
                config.DefaultAccent,
                config.DefaultDensity,
                config.DefaultMotion,
                config.DefaultHero,
                config.DefaultPreviews,
                config.DefaultBadges,
                config.HeroDwellSeconds,
                config.CustomCss);

            return hash.ToString("x8", CultureInfo.InvariantCulture);
        }
    }

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        yield return new PluginPageInfo
        {
            Name = Name,
            EmbeddedResourcePath = GetType().Namespace + ".Configuration.configPage.html",
        };
    }
}
