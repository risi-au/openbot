### Changed

- Hypruse can target windows on any requested workspace. Its default launch range no longer confines access; background-only input and focus guards remain enabled.

- The optional Hypruse connection selects background desktop tools in personal mode. Disabling it restores CUA. Its pinned launcher blocks accessibility focus.

- The personal desktop fork opens local workspaces without an OpenBot email account. Cloud requests still require account authentication.
- Provider settings and state use the fork's private home. Automatic workspace skills and saved-memory access are disabled in personal mode.
- The fork uses a separate app profile and does not accept upstream application updates.

### Fixed

- Local chat reads and read markers work without a cloud account. Existing agents, messages, and attachments can be imported into the separate profile.
- Explicit requests for the user's browser or Linux desktop use OpenBot Computer Use when enabled. Embedded browser guidance no longer overrides that request.
- External sign-in and connection links use the desktop's default browser and its normal profile while provider settings remain private.
- Personal agents with Full access and automatic approval no longer receive a separate approval card for every CUA tool call. Ask first and Workspace only still require approval.
- Computer Use instructions use background agent seats and preserve the user's pointer, focus, and workspace. They prohibit foreground fallback and repeated text after partial input.
