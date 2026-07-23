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
function readInt(key, fallback) {
    const raw = readConfig(key, fallback);
    const value = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    return isNaN(value) ? fallback : value;
}
function loadConfig() {
    return {
        keepEmptyMiddleDesktops: readBool("keepEmptyMiddleDesktops", false),
        maxDesktops: Math.max(2, readInt("maxDesktops", 20)),
    };
}
// Core "always exactly one empty margin on each of 4 edges" 2D grid state
// machine. Generalizes the original 1D "one trailing desktop" model (see
// plans/plan-kworkspaces-rewrite.md) to a grid, per
// plans/plan-kworkspaces-grid-expansion.md Phase 2's 8 invariants (written
// before this code; the two most load-bearing are restated here):
//
// - The grid is row-major over workspace.desktops: desktop at raw index i is
//   at logical (row, col) = (floor(i / cols), i % cols), where
//   cols = workspace.desktopGridWidth, rows = workspace.desktopGridHeight
//   (verified live, kwin.d.ts).
// - SHRINKING never removes a desktop object except at the tail
//   (removeDesktopAt's animation-safety dance -- a real, documented KWin 6
//   pager-animation bug for removal). GROWING inserts new desktop objects
//   directly at their target position via createDesktop, which Phase 1 found
//   to be a genuine positional insert with no equivalent documented bug for
//   creation -- so growth does not need the animation-safety dance.
// - A shrink of an edge only ever happens when the edge AND the next
//   row/column inward are BOTH empty (a non-negotiable, non-config floor rule
//   that guarantees a shrink never removes the one required margin --  this
//   is what fixes the oscillation bug an early draft of this design had).
//   keepEmptyMiddleDesktops only decides what happens once that floor is
//   met: false (default) shrinks immediately back to exactly one margin;
//   true never proactively shrinks beyond what the floor already guarantees.
// Set while removeLastDesktopSafely's internal switch-then-remove-then-
// switch-back replay is running, so main.ts's currentDesktopChanged handler
// ignores the desktop switches that dance itself causes.
let animationFixup = false;
function isDesktopInList(desktops, target) {
    return desktops.indexOf(target) !== -1;
}
function isEmptyDesktop(desktop, windows) {
    return !windows.some(function (win) {
        return !win.skipPager && isDesktopInList(win.desktops, desktop);
    });
}
function isAllEmpty(desktops, windows) {
    return desktops.every(function (d) {
        return isEmptyDesktop(d, windows);
    });
}
// Row-major slicing. Tolerates a ragged last row (desktop count not an exact
// multiple of desktopGridWidth), which can occur transiently mid-resize.
function getRow(index) {
    const cols = workspace.desktopGridWidth;
    const count = workspace.desktops.length;
    if (index < 0 || index * cols >= count) {
        return [];
    }
    const start = index * cols;
    const end = Math.min(count, start + cols);
    return workspace.desktops.slice(start, end);
}
function getColumn(index) {
    const cols = workspace.desktopGridWidth;
    const rows = workspace.desktopGridHeight;
    const count = workspace.desktops.length;
    if (index < 0 || index >= cols) {
        return [];
    }
    const result = [];
    for (let r = 0; r < rows; r++) {
        const idx = r * cols + index;
        if (idx < count) {
            result.push(workspace.desktops[idx]);
        }
    }
    return result;
}
// Reassigns windows whose desktop lies within [range[0], range[1]] (raw
// indices, inclusive) to allDesktops[index + offset] instead. Generalizes the
// 1D rewrite's shiftWindowsRighterThan to an arbitrary signed offset and an
// explicit range, since a column (unlike a row) is strided in the row-major
// array and needs a distinct range/offset per row (see shrinkColumn).
function shiftWindowsBy(windows, allDesktops, range, offset) {
    if (offset === 0) {
        return;
    }
    const [start, end] = range;
    windows.forEach(function (win) {
        win.desktops = win.desktops.map(function (d) {
            const index = allDesktops.indexOf(d);
            return index < start || index > end ? d : allDesktops[index + offset];
        });
    });
}
// Removes the current actual last desktop, replaying a switch around it
// (animationFixup) to keep KWin's pager-switch animation intact. This is the
// one primitive every physical desktop removal in this file goes through.
function removeLastDesktopSafely() {
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
}
// Removes the desktop conceptually "at" boundary without ever removing a
// middle desktop directly: shifts windows out of its way, then removes the
// actual last desktop via removeLastDesktopSafely. Only valid for a boundary
// strictly before the current last index -- callers that have already
// arranged for their target to BE the last index should call
// removeLastDesktopSafely directly instead (see shrinkRow/shrinkColumn).
function removeDesktopAt(boundary) {
    const allDesktops = workspace.desktops;
    if (allDesktops.length - 1 <= boundary) {
        return false;
    }
    shiftWindowsBy(workspace.windowList(), allDesktops, [boundary, allDesktops.length - 1], -1);
    removeLastDesktopSafely();
    return true;
}
// Removes whichever of the two (boundary === current tail, or not) applies.
function removeDesktopAtOrTail(boundary) {
    if (boundary === workspace.desktops.length - 1) {
        removeLastDesktopSafely();
    }
    else {
        removeDesktopAt(boundary);
    }
}
// Grows a new row of desktops beyond the top (atTop) or bottom edge, unless
// doing so would exceed maxDesktops. Per Phase 1's finding, this inserts
// directly at the target position (no window reassignment needed for
// growth) -- the new desktops are interchangeable empty placeholders, so the
// order they're created in doesn't matter. Returns whether it actually grew
// (false if blocked by the cap; a capped grow must not be treated as "an
// action happened" by the caller's recursion, see main.ts).
function growRow(atTop, maxDesktops) {
    const cols = workspace.desktopGridWidth;
    if (workspace.desktops.length + cols > maxDesktops) {
        return false;
    }
    for (let i = 0; i < cols; i++) {
        const position = atTop ? 0 : workspace.desktops.length;
        workspace.createDesktop(position, undefined);
    }
    workspace.desktopGridHeight = workspace.desktopGridHeight + 1;
    return true;
}
// Grows a new column beyond the left (atLeft) or right edge. A column is
// strided (not contiguous) in the row-major array, so this inserts one new
// desktop per existing row, processed from the LAST row to the FIRST: each
// target index is computed against the grid's ORIGINAL width (captured once,
// before any insertion), which stays valid throughout because a later row's
// insertion always happens at a strictly higher raw index than an
// earlier row's, so it never invalidates an earlier row's target index.
function growColumn(atLeft, maxDesktops) {
    const rows = workspace.desktopGridHeight;
    if (workspace.desktops.length + rows > maxDesktops) {
        return false;
    }
    const originalCols = workspace.desktopGridWidth;
    const targetCol = atLeft ? 0 : originalCols;
    for (let r = rows - 1; r >= 0; r--) {
        workspace.createDesktop(r * originalCols + targetCol, undefined);
    }
    return true;
}
// Shrinks (removes) row `index`, which the caller has already confirmed is
// empty. A row is contiguous, so looping removeDesktopAtOrTail at the same
// boundary `rowLen` times closes the row-sized gap correctly on its own
// (each call's own internal shift takes care of it) -- no separate pre-shift
// needed, unlike shrinkColumn below.
function shrinkRow(index) {
    const cols = workspace.desktopGridWidth;
    const rowStart = index * cols;
    const rowLen = Math.min(cols, workspace.desktops.length - rowStart);
    for (let i = 0; i < rowLen; i++) {
        removeDesktopAtOrTail(rowStart);
    }
    workspace.desktopGridHeight = workspace.desktopGridHeight - 1;
}
// Shrinks (removes) column `index`, which the caller has already confirmed
// is empty. A column is strided, so this cannot reuse removeDesktopAt's
// single-boundary loop the way shrinkRow does (that would shift content
// across row boundaries incorrectly). Instead: first close each row's own
// internal gap in isolation (window reassignment only, capturing `cols`
// once so every row's math stays consistent even as later removals shrink
// the array), which leaves each row's own last slot vacated; then physically
// remove those now-vacated slots, from the LAST row to the FIRST (mirroring
// growColumn's insertion order) so each target index is still valid when
// its turn comes.
function shrinkColumn(index) {
    const cols = workspace.desktopGridWidth;
    const rows = workspace.desktopGridHeight;
    const windows = workspace.windowList();
    for (let r = 0; r < rows; r++) {
        const rowStart = r * cols;
        const rowLen = Math.min(cols, workspace.desktops.length - rowStart);
        if (rowLen <= index + 1) {
            continue; // ragged row that doesn't reach past the target column
        }
        shiftWindowsBy(windows, workspace.desktops, [rowStart + index + 1, rowStart + rowLen - 1], -1);
    }
    for (let r = rows - 1; r >= 0; r--) {
        const rowStart = r * cols;
        const rowLen = Math.min(cols, workspace.desktops.length - rowStart);
        if (rowLen <= index) {
            continue; // ragged row that never had this column at all
        }
        removeDesktopAtOrTail(rowStart + rowLen - 1);
    }
}
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
function updateLayout() {
    if (updating) {
        pendingRerun = true;
        return;
    }
    updating = true;
    try {
        runLayoutPass(0);
    }
    finally {
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
function runLayoutPass(depth) {
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
    }
    else if (rows >= 2 && isAllEmpty(getRow(1), windows) && !config.keepEmptyMiddleDesktops) {
        shrinkRow(0);
        runLayoutPass(depth + 1);
        return;
    }
    if (!isAllEmpty(getRow(rows - 1), windows)) {
        if (growRow(false, config.maxDesktops)) {
            runLayoutPass(depth + 1);
            return;
        }
    }
    else if (rows >= 2 && isAllEmpty(getRow(rows - 2), windows) && !config.keepEmptyMiddleDesktops) {
        shrinkRow(rows - 1);
        runLayoutPass(depth + 1);
        return;
    }
    if (!isAllEmpty(getColumn(0), windows)) {
        if (growColumn(true, config.maxDesktops)) {
            runLayoutPass(depth + 1);
            return;
        }
    }
    else if (cols >= 2 && isAllEmpty(getColumn(1), windows) && !config.keepEmptyMiddleDesktops) {
        shrinkColumn(0);
        runLayoutPass(depth + 1);
        return;
    }
    if (!isAllEmpty(getColumn(cols - 1), windows)) {
        if (growColumn(false, config.maxDesktops)) {
            runLayoutPass(depth + 1);
            return;
        }
    }
    else if (cols >= 2 && isAllEmpty(getColumn(cols - 2), windows) && !config.keepEmptyMiddleDesktops) {
        shrinkColumn(cols - 1);
        runLayoutPass(depth + 1);
        return;
    }
}
function onWindowAdded(win) {
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
