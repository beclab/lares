import { MicButton, micCss } from "./MicButton.js";
import { spinCss } from "./icons.js";
import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { VoiceSettings, settingsCss } from "./settings.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

const PLUGIN_CSS = [spinCss, micCss, settingsCss].join("");

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@dina/voice-input", PLUGIN_CSS, "dina-voice-input-css");

  ctx.inject(["slots", "locale"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("dina.voice", { zh: ZH, en: EN }), "dina-voice-locale");
    bindTranslate(scope.locale);

    const translate = getTranslate();

    scope.slots.inject("conversation.input.right", () =>
      scope.slots.register(
        { name: "conversation.input.right", id: "dina-voice", order: 50, label: () => translate("settings.title") },
        MicButton,
      ),
    );
    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        { name: "settings.section", id: "dina-voice-input", order: 12, label: () => translate("settings.title") },
        VoiceSettings,
      ),
    );
  });
}
