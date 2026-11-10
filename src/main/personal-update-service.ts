// The updater of the OpenBot Personal fork: it runs the repo's update script, and quits into the
// build that the script installed and swapped in. The normal updater is off in personal mode, so
// this is the app's path to follow the OpenBot releases.

import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersonalUpdateStatus } from "@openbot/contracts/ipc";
import { isPersonalUpdateBusy, PERSONAL_UPDATE_PHASES } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("personal-update");
const STATUS_FILE = "app-update-status.json";
const BINARY_NAME = "openbot-personal";
const POLL_MS = 1_200;
/** The script stamps its own runs in seconds where the service stamps in milliseconds. */
const RUN_NEAR_MS = 3_000;

interface PersonalUpdateServiceEvents {
  status: [status: PersonalUpdateStatus];
}

export interface PersonalUpdateServiceOptions {
  /** The worktree of the personal branch. The script merges and builds there. */
  repoWorktree: string;
  /** The update script at the repo (`scripts/personal-app-update.sh`). */
  scriptPath: string;
  /** The home of the installed builds, with its `current` link and its status files. */
  updatesDirectory: string;
  /** The real user home for the script's tools: the main process runs with the profile's one. */
  userHome: string;
  /** Ends the process, so the swap stays complete while nothing of the app runs. */
  quit: () => void;
  platform?: NodeJS.Platform;
}

const isBusy = (phase: PersonalUpdateStatus["phase"]): boolean => isPersonalUpdateBusy(phase);

export class PersonalUpdateService extends EventEmitter<PersonalUpdateServiceEvents> {
  readonly #options: PersonalUpdateServiceOptions;
  #child: ChildProcess | null = null;
  #poll: NodeJS.Timeout | undefined;
  #last: PersonalUpdateStatus = { phase: "idle", conflicts: [] };

  constructor(options: PersonalUpdateServiceOptions) {
    super();
    this.#options = options;
  }

  /** An end state that an earlier run left keeps its place: a conflict or a failure stays visible. */
  start(): void {
    const status = this.#readStatusFile();
    if (status !== null && !isBusy(status.phase) && status.phase !== "ready") this.#last = status;
  }

  getStatus(): PersonalUpdateStatus {
    return this.#clean(this.#last);
  }

  async check(): Promise<PersonalUpdateStatus> {
    this.#startRun(["check"]);
    return this.getStatus();
  }

  async updateNow(): Promise<PersonalUpdateStatus> {
    // A conflict that the user fixed, and a ready build that lost its install, skip the merge and
    // go straight to the build and the swap.
    const rebuild = this.#last.phase === "conflict" || this.#last.phase === "ready";
    this.#startRun(rebuild ? ["update", "--rebuild"] : ["update"]);
    return this.getStatus();
  }

  /** Quits into the build behind the `current` link, which the swap of an update moved forward. */
  async restart(): Promise<void> {
    if (this.#options.platform !== "linux") {
      throw new Error("The personal build restart runs on Linux only.");
    }
    const binary = join(this.#options.updatesDirectory, "current", BINARY_NAME);
    if (!existsSync(binary)) {
      throw new Error("The personal build is not where this app expects it.");
    }
    spawn("bash", ["-c", `sleep 1; exec ${JSON.stringify(binary)}`], {
      detached: true,
      stdio: "ignore",
    }).unref();
    this.#options.quit();
  }

  stop(): void {
    if (this.#poll !== undefined) clearInterval(this.#poll);
    this.#poll = undefined;
    this.#child?.kill();
    this.#child = null;
  }

  #startRun(args: readonly string[]): void {
    if (isBusy(this.#last.phase) && this.#child !== null) return;
    const startedAt = new Date().toISOString();
    // The seeds retire the status file of an older run, so the poll of this run takes status that
    // this run wrote.
    this.#writeSeeds();
    this.#setStatus({ phase: args[0] === "check" ? "checking" : "fetching", conflicts: [], startedAt });
    try {
      const child = spawn("bash", [this.#options.scriptPath, "--repo", this.#options.repoWorktree, ...args], {
        cwd: this.#options.repoWorktree,
        env: {
          ...process.env,
          HOME: this.#options.userHome,
          OPENBOT_PERSONAL_USER_HOME: this.#options.userHome,
        },
        stdio: "ignore",
      });
      const runStartedAt = startedAt;
      child.on("exit", (code) => {
        this.#child = null;
        this.#endRun(runStartedAt, code);
      });
      this.#child = child;
      this.#poll = setInterval(() => this.#pollRun(runStartedAt), POLL_MS);
    } catch (error) {
      logger.warn("OpenBot Personal could not start its update script:", toLogValue(error));
      this.#setStatus({ phase: "error", conflicts: [], startedAt, finishedAt: new Date().toISOString() });
    }
  }

  /** A status belongs to the run when both started stamps mean the same moment. */
  #startedWithRun(fileStartedAt: string | undefined, runStartedAt: string): boolean {
    if (fileStartedAt === undefined) return false;
    if (fileStartedAt === runStartedAt) return true;
    const fileTime = Date.parse(fileStartedAt);
    const runTime = Date.parse(runStartedAt);
    if (Number.isNaN(fileTime) || Number.isNaN(runTime)) return false;
    return Math.abs(fileTime - runTime) < RUN_NEAR_MS;
  }

  /** The script writes each phase into its status file; the poll lifts a change into the app. */
  #pollRun(runStartedAt: string): void {
    const status = this.#readStatusFile();
    if (status === null || !this.#startedWithRun(status.startedAt, runStartedAt)) return;
    this.#setStatus(status);
  }

  #endRun(runStartedAt: string, code: number | null): void {
    if (this.#poll !== undefined) clearInterval(this.#poll);
    this.#poll = undefined;
    const status = this.#readStatusFile();
    if (status === null || !this.#startedWithRun(status.startedAt, runStartedAt) || isBusy(status.phase)) {
      this.#setStatus({
        phase: "error",
        conflicts: [],
        startedAt: this.#last.startedAt,
        finishedAt: new Date().toISOString(),
      });
      if (code !== 0) logger.warn("OpenBot Personal update script stopped:", `exit ${String(code)}`);
      return;
    }
    this.#setStatus(status);
  }

  #writeSeeds(): void {
    const file = join(this.#options.updatesDirectory, STATUS_FILE);
    try {
      writeFileSync(`${file}.next`, JSON.stringify(this.#last));
      renameSync(`${file}.next`, file);
    } catch {
      // The home may not exist yet; the script creates it at its first write.
    }
  }

  #readStatusFile(): PersonalUpdateStatus | null {
    let raw: string;
    try {
      raw = readFileSync(join(this.#options.updatesDirectory, STATUS_FILE), "utf8");
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isDynamicRecord(parsed)) return null;
    const { phase, conflicts, message, tag, version, installDir, startedAt, finishedAt } = parsed;
    if (!isOneOf(PERSONAL_UPDATE_PHASES, phase)) return null;
    return {
      phase,
      conflicts: Array.isArray(conflicts) && conflicts.every(isString) ? [...conflicts] : [],
      ...(isString(message) ? { message } : {}),
      ...(isString(tag) ? { tag } : {}),
      ...(isString(version) ? { version } : {}),
      ...(isString(installDir) ? { installDir } : {}),
      ...(isString(startedAt) ? { startedAt } : {}),
      ...(isString(finishedAt) ? { finishedAt } : {}),
    };
  }

  #setStatus(next: PersonalUpdateStatus): void {
    const same =
      this.#last.phase === next.phase &&
      this.#last.tag === next.tag &&
      this.#last.version === next.version &&
      this.#last.startedAt === next.startedAt;
    this.#last = next;
    if (!same) this.emit("status", this.#clean(next));
  }

  /** A field that holds undefined stays away from the IPC payload: the decoder drops records that carry one. */
  #clean(status: PersonalUpdateStatus): PersonalUpdateStatus {
    const { message, tag, version, installDir, startedAt, finishedAt } = status;
    return {
      phase: status.phase,
      conflicts: [...status.conflicts],
      ...(message === undefined ? {} : { message }),
      ...(tag === undefined ? {} : { tag }),
      ...(version === undefined ? {} : { version }),
      ...(installDir === undefined ? {} : { installDir }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(finishedAt === undefined ? {} : { finishedAt }),
    };
  }
}
