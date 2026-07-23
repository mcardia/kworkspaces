# KWorkspaces — KWin script (dynamic desktop grid)

A KWin 6 script that keeps exactly one empty desktop margin on every side — up, down,
left, and right — of whatever's occupied: move a window onto an edge and a new empty
row/column appears there; move the window away (or close it) and switch away, and the
now-empty margin is pruned automatically.

Written in **TypeScript** and compiled to a single `main.js` (KWin's QJSEngine — no
modules). Originally based on
[`maurges/dynamic_workspaces`](https://github.com/maurges/dynamic_workspaces)
(BSD-3-Clause); this is a clean-room rewrite of that behavior, later generalized from a
single dynamic row to a full 2D grid.

## Features

- Always exactly one empty row above, one below, one column to the left, and one to the
  right of whatever is occupied; the grid never shrinks below 1 row × 1 column.
- Opening or moving a window onto any of the 4 edges grows a new empty row/column there.
- Switching desktops (in any direction) or moving a window prunes an edge once it **and**
  the row/column behind it are both empty — this floor rule holds regardless of config,
  and is what keeps the grid from oscillating (growing and immediately re-shrinking the
  same margin).
- **Keep empty desktops between occupied ones**: once an edge and the layer behind it
  are both empty, off (default) shrinks the edge back down immediately; on leaves any
  extra empty margin alone once it's been created, rather than shrinking it back. This is
  a reformulation for a 2D grid, not an exact behavioral clone of a single dynamic row.
- **Maximum desktops** safety cap (default 20): growth requests beyond it are silently
  dropped rather than erroring, without blocking the other 3 edges from growing/shrinking
  normally.
- Windows that are hidden from the pager (`skipPager`) or pinned to all desktops
  (`onAllDesktops`) are ignored for emptiness checks and never trigger a new desktop.
- Removing a desktop never breaks KWin 6's pager-switch animation: the script always
  physically removes the actual last desktop, shifting content out of the way first,
  rather than removing a desktop in the middle directly. Growing, by contrast, inserts
  new desktops directly at their target position — KWin 6 was found to support this
  cleanly, with no equivalent animation concern for creation.

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

Re-running `./install.sh` on an already-enabled install disables the script before
upgrading its files, then re-enables it — upgrading the files alone does not force an
already-running instance to reload the new code.

## Configuration

System Settings → Window Management → KWin Scripts → **KWorkspaces** → configure:

| Key | Default | Meaning |
|-----|---------|---------|
| `keepEmptyMiddleDesktops` | false | Once an edge and the layer behind it are both empty, leave the extra margin alone instead of shrinking it back down. |
| `maxDesktops` | 20 | Safety cap on total desktop count; further growth is silently ignored once reached. Only blocks *future* growth — an existing install already over the cap when upgrading is not retroactively pruned down. |

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
- Removing a desktop in the middle was verified to leave desktop count and window
  placement correct, driven programmatically via KWin's D-Bus interface during
  development. Whether the pager-switch animation itself plays smoothly was not
  independently confirmed by visual observation — worth a quick look next time you
  purge a middle row/column, though the mechanism is a faithful port of the upstream fix.
- Enabling this on a session that has never used more than one row of desktops will
  immediately start growing rows above/below existing windows too, not just columns —
  this is intentional (full 2D behavior in all 4 directions), not a bug, but it does mean
  your desktop count and pager layout will visibly change the first time it runs.
- New desktops are not renamed to reflect their row/column position (unlike some
  reference implementations of this idea), so the pager can show multiple desktops with
  the same default name (e.g. several "Desktop 1"s) once the grid grows past one row or
  column. This is cosmetic only — each is still a distinct, correctly-tracked desktop —
  but worth knowing if the names look confusing. A future enhancement could rename
  desktops to reflect grid position, matching what some reference scripts do.
- Interacting with KDE Activities was not tested; `isEmptyDesktop`'s emptiness check has
  no Activity-awareness (windows are checked for presence only, not whether a desktop is
  an Activity's own "last visited" desktop), and the wider 4-edge trigger model checks
  layout more often than the original single-row design did, so this pre-existing blind
  spot is now exercised more frequently if Activities are in use.
