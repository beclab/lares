import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { ModelsSettings, settingsCss } from "./settings.js";
import modelCss from "./styles/model.css";
import { ModelSwitch, bindLocale, registerLocale, t, HideModelSeat } from "./model-switch.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";
import { bindComposerModelDirectory, isComposerModelAvailable } from "@lares/core/router/session-model";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/chat-model", `${settingsCss}${modelCss}`, "lares-chat-model-css");

  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.chat-model", { zh: ZH, en: EN }), "lares-chat-model-locale");
    bindTranslate(scope.locale);

    const translate = getTranslate();

    // Takes the official Models page's id and order; that page is disabled in
    // @lares/dsh-overlay, since provider routes and credentials belong to Router.
    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        {
          name: "settings.section",
          id: "models",
          order: 10,
          label: () => translate("settings.nav"),
        },
        ModelsSettings,
      ),
    );
  });

  ctx.inject(["locale"], (scope) => {
    bindLocale(scope.locale);
    scope.effect(() => {
      registerLocale(scope.locale);
    }, "lares-chat-model-switch-locale");
  });

  ctx.inject(["slots", "sessions", "modelDirectories"], (scope) => {
    const models = scope.modelDirectories;
    const sessions = scope.sessions;
    const seat = (sessionId) =>
      bindComposerModelDirectory(
        models.directoryFor(sessionId),
        isComposerModelAvailable(sessions.subagentAddress(sessionId)),
      );

    scope.slots.inject("conversation.input.model", () =>
      scope.slots.register({ name: "conversation.input.model", priority: -1 }, HideModelSeat),
    );
    scope.slots.inject("conversation.input.dock", () =>
      scope.slots.register(
        {
          name: "conversation.input.dock",
          id: "lares-model",
          order: 100,
          label: () => t("slot.model"),
          inject: seat,
        },
        ModelSwitch,
      ),
    );
  });
}
