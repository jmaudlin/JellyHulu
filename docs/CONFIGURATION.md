# Configuring JellyHulu

Two layers, in this order:

1. **CSS custom properties** — set by the admin, apply server-wide, no
   JavaScript required.
2. **The settings panel** — set per user, stored in that browser's
   `localStorage`, and applied as `data-jh-*` attributes on `<html>` that
   override the tokens.

A user's choice always wins over the server default, which is the point.

---

## Layer 1 — admin defaults

Redeclare any token **after** the `@import` in Custom CSS:

```css
@import url('/web/jellyhulu/jellyhulu.min.css');

:root {
  --jh-accent: #FF4D8D;
  --jh-radius-card: 10px;
  --jh-card-w-portrait: 190px;
}
```

Order matters — a `:root` block before the import will be overridden by it.

### Brand

| Token | Default | What it does |
| --- | --- | --- |
| `--jh-accent` | `#1CE783` | The one colour that carries the brand. Buttons, focus, progress, active states. |
| `--jh-accent-hover` | `#62F0AC` | Hover state for accent surfaces |
| `--jh-accent-pressed` | `#17C46F` | Active/pressed |
| `--jh-accent-muted` | `rgba(28,231,131,.16)` | Selected-row and active-cell fills |
| `--jh-accent-faint` | `rgba(28,231,131,.08)` | Hover wash on ghost buttons |
| `--jh-on-accent` | `#0B0C0F` | Text drawn *on* the accent — change this too if you pick a dark accent |

### Surfaces

| Token | Default | Where it shows |
| --- | --- | --- |
| `--jh-bg` | `#0B0C0F` | The app ground |
| `--jh-bg-elevated` | `#101216` | Dialogs, the settings panel |
| `--jh-surface` | `#151719` | Cards, dashboard panels, list hover |
| `--jh-surface-hover` | `#1C1E21` | Inputs, raised hover |
| `--jh-glass-bg` | `rgba(11,12,15,.72)` | Header, now-playing bar, sticky bars |
| `--jh-glass-blur` | `18px` | Backdrop blur on those. Set `0px` to drop it everywhere at once. |

The full neutral ramp is `--jh-ink-1000` (deepest) through `--jh-ink-0`
(white). Re-mapping the semantic tokens onto different rungs is usually
easier than editing the ramp.

### Type

| Token | Default |
| --- | --- |
| `--jh-font` | `"Figtree", "Graphik", "Inter", -apple-system, …` |
| `--jh-font-mono` | `ui-monospace, "SF Mono", …` |
| `--jh-fs-md` | `0.875rem` — the body size everything else is relative to |
| `--jh-fs-hero` | `clamp(2.25rem, 1.1rem + 5.2vw, 5rem)` |
| `--jh-ls-tight` | `-0.02em` — headline tracking |

To drop the bundled font and use the system stack:

```css
:root {
  --jh-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
```

The embedded `@font-face` still ships in the file; if you want it gone from
the bytes as well, use `dist/jellyhulu-linked-fonts.min.css` and don't deploy
the font files.

### Layout & shape

| Token | Default | Notes |
| --- | --- | --- |
| `--jh-gutter` | `clamp(1rem, .4rem + 2.2vw, 3.5rem)` | Horizontal page inset |
| `--jh-rail-gap` | `clamp(.5rem, .25rem + .6vw, .875rem)` | Gap between cards in a rail |
| `--jh-section-gap` | `clamp(1.75rem, 1rem + 2vw, 3rem)` | Vertical rhythm between rails |
| `--jh-card-w-portrait` | `168px` | Poster width |
| `--jh-card-w-backdrop` | `300px` | 16:9 card width |
| `--jh-card-w-square` | `180px` | Album/square card width |
| `--jh-radius-card` | `4px` | Tile corners. `10px` for a softer, Disney+-ish look. |
| `--jh-header-height` | `62px` | |
| `--jh-hero-height` | `clamp(360px, 56vh, 720px)` | |

### Motion

| Token | Default |
| --- | --- |
| `--jh-card-scale` | `1.14` — how far a card grows on hover |
| `--jh-dur-base` | `240ms` |
| `--jh-ease-out` | `cubic-bezier(.22,.61,.36,1)` |
| `--jh-preview-delay` | `900ms` before a hover preview starts |
| `--jh-hero-dwell` | `9s` per hero slide |

### Feature switches

These are display values rather than booleans, so flipping one hides a whole
feature without a second stylesheet:

```css
:root {
  --jh-hero-display: none;      /* no hero, for everyone */
  --jh-preview-display: none;   /* no hover previews */
  --jh-badge-display: none;     /* no rank or "New" badges */
}
```

---

## Layer 2 — the settings panel

Click the **tune** icon in the header, or run `JellyHulu.open()` in the
console.

| Setting | Values | Default |
| --- | --- | --- |
| Accent | 7 swatches, or set `accent` to any hex | Hulu green |
| Card density | `compact` · `comfortable` · `cinematic` | comfortable |
| Featured carousel | on · off | on |
| Rank & new badges | on · off | on |
| Animation | `full` · `subtle` · `off` | full |
| Hover previews | on · off | on |
| TV mode | `auto` · `on` · `off` | auto |
| Effects | `auto` · `low` | auto |
| Contrast | `normal` · `high` | normal |

Picking a non-default accent recomputes the hover, pressed, muted and faint
variants from it, and flips `--jh-on-accent` between near-black and white
based on WCAG relative luminance — so a pale accent doesn't end up with
unreadable text on it.

### Scripting it

```js
JellyHulu.version                      // "1.0.0"
JellyHulu.settings.all()               // every current value
JellyHulu.settings.get('density')      // "comfortable"
JellyHulu.settings.set('density', 'cinematic')
JellyHulu.settings.set('accent', '#00E0FF')
JellyHulu.reset()                      // back to defaults
JellyHulu.open()                       // open the panel
```

Settings are stored per Jellyfin user under
`jellyhulu.settings.v1.<user-id>`, so profiles on the same browser don't
collide, and applied to `<html>` as `data-jh-*` attributes.

### Presets, without the panel

The same attributes work if you set them yourself — useful for a kiosk or a
dedicated TV browser where you want a fixed configuration:

```html
<html data-jh-density="cinematic" data-jh-tv="on" data-jh-previews="off">
```

Or from CSS, applied to everyone:

```css
html { --jh-card-scale: 1.06; }   /* calmer hover for everybody */
```

---

## Recipes

**Disney+-adjacent** — deeper blue-black, rounder tiles:

```css
:root {
  --jh-bg: #0A0D18;
  --jh-surface: #131A2B;
  --jh-ink-700: #1A2237;
  --jh-radius-card: 10px;
  --jh-card-scale: 1.10;
}
```

**Maximum density**, for a very large library on a big display:

```css
:root {
  --jh-card-w-portrait: 128px;
  --jh-rail-gap: .5rem;
  --jh-section-gap: 1.25rem;
  --jh-card-scale: 1.08;
  --jh-gutter: 1.5rem;
}
```

**Quiet mode** — the layout, none of the theatre:

```css
:root {
  --jh-hero-display: none;
  --jh-preview-display: none;
  --jh-card-scale: 1.03;
  --jh-glass-blur: 0px;
  --jh-dur-base: 120ms;
}
```

**Kiosk / always-on TV**:

```css
html { --jh-card-scale: 1.10; }
```
```html
<html data-jh-tv="on" data-jh-previews="off" data-jh-power="low">
```
