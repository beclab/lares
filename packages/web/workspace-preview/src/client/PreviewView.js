import React from "react";
import {
  Button,
  IconDownloadOutline16,
  IconLoadingOutline16,
  MarkdownText,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { errorMessage } from "./locale.js";
import { rewriteWorkspaceTargets } from "@olares/lares-core/files/markdown";
import { downloadCurrentFile } from "./download.js";
import { downloadFileUrl, rawFileHref, rawFileUrl, workspaceLinkClickPath } from "@olares/lares-core/files/preview-workspace";
import { Model3dHost } from "./Model3dHost.js";

const h = React.createElement;
const { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } = React;

function PreviewBody({ data, sessionId, openPath, scroll, t }) {
  if (data.kind === "image") {
    return h(
      "div",
      { className: "lares-preview-media", ...scroll },
      h("img", {
        className: "lares-preview-image",
        src: rawFileUrl(sessionId, data.path, data.modifiedAt),
        alt: data.name,
      }),
    );
  }
  if (data.kind === "video") {
    return h(
      "div",
      { className: "lares-preview-media" },
      h("video", {
        className: "lares-preview-video",
        src: rawFileUrl(sessionId, data.path, data.modifiedAt),
        controls: true,
        playsInline: true,
      }),
    );
  }
  if (data.kind === "audio") {
    return h(
      "div",
      { className: "lares-preview-audio-wrap" },
      h("div", { className: "lares-preview-audio-name" }, data.name),
      h("audio", {
        className: "lares-preview-audio",
        src: rawFileUrl(sessionId, data.path, data.modifiedAt),
        controls: true,
      }),
    );
  }
  if (data.kind === "model3d") {
    return h(Model3dHost, { item: data, sessionId, compact: false });
  }
  if (data.kind === "pdf") {
    return h("iframe", {
      className: "lares-preview-pdf",
      src: rawFileUrl(sessionId, data.path, data.modifiedAt),
      title: data.name,
    });
  }
  if (data.kind === "text" || data.kind === "markdown") {
    const body = data.kind === "markdown"
      ? h(
        "div",
        {
          className: "lares-preview-markdown",
          ...scroll,
          onClick: (event) => {
            const path = workspaceLinkClickPath(sessionId, event);
            if (path === null) return;
            event.preventDefault();
            openPath(path);
          },
        },
        h(MarkdownText, {
          text: rewriteWorkspaceTargets(
            data.text ?? "",
            data.path,
            (path) => rawFileHref(sessionId, path),
          ),
        }),
      )
      : h("pre", { className: "lares-preview-text", ...scroll }, data.text ?? "");
    return h(
      React.Fragment,
      null,
      data.truncated && h("div", { className: "lares-preview-banner" }, t("truncated")),
      body,
    );
  }
  return h(
    "div",
    { className: "lares-preview-empty" },
    h("strong", null, t("unsupportedTitle")),
    h("span", null, t("unsupported")),
  );
}

export function createPreviewView(workspace, t) {
  return function FilePreviewView({ sessionId }) {
    const snapshot = useSyncExternalStore(
      (listener) => workspace.subscribe(sessionId, listener),
      () => workspace.getSnapshot(sessionId),
    );
    const path = snapshot.activePath;
    const content = snapshot.content;
    const scrollRef = useRef(null);
    const ready = content.status === "ready";
    const [downloadError, setDownloadError] = useState(null);

    useLayoutEffect(() => {
      setDownloadError(null);
    }, [path]);

    // Before paint, so reopening a tab shows no jump from the top.
    useLayoutEffect(() => {
      const node = scrollRef.current;
      if (node !== null && path) node.scrollTop = workspace.scrollOffset(sessionId, path);
    }, [sessionId, path, ready]);

    const onScroll = useCallback(
      (event) => workspace.rememberScroll(sessionId, path, event.currentTarget.scrollTop),
      [sessionId, path],
    );

    if (!path) {
      return h("div", { className: "lares-preview-empty" }, t("empty"));
    }
    return h(
      "section",
      { className: "lares-preview-view", "aria-label": t("preview") },
      h(
        "div",
        { className: "lares-preview-header" },
        h("div", { className: "lares-preview-path", title: path }, path),
        downloadError && h("div", { className: "lares-preview-download-error", role: "alert" }, downloadError),
        h(
          Button,
          {
            variant: "ghost",
            size: "sm",
            className: "lares-preview-download",
            onClick: () => {
              void downloadCurrentFile(downloadFileUrl(sessionId, path)).then(
                () => setDownloadError(null),
                (error) => setDownloadError(errorMessage(
                  t,
                  error instanceof Error ? error.message : "file_preview_failed",
                )),
              );
            },
          },
          h(IconDownloadOutline16, { size: 14 }),
          t("download"),
        ),
      ),
      h(
        "div",
        { className: "lares-preview-content" },
        (content.status === "idle" || content.status === "loading") && h(
          "div",
          { className: "lares-preview-empty" },
          h(IconLoadingOutline16, { className: "lares-preview-spinner" }),
          h("span", null, t("loading")),
        ),
        content.status === "error" && h(
          "div",
          { className: "lares-preview-empty" },
          h("strong", null, t("failed")),
          h("span", null, errorMessage(t, content.message)),
          h(
            Button,
            {
              variant: "outline",
              size: "sm",
              onClick: () => workspace.retry(sessionId, path),
            },
            t("retry"),
          ),
        ),
        content.status === "ready" && h(PreviewBody, {
          data: content.data,
          sessionId,
          openPath: (target) => workspace.open(sessionId, target),
          scroll: { ref: scrollRef, onScroll },
          t,
        }),
      ),
    );
  };
}
