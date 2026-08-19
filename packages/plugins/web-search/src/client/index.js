import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { HideOfficialWebSearchCard, WebSearchSettings, settingsCss } from "./settings.js";

export const inject = [];

export function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@dina/web-search";
    tag.dataset.pluginCss = "@dina/web-search";
    tag.textContent = settingsCss;
    document.head.append(tag);
    return () => tag.remove();
  }, "dina-web-search-css");

  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("dina.webSearch", { zh: ZH, en: EN }), "dina-web-search-locale");
    bindTranslate(scope.locale);

    const translate = getTranslate();

    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        {
          name: "settings.section",
          id: "dina-web-search",
          order: 35,
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
