import { join } from "node:path";

/** These are the system skills in the pinned Codex runtime, not imported user skills. */
export function personalCodexConfig(directory: string): string {
  const skills = ["imagegen", "openai-docs", "review-agent", "skill-creator", "skill-installer"];
  return `\n# OpenBot Personal defaults\n${skills
    .map(
      (skill) =>
        `[[skills.config]]\npath = ${JSON.stringify(join(directory, "home/.codex/skills/.system", skill, "SKILL.md"))}\nenabled = false\n`,
    )
    .join("\n")}`;
}

/** Keep provider discovery in the fork profile, including launches that bypass its desktop entry. */
export function personalEnvironment(directory: string): NodeJS.ProcessEnv {
  const home = join(directory, "home");
  return {
    OPENBOT_PERSONAL_MODE: "1",
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    GEMINI_HOME: join(home, ".gemini"),
    CLINE_DIR: join(home, ".cline"),
    CURSOR_CONFIG_DIR: join(home, ".cursor"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    OPENCODE_CONFIG: undefined,
    OPENCODE_CONFIG_DIR: undefined,
    OPENCODE_CONFIG_CONTENT: undefined,
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: undefined,
    CLAUDE_CODE_PROJECT_DIR_NAME: undefined,
  };
}
