# Omarchy background computer use

The personal fork uses Cua Driver, from `trycua/cua`. LCU is not selected because its installation guide requires X11 and explicitly excludes native Wayland.

The current machine has Hyprland 0.56.2-4, cua-hyprland-plugin 0.33.2-3, and the two compositor seats Cua-Agent and Cua-Agent-2. The plugin reports a matching compositor ABI. The fork bundles Cua Driver 0.34.0.

## Findings

- OpenBot's attention registry excluded Computer Use from automatic MCP consent even for an agent with Full access and automatic approval. Personal mode now honours that explicit grant when Computer Use is enabled. Ask first, Workspace only, Computer Use off, ordinary plugin questions, and standard mode retain their prompts. `bun scripts/personal-cua-approval-e2e.ts` checks these cases against the real registry and a temporary SQLite conversation.
- Foreground typing produced `foreground_unavailable`, `text_interrupted`, and `Broken pipe (os error 32)` after one character. The same scratch test failed on Cua Driver 0.38.0, so that update was not selected.
- A silent launch on workspace 29 works with Hyprland's Lua `hl.dsp.exec_cmd` and the rules `workspace = "29 silent"`, `no_initial_focus = true`, and `focus_on_activate = false`. The older bracketed exec syntax does not work here.
- Stock raw background input refuses Electron with `background_unavailable` and `client_not_qualified`. The upstream compatibility table permits only exact Calc and Inkscape package versions. The current Calc package also differs from that table.
- The private driver can read the scratch textarea, but semantic `set_value` returns `set_value_unavailable`: the entry exposes neither EditableText nor Value. The system driver's accessibility lookup timed out.

## Separate-seat experiment result

An experimental build of Cua Driver tag `cua-driver-rs-v0.34.0`, commit `b0968e1b12834e485dda68789541a3cc57664a9f`, added an explicit list of absolute executable paths through `CUA_DRIVER_HYPRLAND_EXTRA_EXECUTABLES`. Its three focused compatibility tests passed. Target attestation, input leases, separate seats, and foreground routing remained unchanged.

The live background check still failed with `client_not_bound`. It was repeated with a new native-Wayland Electron scratch window, with compositor metadata confirming `xwayland: false` and workspace 29. Keyboard calls used the exact top-level PID/window without element tokens or pixel coordinates. All three calls refused without typing. The primary focused window and active workspace stayed unchanged. This does not prove a stable pointer position while the user continues to move their mouse.

The experiment is not installed. Removing the package compatibility check did not create a writable input binding, so no package check is bypassed in the shipped fork. The experimental patch and sanitized reports remain locally under `.openbot-build/cua-experimental/` and `.openbot-build/cua-native-seat-result.txt`. The separate CUA source task worktree remains at `/home/rishi/Work/working-projects/cua/.worktrees/openbot-seats` for inspection.

Stock separate-seat raw input is not usable for the tested Electron application in this setup. Chrome's native background input remains unverified and is outside the upstream qualification table. Do not describe either as working because the seats exist, a source test passed, or a click reported dispatch. Never use foreground fallback to pass the check.

Run `scripts/personal-cua-background.py` through the machine's `cu` helper to launch the temporary scratch application silently. Read and modify only that scratch window. Reports remain under the ignored `.openbot-build/` directory. The scratch application has no user documents, accounts, or network content.

The personal instructions require background delivery, preserve the user's pointer and current workspace, and prohibit foreground fallback. Agent access remains full filesystem access, not an OS security sandbox.

Sources: [Cua platform support](https://cua.ai/docs/cua-driver/concepts/platform-support), [Hyprland plugin guidance](https://github.com/trycua/cua/blob/cua-driver-rs-v0.34.0/libs/cua-driver/hyprland-plugin/README.md), and [LCU installation prerequisites](https://github.com/amontlabs/lcu/blob/main/docs/INSTALLATION.md#prerequisites).
