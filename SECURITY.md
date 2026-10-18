# Security

## Scope

This experimental Windows companion starts the official desktop with a random
loopback CDP port. CDP is a privileged debugging interface: local software able
to access it can control the renderer. It is not a security boundary against
other software running as the same user.

Keep the port local. Do not forward it, bind it to a public interface, or include
its endpoint in an issue. The launcher verifies the listening process before
attachment. Unknown desktop builds disable the companion.

The viewer does not make external model requests or persist reasoning text.
`.local/` contains operational metadata and can include paths and thread IDs;
localStorage contains the viewer's height and visibility preferences.

The optional MCP server exposes visibility operations, a settings read, and a
validated settings patch. The patch permits only display mode, following,
collapse, bounded height, and an automatic or hex indicator color. It verifies
the installed build and debug endpoint owner before using fixed renderer
operations. Its responses contain minimal control metadata and display settings,
not reasoning or session identifiers. Generated plugin configuration and exact
skill-path bindings remain under ignored `.local/control-plugin/`.

Hot updates copy the full reasoning cache between owned viewer instances inside
the renderer. That handoff never returns its text over CDP or writes it to disk.

Local menu controls accept only registered skill paths and a bounded single-block
draft. Native menu identity is read from a version-bound React key; titles alone
are not trusted as command identity.

## Report a vulnerability

Please use GitHub's **Report a vulnerability** option on this repository's
Security tab when available. Do not disclose active exploits or private data in
a public issue. If private reporting is unavailable, open an issue requesting
a private reporting channel without including exploit details.

Use synthetic data in reports. Never include authentication tokens, account
files, rollout logs, session databases, real reasoning text, or live debugging
endpoints.

Only the explicitly fingerprinted desktop build is currently supported. An
unrecognized update is disabled until it has been checked.
