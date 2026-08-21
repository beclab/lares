import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { ModelsSettings, settingsCss } from "./settings.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/models", settingsCss, "lares-models-css");

  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.models", { zh: ZH, en: EN }), "lares-models-locale");
    bindTranslate(scope.locale);

    const translate = getTranslate();

    // Takes the official Models page's id and order; that page is disabled in
    // @lares/bundle-web, since provider routes and credentials belong to Router.
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
