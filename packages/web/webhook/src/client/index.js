import { installPluginStyle } from "../../../shared/client/plugin-style.js";
import { attachLocale, bindTranslate, EN, getTranslate, ZH } from "./locale.js";
import { settingsCss, WebhookSettings } from "./settings.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/webhook", settingsCss, "lares-webhook-css");
  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.webhook", { zh: ZH, en: EN }), "lares-webhook-locale");
    bindTranslate(scope.locale);
    const translate = getTranslate();
    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        {
          name: "settings.section",
          id: "lares-webhook",
          order: 15,
          label: () => translate("settings.nav"),
        },
        WebhookSettings,
      ),
    );
  });
}
