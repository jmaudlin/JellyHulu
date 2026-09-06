# Architecture

## Layout

```
src/css/          23 modules, concatenated in filename order
src/js/            7 modules, concatenated into one IIFE
fonts/            Figtree (variable, OFL) + licence
build.mjs         concatenate, generate @font-face, minify, verify
dist/             built output — committed, so a clone is ready to install
scripts/          install/uninstall the companion into jellyfin-web
plugin/           the Jellyfin server plugin (C#) and its tests
test/             a mock Jellyfin DOM plus a browser-driven smoke test
docs/             this and its neighbours
manifest.json     the plugin repository manifest, regenerated per release
```

The plugin is a distribution mechanism, not a second implementation: it
embeds the same `dist/` bundles the manual install uses, so there is exactly
one theme and one companion script. `docs/PLUGIN.md` covers its internals.

## The CSS cascade, on purpose

Jellyfin appends Custom CSS *last*, so most rules here win on source order
alone. `!important` appears only where a built-in theme sets the same property
at equal-or-higher specificity — mostly `.emby-*` component styles and MUI's
generated classes. It is not a blanket policy.

The modules are numbered so the cascade is a design decision rather than an
accident:

| | Module | Why it's here |
| --- | --- | --- |
| 00 | tokens | Everything downstream reads from this. Nothing else hard-codes a colour, radius, duration or z-index. |
| — | *fonts* | Injected by the build between tokens and typography |
| 01 | typography | Applies the type system |
| 02 | base | Ground, scrollbars, focus, selection |
| 03 | layout | Page rhythm, sections, gutters |
| 04 | navigation | Header, tabs, drawer |
| 05 | hero | The carousel |
| 06 | buttons | One button system for `.emby-*`, MUI and `.jh-*` |
| 07 | cards | The core interaction |
| 08–09 | rails, grids | The two ways cards are arranged |
| 10–11 | detail, player | The two deep views |
| 12 | forms | Inputs, dialogs, menus, toasts |
| 13–18 | search, livetv, music, features, login, dashboard | Per-surface work |
| 19–20 | tv, responsive | Contextual overrides — must come after the surfaces |
| 21 | a11y | Preference media queries and perf guards — must win over everything |
| 22 | settings panel | The companion's own UI |

## How settings flow

```
localStorage ──▶ Settings.all() ──▶ Settings.apply()
                                        │
                                        ├─▶ <html data-jh-density="cinematic">
                                        ├─▶ <html data-jh-motion="subtle">
                                        └─▶ <html style="--jh-accent: #00E0FF">
                                                       │
                                        CSS reads them and does all the work
```

The script never styles a component directly. It sets attributes and custom
properties on `<html>`; the stylesheet reacts. That's what makes the CSS a
complete theme on its own, and what keeps a settings change instant — no
re-render, no re-layout of anything the browser didn't already need to touch.

## How the companion talks to Jellyfin

Four integration points, all guarded:

- **`window.ApiClient`** for data, through a small `Api` wrapper so there's
  one place to adapt when the client changes shape between releases.
- **The `viewshow` event**, Jellyfin's own page-shown signal, with
  `hashchange` and a debounced `MutationObserver` as fallbacks. Modules
  subscribe to `Pages.on()` rather than each wiring up their own observers.
- **`window.playbackManager`** when it's exposed. It isn't a stable global, so
  the Play button falls back to navigating to the item and pressing the page's
  own play button once it renders.
- **The DOM**, read-only except for elements the theme itself adds.

Every entry point is wrapped in `safe()`: a throw is logged and swallowed
rather than escaping into Jellyfin's event handlers, so a failure in one
feature can't take down the others or the app.

## The hover-expand decision

Netflix-style themes usually expand a card into a panel that pushes its
siblings aside. That reflows the entire rail on every hover, and on a long
grid it's the dominant cost.

Here the card scales in place with `transform` and the overlay fades in
*inside* it. Nothing below moves, nothing re-layouts, and the whole
interaction stays on the compositor.

The trade-off is clipping: rails are `overflow-x: auto`, and CSS forbids
`overflow-y: visible` on a scroll container, so a scaled card would be cut off
top and bottom. Two things handle that — the scroller carries vertical padding
sized from `--jh-card-scale`, and the companion tags the first and last
visible cards `.jh-edge-start` / `.jh-edge-end` so they scale inward. Without
the companion, cards simply scale from the centre and the padding still
covers them.

## The preview ladder

1. **Local trailer**, direct-played. Best fidelity; needs a trailer file in a
   browser-playable container. A decode failure drops to rung 2 automatically.
2. **Trickplay tiles**, animated as a flipbook. Jellyfin already generates
   these for scrub previews, so this is one cached JPEG per sheet — no
   transcode, no per-second bandwidth, and it works for anything with
   trickplay data.
3. **Nothing.** The still stays.

Resolution costs one API call per item, cached for the session.

## Performance techniques, and why each one is there

| Technique | Where | What it buys |
| --- | --- | --- |
| `content-visibility: auto` | grid cards, off-screen rails | Skips layout and paint for what you can't see |
| `contain-intrinsic-size` | alongside the above | A placeholder height, so the scrollbar doesn't jump |
| `contain: layout style` | sections, cards, hero | One card animating doesn't re-layout its neighbours |
| `will-change` on hover only | `.cardScalable` | A layer when it helps; no layer when it would only cost memory |
| `.jh-scrolling` guard | `<html>` during scroll | A fast flick doesn't start an animation on every card it passes |
| `IntersectionObserver` enhancement | companion | Cards are enhanced as they approach the viewport, not all at once |
| rAF-throttled scroll handlers | companion | Layout reads happen once per frame, batched before any write |
| Auto low-power mode | companion | Weak devices lose blur, shadows and previews before they stutter |

## The build

`node build.mjs`:

1. Reads `src/css/*.css` in order; `00-tokens` first, then the generated
   `@font-face` layer, then the rest.
2. Emits two stylesheets — fonts embedded as data URIs (self-contained), and
   fonts linked from a configurable path (`JH_FONT_BASE`).
3. Wraps `src/js/*.js` in one IIFE and substitutes the version.
4. Minifies with esbuild when it's installed; without it, the unminified
   bundles still build, so a fresh clone works with no `npm install`.
5. Verifies: braces balance, every `var(--jh-*)` resolves to a real
   declaration (comments stripped first, so a property named in a doc comment
   doesn't count as one), the version placeholder is gone, and the JS parses.

`node build.mjs --check` turns any of those into a non-zero exit.

## The test

`test/fixture.html` is a cut-down copy of the DOM jellyfin-web renders, plus a
stub `ApiClient` exposing exactly the surface the companion uses.
`test/smoke.mjs` drives it in headless Chromium and asserts 40 things:
boot without console errors, tokens resolving, the hero building from the
stubbed API, badges landing on the right rails, hover scaling and preview
mount/teardown, the settings panel round-tripping through `localStorage`, and
a set of regression checks for layout bugs that have actually happened —
numerals clipped by the card frame, rail buttons anchored to the viewport,
and rail chrome covering a card's hit area.

## The three build variants of the stylesheet

The same modules produce three files, differing only in how the font is
reached:

| File | `@font-face src` | For |
| --- | --- | --- |
| `jellyhulu.css` | `data:` URIs | Pasting into Custom CSS, or self-hosting one file. Self-contained, no external requests. |
| `jellyhulu-linked-fonts.css` | `/web/jellyhulu/fonts/…` | A manual install that copies the fonts into the web root |
| `jellyhulu-plugin.css` | `fonts/…` — relative | The plugin, which serves the stylesheet at `<base>/JellyHulu/jellyhulu.css`. A relative `url()` resolves against the stylesheet's own address, so it is correct under any base path. |

## Adding a surface

1. Find the classes in devtools on a real Jellyfin instance.
2. Add rules to the module that owns that surface, or add a numbered module.
3. Use tokens. If you need a value that isn't one, add it to `00-tokens.css`
   rather than hard-coding it — the sanity check enforces the first half of
   that and code review has to catch the second.
4. `npm run check`, then `node test/smoke.mjs`.
