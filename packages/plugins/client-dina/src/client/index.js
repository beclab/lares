import shellCss from "./styles/shell.css";
import modelCss from "./styles/model.css";
import { ModelSwitch, bindLocale, registerLocale, t } from "./model-switch.js";
import {
  RetireWelcomeNotice,
  HideOpenDocument,
  RetireStatsLine,
  HideModelSeat,
} from "./shell-overrides.js";

export const inject = [];

export function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.pluginCss = "@dina/client-dina";
    tag.textContent = `${shellCss}\n${modelCss}`;
    document.head.append(tag);
    return () => tag.remove();
  }, "dina-client-css");

  ctx.inject(["locale"], (scope) => {
    bindLocale(scope.locale);
    scope.effect(() => {
      registerLocale(scope.locale);
    }, "dina-client-locale");
  });

  ctx.inject(["slots"], (scope) => {
    scope.slots.inject("settings.onboarding", () =>
      scope.slots.register(
        {
          name: "settings.onboarding",
          id: "welcome-notice",
          priority: -1,
        },
        RetireWelcomeNotice,
      ),
    );
    scope.slots.inject("settings.action", () =>
      scope.slots.register(
        {
          name: "settings.action",
          id: "open-document",
          priority: -1,
        },
        HideOpenDocument,
      ),
    );
    scope.slots.inject("conversation.composer.dock", () =>
      scope.slots.register(
        { name: "conversation.composer.dock", id: "stats", priority: -1 },
        RetireStatsLine,
      ),
    );
  });

  ctx.inject(["slots", "sessions", "modelDirectories"], (scope) => {
    const models = scope.modelDirectories;
    const sessions = scope.sessions;
    const seat = (sessionId) => {
      const directory = models.directoryFor(sessionId);
      const available = sessions.subagentAddress(sessionId) === undefined;
      return {
        available,
        directory: directory.store,
        load: () => {
          if (available) directory.load().catch(() => {});
        },
        select: (selection) =>
          available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
      };
    };

    scope.slots.inject("conversation.input.model", () =>
      scope.slots.register({ name: "conversation.input.model", priority: -1 }, HideModelSeat),
    );
    // High order → chip sits closest to the card.
    scope.slots.inject("conversation.input.dock", () =>
      scope.slots.register(
        {
          name: "conversation.input.dock",
          id: "dina-model",
          order: 100,
          label: () => t("slot.model"),
          inject: seat,
        },
        ModelSwitch,
      ),
    );
  });
}
