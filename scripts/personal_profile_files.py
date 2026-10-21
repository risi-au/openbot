"""Finish a copied profile's file paths without changing chat text."""
import json
from pathlib import Path
import shutil
import sqlite3
import sys


def finish_files(source, target, final=None):
    source, target = Path(source).resolve(), Path(target).resolve()
    final = Path(final).resolve() if final else target
    if source == target:
        raise ValueError("The source profile must remain unchanged.")
    connection = sqlite3.connect(target / "openbot.db")
    source_db = sqlite3.connect(f"file:{source / 'openbot.db'}?mode=ro", uri=True)
    agents = [json.loads(row[0]) for row in source_db.execute("select agent_json from projection_agents")]
    source_db.close()
    roots = {source: final}
    for agent in agents:
        shared = Path(agent["workspacePath"]).parent.parent / "Shared"
        roots[shared] = final / "home/OpenBot/Shared"
        if shared.exists():
            shutil.copytree(shared, target / "home/OpenBot/Shared", dirs_exist_ok=True, symlinks=True)
    runtime = source / "provider-runtimes/codex"
    if runtime.exists() and not (target / "provider-runtimes/codex").exists():
        shutil.copytree(runtime, target / "provider-runtimes/codex", symlinks=True)

    def relocate_path(value):
        if not isinstance(value, str):
            return value
        for old, new in roots.items():
            if value.startswith(str(old) + "/"):
                return str(new) + value[len(str(old)):]
        return value

    def relocate(value):
        if isinstance(value, dict):
            return {k: relocate_path(v) if k in {"path", "sourcePath", "archivePath"} else relocate(v) for k, v in value.items()}
        if isinstance(value, list):
            return [relocate(v) for v in value]
        return value

    before = connection.execute("select thread_id,message_id,message_json from projection_thread_messages order by thread_id,message_id").fetchall()
    with connection:
        for table in (row[0] for row in connection.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'").fetchall()):
            columns = [row[1] for row in connection.execute(f'pragma table_info("{table}")') if row[2] == "TEXT" and (row[1].endswith("_json") or row[1] == "path")]
            for column in columns:
                for rowid, value in connection.execute(f'SELECT rowid,"{column}" FROM "{table}" WHERE "{column}" IS NOT NULL').fetchall():
                    if column == "path":
                        changed = relocate_path(value)
                    else:
                        parsed = json.loads(value)
                        moved = relocate(parsed)
                        changed = json.dumps(moved) if moved != parsed else value
                    if changed != value:
                        connection.execute(f'UPDATE "{table}" SET "{column}"=? WHERE rowid=?', (changed, rowid))
    after = connection.execute("select thread_id,message_id,message_json from projection_thread_messages order by thread_id,message_id").fetchall()
    assert len(before) == len(after)
    assert [(t, m, relocate(json.loads(j))) for t, m, j in before] == [(t, m, json.loads(j)) for t, m, j in after]
    assert connection.execute("pragma integrity_check").fetchone() == ("ok",)
    assert not connection.execute("pragma foreign_key_check").fetchall()
    connection.close()
    return {"messages": len(after), "fileRoots": len(roots), "integrity": "ok"}


if __name__ == "__main__":
    print(json.dumps(finish_files(sys.argv[1], sys.argv[2])))
