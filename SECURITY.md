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
