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

function isDesktopInList(desktops: KWinVirtualDesktop[], target: KWinVirtualDesktop): boolean {
    return desktops.indexOf(target) !== -1;
}

function isEmptyDesktop(desktop: KWinVirtualDesktop, windows: KWinWindow[]): boolean {
    return !windows.some(function (win) {
        return !win.skipPager && isDesktopInList(win.desktops, desktop);
    });
}

function isAllEmpty(desktops: KWinVirtualDesktop[], windows: KWinWindow[]): boolean {
    return desktops.every(function (d) {
        return isEmptyDesktop(d, windows);
    });
}

// Row-major slicing. Tolerates a ragged last row (desktop count not an exact
// multiple of desktopGridWidth), which can occur transiently mid-resize.
function getRow(index: number): KWinVirtualDesktop[] {
    const cols = workspace.desktopGridWidth;
    const count = workspace.desktops.length;
    if (index < 0 || index * cols >= count) {
        return [];
    }
    const start = index * cols;
    const end = Math.min(count, start + cols);
    return workspace.desktops.slice(start, end);
}

function getColumn(index: number): KWinVirtualDesktop[] {
    const cols = workspace.desktopGridWidth;
    const rows = workspace.desktopGridHeight;
    const count = workspace.desktops.length;
    if (index < 0 || index >= cols) {
        return [];
    }
    const result: KWinVirtualDesktop[] = [];
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
function shiftWindowsBy(windows: KWinWindow[], allDesktops: KWinVirtualDesktop[], range: [number, number], offset: number): void {
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
function removeLastDesktopSafely(): void {
    animationFixup = true;
    try {
        const last = workspace.desktops[workspace.desktops.length - 1];
        const current = workspace.currentDesktop;
        const index = workspace.desktops.indexOf(current);
        const target =
            index + 1 < workspace.desktops.length || index === -1
                ? workspace.desktops[index + 1]
                : current;

        workspace.currentDesktop = target;
        workspace.removeDesktop(last);
        workspace.currentDesktop = current;
    } finally {
        animationFixup = false;
    }
}

// Removes the desktop conceptually "at" boundary without ever removing a
// middle desktop directly: shifts windows out of its way, then removes the
// actual last desktop via removeLastDesktopSafely. Only valid for a boundary
// strictly before the current last index -- callers that have already
// arranged for their target to BE the last index should call
// removeLastDesktopSafely directly instead (see shrinkRow/shrinkColumn).
function removeDesktopAt(boundary: number): boolean {
    const allDesktops = workspace.desktops;
    if (allDesktops.length - 1 <= boundary) {
        return false;
    }
    shiftWindowsBy(workspace.windowList(), allDesktops, [boundary, allDesktops.length - 1], -1);
    removeLastDesktopSafely();
    return true;
}

// Removes whichever of the two (boundary === current tail, or not) applies.
function removeDesktopAtOrTail(boundary: number): void {
    if (boundary === workspace.desktops.length - 1) {
        removeLastDesktopSafely();
    } else {
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
function growRow(atTop: boolean, maxDesktops: number): boolean {
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
function growColumn(atLeft: boolean, maxDesktops: number): boolean {
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
function shrinkRow(index: number): void {
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
function shrinkColumn(index: number): void {
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
