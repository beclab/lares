import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { ModelsSettings, settingsCss } from "./settings.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/chat-model", settingsCss, "lares-chat-model-css");

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
}
