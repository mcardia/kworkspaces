// Entry point: wires KWin signals to updateLayout(), the centralized 2D grid
// reactive recompute (desktops.ts owns the grow/shrink primitives; this file
// owns re-entrancy and the per-edge decision loop, per the grid-expansion
// plan's invariant 3 and invariant 8).

const MAX_LAYOUT_RECURSION = 30;

// Re-entrancy guards (invariant 8): `updating` prevents a nested call from
// running a second pass concurrently; `pendingRerun` -- unlike a bare
// boolean guard that would just drop a trigger that arrives mid-run --
// ensures that dropped trigger still causes one more full re-check once the
// in-progress run finishes, so a second window's event can't be silently lost.
let updating = false;
let pendingRerun = false;

function updateLayout(): void {
    if (updating) {
        pendingRerun = true;
        return;
    }
    updating = true;
    try {
        runLayoutPass(0);
    } finally {
        updating = false;
    }
    if (pendingRerun) {
        pendingRerun = false;
        updateLayout();
    }
}

// Checks all 4 edges in turn and performs at most one grow/shrink action per
// call, then recurses to re-check from scratch -- mirrors the reference
// script's reactive-recompute shape. A capped (blocked by maxDesktops) grow
// is NOT treated as an action: the pass falls through to check the next
// edge instead of recursing, so one permanently-capped edge can never starve
// the other 3 edges' own checks (invariant 5).
function runLayoutPass(depth: number): void {
    if (depth > MAX_LAYOUT_RECURSION) {
        return;
    }

    if (workspace.desktops.length === 0) {
        workspace.createDesktop(0, undefined);
        runLayoutPass(depth + 1);
        return;
    }

    const config = loadConfig();
    const windows = workspace.windowList();
    const rows = workspace.desktopGridHeight;
    const cols = workspace.desktopGridWidth;

    if (!isAllEmpty(getRow(0), windows)) {
        if (growRow(true, config.maxDesktops)) {
            runLayoutPass(depth + 1);
            return;
        }
    } else if (rows >= 2 && isAllEmpty(getRow(1), windows) && !config.keepEmptyMiddleDesktops) {
        shrinkRow(0);
        runLayoutPass(depth + 1);
        return;
    }

    if (!isAllEmpty(getRow(rows - 1), windows)) {
        if (growRow(false, config.maxDesktops)) {
            runLayoutPass(depth + 1);
            return;
        }
    } else if (rows >= 2 && isAllEmpty(getRow(rows - 2), windows) && !config.keepEmptyMiddleDesktops) {
        shrinkRow(rows - 1);
        runLayoutPass(depth + 1);
        return;
    }

    if (!isAllEmpty(getColumn(0), windows)) {
        if (growColumn(true, config.maxDesktops)) {
            runLayoutPass(depth + 1);
            return;
        }
    } else if (cols >= 2 && isAllEmpty(getColumn(1), windows) && !config.keepEmptyMiddleDesktops) {
        shrinkColumn(0);
        runLayoutPass(depth + 1);
        return;
    }

    if (!isAllEmpty(getColumn(cols - 1), windows)) {
        if (growColumn(false, config.maxDesktops)) {
            runLayoutPass(depth + 1);
            return;
        }
    } else if (cols >= 2 && isAllEmpty(getColumn(cols - 2), windows) && !config.keepEmptyMiddleDesktops) {
        shrinkColumn(cols - 1);
        runLayoutPass(depth + 1);
        return;
    }
}

function onWindowAdded(win: KWinWindow | null | undefined): void {
    if (win === null || win === undefined) {
        // Not observed empirically on this KWin 6.7 session, but kept
        // defensively per the original script's own guard (see kwin.d.ts).
        return;
    }
    if (win.skipPager) {
        return;
    }

    updateLayout();
    win.desktopsChanged.connect(function () {
        updateLayout();
    });
}

workspace.windowList().forEach(onWindowAdded);
workspace.windowAdded.connect(onWindowAdded);

// Deliberately NOT wired to window-close (invariant 3) -- kept to this
// plan's bounded scope of reacting to window add/move and desktop switches,
// matching the original 1D script's own scope. A closed window's now-
// possibly-empty edge is cleaned up lazily on the next switch/add instead.
workspace.currentDesktopChanged.connect(function () {
    if (animationFixup) {
        return;
    }
    updateLayout();
});
