#!/usr/bin/env bash
#
# Verifies that the URLs the documentation tells people to paste actually
# work, and that the plugin manifest agrees with the archive it points at.
#
#   ./scripts/check-install-urls.sh
#
# This exists because a documented URL broke without anything in the repository
# changing: the plugin repository URL used to be
# releases/latest/download/manifest.json, and publishing an unrelated release
# moved GitHub's "latest" to a release with no manifest attached. Nothing in
# CI could have noticed. Run this after cutting any release.
#
# Network failures are reported as warnings rather than failures, so a flaky
# link or a blocked CDN does not masquerade as a broken URL. Only a real HTTP
# error status, or a checksum mismatch, fails the run.

set -uo pipefail

REPO="jmaudlin/JellyHulu"
FAILED=0
WARNED=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAILED=$((FAILED + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; WARNED=$((WARNED + 1)); }

# Fetch a URL. Echoes the HTTP status, or "000" when the connection failed.
# curl already writes 000 for a failed connection *and* exits non-zero, so an
# `|| echo 000` here would concatenate two codes into "000000".
status_of() {
  local out
  out="$(curl -sSL -m 30 -o "$2" -w '%{http_code}' "$1" 2>/dev/null)"
  printf '%s' "${out:-000}"
}

echo "Checking the URLs the docs tell people to use..."
echo

# --------------------------------------------------------------------------
# 1. The plugin repository URL — the one pasted into Jellyfin.
# --------------------------------------------------------------------------
MANIFEST_URL="https://raw.githubusercontent.com/$REPO/main/manifest.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

code="$(status_of "$MANIFEST_URL" "$TMP/manifest.json")"
if [ "$code" = "200" ]; then
  pass "plugin repository manifest reachable ($MANIFEST_URL)"
elif [ "$code" = "000" ]; then
  warn "could not reach the manifest URL (network); not treating as a failure"
else
  fail "plugin repository manifest returned HTTP $code — $MANIFEST_URL"
fi

# --------------------------------------------------------------------------
# 2. The manifest must parse, list versions newest-first, and its newest
#    entry must point at an archive whose checksum matches. Jellyfin verifies
#    that checksum and refuses the install on a mismatch, so a manifest that
#    parses is not the same as a manifest that works.
# --------------------------------------------------------------------------
if [ -s "$TMP/manifest.json" ]; then
  if ! python3 -c "import json,sys; json.load(open('$TMP/manifest.json'))" 2>/dev/null; then
    fail "the manifest is not valid JSON (is the URL serving an error page?)"
  else
    eval "$(python3 - "$TMP/manifest.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))[0]
v = d['versions'][0]
print(f"NEWEST={v['version']}")
print(f"SRC={v['sourceUrl']}")
print(f"SUM={v['checksum']}")
print(f"COUNT={len(d['versions'])}")
PY
)"
    pass "manifest lists $COUNT version(s), newest $NEWEST"

    code="$(status_of "$SRC" "$TMP/plugin.zip")"
    if [ "$code" = "200" ]; then
      got="$(md5sum "$TMP/plugin.zip" | cut -d' ' -f1)"
      if [ "$got" = "$SUM" ]; then
        pass "archive for $NEWEST downloads and its checksum matches"
      else
        fail "checksum mismatch for $NEWEST: manifest says $SUM, archive is $got"
      fi
    elif [ "$code" = "000" ]; then
      warn "could not download the archive (network)"
    else
      fail "archive for $NEWEST returned HTTP $code — $SRC"
    fi
  fi
fi

# --------------------------------------------------------------------------
# 3. Every pinned jsDelivr URL in the docs must resolve. A tag that does not
#    exist yet returns 404 and an @import fails *silently*, which is a
#    miserable thing to debug from a browser.
# --------------------------------------------------------------------------
while IFS= read -r url; do
  [ -n "$url" ] || continue
  code="$(status_of "$url" /dev/null)"
  if [ "$code" = "200" ]; then
    pass "$url"
  elif [ "$code" = "000" ]; then
    warn "could not reach $url (network or blocked CDN)"
  else
    fail "$url returned HTTP $code"
  fi
done < <(grep -rhoE 'https://cdn\.jsdelivr\.net/[^)'"'"'" ]+' docs/ README.md 2>/dev/null | sort -u)

echo
if [ "$FAILED" -gt 0 ]; then
  printf '\033[31m%d URL check(s) failed\033[0m'"$([ "$WARNED" -gt 0 ] && echo ", $WARNED warning(s)")"'\n' "$FAILED"
  exit 1
fi
printf '\033[32mAll install URLs check out\033[0m'"$([ "$WARNED" -gt 0 ] && echo " ($WARNED warning(s) — see above)")"'\n'
