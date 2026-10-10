import React from "react";
import { resolveSubmitMode } from "@olares/lares-core/larepass/submission-settings";
import { MicButton, micCss } from "./MicButton.js";
import { spinCss } from "./icons.js";
import { ZH, EN, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { VoiceSettings, settingsCss } from "./settings.js";
import { SpeechPlayer, speechDefinition, speechView } from "./speech.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

const h = React.createElement;

const PLUGIN_CSS = [spinCss, micCss, settingsCss].join("");

export const inject = [];

function VoiceComposer(props) {
  return h(
    React.Fragment,
    null,
    h(MicButton, props),
    h(SpeechPlayer, { sessionId: props.sessionId, conversation: props.uiConversation }),
  );
}

function steeringAvailable(snap) {
  const subagent = snap.subagent ?? null;
  return subagent === null || subagent.address?.mode === "continuable";
}

async function sendTranscript(scope, sessionId, text) {
  const spoken = String(text ?? "").trim();
  if (!spoken) return;
  const session = scope.sessions.binding(sessionId)?.session;
  if (!session) throw new Error("voice_failed");
  const snap = session.getSnapshot();
  const preferred = scope.configForms.get("ui-conversation").getSnapshot().value?.busyEnter;
  const mode = resolveSubmitMode(Boolean(snap.running), false, steeringAvailable(snap), preferred);
  const outcome = await scope.conversation.sendSession(session, spoken, [], mode);
  if (outcome?.kind === "error") throw new Error("voice_failed");
}

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/composer-voice", PLUGIN_CSS, "lares-composer-voice-css");

  ctx.inject(["slots", "locale", "uiConversation", "sessions", "conversation", "configForms"], (scope) => {
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

    scope.slots.inject("conversation.input.right", () =>
      scope.slots.register(
        { name: "conversation.input.right", id: "lares-voice", order: 50, label: () => translate("settings.title") },
        function VoiceInput(props) {
          return h(VoiceComposer, {
            ...props,
            uiConversation: scope.uiConversation,
            send: (sessionId, text) => sendTranscript(scope, sessionId, text),
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
