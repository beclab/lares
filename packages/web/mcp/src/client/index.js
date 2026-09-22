import { installPluginStyle } from "../../../shared/client/plugin-style.js";
import { attachLocale, bindTranslate, EN, getTranslate, ZH } from "./locale.js";
import { McpSettings, settingsCss } from "./settings.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/mcp", settingsCss, "lares-mcp-css");
  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.mcp", { zh: ZH, en: EN }), "lares-mcp-locale");
    bindTranslate(scope.locale);
    const translate = getTranslate();
    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        {
          name: "settings.section",
          id: "lares-mcp",
          order: 14,
          label: () => translate("settings.nav"),
        },
        McpSettings,
      ),
    );
  });
}
