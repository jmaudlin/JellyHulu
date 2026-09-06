using Jellyfin.Plugin.JellyHulu.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Jellyfin.Plugin.JellyHulu;

/// <summary>
/// Registers the plugin's services with the host.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // Registered as both, so the API controller can reach the same
        // instance the host drives through IHostedService.
        serviceCollection.AddSingleton<ThemeInjectionService>();
        serviceCollection.AddSingleton<IHostedService>(
            provider => provider.GetRequiredService<ThemeInjectionService>());
    }
}
