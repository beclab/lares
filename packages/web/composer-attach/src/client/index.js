import { createAttachmentButton } from "./AttachmentButton.js";
import { FileIntake } from "@lares/core/files/intake";
import { uploadFile } from "@lares/core/files/upload-client";
import { EN, ZH, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { createUploadCommit } from "@lares/core/files/mention";
import styles from "./styles.css";
import { createUploadFailures } from "./UploadFailures.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/composer-attach", styles, "lares-composer-attach-css");

  ctx.inject(["slots", "locale", "conversation", "sessions"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.files", { zh: ZH, en: EN }), "lares-composer-attach-locale");
    bindTranslate(scope.locale);
    const t = getTranslate();
    const intake = new FileIntake(uploadFile);

    const commitFor = createUploadCommit({
      scopeSession: (sessionId) => scope.sessions.scope(sessionId),
      inputFor: (sessionCtx) => scope.conversation.input.for(sessionCtx),
      unlinkedMessage: (path) => t("upload.unlinked", { path }),
    });

    const AttachmentButton = createAttachmentButton(scope.conversation, intake, commitFor);
    const UploadFailures = createUploadFailures(intake, commitFor);

    scope.slots.inject("conversation.input.left", () =>
      scope.slots.register(
        {
          name: "conversation.input.left",
          id: "lares-composer-attach",
          order: 10,
          label: () => t("button.idle"),
        },
        AttachmentButton,
      ),
    );
    scope.slots.inject("conversation.input.dock", () =>
      scope.slots.register(
        {
          name: "conversation.input.dock",
          id: "lares-file-upload-failures",
          order: 10,
          label: () => t("upload.failures"),
        },
        UploadFailures,
      ),
    );
  });
}
