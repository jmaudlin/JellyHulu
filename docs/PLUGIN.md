# The JellyHulu plugin

A Jellyfin server plugin that installs and maintains the theme for you.

Everything it does can also be done by hand — that's what
[INSTALL.md](INSTALL.md) covers. What the plugin adds is that it keeps doing
it: a Jellyfin upgrade replaces the web client directory and undoes a manual
`index.html` edit, and the plugin simply puts it back on the next start.

| | By hand | With the plugin |
| --- | --- | --- |
| Stylesheet | Paste into Custom CSS, or `@import` a hosted file | Served from the server, linked automatically |
| Companion script | Edit `index.html`, or a reverse-proxy rule | Served from the server, linked automatically |
| Fonts | Copy `.woff2` files into the web root | Embedded in the plugin |
| Survives a Jellyfin upgrade | Only via proxy injection or a container hook | Yes — re-applied on every start |
| Server-wide defaults | Hand-edited CSS tokens | A configuration page |
| Shell access needed | Yes | No |

---

## Installing

### From the plugin repository

1. In Jellyfin: **Dashboard → Plugins → Repositories → +**
2. Name it `JellyHulu`, and use this URL:

   ```
   https://github.com/jmaudlin/JellyHulu/releases/latest/download/manifest.json
   ```

3. **Dashboard → Plugins → Catalogue → JellyHulu → Install**
4. Restart Jellyfin.
5. Hard-reload your browser (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>).

   Use that release URL rather than the `manifest.json` at the top of the
   repository. Each release generates its manifest alongside the archive it
   describes, so the checksums match; the copy in the repository is the most
   recent one generated and can be a release behind.


### Serving the manifest from jsDelivr

You can point Jellyfin at a jsDelivr copy of `manifest.json` instead:

```
https://cdn.jsdelivr.net/gh/jmaudlin/JellyHulu@main/manifest.json
```

It works, but it is the weaker option here, and the reasons are worth knowing
because two of them are easy to get wrong:

- **Don't pin a tag.** A Jellyfin plugin repository manifest is *cumulative* —
  it lists every version and the server picks the newest compatible one. Pin
  it to `@1.0.0` and nobody ever sees 1.1.0, which defeats the point of a
  repository URL. This is the opposite of the advice for the stylesheet, where
  pinning is exactly right.
- **Branch URLs are cached for about 12 hours.** jsDelivr caches tags and
  commit SHAs permanently, branches briefly. So for a while after a release,
  jsDelivr may still serve the previous manifest. That is *benign* rather than
  broken — the stale copy still lists older versions pointing at release
  archives whose checksums still match, so nothing fails to install; people
  just don't see the new version yet. Force it through with
  `https://purge.jsdelivr.net/gh/jmaudlin/JellyHulu@main/manifest.json`.
- **A branch name containing `/` cannot be addressed.** jsDelivr parses
  everything after `@` as `<ref>/<path>`, so a ref like
  `claude/some-feature` is read as ref `claude` and the rest as the file path.
  Fine for `main`; a trap for feature branches.

None of that applies to the release URL above, which is served from the same
release that produced the archive it describes — so the checksums match
structurally rather than as a matter of timing. And the thing a CDN is good at,
low-latency delivery to every client, doesn't apply to a manifest fetched
occasionally by one server. Use jsDelivr for the *stylesheet*, where every
client fetches it on every page load; see
[INSTALL.md](INSTALL.md) Route C.

### By hand

Download `jellyhulu_<version>.zip` from the
[releases page](https://github.com/jmaudlin/JellyHulu/releases), and unzip the
DLL into a `JellyHulu` folder inside your Jellyfin plugins directory:

| Install | Plugins directory |
| --- | --- |
| Debian/Ubuntu package | `/var/lib/jellyfin/plugins` |
| Docker (official) | `/config/plugins` |
| Docker (linuxserver) | `/config/plugins` |
| Windows | `%ProgramData%\Jellyfin\Server\plugins` |
| macOS | `~/.local/share/jellyfin/plugins` |

So the DLL ends up at `<plugins>/JellyHulu/Jellyfin.Plugin.JellyHulu.dll`.
Restart Jellyfin.

---

## The one requirement worth knowing before you start

**Jellyfin must be able to write to its own web client directory.**

The plugin adds three tags to `jellyfin-web/index.html`. There is no other way
for a plugin to get a script into the web client — Jellyfin has no supported
hook for it — so if that file is read-only to the Jellyfin service account,
the plugin cannot do its job.

It fails safely and says so: the configuration page shows the problem and the
path, and the server log carries a warning rather than an exception. Nothing
is broken; the theme just isn't applied.

Where this bites, and what to do:

| Install | Usually writable? | If not |
| --- | --- | --- |
| Docker (official / linuxserver) | Yes — the container runs as root | — |
| Debian/Ubuntu package | **No** — `/usr/share/jellyfin/web` is root-owned | `sudo chown -R jellyfin:jellyfin /usr/share/jellyfin/web` |
| Windows service | Usually | Grant the service account write access to the `jellyfin-web` folder |
| Unraid / TrueNAS apps | Usually | Depends on the template |

If you would rather not loosen those permissions, that's a reasonable call —
use a reverse-proxy injection rule from [INSTALL.md](INSTALL.md) for the
script, and let the plugin serve the stylesheet through Custom CSS:

```css
@import url('/JellyHulu/jellyhulu.css');
```

That URL is served by the plugin and needs no file access at all.

---

## Configuring it

**Dashboard → Plugins → JellyHulu.**

### Injection

| Setting | Default | Notes |
| --- | --- | --- |
| Enable JellyHulu | On | Off leaves the web client untouched without uninstalling — the fastest way to check whether a problem is the theme's |
| Serve the stylesheet | On | Turn off if you manage the CSS through Custom CSS yourself |
| Serve the companion script | On | Turn off for CSS only; the stylesheet is a complete theme without it |

### Defaults for new users

Accent colour, card density, animation level, the featured carousel, hover
previews, rank badges, and the carousel dwell time.

These are **starting points, not policy**. They are published to the browser
as `window.JELLYHULU_DEFAULTS` and sit between the theme's built-in defaults
and each person's own choices — so anyone can still change them in the theme's
settings panel, and their choice is remembered per Jellyfin user. "Reset" in
that panel returns to your server defaults, not the built-in ones.

### Custom CSS

Appended after the theme, so it always wins. This is a better home for token
overrides than the server's Custom CSS box, because it can't end up in the
wrong order — a rule placed *above* an `@import` is overridden by it, which is
a genuinely easy mistake to make.

```css
:root {
  --jh-accent: #FF4D8D;
  --jh-radius-card: 10px;
  --jh-card-w-portrait: 190px;
}
```

The full token reference is in [CONFIGURATION.md](CONFIGURATION.md).

---

## What it serves

All under `<your-jellyfin>/JellyHulu/`:

| Endpoint | What | Auth | Cache |
| --- | --- | --- | --- |
| `jellyhulu.css` | The theme, plus your Custom CSS | Anonymous | ETag, revalidated |
| `jellyhulu.js` | The companion script | Anonymous | 7 days, immutable |
| `defaults.js` | `window.JELLYHULU_DEFAULTS` from your settings | Anonymous | ETag, revalidated |
| `fonts/*.woff2` | Figtree | Anonymous | 7 days, immutable |
| `Status` | Injection status, for the configuration page | Admin | — |
| `Reapply` | Re-runs the injection | Admin | — |

The asset endpoints are anonymous deliberately. A `<link>` or `<script>` tag
carries no Jellyfin access token, so requiring authentication would mean the
theme never loaded — including on the login page, which it themes. Nothing
served there is user data: it's the same stylesheet, script and fonts that
ship in the public repository.

The injected tags use **relative** URLs (`../JellyHulu/...`). `index.html` is
served from `<base>/web/`, so they resolve correctly whatever subpath Jellyfin
is mounted under — an absolute `/JellyHulu/...` would break every
reverse-proxy subpath install.

---

## Uninstalling

**Dashboard → Plugins → JellyHulu → Uninstall**, then restart.

The plugin removes its tags from `index.html` when the server shuts down, so
the web client is left exactly as it was. Nothing is copied to disk — the
stylesheet, script and fonts live inside the plugin assembly — so there are no
leftover files to clean up.

If the server was killed rather than shut down, a stale tag can survive. It
points at an endpoint that no longer exists, so the browser gets a 404 and
carries on; reinstalling and shutting down cleanly, or deleting the block
between `<!-- JellyHulu:begin -->` and `<!-- JellyHulu:end -->`, tidies it.

Per-user settings stay in each browser's `localStorage` under
`jellyhulu.settings.v1.<user-id>`. They're inert without the theme.

---

## Building it yourself

Needs the .NET 8 SDK and Node 18+.

```bash
npm install && npm run build          # the theme — the plugin embeds dist/
dotnet test plugin/Jellyfin.Plugin.JellyHulu.Tests -c Release
plugin/package.sh --version 1.0.0.0   # → plugin/artifacts/
```

`package.sh` rebuilds the theme first, so the plugin can never be built around
a stale stylesheet. It writes the zip, the logo, and a `manifest.json` entry
whose checksum matches that exact zip — which is why the manifest has to be
generated by the same run that produces the archive rather than committed
ahead of time.

The plugin targets `net8.0` and `targetAbi 10.10.0.0`. Jellyfin 10.11 runs on
.NET 9, which loads a net8.0 assembly without trouble, so one build covers
both supported server versions.

### How it's put together

| File | Role |
| --- | --- |
| `Plugin.cs` | Identity, configuration, the config page |
| `PluginServiceRegistrator.cs` | Registers the hosted service |
| `Services/WebIndexInjector.cs` | All the `index.html` rewriting — pure functions plus one atomic write |
| `Services/ThemeInjectionService.cs` | Injects on start, removes on stop, re-applies on config change |
| `Api/AssetStore.cs` | Reads the embedded assets, caches them with a strong ETag |
| `Api/JellyHuluController.cs` | The endpoints above |

`WebIndexInjector` is the part that edits a file you depend on, so it's the
part with tests: 20 of them, covering the round trip being byte-identical,
repeated application not stacking duplicates, insertion going before the *last*
`</body>` (so a `</body>` inside an inline script can't capture it), recovery
from an orphaned marker, and the no-write-when-unchanged path — which is what
makes the plugin behave on a read-only web root instead of failing on every
restart.

---

## Troubleshooting

**"The web client is not themed" on the config page.** Read the detail line —
it names the problem and the path. `NotWritable` is the common one; see the
permissions table above.

**Installed, restarted, nothing changed.** Hard-reload. Then check that
`<your-jellyfin>/JellyHulu/jellyhulu.css` loads in a browser tab; if it does,
the plugin is fine and the tags are missing, so press **Re-apply to the web
client** on the config page and read the status.

**The plugin isn't in the catalogue after adding the repository.** Jellyfin
caches repository manifests. Restart the server, or re-add the repository.

**It disappeared after a Jellyfin upgrade.** That's the case the plugin is
built for — the upgrade replaced the web client, and the next start puts the
tags back. If it didn't, the new web root is probably not writable by the
service account.

**A plugin page looks wrong.** See [TROUBLESHOOTING.md](TROUBLESHOOTING.md);
that applies whichever way the theme was installed.

The plugin GUID, if you need it: `a5af0330-baf3-4ba3-9e2b-097e98f13273`
