# Changelog

All notable changes are recorded here. This project follows
[Semantic Versioning](https://semver.org/): the major version changes when a
custom property is removed or renamed, since that's what a customised install
depends on.

## [Unreleased]

### Jellyfin plugin

- New `plugin/` project: a Jellyfin server plugin that serves the stylesheet,
  the companion script and the fonts from the server itself, and keeps
  `jellyfin-web/index.html` pointing at them.
- Survives Jellyfin upgrades. An upgrade replaces the web client directory,
  which undoes a manual `index.html` edit; the plugin re-applies on the next
  start, and removes its tags again on a clean shutdown.
- Configuration page: enable/disable, whether to serve the stylesheet and the
  script, server-wide defaults for accent, density, motion, the carousel,
  previews, badges and dwell time, and a Custom CSS box appended after the
  theme.
- Server defaults reach the browser as `window.JELLYHULU_DEFAULTS` and sit
  between the built-in defaults and each user's own stored choices, so an
  administrator can set the house style without taking the setting away.
  "Reset" now returns to the server's defaults rather than the built-in ones.
- Assets are embedded in the assembly and served with strong ETags — nothing
  is written to disk, so there is nothing to go stale and nothing to clean up.
- Injected tags use relative URLs, so the theme works under a reverse-proxy
  subpath.
- `plugin/package.sh` builds, tests, packages and regenerates `manifest.json`
  with the checksum of the archive it just produced.
- 20 unit tests over the `index.html` rewriting, including a byte-identical
  round trip, idempotent re-application, insertion before the *last*
  `</body>`, recovery from an orphaned marker, and not writing when the file
  is already correct — which is what lets it behave on a read-only web root.

### Theme

- A third stylesheet variant, `dist/jellyhulu-plugin.css`, whose `@font-face`
  rules use a relative path so the plugin can serve it from any base URL.

## [1.0.0] — 2026-09-05

First release.

### Theme

- Hulu-inspired dark theme: `#0B0C0F` ground, `#1CE783` accent, Figtree type,
  square-ish tiles, dense rails, glass header.
- 23 CSS modules built from a single token layer — every colour, radius,
  duration and z-index is a custom property an admin can override.
- Full surface coverage: home, libraries, grids, detail, person, search,
  login, user select, server select, Quick Connect, the setup wizard, the
  video OSD, Live TV and the EPG, DVR and timers, music and the now-playing
  bar, lyrics, SyncPlay, collections, playlists, books, photos, the metadata
  image and subtitle editors, the admin dashboard (legacy and React/MUI), and
  third-party plugin pages.
- 10-foot TV mode with overscan-safe padding, larger type, and focus states
  that promote every hover-only affordance.
- Responsive from a 420 px phone to a 2200 px ultrawide, plus a print
  stylesheet.
- Honours `prefers-reduced-motion`, `prefers-contrast`,
  `prefers-reduced-data`, `prefers-reduced-transparency` and `forced-colors`.

### Companion script

- Hero carousel built from Continue Watching → Next Up → Recently Added, with
  resume state, pause-on-hover/focus/hidden-tab, keyboard control, and dots
  that fill over the dwell time.
- Hover previews with a three-rung fallback: local trailer → animated
  trickplay tiles → still image.
- In-card metadata and action overlay, reusing text Jellyfin already rendered
  so it costs no extra requests.
- Rank numerals on Top 10 / trending rails and "New" flags on
  recently-added rails, both exposed to screen readers.
- Per-user settings panel in the header: accent, density, motion, previews,
  hero, badges, TV mode, effects, contrast.
- Automatic low-power mode on 2-core / ≤2 GB / save-data / TV clients.
- TV detection beyond Jellyfin's own, plus centre-on-focus scrolling for D-pad
  navigation.
- Skip link and a live region announcing route changes.
- `window.JellyHulu` for scripting.

### Tooling

- `build.mjs`: concatenates, generates the `@font-face` layer in embedded and
  linked flavours, minifies via esbuild when present, and verifies balanced
  braces, resolvable custom properties, version substitution and JS parsing.
- `scripts/install-jellyhulu.sh`: idempotent install/uninstall of the
  companion into `jellyfin-web`, with a backup and marker-delimited edit that
  round-trips to a byte-identical `index.html`.
- `test/smoke.mjs`: 40 assertions against a mock Jellyfin DOM in headless
  Chromium, including regressions for three layout bugs found during
  development.
