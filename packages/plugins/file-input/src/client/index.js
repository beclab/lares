import { createAttachmentButton } from "./AttachmentButton.js";
import { EN, ZH, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import styles from "./styles.css";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/file-input", styles, "lares-file-input-css");

  ctx.inject(["slots", "locale", "conversation"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.files", { zh: ZH, en: EN }), "lares-file-input-locale");
    bindTranslate(scope.locale);
    const t = getTranslate();
    const AttachmentButton = createAttachmentButton(scope.conversation);

    scope.slots.inject("conversation.input.left", () =>
      scope.slots.register(
        {
          name: "conversation.input.left",
          id: "lares-file-input",
          order: 10,
          label: () => t("button.idle"),
        },
        AttachmentButton,
      ),
    );
  });
}
