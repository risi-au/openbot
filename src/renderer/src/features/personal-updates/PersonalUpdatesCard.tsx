import { Button, Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@openbot/ui";
import { createMemo, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { usePersonalUpdates } from "./personal-updates-context";

/**
 * The settings card of the fork's own updater. One row: the status as its text, and one button whose
 * meaning the phase gives: check, update (a conflict retries as a rebuild), or restart into the
 * installed build.
 */
export function PersonalUpdatesCard() {
  const { t } = useI18n();
  const personal = usePersonalUpdates();
  const busy = () => personal.busy();

  const action = createMemo(() => {
    switch (personal.status().phase) {
      case "ready":
        return { label: t("settings.personalUpdates.restart"), run: () => personal.restart() };
      case "conflict":
        return {
          label: t("settings.personalUpdates.update"),
          run: () => personal.updateNow(),
          description: t("settings.personalUpdates.conflict"),
        };
      case "error":
        return {
          label: t("settings.personalUpdates.retry"),
          run: () => personal.updateNow(),
          description: t("settings.personalUpdates.error"),
        };
      case "available":
        return {
          label: t("settings.personalUpdates.update"),
          run: () => personal.updateNow(),
        };
      default:
        return { label: t("settings.personalUpdates.check"), run: () => personal.check() };
    }
  });

  return (
    <ItemGroup class="settings-modal-card">
      <Item class="settings-modal-row settings-modal-personal-update-row">
        <ItemContent>
          <ItemTitle>{t("settings.personalUpdates.title")}</ItemTitle>
          <ItemDescription>{t("settings.personalUpdates.description")}</ItemDescription>
          <Show when={personal.status().message !== undefined}>
            <ItemDescription>{personal.status().message}</ItemDescription>
          </Show>
          <Show when={action().description !== undefined}>
            <ItemDescription>{action().description}</ItemDescription>
          </Show>
          <Show when={personal.status().conflicts.length > 0}>
            <ItemDescription>
              {t("settings.personalUpdates.conflictFiles", {
                files: personal.status().conflicts.join(", "),
              })}
            </ItemDescription>
          </Show>
        </ItemContent>
        <ItemActions>
          <Button
            variant="outline"
            type="button"
            size="sm"
            disabled={busy()}
            loading={busy()}
            loadingLabel={t("settings.personalUpdates.busy")}
            onClick={() => void action().run()}
          >
            {personal.status().phase === "current" ? t("settings.personalUpdates.upToDate") : action().label}
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}
