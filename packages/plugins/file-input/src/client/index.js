import { createAttachmentButton } from "./AttachmentButton.js";
import { uploadFile } from "./api.js";
import { FileIntake } from "./intake.js";
import { EN, ZH, attachLocale, bindTranslate, getTranslate } from "./locale.js";
import { insertUploadReferences } from "./reference.js";
import styles from "./styles.css";
import { createUploadFailures } from "./UploadFailures.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/file-input", styles, "lares-file-input-css");

  ctx.inject(["slots", "locale", "conversation", "sessions"], (scope) => {
    attachLocale(scope.locale);
    scope.effect(() => scope.locale.register("lares.files", { zh: ZH, en: EN }), "lares-file-input-locale");
    bindTranslate(scope.locale);
    const t = getTranslate();
    const intake = new FileIntake(uploadFile);

    const commitFor = (sessionId) => (paths) => {
      const sessionCtx = scope.sessions.scope(sessionId);
      if (sessionCtx === undefined) return;
      const input = scope.conversation.input.for(sessionCtx);
      for (const path of insertUploadReferences(input, paths)) {
        input.notify("error", t("upload.unlinked", { path }));
      }
    };

    const AttachmentButton = createAttachmentButton(scope.conversation, intake, commitFor);
    const UploadFailures = createUploadFailures(intake, commitFor);

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
