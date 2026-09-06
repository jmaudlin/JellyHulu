using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Plugins;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyHulu.Services;

/// <summary>
/// Keeps jellyfin-web's index.html in step with the plugin's configuration.
/// </summary>
/// <remarks>
/// Injecting on start and removing on stop is what makes this survive a
/// Jellyfin upgrade: an upgrade replaces the web client directory, and the
/// next start puts the tags back. It also means uninstalling the plugin
/// leaves index.html clean, because the last shutdown removes them.
/// </remarks>
public sealed partial class ThemeInjectionService : IHostedService, IDisposable
{
    private readonly IApplicationPaths _applicationPaths;
    private readonly ILogger<ThemeInjectionService> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private bool _subscribed;

    /// <summary>
    /// Initializes a new instance of the <see cref="ThemeInjectionService"/> class.
    /// </summary>
    /// <param name="applicationPaths">Server paths, for the web client directory.</param>
    /// <param name="logger">Logger.</param>
    public ThemeInjectionService(
        IApplicationPaths applicationPaths,
        ILogger<ThemeInjectionService> logger)
    {
        _applicationPaths = applicationPaths;
        _logger = logger;
    }

    /// <summary>
    /// Gets the outcome of the most recent attempt, for the configuration page.
    /// </summary>
    public static InjectionResult LastResult { get; private set; } =
        new(InjectionStatus.Removed, "Not applied yet.", null);

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        var plugin = Plugin.Instance;
        if (plugin is not null && !_subscribed)
        {
            plugin.ConfigurationChanged += OnConfigurationChanged;
            _subscribed = true;
        }

        Apply();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken)
    {
        var plugin = Plugin.Instance;
        if (plugin is not null && _subscribed)
        {
            plugin.ConfigurationChanged -= OnConfigurationChanged;
            _subscribed = false;
        }

        // Leave the web client as we found it. If the plugin is being
        // uninstalled, this is the only chance to clean up.
        Remove();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Applies the current configuration to index.html.
    /// </summary>
    public void Apply()
    {
        var plugin = Plugin.Instance;
        if (plugin is null)
        {
            return;
        }

        var config = plugin.Configuration;
        var wanted = config.Enabled && (config.InjectStylesheet || config.InjectScript);

        var block = wanted
            ? WebIndexInjector.BuildBlock(
                config.InjectStylesheet,
                config.InjectScript,
                plugin.AssetVersion,
                plugin.ConfigurationToken)
            : null;

        Run(block);
    }

    /// <summary>
    /// Removes the injected block from index.html.
    /// </summary>
    public void Remove() => Run(null);

    /// <inheritdoc />
    public void Dispose() => _lock.Dispose();

    private void Run(string? block)
    {
        _lock.Wait();
        try
        {
            var result = WebIndexInjector.Apply(_applicationPaths.WebPath, block);
            LastResult = result;

            switch (result.Status)
            {
                case InjectionStatus.Injected:
                    LogThemed(result.IndexPath, result.Detail);
                    break;

                case InjectionStatus.Removed:
                    LogUnthemed(result.Detail);
                    break;

                case InjectionStatus.NotWritable:
                    // The single most common failure, and entirely fixable —
                    // so it gets a warning carrying the remedy rather than a
                    // bare exception.
                    LogNotWritable(result.Detail);
                    break;

                default:
                    LogFailed(result.Status, result.Detail);
                    break;
            }
        }
        finally
        {
            _lock.Release();
        }
    }

    private void OnConfigurationChanged(object? sender, BasePluginConfiguration e) => Apply();

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "JellyHulu: the web client is themed ({Path}). {Detail}")]
    private partial void LogThemed(string? path, string detail);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Information,
        Message = "JellyHulu: the web client was left unthemed. {Detail}")]
    private partial void LogUnthemed(string detail);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Warning,
        Message = "JellyHulu: cannot write to the web client. {Detail}")]
    private partial void LogNotWritable(string detail);

    [LoggerMessage(
        EventId = 4,
        Level = LogLevel.Warning,
        Message = "JellyHulu: could not update the web client ({Status}). {Detail}")]
    private partial void LogFailed(InjectionStatus status, string detail);
}
