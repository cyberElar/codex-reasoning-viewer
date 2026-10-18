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

With the viewer attached, keyboard and pointer handling can consume an entry
locally before it becomes a model request. Native option titles are not unique;
the handler reads the option's version-bound React key and matches its exact
registered skill path. It respects the selected entry, rather than guessing
from its title.

If native selection inserts a `skillMention` first, Enter also handles a single
registered control chip with whitespace or a valid `cot` argument. Foreign
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

| Tool            | Operation                                     |
| --------------- | --------------------------------------------- |
| `viewer_status` | Read minimal connection/visibility state      |
| `viewer_show`   | Show the existing panel                       |
| `viewer_hide`   | Fully hide it while history capture continues |
| `viewer_toggle` | Switch visibility                             |

All four tools accept an empty argument object. There are no reasoning resources,
prompt templates, arbitrary code arguments, or remote host parameters.

Before connecting, the controller checks saved PID/port values, the installed
application fingerprint, the running official desktop process, and TCP ownership.
Only loopback page endpoints for eligible composer pages are accepted. Tools
return connection state, visibility, and window count; they do not return session
IDs or reasoning bodies.

The stdio server's lifetime belongs to its MCP client/session. Stopping that
server does not stop the independent native helper.

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
