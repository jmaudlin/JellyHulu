# Troubleshooting

## The theme doesn't apply at all

**Hard-reload first.** <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> +
<kbd>R</kbd>. Browsers cache `@import`ed stylesheets aggressively, and this is
the cause more often than anything else.

**Check the import resolved.** In the browser console:

```js
getComputedStyle(document.documentElement).getPropertyValue('--jh-accent')
// " #1CE783" if the stylesheet loaded, "" if it didn't
```

If it's empty, open the Network tab and reload. A 404 on
`jellyhulu.min.css` means the path is wrong — the file has to be reachable
from the browser, not just present on the server. With the install script the
URL is `/web/jellyhulu/jellyhulu.min.css`; behind a reverse proxy with a
subpath, prefix it accordingly.

**Check you edited the right box.** It's **Dashboard → General → Custom CSS**
(server-wide). Some Jellyfin builds also show a *Display* → custom CSS field
per user; the import works in either, but if you put it in one and are looking
for it in the other, that explains it.

**Check for a syntax error above your import.** A malformed rule earlier in
the Custom CSS box can swallow everything after it. `@import` must also be the
first thing in the stylesheet — CSS ignores an `@import` that appears after
any rule. If you have your own overrides, they go *after* the import.

## Using the plugin?

Start at the plugin's own configuration page — **Dashboard → Plugins →
JellyHulu** — which reports whether the web client is actually themed and why
not. [PLUGIN.md](PLUGIN.md) covers the plugin-specific cases; the rest of this
page applies whichever way the theme was installed.

## The theme applies but the companion doesn't

Symptom: correct colours and type, but no hero, no rank badges, no `tune`
button in the header.

```js
JellyHulu   // undefined means the script didn't load
```

- **404 on `jellyhulu.js`?** Same path problem as above.
- **Tag missing from `index.html`?**
  `grep -n JellyHulu /usr/share/jellyfin/web/index.html`. If it's gone, a
  Jellyfin upgrade replaced the web root — re-run the install script, or move
  to one of the persistent methods in [INSTALL.md](INSTALL.md).
- **Content-Security-Policy blocking it?** The console will say so explicitly.
  If your reverse proxy adds a CSP header, the script's origin must be allowed
  by `script-src`.
- **`sub_filter` not firing?** nginx can't rewrite a compressed body. Make
  sure `proxy_set_header Accept-Encoding "";` is present in that location.

## No hero on the home page

The hero is built from your own watch data, and needs all of:

- The companion loaded (`JellyHulu.version` returns a version).
- You're signed in — it can't build one on the login screen.
- **At least one item with a backdrop image.** Slides without a backdrop are
  skipped deliberately, because a hero with no artwork is a grey box. A brand
  new library with no fanart downloaded yet will have no hero.
- The hero isn't switched off, in the settings panel or by
  `--jh-hero-display: none`.

Run with `?jhdebug` in the URL to see what it fetched.

## Hover previews don't play

They follow a ladder, and each rung has a requirement:

1. **A local trailer.** Requires a trailer file alongside the media *and* a
   browser-playable container. An MKV trailer won't direct-play in most
   browsers — the theme detects the failure and drops to the next rung.
2. **Trickplay tiles.** Requires trickplay images to have been generated:
   **Dashboard → Scheduled Tasks → Generate Trickplay Images**. On a large
   library this takes a while the first time.
3. **Nothing.** The card keeps its still image and its hover-expand.

Previews are also suppressed on purpose when:

- The setting is off, or Animation is set to Off.
- Low-power mode is engaged (2 or fewer cores, ≤2 GB RAM, save-data, or a TV).
- The OS asks for reduced motion or reduced data.
- You're on a touch device, or on a TV without explicitly enabling them.

## Cards look clipped at the edge of a rail

The expanded card is bigger than the tile, and rails are horizontal scroll
containers — CSS doesn't allow vertical overflow to escape one. The theme
handles this by padding the scroller and by tagging the first and last visible
cards so they scale inward instead of outward.

If you've raised `--jh-card-scale` well past the default, the padding may no
longer be enough. Either lower it, or raise the room:

```css
.emby-scroller { padding-block: 3rem; }
```

## A plugin's configuration page looks wrong

Third-party plugin pages ship their own markup and sometimes their own CSS,
which can win over the theme's generic rules. Scope a fix to that page:

```css
/* Added after the @import */
#myPluginConfigPage .someClass {
  background: var(--jh-surface) !important;
  color: var(--jh-text) !important;
}
```

The theme's tokens are available on any page, so you can restyle a stray
element without picking colours by hand.

## Something broke after a Jellyfin upgrade

Jellyfin occasionally renames or restructures classes. Two things to check:

1. **The companion tag is gone** — the upgrade replaced the web root. Re-run
   the install script.
2. **A specific area looks unstyled** — a selector moved. Open devtools,
   inspect the element, and note the class it actually has now. Please
   [open an issue](https://github.com/jmaudlin/JellyHulu/issues) with the
   Jellyfin version, the page, and that class name; that's exactly what's
   needed to fix it.

## Performance feels sluggish on a big library

Try, in order:

1. **Settings → Effects → Low.** Drops blur, heavy shadows and previews.
2. **Settings → Card density → Compact.** Fewer pixels per card.
3. **Settings → Animation → Subtle** or **Off**.
4. **Turn off hover previews.**

If it's still slow, it may not be the theme: test with the Custom CSS box
emptied. Jellyfin's own grid rendering on a very large library has its own
cost, and comparing the two tells you which one you're looking at.

## The scrub bar or a button shows a word instead of an icon

Jellyfin's icons are a Material Icons ligature font. If it hasn't loaded —
offline, blocked, or still fetching — buttons render the literal word. That's
a Jellyfin asset-loading problem, not a theme problem; the theme clips those
buttons so the overflowing text can't swallow clicks in the meantime.

## Getting a useful bug report together

```js
// In the browser console, on the page that looks wrong:
JellyHulu.version
JellyHulu.settings.all()
document.documentElement.className
document.documentElement.dataset
```

Plus your Jellyfin version, browser and version, and a screenshot with the
element inspected. With those, most selector problems are a one-line fix.
