import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { SkillsSettings, settingsCss } from "./settings.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/skill-packs", settingsCss, "lares-skill-packs-css");

  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.skills", { zh: ZH, en: EN }), "lares-skills-locale");
    bindTranslate(scope.locale);
    const translate = getTranslate();
    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        {
          name: "settings.section",
          id: "lares-skills",
          order: 13,
          label: () => translate("settings.nav"),
        },
        SkillsSettings,
      ),
    );
  });
}
