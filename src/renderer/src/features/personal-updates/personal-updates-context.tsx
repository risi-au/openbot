import type { PersonalUpdateStatus } from "@openbot/contracts/ipc";
import { isPersonalUpdateBusy } from "@openbot/contracts/ipc";
import { createSignal, flush, onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { personalUpdatePort } from "./personal-update-port";

/** The status before main answers, and the one a preview run that never wrote a file falls back to. */
export const FALLBACK_PERSONAL_UPDATE_STATUS: PersonalUpdateStatus = {
  phase: "idle",
  conflicts: [],
};

export interface PersonalUpdatesValue {
  status: () => PersonalUpdateStatus;
  /** True while the run works: the busy phases the script walks one after the other. */
  busy: () => boolean;
  check: () => Promise<void>;
  updateNow: () => Promise<void>;
  restart: () => Promise<void>;
}

/**
 * The fork's own updater, as the renderer sees it: one status main pushes, and the three actions
 * of its settings card. Like the app updater, ungated: the app is fully usable while a run works.
 */
const PersonalUpdates = createSimpleContext({
  name: "PersonalUpdates",
  init: () => {
    const [status, setStatus] = createSignal<PersonalUpdateStatus>(FALLBACK_PERSONAL_UPDATE_STATUS);
    const busy = () => isPersonalUpdateBusy(status().phase);

    onSettled(() => {
      const unsubscribe = personalUpdatePort().personalUpdate.onEvent((next) => {
        flush(() => setStatus(next));
      });
      void personalUpdatePort()
        .personalUpdate.getStatus()
        .then(setStatus)
        .catch(() => undefined);
      return unsubscribe;
    });

    async function check(): Promise<void> {
      setStatus(await personalUpdatePort().personalUpdate.check());
    }

    /** One button: an update that a conflict interrupted rebuilds from the resolved tree. */
    async function updateNow(): Promise<void> {
      setStatus(await personalUpdatePort().personalUpdate.updateNow());
    }

    async function restart(): Promise<void> {
      await personalUpdatePort().personalUpdate.restart();
    }

    return { status, busy, check, updateNow, restart };
  },
});

export const PersonalUpdatesProvider = PersonalUpdates.provider;
export const usePersonalUpdates = PersonalUpdates.use;
