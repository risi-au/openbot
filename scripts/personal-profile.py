"""Copy an existing profile without changing its database or workspaces."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
from personal_profile_files import finish_files

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("target", type=Path)
args = parser.parse_args()
source, target = args.source.resolve(), args.target.resolve()
if source == target or target.exists() or target.with_suffix(".importing").exists():
    parser.error("Use a new target directory. Existing profiles are never overwritten.")
os.umask(0o077)
root = Path(__file__).resolve().parent.parent
repository = Path(subprocess.check_output(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=root, text=True).strip()).parent
backup = repository / ".openbot/personal-backups" / ("original-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
excluded = {"openbot.db", "openbot.db-wal", "openbot.db-shm", "SingletonLock", "SingletonCookie", "SingletonSocket",
            "Cache", "Code Cache", "GPUCache", "DawnWebGPUCache", "DawnGraphiteCache", "Crashpad", "logs"}
shutil.copytree(source, backup, ignore=lambda directory, names: [n for n in names if n in excluded], symlinks=True)
original = sqlite3.connect(f"file:{source / 'openbot.db'}?mode=ro", uri=True)
saved = sqlite3.connect(backup / "openbot.db")
original.backup(saved)
assert saved.execute("pragma integrity_check").fetchone() == ("ok",)
saved.close()
original.close()
staging = target.with_suffix(".importing")
shutil.copytree(backup, staging, ignore=lambda directory, names: [n for n in names if Path(directory) == backup and n in {
    "codex", "provider-accounts", "provider-state", "provider-handoffs", "provider-toolsets", "local-skills",
    "openbot-central-auth-v1.bin", "openbot-remote-servers-v1.json", "openbot-mcp-oauth-v1.json",
    "openbot-mcp-oauth-proxy-v1.json", "openbot-mcp-oauth-proxy-store-v1.json"}], symlinks=True)
db = sqlite3.connect(staging / "openbot.db")
rows = db.execute("select agent_id, agent_json from projection_agents").fetchall()
mapping = {}
for agent_id, data in rows:
    agent = json.loads(data)
    workspace = Path(agent["workspacePath"])
    relative = Path("home/OpenBot/Agents") / agent_id
    destination = staging / relative
    clean = {".agents", ".claude", ".codex", ".cursor", "AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "MEMORY.md", ".mcp.json"}
    shutil.copytree(workspace, backup / "workspaces" / agent_id, symlinks=True)
    shared = workspace.parent.parent / "Shared"
    if shared.exists():
        shutil.copytree(shared, backup / "shared", symlinks=True, dirs_exist_ok=True)
    shutil.copytree(workspace, destination, ignore=lambda directory, names: [n for n in names if n in clean], symlinks=True)
    mapping[str(workspace)] = str(target / relative)

def relocate(value):
    if isinstance(value, dict):
        return {k: mapping.get(v, v) if k == "workspacePath" and isinstance(v, str) else relocate(v) for k, v in value.items()}
    if isinstance(value, list):
        return [relocate(v) for v in value]
    return value

before = db.execute("select message_id, message_json from projection_thread_messages order by message_id").fetchall()
with db:
    for agent_id, data in rows:
        db.execute("update projection_agents set agent_json=? where agent_id=?", (json.dumps(relocate(json.loads(data))), agent_id))
    for sequence, payload in db.execute("select sequence,payload_json from orchestration_events").fetchall():
        value = json.loads(payload)
        changed = relocate(value)
        if changed != value:
            db.execute("update orchestration_events set payload_json=? where sequence=?", (json.dumps(changed), sequence))
assert before == db.execute("select message_id, message_json from projection_thread_messages order by message_id").fetchall()
assert db.execute("pragma integrity_check").fetchone() == ("ok",)
assert not db.execute("pragma foreign_key_check").fetchall()
db.close()
codex = staging / "home/.codex"
codex.mkdir(parents=True, exist_ok=True)
auth = source / "codex/auth.json"
if auth.is_file():
    shutil.copyfile(auth, codex / "auth.json")
    (codex / "auth.json").chmod(0o600)
(codex / "config.toml").write_text('project_root_markers = []\n')
(staging / "home/.claude").mkdir(parents=True, exist_ok=True)
(staging / "home/.claude/settings.json").write_text('{"autoMemoryEnabled":false}\n')
finish_files(source, staging, target)
target.parent.mkdir(parents=True, exist_ok=True)
staging.rename(target)
report = {"backup": str(backup), "target": str(target), "agents": len(rows), "messages": len(before),
          "messageDigest": hashlib.sha256(json.dumps(before).encode()).hexdigest(), "integrity": "ok"}
(backup / "import-report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k != "messageDigest"}))
