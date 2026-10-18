# Native viewer guide

Start with [the README](../README.md) or [中文说明](../README.zh-CN.md).
This guide covers operational details of the Windows companion.

## Entry points

| Entry                                        | Behavior                                           |
| -------------------------------------------- | -------------------------------------------------- |
| Project desktop / Start Menu shortcut        | Hidden Node helper and official desktop            |
| `Launch Codex.vbs`                           | Hidden helper using the supplied Node path or PATH |
| `Launch Native Viewer.cmd` / `npm.cmd start` | Same launcher with terminal output                 |
| Original official entry                      | Ordinary startup; bypasses the companion           |

Install/remove shortcuts with `npm.cmd run shortcuts:install` and
`npm.cmd run shortcuts:remove`. The installer uses the registered user Desktop and
Start Menu folders, including redirected desktops. It will not overwrite an
unrelated shortcut.

The helper resolves the current MSIX installation dynamically. Its shortcut icon
is copied locally, so shortcuts do not depend on an old WindowsApps version path.
The shortcut manifest is `.local/native-integration/shortcuts.json`.

If an ordinary desktop is already running, finish work, exit it normally, then
use the project entry. A startup-only debug flag cannot be added by activation.
An attached running desktop continues normally and is activated on repeat launch.

No Windows sign-in task, registry launch hook, official shortcut rewrite, or
installed file patch is used.

The optional `npm.cmd run plugin:install` layer adds native skill-menu entries
and MCP visibility tools. It does not replace the launcher or create an app-start
hook. See [the control plugin guide](CONTROL-PLUGIN.md).

## Panel behavior

- Auto chooses each item's nonempty summary, otherwise its raw content.
- Summary and Raw are explicit choices; a missing source has a visible empty
  state and the source switch stays available.
- Multiple reasoning items within a turn are joined in order.
- Turn navigation retains your selected historical turn while new text arrives.
- Following scrolls to the end; scrolling up pauses it.
- Drag the top grip to resize. Double-click resets it; arrow keys work when the
  grip is focused.
- Hide removes the entire panel from the DOM, with no button or placeholder.
  The helper and history stay active. `/cot on` reopens it.
- `/cot`, `/cot on`, and `/cot off` perform the same local visibility controls.

Use commands as a single text block with the caret at its end. Shift/Alt+Enter,
IME composition, multiline drafts, attachments, unrelated slash commands, and the
native Stop button retain their original handling. Reserved `/cot` commands with
unknown arguments are consumed locally and show usage without being sent.

History comes from loaded native records and observed notifications. Older
pagination appears when Codex loads it. Closing the helper discards its in-memory
cache; a later launch hydrates from whatever records the desktop has loaded.

## Troubleshoot

Check `.local/native-launch/status.json` locally before sharing a redacted report.

| State                                         | Meaning / next step                                       |
| --------------------------------------------- | --------------------------------------------------------- |
| `visible`                                     | A panel is mounted and visible                            |
| `hidden-by-user`                              | Capture remains active; use `/cot on` to reopen           |
| `attached`                                    | Connected; no visible reasoning panel yet                 |
| `waiting-for-window`                          | Waiting for an eligible composer renderer                 |
| `waiting-for-manager`                         | Waiting for a native manager method to execute            |
| `requires-closed-desktop`                     | Normal exit/reopen through the project entry needed       |
| `disabled-for-build`                          | Version/assets not verified; official app starts normally |
| `capture-unavailable`                         | Desktop started but no endpoint banner was obtained       |
| `endpoint-not-verified`                       | Port ownership did not pass verification                  |
| `connection-unavailable` / `attachment-error` | Inspect the short error locally                           |

A missing summary does not by itself indicate a capture failure. If both
`summaryChars` and `rawChars` are zero for a reasoning item, there may be no readable
text for that turn. Encrypted content cannot be recovered by switching modes.
The companion does not change the provider's summary request options.

If a window predates a helper update, its old helper may still report `attached`
for a hidden panel. `panel.enabled: false` identifies user-hidden UI. A normal
launch loads the current helper.

## Developer validation

```powershell
npm.cmd run check
npm.cmd run format:check
npm.cmd test
```

The unit suite uses synthetic fixtures and fake callbacks. It verifies command
parsing, composer selection, local fixture streams, update guards, and activation
channel behavior. It does not need an installed desktop or account.

Optional renderer regressions:

```powershell
npm.cmd run validate:composer -- <verified-port>
npm.cmd run validate:controls -- <verified-port>
```

The composer fixture verifies empty/hidden portals, streaming, same-turn item
retention, turn history, source modes, resizing, viewport clamping, and cleanup.
The controls fixture verifies local command consumption, submit buttons, unrelated
drafts, hidden history, preference restoration, complete hiding, exact skill paths,
native menu selection identity, and listener cleanup.
They create isolated iframes and storage and remove their fixtures afterward.
Reports go into `.local/native-runtime/`.

The current implementation has also been checked with local fixed-text provider
streams in an isolated desktop profile. That development evidence is not bundled:
the public repository excludes real session diagnostics, extracted application
bundles, local runtime profiles, and investigation artifacts.

`npm.cmd run viewer:update -- <verified-port>` hot-updates an already attached
viewer while retaining its native managers and view preferences. It verifies the
installed build and endpoint owner first. It does not open a model turn.

## Remove

Hide the panel with `/cot off` if you want capture to continue. For a terminal
helper, Ctrl+C performs normal component cleanup; do not use it to stop Codex.

Remove owned shortcuts, exit Codex normally, and use the official entry for an
ordinary launch. A force-killed helper can leave the component until Codex exits.
The debug endpoint closes with the desktop process.
