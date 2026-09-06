# Changelog

All notable changes are recorded here. This project follows
[Semantic Versioning](https://semver.org/): the major version changes when a
custom property is removed or renamed, since that's what a customised install
depends on.

## [Unreleased]

### Fixed

- **The navigation drawer could not be scrolled.** The rail styling matched
  bare `.emby-scroller` and `.scrollSlider`, but `emby-scroller` is not a rail
  component — Jellyfin uses it for vertical containers too, the drawer among
  them. `display: flex` therefore laid the drawer's items out in a row, so it
  overflowed sideways and had nothing to scroll vertically. On a server with
  more libraries than fit on screen, that made the lower entries unreachable.
  Rail rules are now scoped to scrollers actually marked horizontal
  (`.scrollX` or `data-horizontal="true"`), the drawer's own scrolling is
  asserted outright, and scrollbar hiding no longer applies to vertical
  scrollers — a drawer with no scrollbar gives no hint that it scrolls at all.

- **The plugin repository URL no longer depends on GitHub release ordering.**
  It was `releases/latest/download/manifest.json`, which GitHub resolves by
  publish time across *all* releases rather than by relevance. Publishing the
  `1.0.1.0` theme release twelve minutes after `plugin-v1.0.1.0` moved
  `latest` onto a release with no manifest attached, and the documented
  install URL started returning 404 for everyone — with nothing in the
  repository having changed. It now points at `manifest.json` on `main`, which
  the release workflow commits in the same run that builds the archive it
  describes, so the checksums match and release ordering cannot affect it.
- The jsDelivr stylesheet pin in `docs/INSTALL.md` referenced tag `1.0.0`,
  which predates the 1.0.1 fixes — anyone following the CDN route was served
  the buggy build, and a failed `@import` fails silently. Now pinned to
  `1.0.1.0`.

### Added

- `scripts/check-install-urls.sh`, which fetches the documented install URLs,
  downloads the archive the manifest points at, and verifies the checksum
  Jellyfin verifies. The failure above was invisible to the test suite because
  nothing in the repository was wrong; this checks the thing that was.

## [1.0.1] — 2026-09-06

Published as plugin **1.0.1.0**. Both of these were found running the theme
against a real Jellyfin server, and neither could have been caught by the test
suite as it stood — the fixture carried markup I had assumed rather than
markup Jellyfin emits.

### Fixed

- **Duplicated hero carousel, with only the topmost one animating.**
  `Hero.build` is async, and its "do we already have a hero?" check ran only
  before the await on the API call. One navigation fires the page lifecycle
  several times — `viewshow`, `hashchange` and the mutation observer all land
  for a single move — so several builds passed the check inside that window
  and each inserted its own hero. Every build overwrote the module's
  node/slides/timer, so only the last was ever ticked and the rest sat frozen.
  Now guarded by a flag set synchronously before any await, plus a re-check of
  route, anchor and existing hero afterwards. Teardown removes every
  `.jh-hero` rather than only the tracked one, so a page already in the broken
  state repairs itself on the next navigation.
- **The same race in hover previews.** `startPreview` awaits a lookup, and its
  post-await guard only checked that the pointer was still on the same card —
  also true if you left and came back while it waited. Mounting is now
  idempotent, so a second mount cannot orphan the first playing invisibly.
- **Library section headings invisible until hover.** Jellyfin nests a library
  section's heading inside the link that carries its chevron, and the theme
  styled that link as a hover-revealed "see all" control at `opacity: 0` —
  hiding the heading itself. Sections with a bare `<h2>` (Continue Watching,
  Next Up) were unaffected, which is why only library sections looked broken.
  The heading is never hidden or restyled now; only the chevron animates.

### Testing

- Browser suite 58 → 63 checks. Every new check was verified to fail against
  the pre-fix code before being accepted — a regression test that passes on
  the broken version is worse than none.
- The fixture now mirrors Jellyfin's real library-section header, and can slow
  its stub API on demand so the hero race is reproducible rather than a matter
  of timing luck. With a 400 ms delay, the old code produced five heroes.

## [Plugin 1.0.0.0] — 2026-09-06

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
