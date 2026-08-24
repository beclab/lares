import React from "react";
import { IconLoadingOutline16, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { uploadFile } from "./api.js";
import { messageFor, useT } from "./locale.js";

const h = React.createElement;
const { useCallback, useEffect, useRef, useState } = React;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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

function appendMentions(draft, paths) {
  if (paths.length === 0) return draft;
  const prefix = draft && !/\s$/.test(draft) ? " " : "";
  return `${draft}${prefix}${paths.map((path) => `@${path}`).join(" ")} `;
}

function pasteText(event, draft, setDraft) {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!text) return draft;
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return draft;
  const start = target.selectionStart ?? draft.length;
  const end = target.selectionEnd ?? start;
  const next = `${draft.slice(0, start)}${text}${draft.slice(end)}`;
  setDraft(next);
  requestAnimationFrame(() => {
    const caret = start + text.length;
    target.setSelectionRange(caret, caret);
  });
  return next;
}

async function uploadDocuments(files, sessionId) {
  const results = new Array(files.length);
  let cursor = 0;
  let firstError = null;
  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor++;
      try {
        results[index] = await uploadFile(files[index], sessionId);
      } catch (error) {
        firstError ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  return { uploaded: results.filter(Boolean), error: firstError };
}

export function createAttachmentButton(conversation) {
  return function AttachmentButton(props) {
    const t = useT();
    const input = props.inputActions;
    const sessionId = props.sessionId ?? props.session?.sessionId;
    const draft = props.useInput ? props.useInput((state) => state?.draft ?? "") : props.input?.draft ?? "";
    const phase = props.useInput ? props.useInput((state) => state?.phase ?? null) : props.input?.phase ?? null;
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const fileInputRef = useRef(null);
    const errorTimerRef = useRef(0);
    const [uploading, setUploading] = useState(0);
    const [error, setError] = useState(null);
    const ready = phase === "plain" && typeof input?.setDraft === "function" && typeof sessionId === "string";

    useEffect(() => () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    }, []);

    const fail = useCallback((reason) => {
      const code = reason instanceof Error ? reason.message : String(reason);
      setError(messageFor(t, code));
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => {
        setError(null);
        errorTimerRef.current = 0;
      }, 4000);
    }, [t]);

    const addImages = useCallback((files) => {
      if (files.length === 0) return;
      let attachments = [];
      try {
        attachments = conversation.createDraftImages(files);
        if (!input.addImages(attachments.map((attachment) => attachment.id))) {
          conversation.releaseDraftImages(attachments);
        }
      } catch (reason) {
        if (attachments.length > 0) conversation.releaseDraftImages(attachments);
        fail(reason);
      }
    }, [conversation, fail, input]);

    const processFiles = useCallback(async (incoming) => {
      if (!ready || incoming.length === 0) return;
      const files = [...incoming];
      const images = files.filter((file) => IMAGE_TYPES.has(file.type));
      const documents = files.filter((file) => !IMAGE_TYPES.has(file.type));
      addImages(images);
      if (documents.length === 0) return;
      if (documents.some((file) => file.size > MAX_UPLOAD_BYTES)) {
        fail("file_too_large");
        return;
      }

      setUploading((count) => count + documents.length);
      try {
        const result = await uploadDocuments(documents, sessionId);
        if (result.uploaded.length > 0) {
          const next = appendMentions(draftRef.current, result.uploaded.map((item) => item.path));
          draftRef.current = next;
          input.setDraft(next);
        }
        if (result.error) fail(result.error);
      } finally {
        setUploading((count) => Math.max(0, count - documents.length));
      }
    }, [addImages, fail, input, ready, sessionId]);

    const processRef = useRef(processFiles);
    processRef.current = processFiles;

    useEffect(() => {
      const onPaste = (event) => {
        if (!ready || !(event.target instanceof Element) || !event.target.closest("[data-composer-card]")) return;
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0 || files.every((file) => IMAGE_TYPES.has(file.type))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        draftRef.current = pasteText(event, draftRef.current, input.setDraft);
        void processRef.current(files);
      };
      const onDrop = (event) => {
        if (!ready) return;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0 || files.every((file) => IMAGE_TYPES.has(file.type))) return;
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

    const disabled = !ready || uploading > 0;
    const label = error
      ?? (uploading > 0
        ? t("button.uploading", { count: uploading })
        : ready
          ? t("button.idle")
          : t("button.blocked"));

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
            "data-phase": error ? "error" : uploading > 0 ? "uploading" : "idle",
            "aria-label": label,
            disabled,
            onClick: () => fileInputRef.current?.click(),
          },
          uploading > 0
            ? h(IconLoadingOutline16, { size: 14, className: "lares-file-picker-spin" })
            : h(AttachmentGlyph),
        ),
      ),
    );
  };
}
