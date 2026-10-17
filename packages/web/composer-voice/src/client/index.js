import React from "react";
import { resolveSubmitMode } from "@olares/lares-core/larepass/submission-settings";
import { InlineVoice } from "./inline.js";
import { MicButton, micCss } from "./MicButton.js";
import { createWebVoicePanel, VoicePanel } from "./panel.js";
import { useVoiceHistory } from "./history.js";
import { VoiceTimeline } from "./timeline.js";
import { spinCss } from "./icons.js";
import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { VoiceSettings, settingsCss } from "./settings.js";
import { SpeechPlayer } from "./speech.js";
import { speechDefinition, speechView } from "./speech-view.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

const h = React.createElement;

const PLUGIN_CSS = [spinCss, micCss, settingsCss].join("");

export const inject = [];

function VoiceComposer(props) {
  const [active, setActive] = React.useState(false);
  const history = useVoiceHistory(props.sessionId);
  React.useEffect(() => {
    if (!props.sessionId) return;
    const binding = props.uiConversation.binding(props.sessionId);
    binding.setExternalActivity("lares.voice", "chat", history.records.length > 0);
    return () => binding.setExternalActivity("lares.voice", "chat", false);
  }, [props.sessionId, props.uiConversation, history.records.length]);
  return h(
    React.Fragment,
    null,
    h(MicButton, { ...props, onActive: setActive }),
    h(SpeechPlayer, { sessionId: props.sessionId, conversation: props.uiConversation, suspended: active }),
  );
}

function steeringAvailable(snap) {
  const subagent = snap.subagent ?? null;
  return subagent === null || subagent.address?.mode === "continuable";
}


export function apply(ctx) {
  installPluginStyle(ctx, "@lares/composer-voice", PLUGIN_CSS, "lares-composer-voice-css");

  ctx.inject(["slots", "locale", "uiConversation", "sessions", "conversation", "configForms", "uiWorkspace"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.voice", { zh: ZH, en: EN }), "lares-voice-locale");
    bindTranslate(scope.locale);
    scope.effect(() => {
      const stopEvents = scope.uiConversation.events.register(speechDefinition);
      const stopViews = scope.uiConversation.views.register(speechView);
      return () => {
        stopEvents();
        stopViews();
      };
    }, "lares-voice-speech");

    const translate = getTranslate();
    const panel = createWebVoicePanel((sessionId) => scope.uiWorkspace.openSession(sessionId));
    scope.effect(() => () => { void panel.dispose().catch(() => {}); }, "lares-voice-panel-lifetime");
    scope.slots.inject("shell.overlay", () => scope.slots.register({ name: "shell.overlay", id: "lares-voice-panel" }, () => h(VoicePanel, { panel })));
    scope.slots.inject("conversation.chat.timeline", () => scope.slots.register({ name: "conversation.chat.timeline", id: "lares-voice-records", select: () => ({}) }, (props) => h(VoiceTimeline, { ...props, panel })));

    scope.slots.inject("conversation.input.overlay", () => scope.slots.register({ name: "conversation.input.overlay", id: "lares-voice-inline" }, () => h(InlineVoice, { panel })));

    scope.slots.inject("conversation.input.right", () =>
      scope.slots.register(
        { name: "conversation.input.right", id: "lares-voice", order: 50, label: () => translate("settings.title") },
        function VoiceInput(props) {
          return h(VoiceComposer, {
            ...props,
            panel,
            uiConversation: scope.uiConversation,
            mode: () => {
              const session = scope.sessions.binding(props.sessionId)?.session;
              const snap = session?.getSnapshot();
              const preferred = scope.configForms.get("ui-conversation").getSnapshot().value?.busyEnter;
              return resolveSubmitMode(Boolean(snap?.running), false, steeringAvailable(snap || {}), preferred);
            },
          });
        },
      ),
    );
    scope.slots.inject("settings.section", () =>
      scope.slots.register(
        { name: "settings.section", id: "lares-composer-voice", order: 12, label: () => translate("settings.title") },
        VoiceSettings,
      ),
    );
  });
}
