"""Inspect the real pinned Codex process without sending a model prompt."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time

profile = Path(sys.argv[1]).resolve()
home = profile / "home"
environment = os.environ | {
    "HOME": str(home), "CODEX_HOME": str(home / ".codex"),
    "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
    "XDG_CACHE_HOME": str(home / ".cache"),
}
cli = profile / "provider-runtimes/codex/linux-x64/0.163.0/bin/codex"
process = subprocess.Popen([str(cli), "app-server", "--listen", "stdio://"], env=environment,
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           bufsize=0)
selector = selectors.DefaultSelector()
selector.register(process.stdout, selectors.EVENT_READ)
buffer = bytearray()


def request(identifier, method, params):
    process.stdin.write((json.dumps({"id": identifier, "method": method, "params": params}) + "\n").encode())
    process.stdin.flush()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if b"\n" not in buffer:
            if not selector.select(1):
                continue
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            buffer.extend(chunk)
            continue
        line, _, rest = buffer.partition(b"\n")
        buffer[:] = rest
        message = json.loads(line)
        if message.get("id") == identifier:
            assert "error" not in message, f"{method} failed."
            return message["result"]
    raise TimeoutError(method)


try:
    request(1, "initialize", {"clientInfo": {"name": "personal-isolation-check", "version": "1.0"},
                              "capabilities": {"experimentalApi": True}})
    config = request(2, "config/read", {"includeLayers": True})
    active_mcp = [name for name, value in config["config"].get("mcp_servers", {}).items() if value.get("enabled", True)]
    assert not active_mcp
    assert not config["config"].get("plugins", {})
    paths = [str(p) for p in (home / "OpenBot/Agents").iterdir() if p.is_dir()]
    data = request(3, "skills/list", {"cwds": paths, "forceReload": True})
    skills = [skill for result in data["data"] for skill in result["skills"]]
    enabled = [skill["name"] for skill in skills if skill.get("enabled", True)]
    assert not enabled, f"Enabled skills remain: {enabled}"
    account = request(4, "account/read", {}).get("account")
    assert account and account["type"] == "chatgpt"
    report = {"passed": True, "workspaces": len(paths), "activeMcp": active_mcp, "plugins": [],
              "enabledSkills": enabled, "accountType": account["type"],
              "configLayers": [layer["name"] for layer in config.get("layers", [])]}
    out = Path(__file__).resolve().parent.parent / ".openbot-build/personal-provider-e2e"
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: value for k, value in report.items() if k != "configLayers"}))
finally:
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    selector.close()
