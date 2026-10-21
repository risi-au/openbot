import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type McpServerConfig } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { personalEnvironment } from "../src/main/personal-environment";

const profile = resolve(process.argv[2] ?? "");
const python = process.argv[3];
assert.ok(process.argv[2] && python, "Supply the personal profile and private Hypruse Python paths.");
const source = resolve(import.meta.dirname, "..");
const out = join(source, ".openbot-build/hypruse-openbot");
await mkdir(out, { recursive: true });
for (const [key, value] of Object.entries(personalEnvironment(profile))) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
process.env.OPENBOT_CODEX_PATH = join(profile, "provider-runtimes/codex/linux-x64/0.163.0/bin/codex");
const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const checks = join(profile, "home/.checks");
await mkdir(checks, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(checks, "hypruse-"));
const store = new AgentStore(join(root, "data"), join(root, "home"));
const unused = () => Effect.die(new Error("Embedded browser actions are outside this check."));
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
  clearAgentSession: () => Effect.void,
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
  approvalAutomation: { autoApproves: () => true },
});
const config: McpServerConfig = {
  id: "",
  name: "hypruse",
  transport: "stdio",
  enabled: true,
  command: python,
  args: [join(source, "resources/hypruse/openbot-hypruse.py")],
  env: [
    { key: "HYPRUSE_AGENT_WORKSPACES", value: "29,28,27" },
    { key: "HYPRUSE_JOURNAL", value: join(root, "hypruse.ndjson") },
  ],
  envPassthrough: [
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "WAYLAND_DISPLAY",
    "DISPLAY",
    "HYPRLAND_INSTANCE_SIGNATURE",
  ],
  workingDirectory: "",
  url: "",
  headers: [],
};
let promptCount = 0;
service.on("event", (event) => {
  if (event.type === "prompt" || event.type === "approval") promptCount += 1;
});
try {
  await runCauseEffect(service.initialize());
  await runCauseEffect(service.saveMcpServer({ config }));
  const state = join(out, "agent-state.json");
  const scratch = join(source, ".openbot-build/hypruse-test/scratch.py");
  const agent = await runCauseEffect(
    service.createAgent({
      name: "Hypruse live check",
      description: "A temporary OpenBot backend integration check.",
      avatarSeed: "hypruse-check",
      avatarHue: null,
      initialMessage: [
        "Test only the hypruse connection on a new disposable scratch form. The human continues working during this test.",
        "Record the initial human focused window and its own workspace. Do not confuse another monitor's active workspace with the focused window's workspace.",
        `Launch /usr/bin/python ${scratch} with background=true on a free hidden agent workspace.`,
        "Do not use pointer, foreground, focus, workspace changes, CUA, or click_ui on text fields.",
        "Call keyboard with the exact new window and text OPENBOT_HYPRUSE_OK directly; the form has only one editable field.",
        `Read ${join(source, ".openbot-build/hypruse-test/gtk-state.json")} to verify text.`,
        "Call click_ui only on Verify scratch, then verify text OPENBOT_HYPRUSE_OK, clicks=1, and the resulting UI label.",
        "Use each action's own immediate focus/workspace report to judge whether that action moved focus. Stop on an action WARNING, refusal, or partial input.",
        "Record whole-turn human focus/workspace observations separately. A workspace change between separate calls does not establish that your action caused it.",
        `Write ${state} as JSON with passed boolean, observed text/clicks, per-action focus results, before/after focused window and its workspace, scratch pid and window.`,
        `Close only the scratch process you created after verifying its exact command ${scratch}, even if the test fails.`,
        "No other apps, files, settings, external submissions or messages may be changed. This task authorizes these scratch actions and the local report.",
        "Finish with OPENBOT_HYPRUSE_OK only if app-owned text and button state pass and both input actions report the human's focus untouched.",
      ].join("\n"),
    }),
  );
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => {
      service.off("event", check);
      fail(new Error("OpenBot Hypruse turn exceeded four minutes."));
    }, 240_000);
    function check() {
      const deliveries = service.listQueue(agent.id).deliveries;
      if (!deliveries.length || deliveries.some((item) => ["queued", "starting", "running"].includes(item.status)))
        return;
      clearTimeout(timer);
      service.off("event", check);
      if (deliveries.every((item) => item.status === "completed")) done();
      else fail(new Error(`Agent turn ended ${deliveries.map((item) => item.status).join(",")}`));
    }
    service.on("event", check);
    check();
  });
  const actual = JSON.parse(await readFile(join(source, ".openbot-build/hypruse-test/gtk-state.json"), "utf8"));
  assert.deepEqual(actual, { text: "OPENBOT_HYPRUSE_OK", clicks: 1 });
  const observed = JSON.parse(await readFile(state, "utf8"));
  const journal = (await readFile(join(root, "hypruse.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const actions = journal.filter((row) => row.kind === "act");
  assert.ok(actions.every((row) => ["launch", "keyboard", "click_ui"].includes(row.tool)));
  const input = actions.filter((row) => row.tool === "keyboard" || row.tool === "click_ui");
  assert.equal(input.length, 2);
  assert.ok(
    input.every(
      (row) => row.outcome === "ok" && row.args.background === true && row.result.includes("human's focus untouched"),
    ),
  );
  assert.ok(input.some((row) => row.tool === "click_ui" && row.args.name === "Verify scratch"));
  assert.equal(promptCount, 0, "The granted agent unexpectedly asked for approval.");
  await writeFile(
    join(out, "agent-report.json"),
    `${JSON.stringify({ passed: true, provider: "codex", realAgentService: true, scratchState: actual, actionFocusChecks: "unchanged during both input calls", wholeTurnObservation: observed, promptCount, agentId: agent.id, root }, null, 2)}\n`,
  );
  process.stdout.write(`PASS ${join(out, "agent-report.json")}\n`);
} finally {
  await runCauseEffect(service.stop());
}
