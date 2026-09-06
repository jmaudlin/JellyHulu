#!/usr/bin/env bash
#
# Builds the plugin and produces a release zip plus the repository manifest
# entry that points at it.
#
#   ./package.sh                     build 1.0.0.0 for the default download URL
#   ./package.sh --version 1.1.0.0
#   ./package.sh --base-url https://github.com/me/fork/releases/download
#
# The output is written to plugin/artifacts/.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname -- "$SCRIPT_DIR")"
OUT_DIR="$SCRIPT_DIR/artifacts"
PROJECT="$SCRIPT_DIR/Jellyfin.Plugin.JellyHulu/Jellyfin.Plugin.JellyHulu.csproj"
MANIFEST="$REPO_DIR/manifest.json"

VERSION="1.0.0.0"
TARGET_ABI="10.10.0.0"
BASE_URL="https://github.com/jmaudlin/JellyHulu/releases/download"
CHANGELOG="See the repository CHANGELOG."

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[32m·\033[0m %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:?}"; shift 2 ;;
    --target-abi) TARGET_ABI="${2:?}"; shift 2 ;;
    --base-url) BASE_URL="${2:?}"; shift 2 ;;
    --changelog) CHANGELOG="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

command -v dotnet >/dev/null || die "dotnet is not installed"

# The plugin embeds dist/, so a stale dist means a stale plugin. Rebuild it
# first when the tooling is available rather than shipping whatever is on disk.
if command -v node >/dev/null && [ -f "$REPO_DIR/build.mjs" ]; then
  info "rebuilding the theme bundles"
  (cd "$REPO_DIR" && node build.mjs --check >/dev/null) || die "theme build failed"
fi

[ -f "$REPO_DIR/dist/jellyhulu-plugin.min.css" ] || die "dist/jellyhulu-plugin.min.css is missing — run 'npm run build'"
[ -f "$REPO_DIR/dist/jellyhulu.min.js" ] || die "dist/jellyhulu.min.js is missing — run 'npm run build'"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/build"

info "building the plugin ($VERSION)"
dotnet publish "$PROJECT" \
  -c Release \
  -o "$OUT_DIR/build" \
  -p:Version="$VERSION" \
  -p:AssemblyVersion="$VERSION" \
  -p:FileVersion="$VERSION" \
  --nologo >/dev/null

ZIP="$OUT_DIR/jellyhulu_${VERSION}.zip"

# Only our own assembly: the Jellyfin assemblies are provided by the server,
# and shipping copies of them is how plugins end up with load conflicts.
(cd "$OUT_DIR/build" && zip -q -X "$ZIP" "Jellyfin.Plugin.JellyHulu.dll")

# The logo ships as a release asset too. A raw.githubusercontent URL would
# have to name a branch, and the repository's default branch is not something
# this script can know; a release URL is stable and unambiguous.
cp "$SCRIPT_DIR/logo.png" "$OUT_DIR/logo.png" 2>/dev/null || true

CHECKSUM="$(md5sum "$ZIP" | cut -d' ' -f1)"
SIZE="$(stat -c%s "$ZIP")"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GUID="$(grep -oP 'guid:\s*"\K[^"]+' "$SCRIPT_DIR/build.yaml")"

info "packaged $(basename "$ZIP") (${SIZE} bytes, md5 $CHECKSUM)"

# Prepend this version to the manifest, so the newest is first.
VERSION="$VERSION" TARGET_ABI="$TARGET_ABI" BASE_URL="$BASE_URL" \
CHECKSUM="$CHECKSUM" TIMESTAMP="$TIMESTAMP" GUID="$GUID" \
CHANGELOG="$CHANGELOG" MANIFEST="$MANIFEST" \
IMAGE_URL="$BASE_URL/plugin-v$VERSION/logo.png" \
node - <<'NODEEOF'
const fs = require('fs');

const manifestPath = process.env.MANIFEST;
const version = process.env.VERSION;

const entry = {
  version,
  changelog: process.env.CHANGELOG,
  targetAbi: process.env.TARGET_ABI,
  sourceUrl: `${process.env.BASE_URL}/plugin-v${version}/jellyhulu_${version}.zip`,
  checksum: process.env.CHECKSUM,
  timestamp: process.env.TIMESTAMP,
};

let manifest = [];
if (fs.existsSync(manifestPath)) {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

let plugin = manifest.find((p) => p.guid === process.env.GUID);
if (!plugin) {
  plugin = {
    guid: process.env.GUID,
    name: 'JellyHulu',
    description:
      'Serves the JellyHulu stylesheet, its companion script and its fonts from '
      + 'the Jellyfin server, and keeps the web client pointing at them across '
      + 'server upgrades.',
    overview: 'A Hulu-inspired theme for the Jellyfin web client.',
    owner: 'jmaudlin',
    category: 'General',
    versions: [],
  };
  manifest.push(plugin);
}

// Always point at the release being packaged, so the image never outlives
// the tag it was published under.
plugin.imageUrl = process.env.IMAGE_URL;

// Replace an entry for the same version rather than adding a duplicate, so
// re-running the packager is safe.
plugin.versions = plugin.versions.filter((v) => v.version !== version);
plugin.versions.unshift(entry);

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`· manifest.json updated for ${version}`);
NODEEOF

info "done. Artifacts in $OUT_DIR"
