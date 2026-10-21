import type { McpServerConfig } from "@openbot/contracts/ipc";

export const HYPRUSE_MCP_SERVER_NAME = "hypruse";

export function personalHypruseEnabled(configs: readonly McpServerConfig[]): boolean {
  return (
    process.env.OPENBOT_PERSONAL_MODE === "1" &&
    configs.some((config) => config.enabled && config.name === HYPRUSE_MCP_SERVER_NAME && config.transport === "stdio")
  );
}
