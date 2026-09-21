import React from "react";
import { createHeaderTabs } from "./HeaderTabs.js";
import { createPreviewOverlay } from "./PreviewOverlay.js";
import { createPreviewView } from "./PreviewView.js";
import { createTurnMedia } from "./TurnMedia.js";
import { selectInlineTurnMedia } from "@olares/lares-core/files/deliverables";
import { laresPublishedDefinition } from "@olares/lares-core/files/published-turn-data";
import { EN, ZH } from "./locale.js";
import { installPathOpener } from "./open.js";
import styles from "./styles.css";
import { FilePreviewWorkspace } from "@olares/lares-core/files/preview-workspace";
import { ChatScrollport } from "./chat-scrollport.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

const h = React.createElement;
const { useEffect, useSyncExternalStore } = React;
const NS = "lares.workspace-preview";

export const inject = [];

export function apply(ctx) {
  const workspace = new FilePreviewWorkspace(new ChatScrollport());
  installPluginStyle(ctx, "@lares/workspace-preview", styles, "lares-workspace-preview-css");
  installPathOpener(ctx, workspace);

  ctx.inject(["slots", "locale", "uiConversation"], (scope) => {
    scope.uiConversation.events.register(laresPublishedDefinition);
    scope.effect(
      () => scope.locale.register(NS, { zh: ZH, en: EN }),
      "lares-workspace-preview-locale",
    );
    const t = scope.locale.bind(NS);
    const HeaderTabs = createHeaderTabs(workspace, t);
    const PreviewView = createPreviewView(workspace, t);
    const PreviewOverlay = createPreviewOverlay(workspace, PreviewView);
    const TurnMedia = createTurnMedia(t);

    // The header seat is the session-scope mount: the overlay hides the input
    // zone, so it cannot be rendered from a seat inside it.
    function FilePreviewSurface({ sessionId }) {
      const cwd = useSyncExternalStore(
        (listener) => ctx.get("sessions")?.list?.subscribe?.(listener) ?? (() => {}),
        () => ctx.get("sessions")?.list?.getSnapshot?.().byId?.[sessionId]?.cwd,
      );
      useEffect(() => workspace.bindCurrent(sessionId, cwd), [sessionId, cwd]);
      return h(
        React.Fragment,
        null,
        h(HeaderTabs, { sessionId }),
        h(PreviewOverlay, { sessionId }),
      );
    }

    scope.slots.inject("conversation.session.header.actions", () =>
      scope.slots.register(
        {
          name: "conversation.session.header.actions",
          id: "lares-workspace-preview",
          order: -10,
          label: () => t("preview"),
        },
        FilePreviewSurface,
      ),
    );
    // Files are read in this overlay, not in dsh's right column, so the corner
    // seat would only offer a way into an empty panel. The seat is laid out
    // only while its occupant shows something: one that renders nothing empties
    // the corner and gives the header's edge back to the utilities.
    scope.slots.inject("conversation.session.header.corner", () =>
      scope.slots.register(
        { name: "conversation.session.header.corner", id: "lares-no-right-column", priority: -1 },
        () => null,
      ),
    );
    scope.slots.inject("conversation.chat.turnTail", () =>
      scope.slots.register(
        {
          name: "conversation.chat.turnTail",
          priority: -100,
          select: selectInlineTurnMedia,
        },
        TurnMedia,
      ),
    );
  });
}
