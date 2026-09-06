using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.JellyHulu.Configuration;

/// <summary>
/// Settings for the JellyHulu plugin.
/// </summary>
/// <remarks>
/// Two groups: what the plugin injects into the web client, and the
/// server-wide defaults handed to the companion script. The defaults are
/// only defaults — a user's own choices in the theme's settings panel still
/// win, which is the point of having both.
/// </remarks>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets a value indicating whether the theme is injected at all.
    /// Turning this off is the quickest way to check whether a problem is
    /// the theme's, without uninstalling anything.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the stylesheet is injected.
    /// Leave this off if you would rather manage the theme through
    /// Dashboard → General → Custom CSS.
    /// </summary>
    public bool InjectStylesheet { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the companion script is
    /// injected. Without it the stylesheet is still a complete theme; you
    /// lose the hero carousel, hover previews, badges and the settings panel.
    /// </summary>
    public bool InjectScript { get; set; } = true;

    /// <summary>
    /// Gets or sets the default accent colour, as a hex string.
    /// </summary>
    public string DefaultAccent { get; set; } = "#1CE783";

    /// <summary>
    /// Gets or sets the default card density: compact, comfortable or cinematic.
    /// </summary>
    public string DefaultDensity { get; set; } = "comfortable";

    /// <summary>
    /// Gets or sets the default motion level: full, subtle or off.
    /// </summary>
    public string DefaultMotion { get; set; } = "full";

    /// <summary>
    /// Gets or sets a value indicating whether the hero carousel is on by default.
    /// </summary>
    public bool DefaultHero { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether hover previews are on by default.
    /// </summary>
    public bool DefaultPreviews { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether rank and "new" badges are on by default.
    /// </summary>
    public bool DefaultBadges { get; set; } = true;

    /// <summary>
    /// Gets or sets how long, in seconds, the hero holds each slide.
    /// </summary>
    public int HeroDwellSeconds { get; set; } = 9;

    /// <summary>
    /// Gets or sets extra CSS appended after the theme.
    /// This is the right place for token overrides — it is served with the
    /// theme, so it cannot end up out of order the way a Custom CSS entry
    /// placed above an @import can.
    /// </summary>
    public string CustomCss { get; set; } = string.Empty;
}
