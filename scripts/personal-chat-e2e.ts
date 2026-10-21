import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { personalEnvironment } from "../src/main/personal-environment";

const profile = process.argv[2];
assert.ok(profile, "Supply the isolated personal profile path.");
for (const [key, value] of Object.entries(personalEnvironment(resolve(profile)))) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
process.env.OPENBOT_CODEX_PATH = join(profile, "provider-runtimes/codex/linux-x64/0.163.0/bin/codex");
process.chdir(join(profile, "home"));
const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const out = resolve(import.meta.dirname, "../.openbot-build/personal-chat-e2e");
await mkdir(out, { recursive: true });
const checks = join(profile, "home/.checks");
await mkdir(checks, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(checks, "chat-"));
const store = new AgentStore(join(root, "data"), join(root, "home"));
const unused = () => Effect.die(new Error("Browser actions are outside this chat check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
};
const service = new AgentService({
  store,
  mailbox: new MailboxStore(join(root, "data"), store.sharedRoot, store.database),
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});
try {
  await runCauseEffect(service.initialize());
  const agent = await runCauseEffect(
    service.createAgent({
      name: "Isolated chat check",
      description: "A temporary live chat check.",
      avatarSeed: "personal-chat-check",
      avatarHue: null,
      initialMessage: "Reply with exactly OPENBOT_PERSONAL_OK. Do not use tools.",
    }),
  );
  await new Promise<void>((done, fail) => {
    const timeout = setTimeout(() => {
      service.off("event", check);
      fail(new Error("The live chat did not finish within 90 seconds."));
    }, 90_000);
    function check() {
      const deliveries = service.listQueue(agent.id).deliveries;
      if (
        !deliveries.length ||
        deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status))
      )
        return;
      clearTimeout(timeout);
      service.off("event", check);
      if (deliveries.every((delivery) => delivery.status === "completed")) done();
      else fail(new Error(`The live chat ended with ${deliveries.map((delivery) => delivery.status).join(", ")}.`));
    }
    service.on("event", check);
    check();
  });
  const threadId = store.list().find((item) => item.id === agent.id)?.threadId;
  assert.ok(threadId);
  const rows = store.database.connection
    .prepare("SELECT message_json FROM projection_thread_messages WHERE thread_id=?")
    .all(threadId);
  assert.ok(
    rows.some(
      (row) => typeof row.message_json === "string" && JSON.parse(row.message_json).text === "OPENBOT_PERSONAL_OK",
    ),
  );
  await writeFile(
    join(out, "report.json"),
    `${JSON.stringify({ passed: true, provider: "codex", realModelReply: true, sqliteMessages: rows.length }, null, 2)}\n`,
  );
  // Machine-readable: no private conversation content.
  process.stdout.write(`PASS ${join(out, "report.json")}\n`);
} finally {
  await runCauseEffect(service.stop());
}
