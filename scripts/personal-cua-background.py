import json
import pathlib
import shlex
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
command = shlex.join([
    str(root / "node_modules/electron/dist/electron"),
    str(root / "scripts/personal-cua-scratch.cjs"),
    "--force-renderer-accessibility",
    "--ozone-platform=wayland",
    "--class=openbot-cua-scratch",
])
launch = "cd " + shlex.quote(str(root)) + " && " + command
rules = '{ workspace = "29 silent", no_initial_focus = true, focus_on_activate = false }'
subprocess.run(["hyprctl", "dispatch", f"hl.dsp.exec_cmd({json.dumps(launch)}, {rules})"], check=True)
