"""Check retained data and the real installed application's local chat reads."""
import json
from pathlib import Path
import sqlite3
import sys

snapshot, profile = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
old = sqlite3.connect(f"file:{snapshot / 'openbot.db'}?mode=ro", uri=True)
current = sqlite3.connect(f"file:{profile / 'openbot.db'}?mode=ro", uri=True)


def messages(connection):
    return {(thread, message): json.loads(value) for thread, message, value in connection.execute(
        "SELECT thread_id,message_id,message_json FROM projection_thread_messages")}


before, after = messages(old), messages(current)
assert before.keys() <= after.keys(), "An imported message is missing."
assert all(before[key].get("text") == after[key].get("text") for key in before), "An imported message text changed."
old_agents = {row[0] for row in old.execute("SELECT agent_id FROM projection_agents")}
new_agents = {row[0] for row in current.execute("SELECT agent_id FROM projection_agents")}
assert old_agents <= new_agents
assert current.execute("PRAGMA integrity_check").fetchone() == ("ok",)
assert not current.execute("PRAGMA foreign_key_check").fetchall()
assert all(Path(row[0]).exists() for row in current.execute("SELECT path FROM projection_attachments WHERE path<>''"))
assert current.execute("SELECT count(*) FROM projection_agent_routines WHERE active=1").fetchone()[0] == 0
trace = [json.loads(line) for line in (profile / "logs/trace.ndjson").read_text().splitlines()]
operations = ["agent:read-conversation-page", "agent:list-conversation-reads", "agent:mark-conversation-read"]
last = {}
for operation in operations:
    entries = [row for row in trace if row.get("name") == operation]
    assert entries and entries[-1]["outcome"] == "ok", f"The installed app did not complete {operation}."
    last[operation] = entries[-1]["at"]
assert not list((profile / "home/OpenBot/Agents").glob("*/.agents/skills/*"))
assert not list((profile / "home/OpenBot/Agents").glob("*/.claude/skills/*"))
report = {"passed": True, "retainedAgents": len(old_agents), "retainedMessages": len(before),
          "missingMessages": 0, "changedChatTexts": 0, "attachmentsPresent": True,
          "pausedCopiedRoutines": True, "installedChatOperations": last}
out = Path(__file__).resolve().parent.parent / ".openbot-build/personal-installed-e2e"
out.mkdir(parents=True, exist_ok=True)
(out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
old.close()
current.close()
print(json.dumps(report))
