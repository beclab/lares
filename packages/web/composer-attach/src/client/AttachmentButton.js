import React from "react";
import { IconLoadingOutline16, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@lares/core/files/limits";
import { claimComposerBlock, documentPasteFiles, partitionDocumentsBySize, splitComposerFiles } from "./intake.js";
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
    const ready = phase === "plain"
      && !pending
      && typeof input?.addImages === "function"
      && typeof sessionId === "string";

    useEffect(() => {
      if (!pending || typeof sessionId !== "string") return undefined;
      return claimComposerBlock(conversation.blocks, sessionId, t("upload.blocked"));
    }, [conversation, pending, sessionId, t]);

    useEffect(() => () => {
      if (typeof sessionId === "string") intake.cancelSession(sessionId);
    }, [intake, sessionId]);

    const commit = useMemo(() => commitFor(sessionId), [sessionId]);

    const addImages = useCallback((files) => {
      if (files.length === 0) return;
      let attachments = [];
      try {
        attachments = conversation.createDraftImages(files);
        if (!input.addImages(attachments.map((attachment) => attachment.id))) {
          conversation.releaseDraftImages(attachments);
          for (const file of files) intake.reportFailure(sessionId, file, "file_input_blocked");
        }
      } catch (reason) {
        if (attachments.length > 0) conversation.releaseDraftImages(attachments);
        const code = reason instanceof Error ? reason.message : "file_upload_failed";
        for (const file of files) intake.reportFailure(sessionId, file, code);
      }
    }, [conversation, input, intake, sessionId]);

    const processFiles = useCallback((incoming) => {
      if (!ready || incoming.length === 0) return;
      const files = [...incoming];
      const { images, documents } = splitComposerFiles(files);
      addImages(images);
      if (documents.length === 0) return;
      const { accepted, oversized } = partitionDocumentsBySize(documents, MAX_UPLOAD_BYTES);
      for (const file of oversized) intake.reportFailure(sessionId, file, "file_too_large");
      void intake.uploadFiles(sessionId, accepted, commit);
    }, [addImages, commit, intake, ready, sessionId]);

    const processRef = useRef(processFiles);
    processRef.current = processFiles;

    useEffect(() => {
      const onPaste = (event) => {
        if (!ready || !(event.target instanceof Element) || !event.target.closest("[data-composer-card]")) return;
        const files = documentPasteFiles(event.clipboardData);
        if (files === null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void processRef.current(files);
      };
      const onDrop = (event) => {
        if (!ready) return;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0 || splitComposerFiles(files).documents.length === 0) return;
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
