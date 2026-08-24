import { createHeaderTabs } from "./HeaderTabs.js";
import { createPreviewDock } from "./PreviewDock.js";
import { createPreviewView } from "./PreviewView.js";
import { installPreviewClicks } from "./clicks.js";
import { EN, ZH } from "./locale.js";
import styles from "./styles.css";
import { FilePreviewWorkspace } from "./workspace.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

const NS = "lares.file-preview";

export const inject = [];

export function apply(ctx) {
  const workspace = new FilePreviewWorkspace();
  installPluginStyle(ctx, "@lares/file-preview", styles, "lares-file-preview-css");
  installPreviewClicks(ctx, workspace);

  ctx.inject(["slots", "locale"], (scope) => {
    scope.effect(
      () => scope.locale.register(NS, { zh: ZH, en: EN }),
      "lares-file-preview-locale",
    );
    const t = scope.locale.bind(NS);
    const HeaderTabs = createHeaderTabs(workspace, t);
    const PreviewView = createPreviewView(workspace, t);
    const PreviewDock = createPreviewDock(workspace, PreviewView);

    scope.slots.inject("conversation.session.header.actions", () =>
      scope.slots.register(
        {
          name: "conversation.session.header.actions",
          id: "lares-file-preview-tabs",
          order: -10,
          label: () => t("preview"),
        },
        HeaderTabs,
      ),
    );

    scope.slots.inject("conversation.input.dock", () =>
      scope.slots.register(
        {
          name: "conversation.input.dock",
          id: "lares-file-preview-overlay",
          order: 90,
          label: () => t("preview"),
        },
        PreviewDock,
      ),
    );
  });
}
