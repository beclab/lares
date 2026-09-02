import { EN, ZH } from "./locale.js";
import { attachedModel3dHosts, subscribeModel3dHost } from "../../../shared/client/model3d-host.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";
import styles from "./styles.css";
import { mountModel3d, unmountModel3d } from "./viewer.js";

const NS = "lares.workspace-preview-3d";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/workspace-preview-3d", styles, "lares-workspace-preview-3d-css");

  ctx.inject(["locale"], (scope) => {
    scope.effect(
      () => scope.locale.register(NS, { zh: ZH, en: EN }),
      "lares-workspace-preview-3d-locale",
    );
    const t = scope.locale.bind(NS);
    const messages = () => ({
      loading: t("loading"),
      failed: t("failed"),
      hint: t("hint"),
    });

    scope.effect(
      () => {
        const stop = subscribeModel3dHost((event) => {
          if (event.type === "detach") {
            unmountModel3d(event.node);
            return;
          }
          mountModel3d(event.node, {
            src: event.src,
            title: event.title,
            compact: event.compact === true,
            messages: messages(),
          });
        });
        return () => {
          stop();
          for (const node of attachedModel3dHosts()) unmountModel3d(node);
        };
      },
      "lares-workspace-preview-3d-hosts",
    );
  });
}
