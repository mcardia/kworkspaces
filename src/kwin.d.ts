// Ambient declarations for the subset of the KWin 6.7 desktop-scripting API used by
// this script. KWin runs on QJSEngine; these globals/objects are provided at runtime,
// not imported. Findings below were verified empirically against a live Plasma
// 6.7.2/Wayland session (a throwaway debug script relaying logs via callDBus to an
// external listener), not assumed from the old Plasma 5/6 vendor script or docs.

interface Signal0 {
    connect(callback: () => void): void;
    disconnect(callback: () => void): void;
}

interface Signal1<A> {
    connect(callback: (arg: A) => void): void;
    disconnect(callback: (arg: A) => void): void;
}

// Verified live: { objectName: "", id: "<uuid>", x11DesktopNumber: <n>, name: "<n>" }.
// x11DesktopNumber is 1-based (Desktop 1 -> 1, Desktop 4 -> 4) -- the old vendor
// script's header comment ("Desktop numbers are from zero") is WRONG for this
// property; only the array index into workspace.desktops is 0-based. The same
// desktop object instance is returned across repeated reads and across desktop
// switches (checked with === after three live switches), so identity comparison
// (the old script's `==`/`===` assumption) still holds on KWin 6.7.
interface KWinVirtualDesktop {
    readonly objectName: string;
    readonly id: string;
    readonly x11DesktopNumber: number;
    readonly name: string;
}

// Verified live: onAllDesktops windows report desktops = [] (EMPTY), not one
// entry per existing desktop. This means emptiness/containment checks against a
// specific desktop naturally exclude onAllDesktops windows with no special-casing
// needed -- confirmed by toggling onAllDesktops on a real window and observing
// desktops flip between a one-entry array and [].
interface KWinWindow {
    desktops: KWinVirtualDesktop[];
    readonly desktopsChanged: Signal0;
    readonly skipPager: boolean;
    onAllDesktops: boolean;
    readonly caption: string;
}

interface KWinWorkspace {
    readonly desktops: KWinVirtualDesktop[];
    // Read-write: the vendor script's animation-fixup workaround (see desktops.ts)
    // assigns this directly to force KWin's pager-switch animation to replay.
    currentDesktop: KWinVirtualDesktop;
    // Verified live: fires with the OLD desktop (the one being switched away
    // from), not the new one -- confirmed across three separate live switches.
    readonly currentDesktopChanged: Signal1<KWinVirtualDesktop>;
    // Verified live (grid-expansion plan Phase 1): position is a genuine insertion
    // index, not merely "append when equal to length" -- calling
    // createDesktop(0, name) while other desktops exist actually inserts a new
    // desktop at raw index 0, renumbering every existing desktop's
    // x11DesktopNumber upward by one, while their object identity (and .id)
    // is preserved unchanged. name is applied as given.
    createDesktop(position: number, name: string | undefined): void;
    // Verified live: takes the desktop OBJECT to remove, not an index or id.
    removeDesktop(desktop: KWinVirtualDesktop): void;
    windowList(): KWinWindow[];
    // No null/undefined window was observed from windowAdded in this session,
    // but the type stays nullable and the old script's null guard is kept
    // defensively per the rewrite plan -- costs nothing to keep.
    readonly windowAdded: Signal1<KWinWindow | null | undefined>;

    // --- Grid-dimension API (verified live, grid-expansion plan Phase 1) ---
    // Both exist and are read-write numbers. Writing either is a PURE metadata
    // operation: it never creates or removes desktop objects on its own (tested
    // by setting desktopGridHeight with desktop count held fixed -- count never
    // changed). desktopGridWidth is auto-derived from desktop count and
    // desktopGridHeight (width = ceil(count / height)): setting
    // desktopGridHeight alone recomputes width automatically, and changing
    // desktop count (creating/removing desktops) with height held fixed
    // recomputes width automatically too. In practice this means only
    // desktopGridHeight (rows) needs to be written explicitly; width never
    // needs a direct assignment.
    desktopGridWidth: number;
    desktopGridHeight: number;
    // NOT verified to exist: desktopGridWidthChanged/desktopGridHeightChanged
    // were expected (per this plan's pre-Phase-1 research) but
    // `typeof workspace.desktopGridWidthChanged` / `...HeightChanged` were both
    // "undefined" live on this KWin 6.7.2 build -- no such signals exist here
    // (or not under these names). Do not declare or wire them; rely on the
    // signals already used (windowAdded/desktopsChanged/currentDesktopChanged)
    // to trigger re-checks instead.
}

declare const workspace: KWinWorkspace;
declare function readConfig(key: string, defaultValue?: unknown): unknown;

// --- Additional findings from the grid-expansion plan's Phase 1 (verified live) ---
//
// Row-major mapping: with desktopGridHeight set to 2 (desktopGridWidth auto-derived
// to 2 for a 4-desktop grid), workspace.desktops[i].x11DesktopNumber increased
// strictly with i in the same order predicted by (row, col) = (floor(i / cols),
// i % cols) -- confirmed the row-major convention this plan's design assumes.
//
// Identity stability under append + window reassignment: appending N new
// desktops at the tail (via createDesktop at workspace.desktops.length, looped)
// left every pre-existing desktop object at its original array index, unchanged
// (=== stable). Reassigning a real window's .desktops to one of the newly
// appended desktops (a plain window move, not a desktop removal) produced no
// pager-animation glitch and did not require the animationFixup dance --
// confirmed that dance is specific to desktop removal, not needed for growth.
//
// Identity stability under a LOOPED shift-then-remove-last dance: calling the
// existing removeDesktopAt-style dance 3 times in a row at the same boundary
// index (to remove a whole 3-desktop chunk) left every desktop before that
// boundary === stable and in the same order afterward, with the final desktop
// count exactly matching the pre-removal baseline minus 3.
//
// Signal dispatch is SYNCHRONOUS: reassigning a window's .desktops to a
// genuinely different desktop fired that window's desktopsChanged handler
// before the reassigning script's very next statement executed (observed via
// interleaved log ordering) -- a naive re-entrancy guard that assumes nested,
// same-call-stack re-entry (rather than a deferred/queued callback) is correct
// for this KWin build.
