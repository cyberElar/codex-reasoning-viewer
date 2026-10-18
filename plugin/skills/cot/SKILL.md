---
name: cot
description: Toggle the local Codex reasoning panel when the user requests its visibility control.
---

For a toggle request, call the `viewer_toggle` tool from this plugin's reasoning-control
MCP server. For an explicit show/hide request, call `viewer_show`/`viewer_hide` instead.
Use `viewer_status` for status questions. Confirm the returned visibility briefly.

The desktop's local composer handler may execute this menu entry before a model
turn is submitted. If this skill reaches the model, use the control tool once.
If it reports a missing launcher/connection, explain that the project shortcut is
required on the next normal Codex launch. Keep the current desktop session running.
