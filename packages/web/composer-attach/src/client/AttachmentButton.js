import React from "react";
import { IconLoadingOutline16, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@olares/lares-core/files/limits";
import {
  claimComposerBlock,
  commitComposerImages,
  composerAttachReady,
  composerDropHasDocuments,
  composerPasteInCard,
  documentPasteFiles,
  processComposerFiles,
} from "@olares/lares-core/files/intake";
import { useT } from "./locale.js";

const h = React.createElement;
const { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } = React;
const MAX_UPLOAD_BYTES = DEFAULT_MAX_UPLOAD_BYTES;

function AttachmentGlyph() {
  return h(
    "svg",
    { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
    h("path", {
      d: "M5.1 8.8 9.65 4.25a2.15 2.15 0 0 1 3.04 3.04L7.2 12.78a3.25 3.25 0 0 1-4.6-4.6l5.14-5.13",
      stroke: "currentColor",
      strokeWidth: 1.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

export function createAttachmentButton(conversation, intake, commitFor) {
  return function AttachmentButton(props) {
    const t = useT();
    const input = props.inputActions;
    const sessionId = props.sessionId ?? props.session?.sessionId;
    const phase = props.useInput ? props.useInput((state) => state?.phase ?? null) : props.input?.phase ?? null;
    const upload = useSyncExternalStore(
      (listener) => intake.subscribe(sessionId, listener),
      () => intake.getSnapshot(sessionId),
    );
    const fileInputRef = useRef(null);
    const pending = upload.pending > 0;
    const ready = composerAttachReady({
      phase,
      pending,
      addImages: input?.addImages,
      sessionId,
    });

    useEffect(() => {
      if (!pending || typeof sessionId !== "string") return undefined;
      return claimComposerBlock(conversation.blocks, sessionId, t("upload.blocked"));
    }, [conversation, pending, sessionId, t]);

    useEffect(() => () => {
      if (typeof sessionId === "string") intake.cancelSession(sessionId);
    }, [intake, sessionId]);

    const commit = useMemo(() => commitFor(sessionId), [sessionId]);

    const addImages = useCallback((files) => {
      commitComposerImages({
        createDraftImages: (next) => conversation.createDraftImages(next),
        addImages: (ids) => input.addImages(ids),
        releaseDraftImages: (attachments) => conversation.releaseDraftImages(attachments),
        reportFailure: (id, file, code) => intake.reportFailure(id, file, code),
      }, files, sessionId);
    }, [conversation, input, intake, sessionId]);

    const processFiles = useCallback((incoming) => {
      void processComposerFiles({
        ready,
        sessionId,
        maxBytes: MAX_UPLOAD_BYTES,
        addImages,
        reportFailure: (id, file, code) => intake.reportFailure(id, file, code),
        uploadFiles: (id, files, next) => intake.uploadFiles(id, files, next),
        commit,
      }, incoming);
    }, [addImages, commit, intake, ready, sessionId]);

    const processRef = useRef(processFiles);
    processRef.current = processFiles;

    useEffect(() => {
      const onPaste = (event) => {
        if (!ready || !composerPasteInCard(event.target)) return;
        const files = documentPasteFiles(event.clipboardData);
        if (files === null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void processRef.current(files);
      };
      const onDrop = (event) => {
        if (!ready) return;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!composerDropHasDocuments(files)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void processRef.current(files);
      };
      document.addEventListener("paste", onPaste, true);
      document.addEventListener("drop", onDrop, true);
      return () => {
        document.removeEventListener("paste", onPaste, true);
        document.removeEventListener("drop", onDrop, true);
      };
    }, [input, ready]);

    const disabled = !ready;
    const label = pending
      ? t("button.uploading", { count: upload.pending })
      : ready
        ? t("button.idle")
        : t("button.blocked");

    return h(
      React.Fragment,
      null,
      h("input", {
        ref: fileInputRef,
        type: "file",
        multiple: true,
        className: "lares-file-picker-input",
        onChange: (event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void processFiles(files);
        },
      }),
      h(
        Tooltip,
        { label, side: "top", delayMs: 500 },
        h(
          "button",
          {
            type: "button",
            className: "lares-file-picker",
            "data-phase": pending ? "uploading" : "idle",
            "aria-label": label,
            disabled,
            onClick: () => fileInputRef.current?.click(),
          },
          pending
            ? h(IconLoadingOutline16, { size: 14, className: "lares-file-picker-spin" })
            : h(AttachmentGlyph),
        ),
      ),
    );
  };
}
