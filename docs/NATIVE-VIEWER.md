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

The helper resolves the current MSIX installation and registered application ID
dynamically. It uses Windows package activation, preserving the identity required
by the updater and Windows restart integration. Its shortcut icon is copied
locally, so shortcuts do not depend on an old WindowsApps version path.
The shortcut manifest is `.local/native-integration/shortcuts.json`.

If an ordinary desktop is already running, finish work, exit it normally, then
use the project entry. A startup-only debug flag cannot be added by activation.
An attached running desktop continues normally and is activated on repeat launch.

The helper selects an explicit nonzero loopback debugging port. A literal
`--remote-debugging-port=0` changes Chromium's automation state. Updating the
launcher changes the next cold launch; Retry or activating an already running
process cannot replace its startup flags.

This is Chromium's built-in behavior, as recorded in
[runtime_features.cc](https://github.com/chromium/chromium/blob/main/content/child/runtime_features.cc).
The launcher does not override browser properties or alter account/network data.

No Windows sign-in task, registry launch hook, official shortcut rewrite, or
installed file patch is used.

The optional `npm.cmd run plugin:install` layer adds native skill-menu entries
and MCP visibility/settings tools. It does not replace the launcher or create an app-start
hook. See [the control plugin guide](CONTROL-PLUGIN.md).

## Panel behavior

- Auto chooses each item's nonempty summary, otherwise its raw content.
- Summary and Raw are explicit choices through `viewer_configure`; a missing
  source has an English empty state.
- The header contains only an accent indicator, `Thinking` / `Done` label, and
  `‹ n/m turns ›`. The arrows and selector browse history; the label and indicator
  keep following the current turn's running state.
- The indicator follows the Codex accent unless overridden through MCP settings.
- Multiple reasoning items within a turn are joined in order.
- Turn navigation retains your selected historical turn while new text arrives.
- Following scrolls to the end; scrolling up pauses it.
- Drag the top edge down to one header line and one reasoning line. Drag further
  to show just the indicator beside one reasoning line, with status text and
  history controls hidden. Dragging up restores them without changing history
  selection or discarding text.
- The resize edge is invisible and reserves no separate row. Double-click resets
  height; arrow keys work when the edge is focused.
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
| `package-identity-not-verified`               | Activated process does not belong to the expected package |
| `capture-unavailable`                         | Desktop started but no verified listener appeared         |
| `startup-exited`                              | Activated desktop exited before its listener appeared     |
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

The unit suite uses synthetic fixtures, fake callbacks, and non-activating Windows
interop probes. It verifies command parsing, composer selection, local fixture
streams, update guards, and activation channel behavior. It does not need an
installed desktop or account and never calls `ActivateApplication`.
Run it with ordinary Windows user permissions; restricted sandboxes can block
system listener queries and out-of-process COM creation.

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

To run the controls regression without attaching to a desktop, use:

```powershell
npm.cmd run validate:controls:isolated
npm.cmd run validate:composer:isolated
```

This starts a hidden Edge instance with a new temporary profile, exercises the
same fixture, and closes only that owned browser. Native suggestion rows, ARIA
listboxes, and cmdk menus receive real Tab and Enter key input through CDP.
The regression checks that selection applies once, clears the command, retains
editor focus, and never reaches the fixture's submit handler. It also covers an
earlier native listener inserting a control skill chip during the same key press.
The composer check also verifies that exporting and importing the in-memory
adapter cache retains reasoning items absent from the native conversation.

To compare the old and current startup flags in isolated blank Edge windows:

```powershell
npm.cmd run validate:launch:isolated
```

This separate check uses ordinary windows positioned off screen, since headless
mode would itself enable automation. It verifies that a literal port zero sets
`navigator.webdriver` while the helper's explicit nonzero port does not. It uses
temporary profiles, visits no website, and leaves the running Codex untouched.

The current implementation has also been checked with local fixed-text provider
streams in an isolated desktop profile. That development evidence is not bundled:
the public repository excludes real session diagnostics, extracted application
bundles, local runtime profiles, and investigation artifacts.

`npm.cmd run viewer:update -- <verified-port>` hot-updates an already attached
viewer while retaining its native managers, complete in-memory history, and view
preferences. It verifies the
installed build and endpoint owner first. It does not open a model turn.

## Remove

Hide the panel with `/cot off` if you want capture to continue. For a terminal
helper, Ctrl+C performs normal component cleanup; do not use it to stop Codex.

Remove owned shortcuts, exit Codex normally, and use the official entry for an
ordinary launch. A force-killed helper can leave the component until Codex exits.
The debug endpoint closes with the desktop process.
