# Installing JellyHulu

There are two things to install, and the second one is optional:

1. **The stylesheet** — the theme itself. Goes in Jellyfin's Custom CSS box.
2. **The companion script** — hero carousel, hover previews, badges, settings
   panel, TV navigation. Has to be referenced from `jellyfin-web/index.html`,
   because Jellyfin's Custom CSS box only accepts CSS.

Pick a route for each. The stylesheet routes are independent of the script
routes; mix them however suits your setup.

---

## Part 1 — the stylesheet

### Route A: self-hosted (recommended)

No external requests, works on a LAN-only or air-gapped server, and the Custom
CSS box stays one line long.

```bash
git clone https://github.com/jmaudlin/JellyHulu.git
cd JellyHulu
sudo ./scripts/install-jellyhulu.sh
```

The script copies the stylesheets and fonts into `<jellyfin-web>/jellyhulu/`.
Then, in **Dashboard → General → Custom CSS**:

```css
@import url('/web/jellyhulu/jellyhulu.min.css');
```

> A Jellyfin server upgrade replaces the web root, taking these files with it.
> Re-run the script after upgrading, or use the persistent methods below.

### Route B: paste it in

Simplest possible, survives every upgrade, needs no shell access. The whole
theme goes into the Custom CSS box.

1. Open `dist/jellyhulu.min.css` (about 180 kB — the fonts are embedded).
2. Copy all of it.
3. Paste into **Dashboard → General → Custom CSS**, and save.

The box handles it, but a stylesheet that size is awkward to scroll past when
you want to add your own overrides — put yours at the very top with a comment
so you can find them again.

If you'd rather host the fonts separately and keep the paste small, use
`dist/jellyhulu-linked-fonts.min.css` (about 100 kB) and copy `fonts/*.woff2`
to `<jellyfin-web>/jellyhulu/fonts/`.

### Route C: a CDN

One line, always current, but every client fetches from jsDelivr — so it needs
internet access from each device, and it tells jsDelivr who's browsing.

```css
@import url('https://cdn.jsdelivr.net/gh/jmaudlin/JellyHulu@v1.0.0/dist/jellyhulu.min.css');
```

Pin a tag, as above. Pointing at `@main` means an upstream change lands on
your server unannounced.

### Route D: any web server you already run

Drop `dist/jellyhulu.min.css` anywhere your reverse proxy serves and import it
by URL. Useful if you already have a static host and don't want to touch the
Jellyfin web root at all.

---

## Part 2 — the companion script

Optional. Everything in Part 1 works without it. Skip this if you only want
the visual theme.

### Route A: the install script

```bash
sudo ./scripts/install-jellyhulu.sh
```

It copies `dist/jellyhulu.min.js` into `<jellyfin-web>/jellyhulu/` and inserts
one tag into `index.html`, between markers:

```html
<!-- JellyHulu:begin -->
<script defer src="jellyhulu/jellyhulu.js"></script>
<!-- JellyHulu:end -->
```

The original `index.html` is backed up alongside it as
`index.html.jellyhulu-original` before anything is changed. Running the script
again replaces the block rather than adding a second one, and `--uninstall`
removes it and leaves `index.html` byte-identical to how it started.

Options:

| Flag | Effect |
| --- | --- |
| `--web-root PATH` | Skip auto-detection and use this jellyfin-web directory |
| `--uninstall` | Remove the script tag and the `jellyhulu/` directory |
| `--no-fonts` | Don't copy the font files (for the embedded-font stylesheet) |

Auto-detection covers the usual locations: `/usr/share/jellyfin/web`,
`/usr/lib/jellyfin/bin/jellyfin-web`, `/jellyfin/jellyfin-web`,
`/app/jellyfin/jellyfin-web`, `/opt/jellyfin/jellyfin-web`,
`/var/lib/jellyfin/web`, and the macOS app bundle.

### Route B: reverse proxy injection — survives upgrades

The web root gets replaced on every Jellyfin upgrade, but your proxy config
doesn't. Serve the bundle yourself and inject the tag on the way through.

**nginx** (needs `ngx_http_sub_module`, which is in the standard build):

```nginx
location /jellyhulu/ {
    alias /srv/jellyhulu/;      # where you put dist/ and fonts/
    expires 7d;
}

location / {
    proxy_pass http://127.0.0.1:8096;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # sub_filter cannot rewrite a compressed body.
    proxy_set_header Accept-Encoding "";

    sub_filter '</body>' '<script defer src="/jellyhulu/jellyhulu.min.js"></script></body>';
    sub_filter_once on;
    sub_filter_types text/html;
}
```

**Caddy** (needs the `replace-response` plugin —
`xcaddy build --with github.com/caddyserver/replace-response`):

```caddyfile
jellyfin.example.com {
    handle_path /jellyhulu/* {
        root * /srv/jellyhulu
        file_server
    }
    handle {
        replace "</body>" "<script defer src=\"/jellyhulu/jellyhulu.min.js\"></script></body>"
        reverse_proxy 127.0.0.1:8096
    }
}
```

**Traefik**: no body-rewriting middleware ships in core. Either put nginx or
Caddy in front of Jellyfin for this one job, or use Route C.

### Route C: Docker — re-applied on every container start

Mount the repo read-only and patch the web root at startup, so a pulled image
gets themed automatically.

```yaml
services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    volumes:
      - ./config:/config
      - ./cache:/cache
      - ./media:/media
      - ./JellyHulu:/opt/jellyhulu:ro
      - ./jellyhulu-entrypoint.sh:/opt/jellyhulu-entrypoint.sh:ro
    entrypoint: ["/bin/bash", "/opt/jellyhulu-entrypoint.sh"]
```

`jellyhulu-entrypoint.sh`:

```bash
#!/bin/bash
set -e
# The web root is inside the image, so this has to run on every start.
/opt/jellyhulu/scripts/install-jellyhulu.sh \
  --web-root /jellyfin/jellyfin-web || echo "JellyHulu: install skipped"
exec /jellyfin/jellyfin "$@"
```

The `|| echo` matters: if a future image moves the web root, you want Jellyfin
to start un-themed rather than not start at all.

For **linuxserver/jellyfin**, put the same commands in a custom init script at
`/custom-cont-init.d/99-jellyhulu.sh` instead of overriding the entrypoint.

### Route D: a Jellyfin plugin

If you already run a plugin that injects arbitrary JavaScript (several exist
in the community catalogues), point it at `jellyhulu.min.js` and skip the
`index.html` edit entirely. Plugin state lives in your config directory, so it
survives server upgrades.

---

## Verifying it worked

Open the browser console on your Jellyfin tab:

```js
JellyHulu.version        // "1.0.0" if the companion loaded
```

Visually:

- A `tune` icon in the header, left of your avatar → companion loaded.
- A green hero at the top of the home page → carousel working.
- Green accents and Figtree type everywhere → stylesheet loaded.

For verbose logging, add `?jhdebug` to the URL, or run
`localStorage.setItem('jellyhulu.debug', '1')` and reload.

---

## Upgrading

```bash
cd JellyHulu
git pull
npm run build          # only if you changed sources; dist/ is committed
sudo ./scripts/install-jellyhulu.sh
```

Then hard-reload. Browsers cache `@import`ed stylesheets aggressively; if the
new version doesn't appear, bump the URL:

```css
@import url('/web/jellyhulu/jellyhulu.min.css?v=1.0.1');
```

---

## Removing it

```bash
sudo ./scripts/install-jellyhulu.sh --uninstall
```

Then delete the `@import` line (or the pasted CSS) from **Dashboard → General
→ Custom CSS**, and hard-reload.

Per-user settings live in each browser's `localStorage` under
`jellyhulu.settings.v1.<user-id>`. They're harmless once the theme is gone;
clear site data if you want them removed too.
