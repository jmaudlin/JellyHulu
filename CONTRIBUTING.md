# Contributing

## Getting set up

```bash
git clone https://github.com/jmaudlin/JellyHulu.git
cd JellyHulu
npm install            # optional: esbuild for minification, playwright for tests
npm run check          # build + verify
node test/smoke.mjs    # browser smoke test
```

You don't need a Jellyfin server to work on most of this — `test/fixture.html`
is a cut-down copy of the DOM Jellyfin renders, and you can open it directly
in a browser after a build.

For anything selector-related you *do* want a real instance, because the
whole job is matching classes Jellyfin actually emits.

## House rules

**Use tokens.** If a rule needs a colour, radius, duration or z-index, take it
from `00-tokens.css`. If the value you need isn't there, add it there. The
build fails on a `var(--jh-*)` that resolves to nothing, which catches half of
this automatically.

**`!important` needs a reason.** It's warranted where a Jellyfin or MUI style
sets the same property at equal-or-higher specificity, and nowhere else.
Custom CSS is appended last, so source order usually wins on its own.

**Don't reflow on hover.** Hover states are `transform`, `opacity` and colour.
Anything that changes layout gets multiplied by the number of cards on screen.

**Guard everything in the companion.** Wrap entry points in `safe()`. Assume
`window.ApiClient` may not exist, may lack a method, and may change shape
between Jellyfin releases. A broken feature must never break the app.

**No external requests.** The default build embeds its font precisely so the
theme works on an air-gapped server. Don't add a CDN dependency.

## Adding a selector

1. Inspect the element in a real Jellyfin instance and note the classes.
2. Add the rule to the module that owns that surface (see
   [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the map).
3. If it's version-specific, pair it with the equivalent from the other
   version rather than branching the stylesheet — a rule for a class that
   doesn't exist is simply inert.
4. `npm run check && node test/smoke.mjs`.

## Adding to the companion

New behaviour goes in its own `src/js/NN-name.js` module with a `start()`
method, registered in the list in `99-boot.js`. Subscribe to page changes with
`Pages.on()` rather than adding another observer.

If it adds UI, style it in `src/css/22-settings-panel.css` or a new module —
never with inline styles, so it stays themeable.

## Tests

`test/smoke.mjs` is a plain script, not a framework. Add a `check(name,
boolean)` line near the related ones. Every layout bug fixed should leave a
regression check behind; the three at the end of the card section exist
because those bugs actually shipped into a build.

## Reporting a selector break

Jellyfin renames classes from time to time. The most useful report includes:

- Jellyfin version, browser and version
- The page, and what looks wrong
- The class the element actually has now, from devtools

That's usually enough for a one-line fix.

## Commits and PRs

Keep commits scoped to one concern. Run `npm run check` and the smoke test
before opening a PR, and rebuild `dist/` if you touched `src/` — `dist/` is
committed so a clone is installable without a build step, and CI verifies it
matches the sources.
