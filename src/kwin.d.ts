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
    // Verified live: position is the index to insert at (tested with
    // position = current length, which appends at the end); name is applied
    // as given.
    createDesktop(position: number, name: string | undefined): void;
    // Verified live: takes the desktop OBJECT to remove, not an index or id.
    removeDesktop(desktop: KWinVirtualDesktop): void;
    windowList(): KWinWindow[];
    // No null/undefined window was observed from windowAdded in this session,
    // but the type stays nullable and the old script's null guard is kept
    // defensively per the rewrite plan -- costs nothing to keep.
    readonly windowAdded: Signal1<KWinWindow | null | undefined>;
}

declare const workspace: KWinWorkspace;
declare function readConfig(key: string, defaultValue?: unknown): unknown;
