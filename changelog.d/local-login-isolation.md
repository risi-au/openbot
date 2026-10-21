### Changed

- The personal desktop fork opens local workspaces without an OpenBot email account. Cloud requests still require account authentication.
- Provider settings and state use the fork's private home. Automatic workspace skills and saved-memory access are disabled in personal mode.
- The fork uses a separate app profile and does not accept upstream application updates.

### Fixed

- Local chat reads and read markers work without a cloud account. Existing agents, messages, and attachments can be imported into the separate profile.
