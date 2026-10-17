# Architecture

The companion consists of a Node.js launcher and plain JavaScript running
temporarily in the official desktop renderer. Runtime code has no npm dependency.

```mermaid
flowchart TD
    Shortcut["Project shortcut / VBS / terminal"] --> Launcher["Node launcher"]
    Launcher --> Guard["Discover MSIX and verify build"]
    Guard -->|unknown or changed| Normal["Ordinary official startup"]
    Guard -->|verified| Desktop["Official desktop with random loopback CDP port"]
    Desktop --> Capture["Capture existing managers; remove probes"]
    Capture --> Adapter["Notifications + loaded cache snapshots"]
    Adapter --> History["Merge turns and reasoning items"]
    History --> Panel["Above-composer DOM panel"]
    Commands["Local /cot and buttons"] --> Visibility["Visibility preference"]
    Visibility --> Panel
```

## Launch and ownership

`Launch Codex.vbs` starts Node with a hidden console. Its path and the Node path
are quoted separately. The terminal launcher uses the same module.

The helper claims a named pipe derived from the current user's home and project
path. A second launcher can request only a fixed `activate` command. The protocol
does not evaluate supplied code or return reasoning/debug endpoints.

The launcher discovers the registered MSIX location each time. It verifies the
internal application version plus renderer asset SHA-256 values before enabling
capture. Unknown or changed builds start normally.

On a cold, verified launch, the official executable receives only temporary
loopback debug flags. The helper checks TCP ownership and accepts only eligible
`app://-/index.html` composer pages. Overlay pages are excluded. It stays alive
until the desktop exits.

An already running ordinary desktop cannot acquire the needed startup flag
through second-instance activation. The helper activates it and requests one
normal exit/reopen through the new entry. An already attached desktop is simply
activated. The launcher never terminates the desktop.

## Manager capture and observation

The supported build does not expose its manager class as a public extension API.
`capture.mjs` uses three bounded, fingerprint-bound method locations. Conditional
CDP probes return false, capture the existing `this` manager, and do not pause.
After manager capture, the helper removes the probes and disables its Debugger
session.

`adapter.js` observes the manager's local notification callback and wraps selected
state updates. It saves descriptors and restores only wrappers it still owns.
It does not create another app-server, resume a thread, or send a model request.

The active conversation is resolved from the visible composer's portal marker.
An empty portal may be hidden by native CSS, so portal visibility alone is not
sufficient to select the correct conversation.

## History and rendering

The adapter merges native cached turns, loaded history islands, and live deltas
into an in-memory turn/item store. Partial snapshots do not delete previously
observed reasoning. Ordering follows known neighboring native records.

For each reasoning item, Auto chooses a nonempty summary, otherwise readable
content. The panel joins items in turn order. Summary/Raw modes do not silently
substitute the other channel.

Selecting an older turn holds that selection while new turns arrive. Scrolling
up pauses following. A frame scheduler with a timer fallback supports hidden
windows with suspended animation frames.

`resize.js` owns its handle, cursor cleanup, and height preference.
`controls.js` consumes exact single-line local commands at window capture phase,
before the native editor's submission path. It verifies the editor contains a
single text block and the caret is at the end, then clears it using a bounded
editor selection and browser editing command. It does not mutate ProseMirror's
internal document directly. Unrelated drafts and the Stop button retain native
handling.

## Visibility and data

Hiding the panel leaves the adapter, helper, and in-memory history running. A
compact button reopens it. Height and enabled state use namespaced localStorage
keys; reasoning text is not written there.

Launch records, shortcut manifests, copied icons, and synthetic reports live in
ignored `.local/`. Status records can contain local paths and thread IDs. The
project does not change provider settings, session databases, project lists,
installed application files, filesystem permissions, or directory links.

## Cleanup and compatibility

Normal disposal removes owned DOM/listeners, restores owned wrappers, removes
capture probes, and closes connections. The CDP endpoint belongs to the official
desktop and closes with that process. Force-killing the helper can leave the
in-memory component until desktop exit.

Avoiding installed file changes does not guarantee future internal compatibility.
An update can disable the companion without requiring an application repair.
Every new supported build requires interface and runtime validation.
