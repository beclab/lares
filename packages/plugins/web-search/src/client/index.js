import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { HideOfficialWebSearchCard, WebSearchSettings, settingsCss } from "./settings.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/web-search", settingsCss, "lares-web-search-css");

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

    // Same id as the official Plugins → Web search card; priority -1 shadows it.
    scope.slots.inject("settings.plugin.item", () =>
      scope.slots.register(
        {
          name: "settings.plugin.item",
          id: "web-search",
          priority: -1,
        },
        HideOfficialWebSearchCard,
      ),
    );
  });
}
