# Contributing

Keep the companion small, local, and reversible. The supported product is the
Windows above-composer viewer; the earlier MCP prototype is not part of this
repository.

## Set up

Use Windows 11 and Node.js 24 or newer.

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run format:check
```

Use `npm.cmd run format` after editing. Runtime modules use Node built-ins and
browser APIs; Acorn and Prettier are development dependencies.

The unit tests operate on synthetic fixtures and do not require Codex. The
renderer regressions require an already verified desktop debug endpoint:

```powershell
npm.cmd run validate:composer -- <port>
npm.cmd run validate:controls -- <port>
```

Those scripts create isolated iframe fixtures with their own preference storage
and remove them afterward. They do not submit native user turns. Do not substitute
a real user conversation for a test fixture.

## Code layout

| Location                                    | Responsibility                                             |
| ------------------------------------------- | ---------------------------------------------------------- |
| `src/native/launch.mjs`                     | Build guard, official app startup, helper lifecycle        |
| `src/native/installation.mjs`               | MSIX discovery and bounded read-only ASAR verification     |
| `src/native/instance.mjs`                   | Per-user/project activation channel                        |
| `src/native/cdp.mjs`                        | CDP transport                                              |
| `src/native/capture.mjs`                    | Fingerprint-bound manager capture and probe cleanup        |
| `src/native/adapter.js`                     | Manager notifications, cache hydration, turn/item merging  |
| `src/native/panel.js`                       | Source modes, history navigation, scroll state, visibility |
| `src/native/resize.js`                      | Height preference and pointer/keyboard resizing            |
| `src/native/controls.js`                    | Exact local command matching and submit interception       |
| `scripts/integrate-startup.mjs`             | User shortcut installation/removal                         |
| `scripts/update-native-viewer.mjs`          | Replace an existing in-memory viewer                       |
| `test/` and `src/native/fixture-server.mjs` | Synthetic verification                                     |

## Adapt a desktop build

Changing only the version allowlist is insufficient. Before adding support:

1. Inspect the installed version and renderer fingerprints without modifying the
   application. Keep extracted code and evidence outside version control.
2. Confirm the actual manager methods, notification shapes, portal selectors,
   editor behavior, and lifecycle for that build.
3. Update the capture sites and the fingerprint profile together.
4. Validate summary/raw streams, source selection, multiple items per turn,
   history navigation, resizing, local commands, and cleanup with synthetic data.
5. Confirm that unknown or changed assets still disable the companion while
   allowing ordinary Codex startup.

Do not publish an application's extracted JavaScript or binaries. Small pattern
locators and hashes identify the locally installed build; the application itself
is not distributed by this project.

Preserve the boundaries in [ARCHITECTURE.md](docs/ARCHITECTURE.md). Avoid installed
file patches, directory links, provider/model changes, second app-server
processes, native thread resume operations, or test messages in user sessions.

## Report problems

Include the MSIX package version, internal application version, Node version,
Windows version, launch method, and a minimal reproduction. Redact local paths
and thread identifiers before sharing status from `.local/`.

Do not attach session databases, rollout logs, authentication files, raw reasoning,
screenshots containing private conversations, or CDP endpoints. Use synthetic text
for UI reproductions. For vulnerabilities, see [SECURITY.md](SECURITY.md).

Use English for commit messages, issues, and pull request descriptions when
possible. Keep changes focused and describe how they were validated.
