import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { WebSearchSettings, settingsCss } from "./settings.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/router-search", settingsCss, "lares-router-search-css");

  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.webSearch", { zh: ZH, en: EN }), "lares-web-search-locale");
    bindTranslate(scope.locale);

    const translate = getTranslate();

    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        {
          name: "settings.section",
          id: "lares-web-search",
          order: 11,
          label: () => translate("settings.title"),
        },
        WebSearchSettings,
      ),
    );
  });
}
