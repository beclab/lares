import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { ModelsSettings, settingsCss } from "./settings.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@dina/models", settingsCss, "dina-models-css");

  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("dina.models", { zh: ZH, en: EN }), "dina-models-locale");
    bindTranslate(scope.locale);

    const translate = getTranslate();

    // Takes the official Models page's id and order; that page is disabled in
    // @dina/bundle-web, since provider routes and credentials belong to Router.
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
