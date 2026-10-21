import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { memoryContext } from "../src/backend/agent/developer-instructions";
import { DISABLED_MEMORY_TOOLS } from "../src/backend/agent/memory-tool-inputs";
import { BUILTIN_TOOL_CATALOG, VISIBLE_TOOL_DEFINITIONS } from "../src/backend/agent/tool-catalog";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CentralAuthManager } from "../src/main/central-auth-manager";
import { ManagedSkillService } from "../src/main/managed-skill-service";
import { personalCodexConfig, personalEnvironment } from "../src/main/personal-environment";

const out = resolve(import.meta.dirname, "../.openbot-build/personal-mode-e2e");
await mkdir(out, { recursive: true });
const root = await mkdtemp(join(out, "run-"));
const environment = personalEnvironment(root);
process.env.OPENBOT_PERSONAL_MODE = environment.OPENBOT_PERSONAL_MODE;
assert.equal(environment.HOME, join(root, "home"));
assert.equal(environment.CODEX_HOME, join(root, "home/.codex"));
assert.equal(environment.CLAUDE_CONFIG_DIR, join(root, "home/.claude"));
assert.equal(environment.OPENCODE_CONFIG_CONTENT, undefined);
assert.equal(personalCodexConfig(root).match(/enabled = false/gu)?.length, 5);
const storagePath = join(root, "session.bin");
await writeFile(storagePath, "preserve-existing-encrypted-session");
let requests = 0;
for (let restart = 0; restart < 2; restart++) {
  const auth = new CentralAuthManager({
    apiUrl: "http://127.0.0.1:1",
    storagePath,
    localOnly: true,
    canPersist: () => false,
    encrypt: () => {
      throw new Error("Secure storage is unavailable.");
    },
    decrypt: () => {
      throw new Error("Secure storage is unavailable.");
    },
    fetch: async () => {
      requests += 1;
      throw new Error("Account service is offline.");
    },
  });
  assert.equal((await runCauseEffect(auth.initialize())).status, "signed_out");
  await assert.rejects(() => runCauseEffect(auth.updateName("Test")));
  await runCauseEffect(auth.dispose());
}
assert.equal(requests, 0);
assert.equal(await readFile(storagePath, "utf8"), "preserve-existing-encrypted-session");
assert.deepEqual(memoryContext([], { storedMemoryCount: 99 }), { memories: [], storedCount: 0, limit: 0 });
assert.ok(VISIBLE_TOOL_DEFINITIONS.every((tool) => !DISABLED_MEMORY_TOOLS.has(tool.name)));
assert.ok(BUILTIN_TOOL_CATALOG.every((tool) => !DISABLED_MEMORY_TOOLS.has(tool.tool)));
await runCauseEffect(new ManagedSkillService(join(root, "missing-skill")).syncAll([]));
await writeFile(
  join(out, "report.json"),
  `${JSON.stringify({ passed: true, restartChecks: 2, accountRequests: requests, memories: "disabled", automaticSkills: "disabled" }, null, 2)}\n`,
);
// Machine-readable: artifact location only.
process.stdout.write(`PASS ${join(out, "report.json")}\n`);
