#!/usr/bin/env bash
#
# JellyHulu — installs the optional JavaScript companion into jellyfin-web.
#
# Jellyfin's Custom CSS box can only take CSS, so the companion script has to
# be referenced from jellyfin-web's index.html. This copies the bundle into
# the web root and adds one <script> tag, between marker comments so the edit
# can be found and removed again later.
#
#   sudo ./scripts/install-jellyhulu.sh
#   sudo ./scripts/install-jellyhulu.sh --web-root /usr/share/jellyfin/web
#   sudo ./scripts/install-jellyhulu.sh --uninstall
#
# A Jellyfin server upgrade replaces the web root, which removes this edit.
# Re-run the script after upgrading. See docs/INSTALL.md for ways to make it
# survive automatically (reverse-proxy injection, or a container hook).

set -euo pipefail

BEGIN_MARK="<!-- JellyHulu:begin -->"
END_MARK="<!-- JellyHulu:end -->"
SUBDIR="jellyhulu"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname -- "$SCRIPT_DIR")"

WEB_ROOT=""
UNINSTALL=0
WITH_FONTS=1

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[32m·\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --web-root) WEB_ROOT="${2:-}"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    --no-fonts) WITH_FONTS=0; shift ;;
    -h|--help) usage ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# --------------------------------------------------------------------------
# Locate jellyfin-web
# --------------------------------------------------------------------------
if [ -z "$WEB_ROOT" ]; then
  for candidate in \
    /usr/share/jellyfin/web \
    /usr/lib/jellyfin/bin/jellyfin-web \
    /jellyfin/jellyfin-web \
    /app/jellyfin/jellyfin-web \
    /opt/jellyfin/jellyfin-web \
    /var/lib/jellyfin/web \
    "/Applications/Jellyfin.app/Contents/Resources/jellyfin-web" \
    ; do
    if [ -f "$candidate/index.html" ]; then WEB_ROOT="$candidate"; break; fi
  done
fi

[ -n "$WEB_ROOT" ] || die "could not find jellyfin-web. Pass --web-root /path/to/jellyfin-web"
[ -f "$WEB_ROOT/index.html" ] || die "no index.html in $WEB_ROOT"

INDEX="$WEB_ROOT/index.html"
BACKUP="$INDEX.jellyhulu-original"
info "jellyfin-web: $WEB_ROOT"

[ -w "$INDEX" ] || die "$INDEX is not writable — re-run with sudo"

# --------------------------------------------------------------------------
# Remove any previous installation. Uninstall and reinstall share this, so a
# repeat install never stacks up duplicate script tags.
# --------------------------------------------------------------------------
remove_block() {
  if grep -qF "$BEGIN_MARK" "$INDEX"; then
    # Delete the marker block, inclusive.
    sed -i.jellyhulu-bak "/$(printf '%s' "$BEGIN_MARK" | sed 's/[][\.*^$/]/\\&/g')/,/$(printf '%s' "$END_MARK" | sed 's/[][\.*^$/]/\\&/g')/d" "$INDEX"
    info "removed the previous JellyHulu block from index.html"
  fi
}

if [ "$UNINSTALL" -eq 1 ]; then
  remove_block
  if [ -d "$WEB_ROOT/$SUBDIR" ]; then
    rm -rf "${WEB_ROOT:?}/$SUBDIR"
    info "removed $WEB_ROOT/$SUBDIR"
  fi
  rm -f "$INDEX.jellyhulu-bak"
  [ -f "$BACKUP" ] && info "the untouched original is still at $(basename "$BACKUP")"
  info "uninstalled. Clear your browser cache, then remove the @import line"
  info "from Dashboard → General → Custom CSS to drop the stylesheet too."
  exit 0
fi

# --------------------------------------------------------------------------
# Install
# --------------------------------------------------------------------------
BUNDLE="$REPO_DIR/dist/jellyhulu.min.js"
[ -f "$BUNDLE" ] || BUNDLE="$REPO_DIR/dist/jellyhulu.js"
[ -f "$BUNDLE" ] || die "no built bundle in dist/ — run: npm run build"

if [ ! -f "$BACKUP" ]; then
  cp -p "$INDEX" "$BACKUP"
  info "backed up the original index.html to $(basename "$BACKUP")"
fi

remove_block

mkdir -p "$WEB_ROOT/$SUBDIR"
cp "$BUNDLE" "$WEB_ROOT/$SUBDIR/jellyhulu.js"
info "copied $(basename "$BUNDLE") → $SUBDIR/jellyhulu.js"

for css in jellyhulu.min.css jellyhulu.css jellyhulu-linked-fonts.min.css; do
  [ -f "$REPO_DIR/dist/$css" ] && cp "$REPO_DIR/dist/$css" "$WEB_ROOT/$SUBDIR/$css"
done
info "copied the stylesheets alongside it (for the @import route)"

if [ "$WITH_FONTS" -eq 1 ] && [ -d "$REPO_DIR/fonts" ]; then
  mkdir -p "$WEB_ROOT/$SUBDIR/fonts"
  cp "$REPO_DIR"/fonts/*.woff2 "$WEB_ROOT/$SUBDIR/fonts/" 2>/dev/null || true
  cp "$REPO_DIR"/fonts/Figtree-OFL.txt "$WEB_ROOT/$SUBDIR/fonts/" 2>/dev/null || true
  info "copied the Figtree font files"
fi

# Insert before </body>. Using a temp file keeps the original intact if
# anything below fails.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# `sub` and `index` are awk built-ins; the variables here deliberately avoid
# every reserved name.
awk -v mark_begin="$BEGIN_MARK" -v mark_end="$END_MARK" -v jhdir="$SUBDIR" '
  BEGIN { inserted = 0 }
  /<\/body>/ && !inserted {
    print "    " mark_begin
    print "    <script defer src=\"" jhdir "/jellyhulu.js\"></script>"
    print "    " mark_end
    inserted = 1
  }
  { print }
  END { if (!inserted) exit 3 }
' "$INDEX" > "$TMP" || die "no </body> found in index.html — nothing was changed"

cat "$TMP" > "$INDEX"
rm -f "$INDEX.jellyhulu-bak"

info "added the companion script tag to index.html"
echo
info "Done. Next:"
echo "    1. Dashboard → General → Custom CSS, add:"
echo "         @import url('/web/$SUBDIR/jellyhulu.min.css');"
echo "    2. Hard-reload the browser (Ctrl/Cmd + Shift + R)."
echo
warn "A Jellyfin upgrade replaces the web root and undoes the index.html edit."
warn "Re-run this script after upgrading, or use one of the persistent methods"
warn "in docs/INSTALL.md."
