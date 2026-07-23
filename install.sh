#!/usr/bin/env bash
#
# install.sh — build, install and enable the "KWorkspaces" KWin script (Id: kworkspaces).
#
# Keeps one empty desktop at the end, creating and removing desktops as windows
# move onto or off of it. The TypeScript sources compile to
# pkg/contents/code/main.js; the committed build is used as-is when Node/tsc
# are unavailable.
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PKG="$SCRIPT_DIR/pkg"
SCRIPT_ID="kworkspaces"

BUILD=1

c_info() { printf '\033[1;34m::\033[0m %s\n' "$*"; }
c_ok()   { printf '\033[1;32mok\033[0m %s\n' "$*"; }
c_warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }

usage() {
    cat <<EOF
KWorkspaces — KWin script installer

Usage: ./install.sh [options]

Options:
  -n, --no-build     Install the committed build without recompiling TypeScript.
  -u, --uninstall    Run uninstall.sh instead.
  -h, --help         Show this help.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        -n|--no-build) BUILD=0; shift ;;
        -u|--uninstall) exec "$SCRIPT_DIR/uninstall.sh" ;;
        -h|--help) usage; exit 0 ;;
        *) c_warn "unknown option: $1"; usage; exit 2 ;;
    esac
done

qdbus_cli() {
    if command -v qdbus6 >/dev/null 2>&1; then qdbus6 "$@"
    elif command -v qdbus-qt6 >/dev/null 2>&1; then qdbus-qt6 "$@"
    else return 1; fi
}

# 1) Build the TypeScript -> pkg/contents/code/main.js (optional).
if [ "$BUILD" -eq 1 ] && command -v npm >/dev/null 2>&1; then
    c_info "Building TypeScript…"
    ( cd "$SCRIPT_DIR" && npm install --no-fund --no-audit >/dev/null 2>&1 && npm run build >/dev/null )
    c_ok "built pkg/contents/code/main.js"
else
    [ -f "$PKG/contents/code/main.js" ] \
        && c_info "Using committed build (no rebuild)." \
        || { c_warn "No build present and Node unavailable; cannot install."; exit 1; }
fi

# 2) Install / upgrade the KWin script package.
if command -v kpackagetool6 >/dev/null 2>&1; then
    if kpackagetool6 --type KWin/Script --list 2>/dev/null | grep -qx "$SCRIPT_ID"; then
        kpackagetool6 --type KWin/Script --upgrade "$PKG" >/dev/null
        c_ok "upgraded KWin script '$SCRIPT_ID'"
    else
        kpackagetool6 --type KWin/Script --install "$PKG" >/dev/null
        c_ok "installed KWin script '$SCRIPT_ID'"
    fi
else
    # Fallback: copy into the user scripts dir.
    dest="${XDG_DATA_HOME:-$HOME/.local/share}/kwin/scripts/$SCRIPT_ID"
    rm -rf "$dest"; mkdir -p "$dest"; cp -a "$PKG/." "$dest/"
    c_warn "kpackagetool6 missing; copied to $dest"
fi

# 3) Enable in kwinrc and reload KWin.
if command -v kwriteconfig6 >/dev/null 2>&1; then
    kwriteconfig6 --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" true
    c_ok "enabled ${SCRIPT_ID} in kwinrc"
fi
qdbus_cli org.kde.KWin /KWin reconfigure 2>/dev/null || true
c_ok "Done. Move a window onto the last (empty) desktop to see a new one appear."
