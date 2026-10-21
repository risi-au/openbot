import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { app } from "electron";
import { openExternal } from "../src/main/external-browser";
import { personalEnvironment } from "../src/main/personal-environment";

async function main(): Promise<void> {
  const out = resolve(process.cwd(), ".openbot-build/personal-browser-e2e");
  await mkdir(join(out, "electron"), { recursive: true });
  app.setPath("userData", join(out, "electron"));
  await app.whenReady();
  for (const [key, value] of Object.entries(personalEnvironment(out))) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const desktopHome = process.env.HOME;
  const result = Promise.withResolvers<string[]>();
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/result?")) {
      const query = new URL(request.url, "http://localhost").searchParams;
      const brands = (query.get("brands") ?? "").split(",");
      response.end("Browser check complete. You can close this tab.");
      result.resolve(brands);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><title>OpenBot browser check</title><p>Checking the desktop browser. No login or user data is read.</p><script>fetch("/result?brands="+encodeURIComponent((navigator.userAgentData?.brands??[]).map(x=>x.brand).join(","))).then(()=>document.querySelector("p").textContent="Browser check complete. You can close this tab.")</script>',
    );
  });
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const timeout = setTimeout(() => result.reject(new Error("Browser did not report within 30 seconds.")), 30_000);
    try {
      await openExternal(`http://127.0.0.1:${address.port}/`);
      const brands = await result.promise;
      assert.ok(brands.includes("Google Chrome"), `Expected Google Chrome, received ${brands.join(", ")}`);
      assert.equal(process.env.HOME, desktopHome);
      assert.equal(process.env.CODEX_HOME, join(out, "home/.codex"));
      const report = { passed: true, brands, providerHomeUnchanged: true };
      await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`PASS ${join(out, "report.json")}\n`);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    server.closeAllConnections();
    server.close();
    app.quit();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  app.exit(1);
});
