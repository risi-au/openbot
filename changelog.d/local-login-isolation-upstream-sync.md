### Changed

- The fork now sits on upstream v0.52.1, thirty-three releases ahead of v0.46.0. Each local change was re-applied onto the new code instead of merged, so the branch stays linear.
- Upstream's external link opener is kept. Calls that still need the desktop browser in personal mode go through the fork's `openExternal`, so sign-in links open the user's normal browser profile while provider settings stay private.
- Upstream no longer registers a Linux desktop entry or a default protocol handler. The personal fork keeps that default: it never replaces the upstream app's launcher or its `openbot://` handler.
- Upstream's rewritten developer instructions carry the fork's Computer Use, browser, and Hypruse wording. The provider-runner adapter version is 13.
- The personal-mode guard that blocks Computer Use and Hypruse tool approvals while an agent's Computer Use switch is off now sits inside upstream's consent auto-answer path.
