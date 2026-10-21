# Optional Hypruse desktop connection

The personal fork selects an enabled stdio connection named `hypruse` instead of the built-in CUA tools. Disable that connection to return to CUA. The existing per-agent Computer Use switch controls both. Standard OpenBot mode is unchanged.

This is a connection option, not a new desktop or an independent input seat. The Computer Use setup panel still describes CUA's permissions and cursor; Hypruse readiness is checked through its connection. CUA's overlay does not report Hypruse actions.

Install `hypruse==0.13.0` into a private virtual environment in the personal profile. Run its Python with the packaged `resources/hypruse/openbot-hypruse.py` as the MCP command argument. This launcher forces background mode, disables verbatim text journaling, and blocks accessibility focus and focus-only actions. It fails closed on an unreviewed Hypruse version. Do not register shared Codex or Claude plugins or install global skills.

Example connection fields:

```text
Name: hypruse
Transport: stdio
Command: <personal-profile>/hypruse/venv/bin/python
Arguments: ["<personal-profile>/hypruse/openbot-hypruse.py"]
Environment: HYPRUSE_AGENT_WORKSPACES=29,28,27
```

Pass through `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `WAYLAND_DISPLAY`, `DISPLAY`, and `HYPRLAND_INSTANCE_SIGNATURE`. Leave provider HOME and configuration paths private. Preserve the normal desktop D-Bus connection for accessibility.

Use `keyboard` with the exact native Wayland window address. A single editable field receives text directly. Use `click_ui` for buttons and other actionable controls, never to focus a field. Read the resulting app state before retrying anything. XWayland background keyboard fallback is unsupported. Background actions cannot provide arbitrary pixel clicks. App-triggered activation and commands launched under the same user remain outside the input guard.

For browser tasks, an optional `agent_chrome` stdio connection can run `chrome-devtools-mcp --browserUrl http://127.0.0.1:9224 --no-usage-statistics --no-performance-crux` against the existing agents' Chrome. Never use autoConnect or attach to the user's browser. Direct provider shell commands remain the first choice for terminal work.

Run `bun scripts/personal-mode-e2e.ts` for selection and instruction checks. Run the private Hypruse Python on `scripts/personal-hypruse-guard-check.py` to check the blocked focus route without GUI input. Real agent tests must run through this machine's `cu` helper and use only disposable scratch apps.
