import { MicButton, micCss } from "./MicButton.js";
import { spinCss } from "./icons.js";
import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { VoiceSettings, settingsCss } from "./settings.js";

const PLUGIN_CSS = [spinCss, micCss, settingsCss].join("");

export const inject = [];

export function apply(ctx) {
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@dina/voice-input";
    tag.dataset.pluginCss = "@dina/voice-input";
    // Appended after the shell stylesheet, so equal-specificity overrides on primitives win.
    tag.textContent = PLUGIN_CSS;
    document.head.append(tag);
    return () => tag.remove();
  }, "dina-voice-input-css");

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
        { name: "settings.section", id: "dina-voice-input", order: 40, label: () => translate("settings.title") },
        VoiceSettings,
      ),
    );
  });
}
