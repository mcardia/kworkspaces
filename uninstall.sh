#!/usr/bin/env bash
#
# uninstall.sh — disable and remove the "KWorkspaces" KWin script (Id: kworkspaces).
#
set -euo pipefail

SCRIPT_ID="kworkspaces"

c_ok()   { printf '\033[1;32mok\033[0m %s\n' "$*"; }
c_warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }

qdbus_cli() {
    if command -v qdbus6 >/dev/null 2>&1; then qdbus6 "$@"
    elif command -v qdbus-qt6 >/dev/null 2>&1; then qdbus-qt6 "$@"
    else return 1; fi
}

if command -v kwriteconfig6 >/dev/null 2>&1; then
    kwriteconfig6 --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" false
    c_ok "disabled ${SCRIPT_ID} in kwinrc"
fi

if command -v kpackagetool6 >/dev/null 2>&1; then
    kpackagetool6 --type KWin/Script --remove "$SCRIPT_ID" >/dev/null 2>&1 \
        && c_ok "removed KWin script '$SCRIPT_ID'" \
        || c_warn "package '$SCRIPT_ID' was not installed via kpackagetool6"
else
    rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/kwin/scripts/$SCRIPT_ID" \
        && c_ok "removed user scripts copy"
fi

qdbus_cli org.kde.KWin /KWin reconfigure 2>/dev/null || true
c_ok "Done."
