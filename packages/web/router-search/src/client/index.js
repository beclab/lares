import * as fetchLocale from "./fetch-locale.js";
import { WebFetchSettings } from "./fetch-settings.js";
import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { WebSearchSettings, settingsCss } from "./settings.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/router-search", settingsCss, "lares-router-search-css");

  ctx.inject(["slots", "locale"], (scope) => {
    fetchLocale.attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.webFetch", { zh: fetchLocale.ZH, en: fetchLocale.EN }), "lares-web-fetch-locale");
    fetchLocale.bindTranslate(scope.locale);
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.webSearch", { zh: ZH, en: EN }), "lares-web-search-locale");
    bindTranslate(scope.locale);

    const translate = getTranslate();
    const translateFetch = fetchLocale.getTranslate();
    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        { name: "settings.section", id: "lares-web-fetch", order: 11.5, label: () => translateFetch("settings.title") },
        WebFetchSettings,
      ),
    );

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
