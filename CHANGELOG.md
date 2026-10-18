# Changelog

## 0.3.1 - 2026-10-18

- Show Thinking while the current turn runs and Done when it finishes.
- Keep the header label and indicator tied to the current turn while browsing
  historical reasoning, without changing the selected turn or text.
- Verify status transitions on turn start and completion, including before the
  first reasoning delta and while historical reasoning remains selected.

## 0.3.0 - 2026-10-18

- Simplify the English header to an accent indicator, Thinking label, and
  previous/next arrows around the current turn counter.
- Follow the Codex accent color by default and allow a custom indicator color.
- Add MCP settings tools for display mode, following, collapse, height, and color.
- Read explicit MCP environment settings at startup and save tool changes locally.
- Preserve the complete in-memory history during viewer hot updates, including
  reasoning items that are no longer available in native snapshots.
- Extend isolated browser regressions to configuration, dynamic theme colors,
  history handoff, and the minimal header.

## 0.2.1 - 2026-10-18

- Apply a highlighted viewer control immediately on Tab, Enter, or click.
- Recognize the desktop's native suggestion rows and highlighted selection,
  in addition to cmdk menus.
- Clear any control skill chip inserted by an earlier native keyboard listener
  during the same key press, without another Enter or a model submission.
- Preserve normal Tab navigation for unrelated drafts, modifiers, and IME.
- Add an isolated Edge regression runner with real browser keyboard input.

## 0.2.0 - 2026-10-18

- Fully hide the panel without a reopen button, border, or layout space.
- Keep background history capture active and restore the panel with `/cot on`.
- Verify that hidden startup and preference changes leave no visible viewer UI.
- Add an optional MCP control server with four fixed, zero-argument tools.
- Add native slash-menu skills and local handling for verified skill paths.
- Generate machine-specific plugin packages under ignored local state and install
  them through the official Codex CLI.

## 0.1.0 - 2026-10-18

Initial public source release.

- Add an above-composer reasoning panel for one verified Windows desktop build.
- Display complete summaries or readable raw reasoning with per-item fallback.
- Receive live deltas and retain multiple reasoning items and turns.
- Add history navigation, scroll following, and persistent height/visibility.
- Add local `/cot` controls and hidden desktop/Start Menu launchers.
- Guard desktop versions and renderer fingerprints without changing installed
  application files.
- Include synthetic unit tests and isolated renderer regression tools.
