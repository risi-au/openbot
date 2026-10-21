import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type AgentEvent, COMPUTER_USE_MCP_SERVER_NAME } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AttentionRegistry } from "../src/backend/agent/attention-registry";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { RequestId } from "../src/backend/protocol";

class ConsentClient extends CodexAppServerClient {
  readonly replies: unknown[] = [];
  override respond(_id: RequestId, result: unknown): void {
    this.replies.push(result);
  }
}

const out = resolve(import.meta.dirname, "../.openbot-build/personal-cua-approval-e2e");
await mkdir(out, { recursive: true });
const root = await mkdtemp(join(out, "run-"));
const store = new AgentStore(join(root, "data"), join(root, "home"));
const events: AgentEvent[] = [];
const conversation = new ConversationRuntime(
  store,
  (event) => events.push(event),
  () => store.list(),
);
const client = new ConsentClient("unused-in-process-consent-adapter");
let autoApprove = true;
let sandboxed = false;
let computerUse = true;
const unused = () => Effect.die(new Error("Desktop consent must not invoke browser or hosted-site operations."));
const attention = new AttentionRegistry({
  conversation,
  browser: { listTabs: () => [], beginTakeover: unused, endTakeover: () => {} },
  hostedSites: { prepareApproval: unused, resolveApproval: unused },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
  approvalAutomation: { autoApproves: () => autoApprove },
  workspaceSandboxed: () => sandboxed,
  computerUseEnabled: () => computerUse,
  emit: (event) => events.push(event),
  emitError: (_code, error) => {
    throw error;
  },
  emitRuntimeSnapshot: () => {},
});
try {
  await runCauseEffect(store.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Desktop consent check", description: "", avatarSeed: "consent", avatarHue: null }),
  );
  const threadId = store.ensureThreadIdNow(agent.id);
  conversation.bindThread(threadId, agent.id, threadId);
  let requestId = 0;
  function request(marked = true) {
    const id = ++requestId;
    attention.surfaceMcpElicitation(client, {
      id,
      method: "mcpServer/elicitation/request",
      params: {
        threadId,
        turnId: `turn-${id}`,
        serverName: COMPUTER_USE_MCP_SERVER_NAME,
        mode: "form",
        message: "Allow this desktop tool?",
        requestedSchema: { type: "object", properties: {} },
        _meta: { codex_approval_kind: marked ? "mcp_tool_call" : "plugin_question", persist: ["always"] },
      },
    });
  }
  process.env.OPENBOT_PERSONAL_MODE = "0";
  request();
  assert.equal(client.replies.length, 0);
  assert.equal(events.filter((event) => event.type === "prompt").length, 1);
  process.env.OPENBOT_PERSONAL_MODE = "1";
  for (let i = 0; i < 3; i++) request();
  assert.equal(client.replies.length, 3);
  assert.equal(events.filter((event) => event.type === "prompt").length, 1);
  autoApprove = false;
  request();
  autoApprove = true;
  sandboxed = true;
  request();
  sandboxed = false;
  computerUse = false;
  request();
  computerUse = true;
  request(false);
  assert.equal(client.replies.length, 3);
  assert.equal(events.filter((event) => event.type === "prompt").length, 5);
  await writeFile(
    join(out, "report.json"),
    `${JSON.stringify({ passed: true, approvedDesktopCalls: 3, preservedPromptCases: ["standard mode", "Ask first", "Workspace only", "Computer Use off", "plugin question"] }, null, 2)}\n`,
  );
  process.stdout.write(`PASS ${join(out, "report.json")}\n`);
} finally {
  conversation.dispose();
  store.database.close();
}
