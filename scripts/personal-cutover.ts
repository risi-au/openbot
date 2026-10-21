import assert from "node:assert/strict";
import { resolve } from "node:path";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const directory = process.argv[2];
assert.ok(directory, "Supply the copied personal profile path.");
const database = new OpenBotDatabase(resolve(directory));
await runCauseEffect(database.initialize());
try {
  const before = database.connection
    .prepare("SELECT * FROM projection_thread_messages ORDER BY thread_id, message_id")
    .all();
  const threads = database.connection
    .prepare("SELECT DISTINCT thread_id FROM projection_provider_sessions WHERE state = 'active'")
    .all();
  for (const row of threads) {
    assert.equal(typeof row.thread_id, "string");
    if (typeof row.thread_id === "string") database.deactivateProviderSessions(row.thread_id);
  }
  const routines = new AgentRoutineStore(database);
  let pausedRoutines = 0;
  for (const agent of database.listAgents()) {
    for (const routine of routines.list(agent.id)) {
      if (!routine.active) continue;
      routines.update({ agentId: agent.id, routineId: routine.id, active: false });
      pausedRoutines += 1;
    }
  }
  assert.deepEqual(
    database.connection.prepare("SELECT * FROM projection_thread_messages ORDER BY thread_id, message_id").all(),
    before,
  );
  assert.equal(
    database.connection
      .prepare("SELECT count(*) AS count FROM projection_provider_sessions WHERE state = 'active'")
      .get()?.count,
    0,
  );
  // Machine-readable: no message content or credentials leave the profile.
  process.stdout.write(
    `${JSON.stringify({ messages: before.length, retiredThreads: threads.length, pausedRoutines, preserved: true })}\n`,
  );
} finally {
  database.close();
}
