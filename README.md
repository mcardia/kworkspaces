# KWorkspaces — KWin script (dynamic trailing desktop)

A KWin 6 script that keeps exactly one empty desktop at the end: move a window onto it
and a new empty one appears; move the window away (or close it) and switch past it, and
the now-empty trailing desktops are pruned automatically.

Written in **TypeScript** and compiled to a single `main.js` (KWin's QJSEngine — no
modules). Originally based on
[`maurges/dynamic_workspaces`](https://github.com/maurges/dynamic_workspaces)
(BSD-3-Clause); this is a clean-room rewrite of that behavior.

## Features

- Always exactly one empty desktop at the end; never drops below 2 desktops total.
- Opening or moving a window onto the last desktop creates a new trailing one.
- Switching to an earlier desktop prunes empty desktops behind it, right-to-left, down
  to (not including) the desktop you switched to.
- **Keep empty desktops between occupied ones**: when off (default), the purge skips
  non-empty desktops but keeps scanning past them; when on, the purge stops at the
  first non-empty desktop found.
- Windows that are hidden from the pager (`skipPager`) or pinned to all desktops
  (`onAllDesktops`) are ignored for emptiness checks and never trigger a new desktop.
- Removing a desktop never breaks KWin 6's pager-switch animation: the script shifts
  windows out of the way and always physically removes the last desktop, replaying a
  switch around it, rather than removing a desktop in the middle directly.

## Build

```sh
npm install
npm run build      # tsc -> pkg/contents/code/main.js
npm run check      # tsc --noEmit (type-check only)
```

Sources live in `src/` (`kwin.d.ts` ambient types, `config.ts`, `desktops.ts`,
`main.ts`). The KWin package is `pkg/` (`metadata.json`, `contents/`). The entry point
compiles to `contents/code/main.js` (the path KWin/kpackagetool6 require) and is
committed so installation works without Node.

## Install / uninstall

```sh
./install.sh              # build, install (kpackagetool6), enable in kwinrc, reload KWin
./install.sh --no-build   # install the committed build without recompiling
./install.sh --uninstall  # same as ./uninstall.sh
./uninstall.sh            # disable + remove
```

## Configuration

System Settings → Window Management → KWin Scripts → **KWorkspaces** → configure:

| Key | Default | Meaning |
|-----|---------|---------|
| `keepEmptyMiddleDesktops` | false | Stop the purge at the first non-empty desktop found instead of skipping past it too. |

## Notes

- Requires KWin 6 (developed on Plasma 6.7, Wayland). No Plasma 5 compatibility.
- Coexists with `padding` (this repo's gap script): verified live that maximizing a
  window on a KWorkspaces-managed desktop still gets padding's gap, and both scripts
  settle cleanly (no errors) when the window is closed.
- Like the original script, this doesn't live well with other scripts that also create
  or remove desktops — mix at your own risk.
- Multi-monitor "separate virtual desktops per screen" was not verified live (this was
  developed and tested on a single-monitor session) — treat as unverified rather than
  supported if you use that mode.
