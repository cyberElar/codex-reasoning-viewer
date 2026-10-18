# Codex Reasoning Viewer

[简体中文](README.zh-CN.md)

A local reasoning panel above the Codex Desktop composer on Windows. Read complete
reasoning summaries, follow incoming text, and revisit earlier turns without
changing the installed Codex application.

This is an **experimental, unofficial companion**. It uses private desktop
interfaces and supports only explicitly verified builds. The reasoning path uses
the native adapter; an optional plugin adds MCP controls and slash-menu skills.
It does not modify the ASAR, replace the application directory, or alter model settings.

## Features

- **Auto / Summary / Raw:** prefer each item's complete summary, or fall back to
  its readable raw reasoning. You can also choose either source explicitly.
- **Streaming and scrolling:** append incoming deltas, follow the latest text,
  and pause following when you scroll up.
- **Turn history:** keep multiple reasoning items together within a turn, browse
  earlier turns, and return to the latest without losing already observed items.
- **Resizable panel:** drag the top edge down to one header line plus one reasoning line,
  then further to a single line with the indicator beside the reasoning text.
  Drag up to restore the header and history controls; double-click to reset.
- **Minimal English header:** an accent-colored indicator, `Thinking` / `Done`,
  and `‹ n/m turns ›` navigation. Status follows the current turn even while you
  browse history. The indicator follows the Codex accent by default.
- **MCP settings:** choose the display source, scroll following, collapsed state,
  height, and indicator color through tools or startup environment configuration.
- **Local controls:** `/cot`, `/cot on`, and `/cot off`.
  Hiding removes the entire panel without a placeholder or reopen button, while
  the helper and history capture keep running. Use `/cot on` to reopen.
- **Background launcher:** optional desktop and Start Menu shortcuts start Codex
  and the hidden helper together. Repeated launches activate the existing window.
- **Build guard:** unknown or changed desktop builds start normally with the
  viewer disabled.

The interface uses English labels. It displays only text that Codex
actually receives. Encrypted reasoning without a readable summary remains
unavailable; the viewer does not decrypt it or request additional model output.

## Requirements and supported build

- Windows 11.
- Node.js 24 or newer; locally verified with Node.js 24.15.0.
- The installed Windows `OpenAI.Codex` package with a verified fingerprint.

| Version field                    | Verified value   |
| -------------------------------- | ---------------- |
| Windows MSIX package             | `26.1013.4894.0` |
| Application metadata inside ASAR | `26.1013.40934`  |

These are different version fields. The guard checks the internal application
version and three renderer asset hashes. See
[`supported-builds.json`](src/native/supported-builds.json).

Other operating systems and desktop builds are not verified. An application
update may disable the panel until the new internal interfaces are checked.

## Install and launch

Clone into a folder you intend to keep:

```powershell
git clone https://github.com/cyberElar/codex-reasoning-viewer.git
Set-Location .\codex-reasoning-viewer
npm.cmd ci
npm.cmd run shortcuts:install
```

The installer creates a `Codex` shortcut on your desktop and in your user Start
Menu. It chooses an alternative name if an unrelated shortcut already uses that
name. The shortcuts reference this checkout and your Node executable, so recreate
them after moving the folder or changing the Node installation.

If Codex is already running from its ordinary official entry, finish your work
and exit it normally once. Then open the **new shortcut**. Subsequent launches
start the helper invisibly and keep it running for the desktop process's lifetime.
The launcher never closes an existing Codex process to attach.

You can also double-click `Launch Codex.vbs` for a hidden launch, or use a terminal:

```powershell
npm.cmd start
```

`Launch Native Viewer.cmd` is the terminal launcher for troubleshooting.

**Automatic loading applies to the new shortcuts.** Cold-starting through the
original official application entry or a previously pinned official icon bypasses
the loader. This project does not add a Windows sign-in startup task or hook every
official launch path. The debug endpoint must be enabled when Codex starts.

## Use

Open a local conversation containing reasoning. The panel appears above its
composer; the companion follows the active visible conversation.

| Action                            | Result                                           |
| --------------------------------- | ------------------------------------------------ |
| `/cot`                            | Toggle panel visibility                          |
| `/cot on`                         | Show the panel                                   |
| `/cot off`                        | Hide the panel; keep capturing history           |
| `‹ n/m turns ›`                   | Browse turns with arrows or the turn selector    |
| Last turn in the selector         | Return to the latest turn                        |
| `viewer_configure` MCP tool       | Change source, following, collapse, height/color |
| Drag top edge / double-click edge | Resize / reset the panel                         |

Enter a local command alone on one line, with the caret at its end, then press
Tab or Enter. The local handler applies it immediately and clears the command,
without creating a chat message or starting a model turn.
The base launcher handles typed commands; the optional plugin adds native skill-menu entries.
`show`, `hide`, and `toggle` are accepted aliases. Invalid `/cot` arguments stay in
the composer with a usage hint.

Summary availability depends on the provider and the actual turn. Auto mode makes
the choice separately for each reasoning item before joining the turn's items.
The panel does not truncate text to a character limit.

History is retained in memory for the helper's lifetime and hydrated from records
already loaded by Codex. Older paginated records appear when the desktop loads
them. The viewer does not independently fetch every session or persist a second
copy of reasoning text.

## Optional MCP and slash-menu controls

```powershell
npm.cmd run plugin:install
```

This installs a local plugin through the official Codex CLI. It provides the
`cot`, `cot-on`, and `cot-off` skills in the native slash menu, plus six MCP tools:
`viewer_show`, `viewer_hide`, `viewer_toggle`, `viewer_status`, `viewer_settings`,
and `viewer_configure`. They return only control state and settings, never
reasoning text.

For example, `viewer_configure` with `{"mode":"raw","indicatorColor":"auto"}`
selects raw text and follows Codex's accent color. All fields are optional;
unmentioned fields keep their saved values. See the
[configuration guide](docs/CONTROL-PLUGIN.md#settings-and-startup-configuration)
for MCP `env` startup settings.

In the supported desktop, the attached local handler identifies this plugin's
exact skill paths. Highlight `cot`, `cot-on`, or `cot-off`, then press Tab or
Enter, or click the entry: the control takes effect on that selection.
If a native keyboard listener inserts a skill chip first, the local handler
clears and executes it during the same key press. Other skill chips and mixed
prose/attachments retain native behavior.
In a client without that attached handler, using the skill follows the ordinary
model/tool workflow instead.

**Keep using the project launcher.** MCP servers start with a session, after
Chromium initialization; they cannot add a missing debug port to an already
running desktop. No app-start hook is installed. The existing helper still owns
reasoning capture, rendering, and history.

The generated package and path bindings stay in ignored `.local/control-plugin/`.
After installation or an update, start a fresh conversation or normally reopen
Codex if its current skill catalog has not refreshed. See
[control plugin details](docs/CONTROL-PLUGIN.md).

To remove only the optional controls: `npm.cmd run plugin:remove`.

## How it works

The Node launcher discovers the installed package dynamically, verifies the build,
and activates its registered Windows application with a temporary, random
**loopback CDP port**. It preserves package identity and passes an explicit
nonzero port so the ordinary window does not acquire Chromium's automation state.
Short-lived conditional probes capture existing conversation managers without
pausing the renderer. The probes are then removed.

The companion uses those managers' local notifications and cached snapshots. A
plain DOM panel mounts in the above-composer portal. There is no second app-server,
model call, database write, or installed application patch.

See [architecture](docs/ARCHITECTURE.md) and the
[detailed guide](docs/NATIVE-VIEWER.md) for lifecycle, compatibility, and validation.

## Local data and security

Reasoning text stays in renderer memory. The height and visibility preferences
use this viewer's own localStorage keys. `.local/` contains launch status,
shortcut manifests, copied shortcut icons, and test reports; status may include
local paths and thread identifiers. It is excluded from Git.

CDP grants control of the running renderer. The launcher binds it to `127.0.0.1`
on a random port and verifies the owning desktop process. Keep the endpoint local;
do not expose or forward it. Local software with access to that endpoint can
control the renderer. The endpoint ends when that desktop process exits.

The companion restores its wrapped methods and removes its own listeners/DOM
during normal cleanup. A forcibly terminated helper may leave the in-memory
panel until Codex exits.

## Develop

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run format:check
npm.cmd test
```

The automated tests use synthetic ASAR files, local streams, and fake activation
callbacks. They do not require a Codex installation, read personal sessions, or
call external models. Windows CI runs these checks on Node.js 24.

The two optional renderer regression scripts require a verified existing CDP
port. They use isolated iframe fixtures, not real user turns:

```powershell
npm.cmd run validate:composer -- <port>
npm.cmd run validate:controls -- <port>
```

For changes to an already attached viewer, `npm.cmd run viewer:update -- <port>`
preserves its captured managers and replaces only the in-memory component.
Developer operations and version-adaptation requirements are documented in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Remove

```powershell
npm.cmd run shortcuts:remove
```

This removes only shortcuts still owned by this project. Exit Codex normally,
then use its original official entry for an ordinary launch. The project folder
can be removed afterward. No application reinstall or directory-link repair is
required.

## License

[MIT](LICENSE). OpenAI and Codex are trademarks of their respective owners. This
project is not affiliated with or endorsed by OpenAI. No Codex application
binaries, extracted bundles, user sessions, or credentials are distributed here.
