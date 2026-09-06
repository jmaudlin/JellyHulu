# Compatibility

## Jellyfin versions

| Version | Status | Notes |
| --- | --- | --- |
| 10.11.x | Supported | React/MUI dashboard pages are themed via `.Mui*` selectors |
| 10.10.x | Supported | The primary target |
| 10.9.x | Mostly works | Lyrics and trickplay exist; some dashboard pages are pre-React and fall back to the `.emby-*` rules, which are also covered |
| 10.8 and older | Untested | The card and rail markup differs enough that rails may look wrong |

Both supported versions are covered at once by pairing selectors — Jellyfin's
own `.emby-*` classes alongside the MUI classes that replaced some of them —
rather than by shipping two stylesheets. When a class exists on only one
version, the rule for it is simply inert on the other.

## Clients

The theme is server-side CSS, so it reaches anything that renders
jellyfin-web:

| Client | Themed? |
| --- | --- |
| Any desktop or mobile **browser** | Yes |
| **Jellyfin Media Player** (desktop) | Yes |
| **Jellyfin Web** on a TV browser | Yes, with TV mode |
| **Jellyfin for Android TV** (webOS/Tizen builds using the web UI) | Yes |
| **Jellyfin for Android / iOS** (native) | No — native UI, ignores server CSS |
| **Findroid**, **Swiftfin**, **Infuse** and other third-party clients | No |
| **Roku**, **Kodi** | No |

That split isn't specific to this theme: no Jellyfin CSS theme can reach a
native client.

The companion script needs `index.html` to load it, so it applies wherever
that file is served — browsers and Jellyfin Media Player. It never runs in a
native client.

## Browsers

| Browser | Minimum | Notes |
| --- | --- | --- |
| Chrome / Edge | 105 | |
| Firefox | 121 | `:has()` landed here; 110–120 works but tabbed library pages need the companion script, or a manual `--jh-header-height` bump |
| Safari | 15.4 | |
| Samsung Internet | 21 | Common on Tizen TVs |
| WebOS / Tizen built-in | 2021 models and newer | Older sets fall back gracefully |

Where a modern feature isn't available the theme degrades rather than breaks:

- **`:has()`** picks grid column widths from the card shape, and adds the tab
  row to a library page's top padding. Without it, grids use the portrait
  width for every shape, and tabbed pages need the companion script — which
  measures the header directly and is exact — or a hand-set
  `--jh-header-height`.
- **`content-visibility`** is the large-library optimisation. Without it,
  everything renders normally, just with more work on very long grids.
- **`backdrop-filter`** makes the header glass. Without it, the fallback is a
  solid near-black bar.
- **`-webkit-text-stroke`** draws the rank numerals. Without it they render as
  filled white numerals, which still reads correctly.

## The JellyHulu plugin

| Jellyfin | Status |
| --- | --- |
| 10.11.x | Supported — .NET 9 loads the net8.0 assembly |
| 10.10.x | Supported — the build target |
| 10.9.x and older | Not supported; `IPluginServiceRegistrator` and the hosted-service lifecycle differ |

It needs Jellyfin to be able to write to its own web client directory, which
is the default in Docker but **not** on a Debian/Ubuntu package install. See
[PLUGIN.md](PLUGIN.md).

## Plugins

Known-good with:

- **Intro Skipper** — the skip button is themed (`.skipIntro`, `.skip-button`).
- **Trickplay** (built in since 10.9) — powers the scrub bubble *and* the
  hover-preview fallback.
- **Playback Reporting**, **Merge Versions**, **Fanart**, and other plugins
  with configuration pages — themed generically through the plugin-page rules,
  since third-party markup can't be enumerated in advance.

A plugin that ships its own stylesheet may override parts of this one. If a
plugin page looks wrong, that's usually why —
[docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) has the fix.

## What this theme deliberately does not do

- **Change any behaviour you didn't ask for.** The companion adds UI; it never
  intercepts playback, alters requests, or changes what Jellyfin does.
- **Phone home.** No analytics, no external requests. The default stylesheet
  embeds its font so it works with no internet access at all.
- **Touch the server.** Nothing here writes to the Jellyfin database beyond
  the Custom CSS field you edit yourself.
