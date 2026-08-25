import React from "react";
import { createHeaderTabs } from "./HeaderTabs.js";
import { createPreviewOverlay } from "./PreviewOverlay.js";
import { createPreviewView } from "./PreviewView.js";
import { createTurnMedia } from "./TurnMedia.js";
import { selectProducedFiles } from "./deliverables.js";
import { EN, ZH } from "./locale.js";
import { installPathOpener } from "./open.js";
import styles from "./styles.css";
import { FilePreviewWorkspace } from "./workspace.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

const h = React.createElement;
const NS = "lares.file-preview";

export const inject = [];

export function apply(ctx) {
  const workspace = new FilePreviewWorkspace();
  installPluginStyle(ctx, "@lares/file-preview", styles, "lares-file-preview-css");
  installPathOpener(ctx, workspace);

  ctx.inject(["slots", "locale"], (scope) => {
    scope.effect(
      () => scope.locale.register(NS, { zh: ZH, en: EN }),
      "lares-file-preview-locale",
    );
    const t = scope.locale.bind(NS);
    const HeaderTabs = createHeaderTabs(workspace, t);
    const PreviewView = createPreviewView(workspace, t);
    const PreviewOverlay = createPreviewOverlay(workspace, PreviewView);
    const TurnMedia = createTurnMedia(t);

    // The header seat is the session-scope mount: the overlay hides the input
    // zone, so it cannot be rendered from a seat inside it.
    function FilePreviewSurface({ sessionId }) {
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
          id: "lares-file-preview",
          order: -10,
          label: () => t("preview"),
        },
        FilePreviewSurface,
      ),
    );
    scope.slots.inject("conversation.chat.turnTail", () =>
      scope.slots.register(
        {
          name: "conversation.chat.turnTail",
          priority: -100,
          select: selectProducedFiles,
        },
        TurnMedia,
      ),
    );
  });
}
