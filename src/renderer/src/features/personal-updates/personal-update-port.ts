import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the personal updates context reaches in main: the fork's update status, its check and
 * update steps, and the restart into the build the update installed.
 */
export interface PersonalUpdatePort {
  personalUpdate: Pick<
    OpenBotDesktopApi["personalUpdate"],
    "check" | "getStatus" | "onEvent" | "restart" | "updateNow"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function personalUpdatePort(): PersonalUpdatePort {
  return window.openbot;
}
