// The personal fork update: the same flow its script drives, reached from the settings card.

import type { PersonalUpdateService } from "../personal-update-service";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

export interface PersonalUpdateIpcDependencies {
  personalUpdate: Pick<PersonalUpdateService, "getStatus" | "check" | "updateNow" | "restart">;
}

export function personalUpdateIpcHandlers({
  personalUpdate,
}: PersonalUpdateIpcDependencies): Pick<IpcGroupHandlers, "personalUpdate"> {
  return {
    personalUpdate: {
      getStatus: handler(() => personalUpdate.getStatus()),
      check: handler(() => personalUpdate.check()),
      updateNow: handler(() => personalUpdate.updateNow()),
      restart: handler(() => personalUpdate.restart()),
    },
  };
}
