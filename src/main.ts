// Entry point: wires KWin signals to the desktop-management logic in desktops.ts.

function onWindowAdded(win: KWinWindow | null | undefined): void {
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
