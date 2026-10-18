# Optional control plugin

The plugin is a thin control surface. The existing native helper still captures
reasoning, hydrates history, and renders the panel.

## Install

```powershell
npm.cmd ci
npm.cmd run plugin:install
```

The installer generates a package under `.local/control-plugin/`, gives its
marketplace a project-specific identity, and uses the official Codex plugin CLI
to install and enable it. It does not edit application files or create directory
links.

The generated `mcp.json` records the current Node executable and the project
server script as separate arguments. These machine paths are not committed.
Keep the project folder in place. After moving it or updating the plugin, rerun
the installer. A fresh conversation or normal desktop reopen may be needed for
the native skill catalog to refresh.

`npm.cmd run plugin:build` generates the local package without installing it.
The tracked `plugin/` folder is a template; use the installer so its MCP server
and machine-specific skill bindings are configured together.

## Native menu and local execution

The plugin provides `cot`, `cot-on`, and `cot-off` skills. The supported desktop
lists available plugin skills in its native slash menu.

With the viewer attached, highlight an entry and press Tab or Enter, or click
the entry. It applies immediately, clears the control text, and keeps focus in
the composer, without creating a chat message or starting a model turn.
The handler recognizes native suggestion rows as well as cmdk lists.
Native option titles are not unique;
the handler reads the option's version-bound React key and matches its exact
registered skill path. It respects the selected entry, rather than guessing
from its title.

If an earlier native keyboard listener inserts a `skillMention` first, the
handler executes and clears the registered control chip during the same Tab or
Enter key press. A single registered chip with whitespace or a valid `cot`
argument also works when already present in the composer. Foreign
skills, multiple chips, prose, attachments, multiline content, and IME composition
retain their normal behavior.

The installer obtains the actual cache path from the CLI and verifies skill file
contents before recording bindings. The helper refreshes those bindings while
running. Hot updates also load them.

Plain `/cot`, `/cot on`, `/cot off`, `/cot-on`, and `/cot-off` remain local
commands without the optional plugin.

In a client without the attached desktop handler, a skill is an ordinary
model/tool workflow. The skill's fallback instructions call the corresponding
MCP tool once. The plugin alone does not turn every compatible client's skill
invocation into a zero-model UI action.

## MCP tools

| Tool               | Operation                                     |
| ------------------ | --------------------------------------------- |
| `viewer_status`    | Read minimal connection/visibility state      |
| `viewer_show`      | Show the existing panel                       |
| `viewer_hide`      | Fully hide it while history capture continues |
| `viewer_toggle`    | Switch visibility                             |
| `viewer_settings`  | Read saved display settings                   |
| `viewer_configure` | Save and apply a validated settings patch     |

All tools except `viewer_configure` accept an empty argument object.
There are no reasoning resources,
prompt templates, arbitrary code arguments, or remote host parameters.

Before connecting, the controller checks saved PID/port values, the installed
application fingerprint, the running official desktop process, and TCP ownership.
Only loopback page endpoints for eligible composer pages are accepted. Tools
return connection state, visibility, and window count; they do not return session
IDs or reasoning bodies.

The stdio server's lifetime belongs to its MCP client/session. Stopping that
server does not stop the independent native helper.

## Settings and startup configuration

The toolbar contains only an indicator, `Thinking` / `Done`, and `‹ n/m turns ›`.
The indicator and label follow the current turn even when you browse history.
At the smallest dragged height, the panel becomes a single line with the
indicator beside the reasoning text. Status text and history controls return
when you expand it; history and the selected turn remain intact.
Settings are managed by MCP, not by controls in that toolbar.

| Field            | Values                                                         | Default |
| ---------------- | -------------------------------------------------------------- | ------- |
| `mode`           | `auto`, `summary`, `raw`                                       | `auto`  |
| `follow`         | Boolean; default scrolling preference                          | `true`  |
| `collapsed`      | Boolean; keep the header and hide the text body                | `false` |
| `height`         | Integer from 18 to 1600 pixels, or `null` for automatic sizing | `null`  |
| `indicatorColor` | `auto` or a 3/4/6/8-digit hex color                            | `auto`  |

For example:

```json
{
  "mode": "raw",
  "follow": true,
  "collapsed": false,
  "indicatorColor": "auto"
}
```

Pass that object to `viewer_configure`. It saves only the supplied fields and
applies them to attached windows. If the desktop is closed, the settings are still
saved and will be applied when the helper attaches. `viewer_settings` reads them
without needing a running desktop.

Height measures the reasoning body. A body height of 28 pixels fits one text line
under the header. Values from 18 through 27 pixels snap to an 18-pixel body in the
single-line layout. Scrolling and live text following remain active. The saved
mouse-resize preference still uses the existing localStorage key.

With `indicatorColor: "auto"`, the dot references Codex's native accent variable;
theme changes take effect immediately. A hex color overrides it. No color is
hard-coded for the automatic case.

Preferences are stored in ignored `.local/control-plugin/settings.json`.
Manual scrolling can pause the current text without changing the configured
follow preference. Dragging the top edge keeps its existing local height preference.
An explicit `{"height": null}` resets that height; an unspecified startup height
preserves a previous mouse resize.

To set startup values, add viewer variables to the `reasoning-control` server's
`env` in the generated
`.local/control-plugin/plugins/codex-reasoning-viewer/mcp.json`:

```json
{
  "CODEX_REASONING_MODE": "auto",
  "CODEX_REASONING_FOLLOW": "true",
  "CODEX_REASONING_COLLAPSED": "false",
  "CODEX_REASONING_HEIGHT": "auto",
  "CODEX_REASONING_INDICATOR_COLOR": "auto"
}
```

Rerun `npm.cmd run plugin:install` to refresh the installed package, then let the
MCP server start in a new session. The installer preserves these viewer variables
when rebuilding the package. Explicit environment values are reapplied on MCP
startup; fields omitted from `env` keep their saved settings. The generated
`env` is empty by default so tool changes persist across sessions.

## Startup boundary

**Keep launching Codex through the project shortcut.**

In the verified build, Electron and Chromium start before the app-server and its
MCP session runtime. A plugin/MCP process cannot add a Chromium startup flag to an
already initialized parent process.

`SessionStart` refers to a Codex session, with sources such as startup, resume, or
fork. It is not a pre-Chromium application-start hook. No such hook is installed
by this plugin. A missing endpoint produces a launcher/connection-required result;
the controls never kill or restart the desktop.

Official references:

- [Plugin packaging and bundled lifecycle hooks](https://developers.openai.com/plugins/build/plugins)
- [Hook events and SessionStart](https://learn.chatgpt.com/docs/hooks)
- [MCP tools and prompts](https://developers.openai.com/plugins/concepts/mcp-server)

The native menu behavior is based on bounded inspection of the fingerprinted
renderer and synthetic renderer regressions. This is not a public registration
contract for future desktop builds.

## Remove

```powershell
npm.cmd run plugin:remove
```

This removes only this project's plugin and its marketplace, then clears its
skill-path bindings. It keeps the independent viewer, local `/cot` commands, and
current desktop session running.
