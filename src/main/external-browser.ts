import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { shell } from "electron";

// Capture desktop preferences before startup replaces HOME and XDG paths for providers.
const desktopEnvironment = { ...process.env };
const execute = promisify(execFile);

export async function openExternal(url: string): Promise<void> {
  if (process.platform === "linux" && process.env.OPENBOT_PERSONAL_MODE === "1" && /^https?:\/\//u.test(url)) {
    await execute("xdg-open", [url], { env: desktopEnvironment });
    return;
  }
  await shell.openExternal(url);
}
