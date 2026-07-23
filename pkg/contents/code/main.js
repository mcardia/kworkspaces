"use strict";
// Configuration: read fresh from the script's kwinrc section via readConfig()
// on every check, matching the original script (which never caches this, since
// it can change live via System Settings while the script keeps running).
function readBool(key, fallback) {
    const raw = readConfig(key, fallback);
    if (typeof raw === "boolean") {
        return raw;
    }
    const text = String(raw).toLowerCase();
    return text === "true" || text === "1";
}
function loadConfig() {
    return {
        keepEmptyMiddleDesktops: readBool("keepEmptyMiddleDesktops", false),
    };
}
// Core "always exactly one empty trailing desktop" state machine. Six invariants
// (from plans/plan-kworkspaces-rewrite.md Phase 2, written before this code):
//
// 1. Desktop count never drops below MIN_DESKTOPS.
// 2. A window landing on (or created on) the last desktop appends a new trailing
//    desktop (maintainTrailingDesktop).
// 3. Switching to a lower-index desktop purges empty desktops scanning
//    right-to-left from second-to-last down to (not including) the new current
//    desktop, never past index 0. With keepEmptyMiddleDesktops true, the purge
//    stops at the first non-empty desktop found; false (default) keeps going
//    past it too (pruneEmptyDesktopsOnSwitch).
// 4. Removing a desktop in the middle breaks KWin 6's pager-switch animation
//    (documented upstream bug) -- emulated by shifting every window on a
//    desktop past the target down by one, then removing the actual last
//    desktop, guarded by animationFixup so the internal switch-then-remove-
//    then-switch-back dance doesn't re-trigger the purge (removeDesktopAt).
// 5. Windows with skipPager are ignored for emptiness and never trigger
//    trailing-desktop creation (checked explicitly). onAllDesktops windows are
//    excluded too, with no special-casing needed: verified live (kwin.d.ts)
//    that such a window's .desktops is always empty, so it never matches a
//    specific desktop in isDesktopInList.
// 6. A null/undefined window is tolerated (guarded in main.ts's windowAdded
//    handler, not here).
const MIN_DESKTOPS = 2;
// Set while removeDesktopAt's internal switch-then-remove-then-switch-back
// replay is running, so main.ts's currentDesktopChanged handler ignores the
// desktop switches that dance itself causes.
let animationFixup = false;
function isDesktopInList(desktops, target) {
    return desktops.indexOf(target) !== -1;
}
function isWindowOnDesktop(win, desktop) {
    return isDesktopInList(win.desktops, desktop);
}
function isEmptyDesktop(desktop, windows) {
    return !windows.some(function (win) {
        return !win.skipPager && isDesktopInList(win.desktops, desktop);
    });
}
// Shifts every window whose assigned desktop is at index >= boundary one
// position to the left (onto allDesktops[index - 1] instead); windows at
// index < boundary are untouched. Vacates the trailing desktops before
// removeDesktopAt physically removes the last one.
function shiftWindowsRighterThan(windows, allDesktops, boundary) {
    if (boundary === 0) {
        return;
    }
    windows.forEach(function (win) {
        win.desktops = win.desktops.map(function (d) {
            const index = allDesktops.indexOf(d);
            return index < boundary ? d : allDesktops[index - 1];
        });
    });
}
// Removes the desktop conceptually "at" boundary without ever removing a
// middle desktop directly: shifts windows out of its way, then removes the
// actual last desktop, replaying a switch around it (animationFixup) to keep
// KWin's pager-switch animation intact.
function removeDesktopAt(boundary) {
    const allDesktops = workspace.desktops;
    if (allDesktops.length - 1 <= boundary || allDesktops.length <= MIN_DESKTOPS) {
        return false;
    }
    shiftWindowsRighterThan(workspace.windowList(), allDesktops, boundary);
    animationFixup = true;
    try {
        const last = workspace.desktops[workspace.desktops.length - 1];
        const current = workspace.currentDesktop;
        const index = workspace.desktops.indexOf(current);
        const target = index + 1 < workspace.desktops.length || index === -1
            ? workspace.desktops[index + 1]
            : current;
        workspace.currentDesktop = target;
        workspace.removeDesktop(last);
        workspace.currentDesktop = current;
    }
    finally {
        animationFixup = false;
    }
    return true;
}
function maintainTrailingDesktop(win) {
    const last = workspace.desktops[workspace.desktops.length - 1];
    if (isWindowOnDesktop(win, last)) {
        workspace.createDesktop(workspace.desktops.length, undefined);
    }
}
function pruneEmptyDesktopsOnSwitch(oldDesktop, keepEmptyMiddleDesktops) {
    const oldIndex = workspace.desktops.indexOf(oldDesktop);
    const currentIndex = workspace.desktops.indexOf(workspace.currentDesktop);
    if (oldIndex <= currentIndex) {
        return; // switched right (or to the same desktop) -- nothing to purge
    }
    for (let idx = workspace.desktops.length - 2; idx > currentIndex && idx > 0; --idx) {
        const desktop = workspace.desktops[idx];
        if (isEmptyDesktop(desktop, workspace.windowList())) {
            removeDesktopAt(idx);
        }
        else if (keepEmptyMiddleDesktops) {
            break;
        }
    }
}
// Entry point: wires KWin signals to the desktop-management logic in desktops.ts.
function onWindowAdded(win) {
    if (win === null || win === undefined) {
        // Not observed empirically on this KWin 6.7 session, but kept
        // defensively per the original script's own guard (see kwin.d.ts).
        return;
    }
    if (win.skipPager) {
        return;
    }
    maintainTrailingDesktop(win);
    win.desktopsChanged.connect(function () {
        maintainTrailingDesktop(win);
    });
}
workspace.windowList().forEach(onWindowAdded);
workspace.windowAdded.connect(onWindowAdded);
workspace.currentDesktopChanged.connect(function (oldDesktop) {
    if (animationFixup) {
        return;
    }
    const config = loadConfig();
    pruneEmptyDesktopsOnSwitch(oldDesktop, config.keepEmptyMiddleDesktops);
});
