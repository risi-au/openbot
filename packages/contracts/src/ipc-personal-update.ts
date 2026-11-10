// The update flow of the OpenBot Personal fork: it merges an upstream release into the personal
// branch of the repo, builds the desktop app from it, and swaps the installed build. Upstream's own
// updater stays off in personal mode, so this is the path that keeps the app current.

/** The phase list is the source of truth: `PersonalUpdatePhase` is derived from it. */
export const PERSONAL_UPDATE_PHASES = [
  "idle",
  "checking",
  "available",
  "fetching",
  "merging",
  "conflict",
  "installing-deps",
  "typechecking",
  "building",
  "packaging",
  "installing",
  "ready",
  "current",
  "error",
] as const;

export type PersonalUpdatePhase = (typeof PERSONAL_UPDATE_PHASES)[number];

/** Phases where the run works and the card shows a spinner. The script bounds each one. */
export const PERSONAL_UPDATE_BUSY_PHASES = [
  "checking",
  "fetching",
  "merging",
  "installing-deps",
  "typechecking",
  "building",
  "packaging",
  "installing",
] as const satisfies readonly PersonalUpdatePhase[];

export type PersonalUpdateBusyPhase = (typeof PERSONAL_UPDATE_BUSY_PHASES)[number];

/** True while the run works: the card shows a spinner and takes no new run. */
export function isPersonalUpdateBusy(phase: PersonalUpdatePhase): boolean {
  return PERSONAL_UPDATE_BUSY_PHASES.some((busyPhase) => busyPhase === phase);
}

export interface PersonalUpdateStatus {
  phase: PersonalUpdatePhase;
  /** What the run last did, as the script wrote it, in one short line. */
  message?: string;
  /** The release tag of this run, such as "v0.66.0". Set once the script knows the target. */
  tag?: string;
  /** The app version of the build that the script installed. Set in the `ready` phase. */
  version?: string;
  /** The directory the build landed in, under the personal updates home. */
  installDir?: string;
  /** The files the merge collides on, set in the `conflict` phase. */
  conflicts: readonly string[];
  /** The start of the run, in ISO format. */
  startedAt?: string;
  /** The end of the run, in ISO format. Set in every end phase. */
  finishedAt?: string;
}
