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
  function request(marked = true, serverName = COMPUTER_USE_MCP_SERVER_NAME) {
    const id = ++requestId;
    attention.surfaceMcpElicitation(client, {
      id,
      method: "mcpServer/elicitation/request",
      params: {
        threadId,
        turnId: `turn-${id}`,
        serverName,
        mode: "form",
        message: "Allow this desktop tool?",
        requestedSchema: { type: "object", properties: {} },
        _meta: { codex_approval_kind: marked ? "mcp_tool_call" : "plugin_question", persist: ["always"] },
      },
    });
  }
  // This fork answers Computer Use consent without a card while auto-approve is on and the agent's own
  // Computer Use switch is on, in personal mode and in standard mode. A card stays for Ask first,
  // workspace only, Computer Use off, and a question that is not a tool call.
  process.env.OPENBOT_PERSONAL_MODE = "0";
  request();
  assert.equal(client.replies.length, 1);
  assert.equal(events.filter((event) => event.type === "prompt").length, 0);
  process.env.OPENBOT_PERSONAL_MODE = "1";
  for (let i = 0; i < 3; i++) request();
  assert.equal(client.replies.length, 4);
  request(true, "hypruse");
  assert.equal(client.replies.length, 5);
  autoApprove = false;
  request();
  autoApprove = true;
  sandboxed = true;
  request();
  sandboxed = false;
  computerUse = false;
  request();
  request(true, "hypruse");
  computerUse = true;
  request(false);
  assert.equal(client.replies.length, 5);
  assert.equal(events.filter((event) => event.type === "prompt").length, 5);
  await writeFile(
    join(out, "report.json"),
    `${JSON.stringify({ passed: true, approvedDesktopCalls: 5, preservedPromptCases: ["Ask first", "Workspace only", "CUA off", "Hypruse off", "plugin question"] }, null, 2)}\n`,
  );
  process.stdout.write(`PASS ${join(out, "report.json")}\n`);
} finally {
  conversation.dispose();
  store.database.close();
}
